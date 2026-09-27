import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlatform} from '../platform.mjs';

test('只有平台主账号确认后可清空全部租户操作审计，不影响租户与身份',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-audit-clear-'));
 const admin='a'.repeat(32),app=createPlatform({dir,admin,gateway:'g'.repeat(32)});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,cookie='')=>{const response=await fetch(base+'/api/account/'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const setup=await request('setup',{name:'Main',email:'main@example.test',password:'password-123456',bootstrapToken:admin}),main=setup.cookie;
  const tenant=(await request('tenants',{name:'Second'},main)).body;
  const invite=(await request('invite',{email:'owner@example.test',role:'owner'},main)).body;
  const secondary=(await request('register',{name:'Tenant owner',email:'owner@example.test',password:'password-123456',inviteCode:invite.code})).cookie;
  await request('switch',{tenantId:tenant.id},main);
  await request('tenants/rename',{name:'Second renamed'},main);
  const before=JSON.parse(readFileSync(path.join(dir,'accounts.json'),'utf8'));
  assert.ok(before.audit.some(row=>row.tenantId==='default'));
  assert.ok(before.audit.some(row=>row.tenantId===tenant.id));
  assert.equal((await request('audit/clear',{confirm:'清除全部审计日志'},secondary)).status,403);
  assert.equal((await request('audit/clear',{confirm:'清除全部审计日志'})).status,401);
  assert.equal((await request('audit/clear',{confirm:'确认清除'},main)).status,400);
  assert.equal(JSON.parse(readFileSync(path.join(dir,'accounts.json'),'utf8')).audit.length,before.audit.length);
  const cleared=await request('audit/clear',{confirm:'清除全部审计日志'},main);
  assert.equal(cleared.status,200);assert.equal(cleared.body.deleted,before.audit.length);
  const after=JSON.parse(readFileSync(path.join(dir,'accounts.json'),'utf8'));
  assert.deepEqual(after.audit,[]);assert.equal(after.users.length,before.users.length);assert.equal(after.tenants.length,before.tenants.length);assert.equal(after.sessions.length,before.sessions.length);
  assert.equal((await request('audit?days=7',null,main)).body.total,0);
  assert.equal((await request('audit?days=7',null,secondary)).body.total,0);
  await request('tenants/rename',{name:'Second final'},main);
  assert.equal((await request('audit',null,main)).body.items[0].action,'tenant.rename','后续管理操作继续正常审计');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
