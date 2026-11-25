import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConversationClient,conversationMessages,conversationPayload,conversationBlockReason,conversationRequest} from '../public/conversations.js';

const settle=()=>new Promise(setImmediate);
function clock(){
 let time=1000,next=0;const jobs=new Map();
 const add=(fn,delay,repeat=0)=>{const id=++next;jobs.set(id,{fn,at:time+delay,repeat});return id;};
 return {now:()=>time,setTimeout:(fn,delay)=>add(fn,delay),clearTimeout:id=>jobs.delete(id),setInterval:(fn,delay)=>add(fn,delay,delay),clearInterval:id=>jobs.delete(id),
  async advance(ms){const end=time+ms;for(;;){const candidates=[...jobs].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at);if(!candidates.length)break;const [id,job]=candidates[0];time=job.at;if(job.repeat)job.at+=job.repeat;else jobs.delete(id);job.fn();await settle();}time=end;await settle();},get size(){return jobs.size;}};
}
function harness(t){
 const timers=clock(),records=new Map(),calls=[];let sequence=0,inflight=0,maximum=0,nextError=null;
 const fetcher=async(url,options)=>{
  inflight++;maximum=Math.max(maximum,inflight);await Promise.resolve();
  const route=url.replace('/api/account/conversations',''),body=options.body?JSON.parse(options.body):undefined;calls.push({route,body,options});
  try{
   if(nextError){const {status,message}=nextError;nextError=null;return {ok:false,status,json:async()=>({error:{message}})};}
   const ok=value=>({ok:true,status:200,json:async()=>structuredClone(value)});
   if(route.startsWith('/item?'))return ok(records.get(new URLSearchParams(route.split('?')[1]).get('id')));
   if(route.startsWith('?'))return ok({items:[...records.values()].map(({messages,settings,runId,...row})=>row),total:records.size,page:1,pages:1,limit:20});
   if(route===''||route==='/import'){
    if(route==='/import'){const found=[...records.values()].find(row=>row.sourceHistoryId===body.historyId);if(found)return ok(found);}
    const row={id:`c${++sequence}`,title:'新对话',messages:[],draft:'',settings:{},pinned:false,archived:false,status:'idle',revision:1,runId:null,leaseUntil:null,...(route==='/import'?{sourceHistoryId:body.historyId,messages:[{role:'user',content:'旧文本'}]}:body)};records.set(row.id,row);return ok(row);
   }
   const row=records.get(body.id);
   if(body.expectedRevision!==row.revision)return {ok:false,status:409,json:async()=>({error:{message:'版本冲突，保留本地副本'}})};
   if(route==='/delete'){records.delete(body.id);return ok({ok:true});}
   if(route==='/update'&&row.status==='running')throw Error('ordinary update during run');
   if(['/run/checkpoint','/run/finish'].includes(route)){assert.equal(body.runId,row.runId);assert.ok(row.leaseUntil>timers.now());}
   const {id,expectedRevision,runId,...patch}=body;Object.assign(row,patch);row.revision++;
   if(route==='/run/start'){row.runId=`run-${row.revision}`;row.status='running';row.leaseUntil=timers.now()+120000;}
   if(route==='/run/checkpoint')row.leaseUntil=timers.now()+120000;
   if(route==='/run/finish'||route==='/run/recover'){row.runId=null;row.leaseUntil=null;if(route.endsWith('recover'))row.status='interrupted';}
   return ok(row);
  }finally{inflight--;}
 };
 const client=createConversationClient({tenantId:'tenant-a',userId:'owner-a',fetcher,now:timers.now,timers});t.after(()=>client.dispose());
 return {client,timers,records,calls,get maximum(){return maximum;},fail(status=409,message='版本冲突，保留本地副本'){nextError={status,message};}};
}

test('500ms 草稿保存、发送前 flush 和 CAS start 串行，不携带 userId',async t=>{
 const h=harness(t),entry=h.client.local();
 h.client.change(entry,{draft:'草稿一'});await h.timers.advance(499);assert.equal(h.calls.length,0);
 h.client.change(entry,{draft:'草稿二'});await h.timers.advance(500);
 assert.equal(h.records.get(entry.id).draft,'草稿二');
 h.client.change(entry,{draft:'发送前最后编辑'});
 const messages=[{role:'user',content:'发送前最后编辑'},{role:'assistant',content:'',status:'生成中'}];
 const run=await h.client.start(entry,{messages,settings:{...entry.settings,target:'personal-auto'}});
 assert.deepEqual(h.calls.map(call=>call.route),['','/update','/run/start']);
 assert.equal(h.calls[1].body.draft,'发送前最后编辑');assert.equal(h.calls[2].body.expectedRevision,2);
 assert.equal(run.owner,'owner-a');assert.equal(run.tenantId,'tenant-a');assert.equal(run.id,entry.id);assert.equal(run.revision,3);
 assert.equal(run.settings.target,'personal-auto');assert.equal(h.maximum,1);
 for(const call of h.calls){assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.headers['X-Tenant-ID'],'tenant-a');assert.ok(!Object.hasOwn(call.body,'userId'));}
});

