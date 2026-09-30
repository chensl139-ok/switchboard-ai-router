import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import WebSocket from 'ws';
import {ApiKeyStore} from '../key-store.mjs';
import {createPlatform} from '../platform.mjs';
const admin='a'.repeat(32),gateway='g'.repeat(32),password='member-key-password-12345';

test('Key 存储按创建人隔离，旧无归属密钥仅迁移一次且不修改既有归属',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'member-key-store-'));
 const store=new ApiKeyStore(dir,{tenantId:'default'});
 try{
  const old=store.create({name:'old'}),a=store.create({name:'a',createdBy:'b'},'a'),b=store.create({name:'b'},'b');
  const scope={userId:'a',manageLegacy:false};
  assert.deepEqual(store.list(scope).keys.map(k=>k.id),[a.key.id]);
  assert.equal(store.list(scope).legacyAvailable,false);
  assert.equal('legacyEnabled' in store.list(scope),false);
  for(const action of [()=>store.update(b.key.id,{name:'stolen'},scope),()=>store.toggle(b.key.id,false,scope),()=>store.delete(b.key.id,scope)])assert.throws(action,{status:404});
  assert.equal(store.authenticate(b.token),b.key.id);
  assert.equal(store.owner(a.key.id),'a');
  assert.ok(!JSON.stringify(store.list(scope)).includes(a.token));
  assert.ok(!JSON.stringify(store.list(scope)).includes('digest'));
  store.claimUnassigned('root');store.claimUnassigned('other-root');
  assert.equal(store.owner(old.key.id),'root');assert.equal(store.owner(b.key.id),'b');
  const restored=new ApiKeyStore(dir,{tenantId:'default'});
  try{assert.deepEqual(restored.list({userId:'root',manageLegacy:true}).keys.map(k=>k.id),[old.key.id]);}finally{restored.close();}
  store.delete(a.key.id,scope);assert.equal(store.list(scope).keys.length,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('新成员可创建和调用个人 Key，管理员和成员互不可见，撤销成员权限即时拦截旧 Key',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'member-key-platform-'));let calls=0;
 const legacy=new ApiKeyStore(dir,{tenantId:'default'}),old=legacy.create({name:'historical'});legacy.close();
 const app=createPlatform({dir,admin,gateway,fetcher:async()=>{calls++;return Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}});}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,{cookie='',token=''}={})=>{
  const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 let ws;
 try{
  const root=await request('/api/account/setup',{name:'Owner',email:'owner@example.com',password,bootstrapToken:admin});assert.equal(root.status,200);
  const owner={cookie:root.cookie};
  await request('/api/provider',{id:'alpha',name:'Test',baseUrl:'https://test.example/v1',protocol:'openai',model:'model',models:['model'],enabled:true,priority:1,apiKey:'fixture-secret'},owner);
  const register=async(name,role)=>{
   const email=`${name}@example.com`,invite=await request('/api/account/invite',{email,role},owner);
   const result=await request('/api/account/register',{name,email,password,inviteCode:invite.body.code});assert.equal(result.status,200);assert.equal(result.body.role,role);return result;
  };
  const members=[await register('first','member'),await register('second','member'),await register('manager','admin')],viewer=await register('readonly','viewer');
  const keys=[];
  for(const member of members){
   const identity={cookie:member.cookie},before=await request('/api/keys',null,identity);
   assert.equal(before.status,200);assert.deepEqual(before.body.keys,[]);
   const created=await request('/api/keys',{name:member.body.user.name,createdBy:root.body.user.id},identity);
   assert.equal(created.status,201);assert.equal(created.body.key.createdBy,member.body.user.id);keys.push(created.body);
   assert.equal((await request('/api/keys/update',{id:created.body.key.id,name:'personal',createdBy:root.body.user.id,totalLimit:20},identity)).status,200);
   assert.equal((await request('/api/keys/toggle',{id:created.body.key.id,enabled:false},identity)).status,200);
   assert.equal((await request('/v1/models',null,{token:created.body.token})).status,403);
   assert.equal((await request('/api/keys/toggle',{id:created.body.key.id,enabled:true},identity)).status,200);
  }
  assert.equal((await request('/api/keys',null,{cookie:viewer.cookie})).status,403);
  assert.equal((await request('/api/keys',{name:'forbidden'},{cookie:viewer.cookie})).status,403);
  assert.equal((await request('/api/keys/legacy',{enabled:false},{cookie:members[0].cookie})).status,403);
  const ownerKey=await request('/api/keys',{name:'root-private'},owner);assert.equal(ownerKey.status,201);
  const identities=[...members.map(m=>({cookie:m.cookie})),owner],allKeys=[...keys,ownerKey.body];
  for(let i=0;i<identities.length;i++){
   const listing=await request('/api/keys',null,identities[i]);assert.equal(listing.status,200);
   assert.deepEqual(listing.body.keys.map(k=>k.id).sort(),(i===3?[old.key.id,ownerKey.body.key.id]:[keys[i].key.id]).sort());
   for(let j=0;j<allKeys.length;j++)if(i!==j){
    assert.ok(!JSON.stringify(listing.body).includes(allKeys[j].key.preview));
    for(const [route,data] of [['update',{name:'stolen'}],['toggle',{enabled:false}],['delete',{}]])assert.equal((await request('/api/keys/'+route,{id:allKeys[j].key.id,...data},identities[i])).status,404);
   }
  }
  const legacyResponse=await request('/api/keys/legacy',{enabled:false},{cookie:members[2].cookie});
  assert.equal(legacyResponse.status,200);assert.deepEqual(legacyResponse.body.keys.map(k=>k.id),[keys[2].key.id]);
  await request('/api/keys/legacy',{enabled:true},owner);
  const input={model:'alpha',messages:[{role:'user',content:'hi'}]};
  for(const key of [...allKeys,old]){
   assert.equal((await request('/v1/chat/completions',input,{token:key.token})).status,200);
   assert.equal((await request('/api/keys',null,{token:key.token})).status,401);
  }
  const audit=await request('/api/account/usage-audit',null,owner);
  assert.equal(audit.body.keys.find(row=>row.apiKeyId===keys[0].key.id).actorId,members[0].body.user.id);
  ws=new WebSocket(base.replace('http:','ws:')+'/v1/realtime');await once(ws,'open');
  const ready=once(ws,'message');ws.send(JSON.stringify({type:'auth',token:keys[0].token}));assert.equal(JSON.parse((await ready)[0]).type,'ready');
  assert.equal((await request('/api/account/member-role',{userId:members[0].body.user.id,role:'viewer'},owner)).status,200);
  const callsBefore=calls;
  for(const [route,data] of [['/v1/models',null],['/v1/chat/completions',input],['/v1/chat/completions',{...input,stream:true}],['/v1/messages/count_tokens',input],['/v1/images/generations',{model:'alpha',prompt:'hi'}]])assert.equal((await request(route,data,{token:keys[0].token})).status,403);
  const denied=once(ws,'message');ws.send(JSON.stringify({type:'chat',id:'revoked',input}));assert.equal(JSON.parse((await denied)[0]).type,'error');assert.equal(calls,callsBefore);
  ws.close();await once(ws,'close');ws=null;
  await request('/api/account/member-role',{userId:members[0].body.user.id,role:'member'},owner);
  assert.equal((await request('/v1/models',null,{token:keys[0].token})).status,200);
  assert.equal((await request('/api/account/member-remove',{userId:members[0].body.user.id},owner)).status,200);
  assert.equal((await request('/v1/chat/completions',input,{token:keys[0].token})).status,403);
  assert.equal((await request('/api/keys/delete',{id:keys[1].key.id},{cookie:members[1].cookie})).status,200);
  assert.equal((await request('/v1/models',null,{token:keys[1].token})).status,403);
 }finally{if(ws)ws.terminate();await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
