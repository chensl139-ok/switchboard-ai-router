import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import WebSocket from 'ws';
import {ApiKeyStore} from '../key-store.mjs';
import {createApp} from '../server.mjs';
const admin='a'.repeat(32),gateway='g'.repeat(32);
test('Key 时间边界、每日/RPM 重置、持久化、哈希及修改不重置用量',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'key-store-'));let now=Date.parse('2026-09-13T00:00:00Z');
 try{
  const store=new ApiKeyStore(dir,{now:()=>now});
  const policy={name:'consumer',startsAt:new Date(now+1000).toISOString(),expiresAt:new Date(now+86400000*3).toISOString(),totalLimit:3,dailyLimit:1,rpmLimit:1};
  const {key,token}=store.create(policy,'user-1');assert.equal(store.owner(key.id),'user-1');assert.throws(()=>store.authenticate(token),/尚未生效/);now+=1000;
  assert.equal(store.authenticate(token),key.id);store.admit(key.id);store.complete(key.id,true,12);
  assert.throws(()=>store.admit(key.id),/今日/);now+=86400000;store.admit(key.id);
  store.update(key.id,{...policy,dailyLimit:5});assert.equal(store.list().keys[0].requests,2);
  assert.throws(()=>store.admit(key.id),/每分钟/);now+=60000;store.admit(key.id);assert.throws(()=>store.admit(key.id),/总调用/);
  const restored=new ApiKeyStore(dir,{now:()=>now});assert.equal(restored.list().keys[0].knownTokens,12);
  const disk=readFileSync(path.join(dir,'api-keys.json'),'utf8');assert.ok(!disk.includes(token));assert.ok(!JSON.stringify(store.list()).includes('digest'));
  now=Date.parse(policy.expiresAt);assert.throws(()=>restored.authenticate(token),/已过期/);
  assert.throws(()=>store.create({...policy,totalLimit:-1}));assert.throws(()=>store.create({...policy,expiresAt:policy.startsAt}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('HTTP/SSE 共用配额、并发无超发、旧令牌开关与 WebSocket 每次重新鉴权',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'key-api-'));let upstreamCalls=0;
 const app=createApp({dir,admin,gateway,fetcher:async(url,options)=>{
  upstreamCalls++;await new Promise(r=>setTimeout(r,15));
  if(JSON.parse(options.body).stream)return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  return Response.json({choices:[{message:{content:'ok'}}],usage:{total_tokens:3}});
 }});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(url,data,token=admin)=>fetch(base+url,{method:data?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  await request('/api/provider',{id:'test',name:'Test',baseUrl:'https://test.example/v1',protocol:'openai',model:'one',enabled:true,priority:1,apiKey:'upstream'});
  const created=await (await request('/api/keys',{name:'limited',totalLimit:1})).json();const token=created.token;
  assert.equal((await request('/api/keys',undefined,token)).status,403);
  const input={model:'test',messages:[{role:'user',content:'hi'}]};
  const results=await Promise.all([request('/v1/chat/completions',input,token),request('/v1/chat/completions',{...input,stream:true},token)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);assert.equal(upstreamCalls,1);
  assert.equal((await request('/v1/chat/completions',input,token)).status,429);
  assert.equal((await request('/api/keys',undefined,admin)).status,200);
  await request('/api/keys/legacy',{enabled:false});assert.equal((await request('/v1/models',undefined,gateway)).status,401);
  const wsKey=await (await request('/api/keys',{name:'socket'})).json();
  const ws=new WebSocket(base.replace('http:','ws:')+'/v1/realtime');await once(ws,'open');
  const ready=once(ws,'message');ws.send(JSON.stringify({type:'auth',token:wsKey.token}));assert.equal(JSON.parse((await ready)[0]).type,'ready');
  await request('/api/keys/toggle',{id:wsKey.key.id,enabled:false});
  const denied=once(ws,'message');ws.send(JSON.stringify({type:'chat',id:'blocked',input}));assert.equal(JSON.parse((await denied)[0]).type,'error');assert.equal(upstreamCalls,1);
  ws.close();await once(ws,'close');
  assert.equal((await request('/v1/models',undefined,wsKey.token)).status,403);
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
