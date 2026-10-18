import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createPlatform} from '../platform.mjs';

const admin='a'.repeat(32),gateway='g'.repeat(32);
const input={model:'test',messages:[{role:'user',content:'hello'}]};
const completion=()=>Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

async function fixture(t,fetcher=async()=>completion(),platformOptions={}){
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-tenant-lifecycle-'));
 const app=createPlatform({...platformOptions,dir,admin,gateway,fetcher}),cleanup=[];
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;let cookie='';
 t.after(async()=>{
  for(const dispose of cleanup.reverse())await dispose();
  app.closeAllConnections();await new Promise(resolve=>app.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 });
 const request=async(route,data,{token,signal,text=false}={})=>{
  const res=await fetch(base+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{cookie})},...(data?{body:JSON.stringify(data)}:{}),signal});
  return {status:res.status,body:text?await res.text():await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 const setup=await request('/api/account/setup',{name:'Owner',email:'owner@example.test',password:'long-test-password-123',bootstrapToken:admin});
 assert.equal(setup.status,200);cookie=setup.cookie;
 const created=await request('/api/account/tenants',{name:'Target'});assert.equal(created.status,201);const tenant=created.body;
 assert.equal((await request('/api/account/switch',{tenantId:tenant.id})).status,200);
 assert.equal((await request('/api/provider',{id:'test',name:'Test',baseUrl:'https://test.example/v1',protocol:'openai',model:'one',models:['one'],enabled:true,apiKey:'fixture-upstream-key'})).status,200);
 const key=await request('/api/keys',{name:'Tenant key'});assert.equal(key.status,201);
 assert.equal((await request('/api/account/switch',{tenantId:'default'})).status,200);
 return {dir,base,request,tenant,token:key.body.token,cleanup,deleteTenant:()=>request('/api/account/tenants/delete',{tenantId:tenant.id})};
}

test('空闲租户删除先关闭 SQLite，再移动目录，并撤销其 API Key',async t=>{
 const f=await fixture(t),tenantPath=path.join(f.dir,'tenants',f.tenant.id);
 assert.equal(existsSync(path.join(tenantPath,'usage.sqlite')),true);
 assert.equal(existsSync(path.join(tenantPath,'api-key-usage.sqlite')),true);
 assert.equal((await f.deleteTenant()).status,200);
 assert.equal(existsSync(tenantPath),false);
 assert.equal((await f.request('/v1/models',null,{token:f.token})).status,401);
 assert.equal((await f.request('/api/state')).status,200);
});

test('HTTP 上游请求期间仅阻止删除对应租户，完成后可删除',async t=>{
 const started=deferred(),finish=deferred();
 const f=await fixture(t,async()=>{started.resolve();await finish.promise;return completion();});
 const pending=f.request('/v1/chat/completions',input,{token:f.token});
 f.cleanup.push(async()=>{finish.resolve();await pending.catch(()=>{});});
 await started.promise;
 const blocked=await f.deleteTenant();assert.equal(blocked.status,409);assert.match(blocked.body.error.message,/进行中的请求/);
 const unrelated=await f.request('/api/account/tenants',{name:'Unrelated'});assert.equal(unrelated.status,201);
 assert.equal((await f.request('/api/account/tenants/delete',{tenantId:unrelated.body.id})).status,200);
 finish.resolve();assert.equal((await pending).status,200);
 assert.equal((await f.deleteTenant()).status,200);
});

test('客户端断开后仍等待上游清理结束，避免已关闭 SQLite 的迟到写入',async t=>{
 const started=deferred(),finish=deferred(),returned=deferred();
 const f=await fixture(t,async()=>{started.resolve();await finish.promise;returned.resolve();return completion();});
 const controller=new AbortController(),pending=f.request('/v1/chat/completions',input,{token:f.token,signal:controller.signal});
 f.cleanup.push(async()=>{finish.resolve();await pending.catch(()=>{});});
 await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});
 // A second HTTP round trip permits the server to process the disconnect.
 await f.request('/healthz');assert.equal((await f.deleteTenant()).status,409);
 finish.resolve();await returned.promise;
 // The request handler finishes asynchronously after the mocked upstream returns.
 let deleted;
 for(let attempt=0;attempt<20;attempt++){
  deleted=await f.deleteTenant();if(deleted.status!==409)break;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.equal(deleted.status,200);
});

test('WebSocket 生成期间不可删除租户，生成完成后可以删除',async t=>{
 const started=deferred(),finish=deferred();
 const f=await fixture(t,async()=>{started.resolve();await finish.promise;return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});});
 const ws=new WebSocket(f.base.replace('http:','ws:')+'/v1/realtime');
 f.cleanup.push(()=>{finish.resolve();ws.terminate();});
 await once(ws,'open');const ready=once(ws,'message');ws.send(JSON.stringify({type:'auth',token:f.token}));assert.equal(JSON.parse((await ready)[0]).type,'ready');
 const done=new Promise((resolve,reject)=>ws.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='done')resolve(message);if(message.type==='error')reject(Error(message.message));}));
 ws.send(JSON.stringify({type:'chat',id:'active',input}));await started.promise;
 assert.equal((await f.deleteTenant()).status,409);
 finish.resolve();await done;
 assert.equal((await f.deleteTenant()).status,200);
 ws.close();await once(ws,'close');
});

test('桌面个人路由的共享候选调用同样阻止租户删除，不随会话切换丢失保护',async t=>{
 const started=deferred(),finish=deferred();
 const f=await fixture(t,async()=>{started.resolve();await finish.promise;return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});},{desktopAuth:'d'.repeat(64),oauthConfig:[]});
 assert.equal((await f.request('/api/account/switch',{tenantId:f.tenant.id})).status,200);
 const pending=f.request('/api/account/chatgpt/route/stream',{...input,stream:true},{text:true});
 f.cleanup.push(async()=>{finish.resolve();await pending.catch(()=>{});});
 await started.promise;
 assert.equal((await f.request('/api/account/switch',{tenantId:'default'})).status,200);
 assert.equal((await f.deleteTenant()).status,409);
 finish.resolve();const result=await pending;assert.equal(result.status,200);assert.match(result.body,/\[DONE\]/);
 assert.equal((await f.deleteTenant()).status,200);
});

test('删除账户记录失败后恢复目录，原租户懒重开且模型及用量可继续使用',async t=>{
 const f=await fixture(t),tenantPath=path.join(f.dir,'tenants',f.tenant.id),blockedFile=path.join(f.dir,'accounts.json.tmp');
 mkdirSync(blockedFile);
 assert.equal((await f.deleteTenant()).status,500);
 assert.equal(existsSync(tenantPath),true);
 assert.equal(readdirSync(path.join(f.dir,'tenant-deletion-pending')).length,0);
 // Only remove the explicit test-created blocker; never touch application data.
 rmSync(blockedFile,{recursive:true});
 const models=await f.request('/v1/models',null,{token:f.token});assert.equal(models.status,200);assert.ok(models.body.data.some(item=>item.id==='test::one'));
 assert.equal((await f.request('/v1/chat/completions',input,{token:f.token})).status,200);
 assert.equal((await f.request('/api/account/switch',{tenantId:f.tenant.id})).status,200);
 const keys=await f.request('/api/keys');assert.equal(keys.status,200);assert.equal(keys.body.keys[0].requests,1);
 const analytics=await f.request('/api/analytics');assert.equal(analytics.status,200);assert.equal(analytics.body.totals.requests,1);
 assert.equal((await f.request('/api/account/switch',{tenantId:'default'})).status,200);
 assert.equal((await f.deleteTenant()).status,200);
});