test('并行保存只以最新 revision 写入，旧响应不覆盖较新草稿',async t=>{
 const h=harness(t),entry=h.client.local();await h.client.flush(entry);
 h.client.change(entry,{draft:'第一版'});const first=h.client.flush(entry);await Promise.resolve();
 h.client.change(entry,{draft:'第二版'});const second=h.client.flush(entry);await Promise.all([first,second]);
 assert.equal(entry.draft,'第二版');assert.equal(h.records.get(entry.id).draft,'第二版');assert.equal(entry.version,entry.savedVersion);
 assert.deepEqual(h.calls.filter(call=>call.route==='/update').map(call=>call.body.expectedRevision),[1,2]);assert.equal(h.maximum,1);
});

test('409 不启动上游、不自动重试，保留可导出的本地副本并可分支或重新加载',async t=>{
 const h=harness(t),entry=h.client.local();await h.client.flush(entry);
 h.client.change(entry,{draft:'不能丢失的本地草稿'});h.fail();
 await assert.rejects(h.client.start(entry,{messages:[{role:'user',content:'不能丢失的本地草稿'}]}),error=>error.status===409);
 assert.equal(entry.conflict,true);assert.equal(entry.run,null);assert.equal(entry.draft,'不能丢失的本地草稿');assert.equal(h.calls.some(call=>call.route==='/run/start'),false);
 const attempts=h.calls.length;h.client.change(entry,{draft:'冲突后仍可编辑'});await h.timers.advance(10000);assert.equal(h.calls.length,attempts);
 assert.equal(h.client.exportEntry(entry).draft,'冲突后仍可编辑');assert.match(conversationBlockReason(entry),/冲突/);
 const branch=await h.client.branch(entry);assert.notEqual(branch.id,entry.id);assert.equal(branch.draft,entry.draft);
 const reloaded=await h.client.load(entry.id,{reload:true});assert.equal(reloaded.error,null);assert.equal(reloaded.backup.draft,'冲突后仍可编辑');assert.equal(reloaded.draft,'');
});

test('输出每5秒检查点，空闲25秒续租，结束与检查点严格串行',async t=>{
 const h=harness(t),entry=h.client.local(),messages=[{role:'user',content:'hi'},{role:'assistant',content:''}];
 await h.client.start(entry,{messages});
 for(let index=0;index<20;index++){messages[1].content+='x';h.client.output(entry);}
 await h.timers.advance(4999);assert.equal(h.calls.filter(call=>call.route==='/run/checkpoint').length,0);
 await h.timers.advance(1);assert.equal(h.calls.filter(call=>call.route==='/run/checkpoint').length,1);
 assert.equal(h.records.get(entry.id).messages[1].content,'x'.repeat(20));
 await h.timers.advance(20000);assert.equal(h.calls.filter(call=>call.route==='/run/checkpoint').length,2);
 messages[1].content+=' done';entry.version++;
 await Promise.all([h.client.checkpoint(entry),h.client.finish(entry,'completed')]);
 const writes=h.calls.filter(call=>call.body?.expectedRevision!==undefined);
 assert.deepEqual(writes.map(call=>call.body.expectedRevision),[1,2,3,4,5]);assert.equal(writes.at(-1).route,'/run/finish');
 assert.equal(h.records.get(entry.id).status,'completed');assert.equal(h.records.get(entry.id).messages[1].content,'x'.repeat(20)+' done');assert.equal(entry.run,null);assert.equal(h.maximum,1);
 const count=h.calls.length;await h.timers.advance(60000);assert.equal(h.calls.length,count);
});

test('浏览另一会话不改变原运行的 id、消息、模型或租户，草稿独立',async t=>{
 const h=harness(t),a=h.client.local({target:'personal-auto'}),b=h.client.local({target:'auto'}),messages=[{role:'assistant',content:''}];
 await h.client.start(a,{messages});h.client.current=b;h.client.change(b,{draft:'另一个会话的草稿'});
 messages[0].content='只属于 A';h.client.output(a);await h.timers.advance(5000);await h.client.finish(a,'completed');
 assert.equal(b.messages.length,0);assert.equal(b.draft,'另一个会话的草稿');assert.equal(h.records.get(a.id).messages[0].content,'只属于 A');
 for(const call of h.calls.filter(call=>call.route.startsWith('/run/'))){assert.equal(call.body.id,a.id);assert.equal(call.body.settings.target,'personal-auto');assert.equal(call.options.headers['X-Tenant-ID'],'tenant-a');}
 assert.equal(h.records.get(b.id).draft,b.draft);
});

