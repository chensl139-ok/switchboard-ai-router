import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlatform} from '../platform.mjs';

test('仅租户所有者可重置统计起点或清除本租户请求；保留日志、Key 与审计的边界明确',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-owner-usage-'));
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async()=>Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}})});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(url,data,cookie='')=>{const response=await fetch(base+url,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const owner=(await request('/api/account/setup',{name:'Owner',email:'owner@example.com',password:'strong-password-12345',bootstrapToken:'a'.repeat(32)})).cookie;
  await request('/api/provider',{id:'p',name:'Provider',baseUrl:'https://provider.example/v1',protocol:'openai',model:'m',models:['m'],enabled:true,apiKey:'secret'},owner);
  const key=(await request('/api/keys',{name:'app'},owner)).body;
  const chat={model:'auto',messages:[{role:'user',content:'hi'}]};assert.equal((await request('/api/chat',chat,owner)).status,200);
  assert.equal((await request('/api/analytics',null,owner)).body.totals.requests,1);
  const secondTenant=(await request('/api/account/tenants',{name:'Second'},owner)).body;
  await request('/api/account/switch',{tenantId:secondTenant.id},owner);
  await request('/api/provider',{id:'p2',name:'Provider B',baseUrl:'https://provider-b.example/v1',protocol:'openai',model:'m',models:['m'],enabled:true,apiKey:'secret-b'},owner);
  assert.equal((await request('/api/chat',chat,owner)).status,200);
  await request('/api/account/switch',{tenantId:'default'},owner);
  const invite=(await request('/api/account/invite',{email:'admin@example.com',role:'admin'},owner)).body;
  const admin=(await request('/api/account/register',{name:'Admin',email:'admin@example.com',password:'strong-password-12345',inviteCode:invite.code})).cookie;
  assert.equal((await request('/api/account/usage/reset',{confirm:'reset'},admin)).status,403);
  assert.equal((await request('/api/account/usage/clear',{confirm:'clear'},admin)).status,403);
  assert.equal((await request('/api/account/usage/reset',{confirm:'wrong'},owner)).status,400);
  assert.equal((await request('/api/account/usage/reset',{confirm:'reset'},owner)).status,200);
  assert.equal((await request('/api/analytics',null,owner)).body.totals.requests,0);
  assert.equal((await request('/api/account/usage-audit',null,owner)).body.members.length,0);
  assert.equal((await request('/api/logs',null,owner)).body.total,1,'重置后原始日志保留');
  assert.equal((await request('/api/chat',chat,owner)).status,200);
  assert.equal((await request('/api/analytics',null,owner)).body.totals.requests,1);
  const cleared=await request('/api/account/usage/clear',{confirm:'clear'},owner);assert.equal(cleared.status,200);assert.equal(cleared.body.deletedCalls,2);
  assert.equal((await request('/api/logs',null,owner)).body.total,0);
  assert.equal((await request('/api/analytics',null,owner)).body.totals.requests,0);
  assert.equal((await request('/api/keys',null,owner)).body.keys[0].id,key.key.id);
  const audit=(await request('/api/account/audit?category=tenant',null,owner)).body.items;
  assert.ok(audit.some(item=>item.action==='usage.statistics.reset'));
  assert.ok(audit.some(item=>item.action==='usage.statistics.clear'));
  await request('/api/account/switch',{tenantId:secondTenant.id},owner);
  assert.equal((await request('/api/logs',null,owner)).body.total,1,'清除默认租户不得删除其他租户请求');
  assert.equal((await request('/api/analytics',null,owner)).body.totals.requests,1);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
