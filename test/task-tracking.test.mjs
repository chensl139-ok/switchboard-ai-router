import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {UsageStore} from '../usage-store.mjs';
import {createApp} from '../server.mjs';
import {taskIdentifier} from '../task-tracking.mjs';
import {renderTaskSummary} from '../public/request-logs.js';
import {platformOpenAPI} from '../openapi.mjs';
const temp=()=>mkdtempSync(path.join(tmpdir(),'switchboard-task-'));
const admin='a'.repeat(32),gateway='g'.repeat(32);

test('任务按最新请求验收；跨币种、未知费用、并发跨度和累计耗时独立核算，反馈幂等',()=>{
 const dir=temp(),store=new UsageStore(dir),tracker=store.tasks;
 try{
  tracker.start('r1','job','key:a',1000);tracker.start('r2','job','key:a',1100);
  store.record({id:'a1',requestId:'r1',time:new Date(1300).toISOString(),startedAt:1000,status:200,latency:300,tokens:10,usageKnown:true,currency:'USD',estimatedCost:0.1});
  store.record({id:'a2',requestId:'r2',time:new Date(1400).toISOString(),startedAt:1100,status:503,latency:300,tokens:0,usageKnown:false});
  store.record({id:'a3',requestId:'r2',time:new Date(1500).toISOString(),startedAt:1400,status:200,latency:100,tokens:20,usageKnown:true,currency:'CNY',estimatedCost:0.2});
  tracker.finish('r1','completed','a1',1300);tracker.feedback('r1','key:a',{outcome:'rejected',reason:'parse_error'},1400);
  assert.equal(tracker.summary('job','key:a',1450).outcome,'running');
  tracker.finish('r2','completed','a3',1500);
  assert.equal(tracker.summary('job','key:a').outcome,'unverified');
  const summary=tracker.feedback('r2','key:a',{outcome:'accepted'},1600);
  assert.deepEqual([summary.elapsedMs,summary.attemptLatencyMs,summary.tokens,summary.unknownCostAttempts,summary.acceptanceFailures],[600,700,30,1,1]);
  assert.deepEqual(summary.costs,[{currency:'USD',amount:.1},{currency:'CNY',amount:.2}]);
  assert.equal(summary.outcome,'accepted');
  assert.equal(tracker.feedback('r2','key:a',{outcome:'accepted'},9999).elapsedMs,600);
  assert.throws(()=>tracker.feedback('r2','key:a',{outcome:'rejected',reason:'schema_error'}),e=>e.status===409);
  assert.throws(()=>tracker.feedback('r1','key:other',{outcome:'accepted'}),e=>e.status===404);
  assert.throws(()=>tracker.summary('job','key:other'),e=>e.status===404);
  const page=store.logs({taskRequestId:'r1',limit:1});assert.equal(page.total,3);assert.equal(page.items.length,1);
  assert.equal(store.logs({q:'job'}).total,3);
  assert.equal(store.logs({acceptance:'rejected'}).items[0].acceptance,'rejected');
  const html=renderTaskSummary(summary,x=>String(x).replaceAll('<','&lt;'));
  assert.match(html,/验收通过/);assert.match(html,/USD 0.100000/);assert.match(html,/CNY 0.200000/);assert.match(html,/1 次费用未知/);
  store.resetStatistics('clear');assert.throws(()=>tracker.summary('job','key:a'),e=>e.status===404);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('旧 SQLite 无损迁移；重启保留反馈并终止中断任务；不同租户同名任务隔离',()=>{
 const dir=temp(),other=temp();let store,second;
 try{
  const db=new DatabaseSync(path.join(dir,'usage.sqlite'));
  db.exec('CREATE TABLE calls(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,time TEXT NOT NULL,actor_id TEXT,api_key_id TEXT,provider_id TEXT,provider TEXT,model TEXT,status INTEGER,latency INTEGER,input_tokens INTEGER,output_tokens INTEGER,tokens INTEGER,usage_known INTEGER,currency TEXT,estimated_cost REAL,price_source TEXT,reason TEXT,transport TEXT)');db.close();
  store=new UsageStore(dir);const now=Date.now();store.tasks.start('persist','same','key:a',now);store.tasks.finish('persist','completed','x',now+10);store.tasks.feedback('persist','key:a',{outcome:'accepted'},now+20);store.tasks.start('interrupted','unfinished','key:a');store.close();
  store=new UsageStore(dir);assert.equal(store.tasks.summary('same','key:a').outcome,'accepted');assert.equal(store.tasks.summary('unfinished','key:a').outcome,'gateway_failed');
  second=new UsageStore(other);assert.throws(()=>second.tasks.summary('same','key:a'),e=>e.status===404);
  second.tasks.start('different','same','key:a');assert.equal(second.tasks.summary('same','key:a').outcome,'running');
 }finally{store?.close();second?.close();rmSync(dir,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});

test('API：200 解析验收失败→同任务备用模型通过；反馈不触发调用、不改健康或配额，Key 隔离',async()=>{
 const dir=temp();let calls=0;
 const app=createApp({dir,admin,gateway,fetcher:async()=>{calls++;return Response.json({choices:[{message:{role:'assistant',content:'extra text {}'}}],usage:{prompt_tokens:8,completion_tokens:4,total_tokens:12}});}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const request=(url,data,token=admin,headers={})=>fetch(base+url,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
 try{
  assert.equal((await request('/api/provider',{id:'one',name:'One',baseUrl:'https://test.example/v1',protocol:'openai',model:'m1',models:['m1','m2'],enabled:true,apiKey:'secret'})).status,200);
  const a=await(await request('/api/keys',{name:'a'})).json(),b=await(await request('/api/keys',{name:'b'})).json();
  assert.equal((await request('/api/prices',{providerId:'one',model:'m1',currency:'USD',inputPerMillion:1,outputPerMillion:2})).status,200);
  const input={model:'one::m1',messages:[{role:'user',content:'json'}]};
  const first=await request('/v1/chat/completions',input,a.token,{'x-task-id':'job-1'});await first.json();
  assert.equal(first.status,200);assert.equal(first.headers.get('x-task-id'),'job-1');assert.ok(first.headers.get('x-attempt-id'));
  const id=first.headers.get('x-request-id'),url='/v1/requests/'+id+'/feedback';
  assert.equal((await request(url,{outcome:'rejected',reason:'parse_error'},b.token)).status,404);
  assert.equal((await request(url,{outcome:'rejected'},a.token)).status,400);
  assert.equal((await request(url,{outcome:'rejected',reason:'parse_error',text:'private'},a.token)).status,400);
  assert.equal((await request(url,{outcome:'rejected',reason:'parse_error'},a.token)).status,200);
  assert.equal((await request(url,{outcome:'rejected',reason:'parse_error'},a.token)).status,200);assert.equal(calls,1);
  const retry=await request('/v1/chat/completions',{...input,model:'one::m2'},a.token,{'x-task-id':'job-1'});await retry.json();
  const feedback=await request('/v1/requests/'+retry.headers.get('x-request-id')+'/feedback',{outcome:'accepted'},a.token);
  const summary=await feedback.json();assert.equal(summary.outcome,'accepted');assert.equal(summary.attemptCount,2);assert.equal(summary.tokens,24);assert.equal(summary.acceptanceFailures,1);assert.ok(Math.abs(summary.costs[0].amount-0.000016)<1e-12);assert.equal(summary.unknownCostAttempts,1);
  assert.equal((await request('/v1/tasks/job-1',null,b.token)).status,404);
  const own=await request('/v1/chat/completions',input,b.token,{'x-task-id':'job-1'});await own.json();
  assert.equal((await(await request('/v1/tasks/job-1',null,b.token)).json()).attemptCount,1);
  const logs=await(await request('/api/logs?taskRequestId='+id+'&limit=1')).json();assert.equal(logs.total,2);assert.equal(logs.items.length,1);
  const traced=await(await request('/api/tasks?requestId='+id)).json();assert.equal(traced.attemptCount,2);
  assert.equal((await(await request('/api/analytics')).json()).totals.requestSuccesses,3);
  assert.equal((await(await request('/api/keys')).json()).keys.find(k=>k.id===a.key.id).requests,2);
  assert.equal((await request('/v1/chat/completions',input,a.token,{'x-task-id':'bad space'})).status,400);assert.equal(calls,3);
  const unlinked=await request('/v1/chat/completions',input,a.token);await unlinked.json();assert.equal(unlinked.headers.get('x-task-id'),unlinked.headers.get('x-request-id'));
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('API：流式 HTTP 200 后中断仍为调用失败；已知用量保留，拒绝验收',async()=>{
 const dir=temp();const app=createApp({dir,admin,gateway,fetcher:async()=>new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\ndata: {"error":{"message":"broken"}}\n\n',{headers:{'content-type':'text/event-stream'}})});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const req=(url,data,token=admin)=>fetch(base+url,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-task-id':'stream'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  await req('/api/provider',{id:'one',name:'One',baseUrl:'https://test.example/v1',protocol:'openai',model:'m1',enabled:true,apiKey:'secret'});
  const response=await req('/v1/chat/completions',{model:'auto',stream:true,messages:[{role:'user',content:'hi'}]},gateway);
  assert.equal(response.status,200);assert.match(await response.text(),/error/);
  const summary=await(await req('/v1/tasks/stream',null,gateway)).json();assert.equal(summary.outcome,'gateway_failed');assert.equal(summary.attempts[0].upstream_status,200);assert.equal(summary.attempts[0].failure_kind,'response_processing');assert.equal(summary.tokens,10);assert.equal(summary.unknownUsageAttempts,0);
  assert.equal((await req('/v1/requests/'+response.headers.get('x-request-id')+'/feedback',{outcome:'accepted'},gateway)).status,409);
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('任务 ID 和 OpenAPI 契约',()=>{
 for(const value of ['',[],{},'contains space','a'.repeat(129)])assert.throws(()=>taskIdentifier(value,'fallback'));
 assert.equal(taskIdentifier(undefined,'fallback'),'fallback');
 for(const p of ['/v1/messages','/v1/responses','/v1/completions','/v1/chat/completions'])assert.equal(platformOpenAPI.paths[p].post.parameters[0].name,'X-Task-ID');
 assert.ok(platformOpenAPI.paths['/v1/tasks/{taskId}']);assert.ok(platformOpenAPI.paths['/v1/requests/{requestId}/feedback']);
});

test('同服务商及跨服务商回退仍归同请求，后续新请求归同任务',async()=>{
 const dir=temp();let counter=0;
 const app=createApp({dir,admin,gateway,fetcher:async()=>{counter++;if(counter===1)throw Error('network unreachable');if(counter===2)return new Response('unavailable',{status:503});return Response.json({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}});}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const req=(url,data,token=admin)=>fetch(base+url,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-task-id':'fallback-job'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  for(const id of ['one','two'])await req('/api/provider',{id,name:id,baseUrl:'https://'+id+'.example/v1',protocol:'openai',model:'m1',models:['m1','m2'],enabled:true,apiKey:'secret'});
  await req('/api/routing',{active:'one',strategy:'fallback',routing:{maxAttempts:3,timeoutMs:30000,concurrency:5,requestsPerMinute:60}});
  const input={model:'auto',messages:[{role:'user',content:'hi'}]};
  const response=await req('/v1/chat/completions',input,gateway);assert.equal(response.status,200);await response.json();
  const summary=await(await req('/v1/tasks/fallback-job',null,gateway)).json();
  assert.equal(summary.requestCount,1);assert.equal(summary.attemptCount,3);assert.deepEqual(summary.attempts.map(a=>[a.provider_id,a.model]),[['one','m1'],['one','m2'],['two','m1']]);
  assert.equal(summary.attempts[0].failure_kind,'transport');assert.equal(summary.attempts[0].upstream_status,null);assert.equal(summary.attempts[1].failure_kind,'upstream_http');
  await req('/v1/requests/'+response.headers.get('x-request-id')+'/feedback',{outcome:'rejected',reason:'schema_error'},gateway);
  const next=await req('/v1/chat/completions',input,gateway);await next.json();
  const final=await(await req('/v1/requests/'+next.headers.get('x-request-id')+'/feedback',{outcome:'accepted'},gateway)).json();
  assert.equal(final.requestCount,2);assert.equal(final.attemptCount,4);assert.equal(final.upstreamFailures,2);assert.equal(final.acceptanceFailures,1);assert.equal(final.outcome,'accepted');
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('四种入口协议均可关联任务与验收，SSE 完成与非流式一致',async()=>{
 const dir=temp();const app=createApp({dir,admin,gateway,fetcher:async(url,options)=>JSON.parse(options.body).stream?new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json({choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}})});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const req=(url,data,token=gateway)=>fetch(base+url,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-task-id':'protocols'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  await req('/api/provider',{id:'one',name:'One',baseUrl:'https://one.example/v1',protocol:'openai',model:'m1',enabled:true,apiKey:'secret'},admin);
  for(const stream of [false,true])for(const [endpoint,input] of [['chat/completions',{messages:[{role:'user',content:'hi'}]}],['messages',{messages:[{role:'user',content:'hi'}],max_tokens:20}],['responses',{input:'hi'}],['completions',{prompt:'hi'}]]){
   const r=await req('/v1/'+endpoint,{...input,model:'auto',stream});assert.equal(r.status,200);assert.match(await r.text(),/OK/);assert.ok(r.headers.get('x-attempt-id'));
   assert.equal((await req('/v1/requests/'+r.headers.get('x-request-id')+'/feedback',{outcome:'accepted'})).status,200);
  }
  const s=await(await req('/v1/tasks/protocols')).json();assert.equal(s.requestCount,8);assert.equal(s.attemptCount,8);assert.equal(s.outcome,'accepted');assert.equal(s.tokens,24);
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('平台会话：成员仅查看自己的任务，管理员可查看本租户；跨租户拒绝',async()=>{
 const {createPlatform}=await import('../platform.mjs');const dir=temp();const app=createPlatform({dir,admin,gateway,oauthConfig:[],fetcher:async()=>Response.json({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const req=async(url,data,cookie)=>{const response=await fetch(base+url,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),'x-task-id':'members'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],id:response.headers.get('x-request-id')};};
 try{
  const owner=(await req('/api/account/setup',{name:'Owner',email:'owner@example.invalid',password:'test-only-password-123',bootstrapToken:admin})).cookie;
  await req('/api/provider',{id:'one',name:'One',baseUrl:'https://one.example/v1',protocol:'openai',model:'m',enabled:true,apiKey:'secret'},owner);
  const invite=(await req('/api/account/invite',{email:'member@example.invalid',role:'member'},owner)).body;
  const member=(await req('/api/account/register',{name:'Member',email:'member@example.invalid',password:'test-only-password-123',inviteCode:invite.code})).cookie;
  const input={model:'auto',messages:[{role:'user',content:'hi'}]},a=await req('/api/chat',input,owner),b=await req('/api/chat',input,member);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal((await req('/api/logs',null,member)).body.total,1);
  assert.equal((await req('/api/tasks?requestId='+a.id,null,member)).status,404);
  assert.equal((await req('/api/tasks?requestId='+b.id,null,owner)).status,200);
  assert.equal((await req('/v1/requests/'+a.id+'/feedback',{outcome:'accepted'},member)).status,404);
  assert.equal((await req('/v1/requests/'+b.id+'/feedback',{outcome:'accepted'},member)).status,200);
  const second=(await req('/api/account/tenants',{name:'Second'},owner)).body;
  await req('/api/account/switch',{tenantId:second.id},owner);
  assert.equal((await req('/api/tasks?requestId='+a.id,null,owner)).status,404);
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