test('检查点保存失败停止续租且保留输出，不假装完成或重发',async t=>{
 const h=harness(t),entry=h.client.local(),messages=[{role:'assistant',content:''}];let aborted=0;
 await h.client.start(entry,{messages,onFailure:()=>aborted++});messages[0].content='尚未保存的输出';h.fail(503,'存储暂不可用');
 await assert.rejects(h.client.checkpoint(entry),error=>error.status===503);assert.equal(aborted,1);
 const count=h.calls.length;h.client.output(entry);await h.timers.advance(60000);assert.equal(h.calls.length,count);
 await assert.rejects(h.client.finish(entry,'stopped'),/存储暂不可用/);assert.equal(h.calls.length,count);
 assert.equal(h.client.exportEntry(entry).messages[0].content,'尚未保存的输出');assert.match(conversationBlockReason(entry),/尚未保存/);
});

test('刷新 running 会话只读，过期后仅 recover；旧历史导入幂等',async t=>{
 const h=harness(t),entry=h.client.local();await h.client.start(entry,{messages:[{role:'user',content:'请求'}]});
 const stored=structuredClone(h.records.get(entry.id));h.client.dispose();
 const other=createConversationClient({tenantId:'tenant-a',timers:h.timers,now:h.timers.now,fetcher:async(url,options)=>{
  if(!options.body)return {ok:true,json:async()=>structuredClone(stored)};
  const body=JSON.parse(options.body);assert.ok(url.endsWith('/run/recover'));assert.equal(body.expectedRevision,stored.revision);return {ok:true,json:async()=>({...stored,status:'interrupted',revision:stored.revision+1,runId:null})};
 }});t.after(()=>other.dispose());
 const loaded=await other.load(stored.id);assert.equal(other.readOnly(loaded),true);assert.equal(other.change(loaded,{draft:'禁止修改'}),false);
 await assert.rejects(other.start(loaded,{messages:[]}),/只读|租约/);await h.timers.advance(120001);
 // A rejected local start does not poison the entry; recovery remains an explicit action.
 await other.recover(loaded);assert.equal(loaded.record.status,'interrupted');assert.equal(other.readOnly(loaded),false);
 const importedHarness=harness(t),first=await importedHarness.client.importHistory('legacy-id'),second=await importedHarness.client.importHistory('legacy-id');assert.equal(first.id,second.id);assert.equal(first.messages[0].content,'旧文本');
});

test('持久数据不截断，不存图片二进制，缺失素材或工具阻止续聊并允许明确纯文本分支',async t=>{
 const h=harness(t),entry=h.client.local();entry.messages=[{role:'user',content:[{type:'text',text:'描述素材'},{type:'image_url',image_url:{url:'data:image/png;base64,SECRET'}}],video:{name:'x'}},{role:'assistant',content:'text',reasoning_content:'思考',tool_calls:[{id:'x',function:{name:'tool',arguments:'{}'}}]}];
 const saved=conversationMessages(entry.messages);assert.equal(saved[0].missingAttachments,true);assert.equal(saved[0].content,'描述素材');assert.ok(!JSON.stringify(saved).includes('SECRET'));assert.match(conversationBlockReason({...entry,messages:saved}),/素材/);
 await h.client.flush(entry);const loaded=await h.client.load(entry.id,{reload:true});assert.match(conversationBlockReason(loaded),/素材/);
 const branch=await h.client.branch(loaded,{textOnly:true});assert.equal(conversationBlockReason(branch),'');assert.equal(branch.messages[0].content,'描述素材');assert.ok(!branch.messages[1].tool_calls);
 entry.messages=[{role:'assistant',content:'x'.repeat(1024*1024)}];assert.throws(()=>conversationPayload(entry),/1 MiB/);assert.equal(h.client.exportEntry(entry).messages[0].content.length,1024*1024);
 entry.messages=[];entry.draft='字'.repeat(22000);assert.throws(()=>conversationPayload(entry),/64 KiB/);assert.equal(entry.draft.length,22000);
});

test('账户接口保留 JSON 错误文本与 HTTP 状态码',async()=>{
 await assert.rejects(conversationRequest('tenant','/update',{}, {fetcher:async()=>({ok:false,status:413,json:async()=>({error:{message:'账户会话容量已满'}})})}),error=>error.status===413&&error.message==='账户会话容量已满');
});

test('playground 仍保留协议/限制，持久会话是唯一新记录且生成绑定 owner',()=>{
 const source=readFileSync(new URL('../public/playground.js',import.meta.url),'utf8');
 assert.ok(!source.includes('conversationSnapshot'));assert.ok(!source.includes('labHistoryRequest('));
 for(const text of ['initialConversationId','onConversationChange','updatePersonalProviders:refreshPersonalModels','await client.start(owner','client.output(owner)','await client.finish(owner','activeConversation===owner','context.length>=99','10*1024*1024','streamChat(requestTransport','fetch(\'/api/chat\'','client.importHistory(row.id)'])assert.ok(source.includes(text),text);
 assert.ok(source.indexOf('await client.start(owner')<source.indexOf("fetch('/api/chat'"));
 assert.ok(!source.includes("settings.target='auto'"));
});
