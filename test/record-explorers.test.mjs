import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../accounts.mjs';
import {UsageStore} from '../usage-store.mjs';
import {normalizeLogFilters,diagnoseAttempt,renderLogs,renderTaskSummary} from '../public/request-logs.js';

test('审计先按租户隔离，再组合筛选和分页；可检索前 200 条之外的历史操作',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-audit-'));
 const now=Date.now(),account=new Accounts(dir,'x'.repeat(32),{now:()=>now});
 try{
  account.state.users=[{id:'a',name:'管理员甲',email:'alpha@example.com'},{id:'b',name:'成员乙',email:'beta@example.com'},{id:'c',name:'私有租户用户',email:'private@example.com'}];
  for(let i=0;i<240;i++)account.event('default',i%2?'a':'b','/api/provider',`服务商 ${i}`);
  account.event('other','c','/api/provider','不可见对象');
  account.event('default','a','member.role','b');
  const caller={role:'owner',tenantId:'default'};
  assert.equal(account.auditPage(caller).total,241);
  assert.equal(account.auditPage(caller,{q:'服务商 0'}).items[0].target,'服务商 0');
  assert.equal(account.auditPage(caller,{q:'ALPHA@EXAMPLE.COM',category:'provider',actor:'a'}).total,120);
  const roles=account.auditPage(caller,{category:'member',q:'成员乙'});assert.equal(roles.total,1);assert.equal(roles.items[0].targetName,'成员乙');
  const first=account.auditPage(caller,{limit:20}),second=account.auditPage(caller,{limit:20,page:2});
  assert.equal(first.items.length,20);assert.equal(second.items.length,20);assert.ok(!first.items.some(a=>second.items.some(b=>a.id===b.id)));
  assert.equal(account.auditPage(caller,{limit:20,page:999}).page,13);
  assert.ok(!first.actors.some(actor=>actor.id==='c'));assert.equal(account.auditPage(caller,{q:'不可见'}).total,0);
  account.state.audit.find(item=>item.target==='服务商 0').time=new Date(now-40*86400000).toISOString();
  assert.equal(account.auditPage(caller,{days:30,q:'服务商 0'}).total,0);
  assert.equal(account.auditPage(caller,{days:90,q:'服务商 0'}).total,1);
  account.event('default','a','account.login.feishu','cli_example/ou_example');
  account.event('default','a','/api/models/discover','旧版发现');
  assert.equal(account.auditPage(caller).total,241,'默认列表应隐藏历史登录和旧版只读发现记录');
  assert.equal(account.auditPage(caller,{includeRoutine:'1'}).total,243,'需要时仍可查询已保存的例行历史记录');
  assert.throws(()=>account.auditPage({role:'member',tenantId:'default'}),{status:403});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('请求日志支持时间、模型、服务商、状态、Key 组合过滤和精确请求追踪',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-log-')),store=new UsageStore(dir);
 try{
  const now=Date.now();
  const rows=[
   {id:'1',requestId:'trace-123',providerId:'a',provider:'Alpha',model:'gpt-4o',status:502,reason:'上游超时',apiKeyId:'key-a'},
   {id:'2',requestId:'trace-123',providerId:'b',provider:'Beta',model:'GLM-5',status:200,reason:'故障转移',apiKeyId:'key-a'},
   {id:'3',requestId:'trace-123-other',providerId:'a',provider:'Alpha',model:'GLM-5',status:200,apiKeyId:'key-b'},
   {id:'4',requestId:'old',providerId:'a',provider:'Alpha',model:'gpt-4o',status:200,time:new Date(now-15*86400000).toISOString()}
  ];
  rows.forEach(row=>store.record({time:new Date(now).toISOString(),...row}));
  assert.equal(store.logs({days:7}).total,3);
  assert.equal(store.logs({q:'ALPHA',days:7,status:'error',apiKeyId:'key-a'}).total,1);
  assert.equal(store.logs({q:'故障转移',provider:'b'}).total,1);
  assert.equal(store.logs({q:'trace-123'}).total,3);
  assert.equal(store.logs({requestId:'trace-123'}).total,2);
  assert.equal(store.logs({q:'%'}).total,0);
  assert.equal(store.logs({requestId:'trace-123',status:'success'}).items[0].id,'2');
  const page=store.logs({requestId:'trace-123',limit:1,page:50});assert.equal(page.page,2);assert.equal(page.items.length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const metadataKey='0123456789abcdefabcd';
const logState={providers:[{id:'p&1',name:'<Provider>'}]};

test('log initial filters whitelist metadata and reject credentials and unsupported values',()=>{
 const input={q:' model & name ',days:90,provider:'p&1',status:'error',acceptance:'rejected',apiKeyId:metadataKey,requestId:'request/1',taskRequestId:'task-request/2',token:'not-accepted',apiKey:'not-accepted',limit:999};
 const filters=normalizeLogFilters(input,logState);
 assert.deepEqual(filters,{q:'model & name',days:'90',provider:'p&1',status:'error',acceptance:'rejected',apiKeyId:metadataKey,requestId:'',taskRequestId:'task-request/2'});
 assert.equal(input.requestId,'request/1');
 for(const days of ['',1,7,'30',90])assert.equal(normalizeLogFilters({days}).days,String(days));
 for(const days of ['999','30&status=error',' 7 ',[],{},null])assert.equal(normalizeLogFilters({days}).days,'7');
 const invalid=normalizeLogFilters({provider:'other',status:'all',acceptance:'pass',apiKeyId:'not-a-key-id',q:{},requestId:[],taskRequestId:42},logState);
 assert.deepEqual(invalid,{q:'',days:'7',provider:'',status:'',acceptance:'',apiKeyId:'',requestId:'',taskRequestId:''});
 for(const secret of ['srk_tenant_'+metadataKey+'_secret','sk-secret-text','Bearer private-token','eyJhbGci.eyJzdWI.signature','token=plaintext','api_key: plaintext']){
  const result=normalizeLogFilters({q:secret,apiKeyId:secret,requestId:secret,taskRequestId:secret});
  for(const field of ['q','apiKeyId','requestId','taskRequestId'])assert.equal(result[field],'');
 }
 assert.equal(normalizeLogFilters({q:'a'.repeat(210)+' srk_secret'}).q,'','detect credentials before truncating');
 assert.equal(normalizeLogFilters({q:'a'.repeat(210)}).q.length,200);
 assert.equal(normalizeLogFilters({requestId:'request-1'}).days,'');
 assert.equal(normalizeLogFilters({taskRequestId:'request-1',days:'7'}).days,'7');
 assert.equal(normalizeLogFilters(null).days,'7');
});

test('attempt diagnostics use failure stage and upstream status without asserting task outcome',()=>{
 const cases=[
  [{failure_kind:'cancelled',upstream_status:200,status:502},'cancelled',/中断|取消/],
  [{failure_kind:'timeout',upstream_status:200,status:502},'timeout',/超时/],
  [{failure_kind:'response_processing',upstream_status:200,status:422},'response_processing',/响应处理/],
  [{failure_kind:'upstream_http',upstream_status:401,status:502},'auth',/鉴权/],
  [{upstream_status:'403',status:502},'auth',/权限/],
  [{upstream_status:429,status:502},'rate_limit',/限流/],
  [{status:529},'rate_limit',/繁忙/],
  [{status:504},'timeout',/超时/],
  [{failure_kind:'transport',upstream_status:null,status:502},'network',/网络/],
  [{status:499},'cancelled',/取消/],
  [{upstream_status:503,status:502},'upstream',/上游/],
  [{status:404},'request',/模型|接口/],
  [{status:200,upstream_status:200},'completed',/本次上游尝试已完成/],
  [{status:502,upstream_status:200},'unknown',/待确认/],
  [{failure_kind:'<script>',status:'bad'},'unknown',/待确认/],
  [{status:502},'unknown',/待确认/],
  [{},'unknown',/待确认/]
 ];
 for(const [record,kind,title] of cases){
  const before=structuredClone(record),result=diagnoseAttempt(record);assert.equal(result.kind,kind);assert.match(result.title,title);assert.ok(result.suggestion.length>10);assert.match(result.href,/^#[a-z]+$/);assert.doesNotMatch(JSON.stringify(result),/<script>|任务已失败|请求最终失败/);assert.deepEqual(record,before);
 }
 assert.match(diagnoseAttempt({status:200}).suggestion,/不代表输出验收通过/);
 assert.match(diagnoseAttempt({failure_kind:'transport'}).suggestion,/不能证明上游未执行/);
});

function logDOM(){
 const fields=['q','days','provider','status','acceptance','apiKeyId'];
 const form={isConnected:true,elements:Object.fromEntries(fields.map(field=>[field,{value:field==='days'?'7':''}]))};
 const elements=new Map(['log-trace','log-trace span','log-summary','log-updated','log-error','log-task-summary','log-data','log-range','log-page','log-prev','log-next','log-query','log-refresh','log-trace-clear'].map(id=>['#'+id,{innerHTML:'',textContent:'',hidden:false,disabled:false}]));
 elements.set('#log-filters',form);elements.set('#log-model',form.elements.q);elements.set('#log-key',form.elements.apiKeyId);
 const root={isConnected:true,innerHTML:'',classList:{add(){}},setAttribute(){},contains:node=>node===form&&form.isConnected,querySelector:selector=>elements.get(selector)};
 return {root,form,elements};
}
const logItem={id:'attempt-1',request_id:'req/1 & <tag>',task_id:'task-1',time:'2026-11-01T00:00:00Z',provider:'<Provider>',provider_id:'p&1',model:'model&1',status:502,upstream_status:200,failure_kind:'response_processing',transport:'sse',latency:120,usage_known:0,estimated_cost:null,reason:'<reason>',api_key_id:metadataKey};
const taskSummary={taskId:'task-1',outcome:'unverified',elapsedMs:500,attemptLatencyMs:120,requestCount:1,attemptCount:1,upstreamFailures:1,acceptanceFailures:0,tokens:0,unknownUsageAttempts:1,unknownCostAttempts:1,costs:[],requests:[{request_id:logItem.request_id,status:'completed',feedback:null}],notice:'<仅供参考>'};
const pageResult=(items=[logItem],page=1,total=items.length)=>({items,page,total,limit:25});
async function withLogDOM(run){
 const previousDocument=globalThis.document,previousFormData=globalThis.FormData,dom=logDOM();
 globalThis.document={querySelector:()=>dom.root};
 globalThis.FormData=class{constructor(form){this.entries=Object.entries(form.elements).map(([key,input])=>[key,input.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}};
 try{return await run(dom);}finally{globalThis.document=previousDocument;globalThis.FormData=previousFormData;}
}

test('logs initialize existing form, encode task API lookups, and escape diagnostics and trace links',async()=>withLogDOM(async dom=>{
 const calls=[];
 await renderLogs({state:logState,esc,initialFilters:{days:'90',q:'model & q',provider:'p&1',status:'error',acceptance:'rejected',apiKeyId:metadataKey,taskRequestId:logItem.request_id},api:async url=>{calls.push(url);return url.startsWith('/api/tasks?')?taskSummary:pageResult();}});
 const params=new URLSearchParams(calls[0].split('?')[1]);
 for(const [key,value] of Object.entries({days:'90',q:'model & q',provider:'p&1',status:'error',acceptance:'rejected',apiKeyId:metadataKey,taskRequestId:logItem.request_id,page:'1',limit:'25'}))assert.equal(params.get(key),value);
 assert.equal(params.has('requestId'),false);assert.equal(new URLSearchParams(calls[1].split('?')[1]).get('requestId'),logItem.request_id);
 assert.equal(dom.form.elements.days.value,'90');assert.equal(dom.elements.get('#log-trace').hidden,false);assert.match(dom.elements.get('#log-trace span').textContent,/关联请求/);
 const html=dom.elements.get('#log-data').innerHTML;assert.match(html,/diagnostic-note/);assert.match(html,/不能据此判断请求或任务最终结果/);assert.match(html,/响应处理中断/);assert.match(html,/href="#connect"/);assert.match(html,/&lt;reason&gt;/);assert.match(html,/费用未知/);assert.doesNotMatch(html,/<Provider>|<reason>|<tag>/);
 const links=[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1].replaceAll('&amp;','&'));
 assert.equal(new URLSearchParams(links.find(link=>link.includes('taskRequestId=')).split('?')[1]).get('taskRequestId'),logItem.request_id);
 assert.match(dom.elements.get('#log-task-summary').innerHTML,/data-task-request=/);assert.match(dom.root.innerHTML,/value="90"/);
 let prevented=false;
 dom.elements.get('#log-task-summary').onclick({target:{closest:()=>({dataset:{taskRequest:logItem.request_id}})},preventDefault(){prevented=true;}});await new Promise(setImmediate);
 const requestParams=new URLSearchParams(calls.at(-1).split('?')[1]);assert.ok(prevented);assert.equal(requestParams.get('requestId'),logItem.request_id);assert.equal(requestParams.has('taskRequestId'),false);assert.equal(requestParams.get('days'),'');assert.equal(requestParams.get('status'),'');
 dom.elements.get('#log-data').onclick({target:{closest:selector=>selector==='[data-task]'?{dataset:{task:'0'}}:null},preventDefault(){}});await new Promise(setImmediate);
 assert.ok(calls.at(-1).startsWith('/api/tasks?'));assert.equal(new URLSearchParams(calls.at(-2).split('?')[1]).get('taskRequestId'),logItem.request_id);
 dom.elements.get('#log-trace-clear').onclick();await new Promise(setImmediate);assert.equal(dom.elements.get('#log-trace').hidden,true);assert.equal(new URLSearchParams(calls.at(-1).split('?')[1]).has('taskRequestId'),false);
}));

test('logs retain pagination and ignore superseded results and results after navigation',async()=>withLogDOM(async dom=>{
 const pending=[];
 const first=renderLogs({state:logState,esc,api:url=>new Promise(resolve=>pending.push({url,resolve}))});
 dom.form.elements.status.value='error';dom.form.onchange({target:{tagName:'SELECT'}});
 pending[1].resolve(pageResult([{...logItem,model:'newer',status:'<status>'}],1,60));await new Promise(setImmediate);
 assert.match(dom.elements.get('#log-data').innerHTML,/newer/);assert.match(dom.elements.get('#log-data').innerHTML,/&lt;status&gt;/);assert.doesNotMatch(dom.elements.get('#log-data').innerHTML,/<status>/);
 pending[0].resolve(pageResult([{...logItem,model:'stale'}]));await first;assert.doesNotMatch(dom.elements.get('#log-data').innerHTML,/stale/);
 dom.elements.get('#log-next').onclick();assert.equal(new URLSearchParams(pending[2].url.split('?')[1]).get('page'),'2');
 pending[2].resolve(pageResult([],2,60));await new Promise(setImmediate);assert.equal(dom.elements.get('#log-page').textContent,'2 / 3');
 dom.elements.get('#log-refresh').onclick();dom.form.isConnected=false;dom.elements.get('#log-data').innerHTML='left-page';pending[3].resolve(pageResult());await new Promise(setImmediate);assert.equal(dom.elements.get('#log-data').innerHTML,'left-page');
}));

test('task summary deep-links request IDs safely and keeps unknown cost counts',()=>{
 const html=renderTaskSummary(taskSummary,esc);assert.match(html,/未知/);assert.match(html,/暂无已知费用/);assert.match(html,/&lt;仅供参考&gt;/);assert.doesNotMatch(html,/<tag>|<仅供参考>/);
 const href=html.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&');const params=new URLSearchParams(href.split('?')[1]);assert.equal(params.get('requestId'),logItem.request_id);assert.equal(params.get('days'),'');
});
