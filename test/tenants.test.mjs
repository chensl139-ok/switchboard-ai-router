import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createPlatform} from '../platform.mjs';
import {Accounts} from '../accounts.mjs';
const admin='a'.repeat(32),gateway='g'.repeat(32),password='correct-password-12345';
test('旧数据首次重新登录时安全迁移平台主账号，旧会话不自动升权',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tenant-owner-migration-'));
 try{
  const accounts=new Accounts(dir,admin),oldToken=await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:admin});
  accounts.mutate(()=>{delete accounts.state.platformOwnerUserId;delete accounts.state.sessions[0].platformSource;});
  const restored=new Accounts(dir,admin);assert.equal(restored.resolve(oldToken).platformAccess,false);
  const newToken=await restored.login({email:'owner@example.com',password});assert.equal(restored.resolve(newToken).platformAccess,true);assert.equal(restored.state.platformOwnerUserId,restored.state.users[0].id);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('平台主账号可接管历史上不属于自己的租户，普通账号仍仅见本租户',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tenant-owner-legacy-'));
 try{
  const accounts=new Accounts(dir,admin),token=await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:admin});
  const root=accounts.resolve(token),legacy=accounts.createTenant(root,'Legacy');
  accounts.mutate(()=>{accounts.state.members=accounts.state.members.filter(m=>m.tenantId!==legacy.id||m.userId!==root.userId);});
  assert.equal(accounts.me(root).tenants.length,2);
  accounts.switchTenant(root,legacy.id);
  const switched=accounts.resolve(token);
  assert.equal(switched.role,'owner');assert.equal(switched.tenantId,legacy.id);
  assert.equal(accounts.renameTenant(switched,'Legacy renamed').name,'Legacy renamed');
  accounts.switchTenant(switched,'default');
  assert.equal(accounts.deleteTenant(accounts.resolve(token),legacy.id).deleted,legacy.id);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('账户、租户隔离、RBAC、API Key 删除和用量归属',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tenant-platform-'));let calls=0;
 const app=createPlatform({dir,admin,gateway,fetcher:async(url)=>{if(url.endsWith('/models'))return Response.json({data:[{id:'model'}]});calls++;return Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(url,data,{cookie='',token='',headers={}}={})=>{const res=await fetch(base+url,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(token?{authorization:'Bearer '+token}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
 try{
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/account/setup',{name:'Owner',email:'owner@example.com',password,bootstrapToken:'wrong'})).status,403);
  const setup=await request('/api/account/setup',{name:'Owner',email:'owner@example.com',password,bootstrapToken:admin});let owner=setup.cookie;assert.equal(setup.status,200);assert.equal(setup.body.role,'owner');
  assert.equal((await request('/api/account/setup',{name:'Owner',email:'owner@example.com',password,bootstrapToken:admin})).status,409);
  assert.equal((await request('/api/state',null,{token:admin})).status,401);
  const provider={id:'alpha',name:'Tenant A',baseUrl:'https://api.deepseek.com/v1',protocol:'openai',model:'model',models:['model'],enabled:true,priority:1,apiKey:'tenant-a-secret'};
  assert.equal((await request('/api/provider',provider,{cookie:owner})).status,200);
  const beforePreview=(await request('/api/account/audit',null,{cookie:owner})).body.items;
  assert.equal(beforePreview[0].action,'/api/provider');
  assert.equal(beforePreview[0].target,'保存服务商配置');
  const filteredAudit=await request('/api/account/audit?category=provider&q=Owner&limit=1',null,{cookie:owner});
  assert.equal(filteredAudit.status,200);assert.equal(filteredAudit.body.total,1);assert.equal(filteredAudit.body.items[0].label,'保存服务商');
  assert.equal((await request('/api/routing/preview',{model:'auto'},{cookie:owner})).status,200);
  assert.equal((await request('/api/provider/models',{id:'alpha',baseUrl:provider.baseUrl,protocol:'openai'},{cookie:owner})).status,200);
  assert.equal((await request('/api/account/audit',null,{cookie:owner})).body.items.length,beforePreview.length,'只读路由预览与模型获取不得被记为配置变更');
  const keyA=(await request('/api/keys',{name:'a',totalLimit:5},{cookie:owner})).body;
  const tenantB=(await request('/api/account/tenants',{name:'Tenant B'},{cookie:owner})).body;
  assert.ok((await request('/api/account/audit?category=tenant',null,{cookie:owner})).body.items.some(item=>item.action==='tenant.create'&&item.target==='Tenant B'),'原租户应看到新租户创建事件');
  await request('/api/account/switch',{tenantId:tenantB.id},{cookie:owner});
  assert.ok((await request('/api/account/audit?category=tenant',null,{cookie:owner})).body.items.some(item=>item.action==='tenant.create'),'新租户也应看到创建事件');
  const bState=(await request('/api/state',null,{cookie:owner})).body;assert.ok(!bState.providers.some(p=>p.id==='alpha'));assert.equal((await request('/api/keys',null,{cookie:owner})).body.keys.length,0);
  assert.equal((await request('/api/keys/delete',{id:keyA.key.id},{cookie:owner})).status,404);
  const input={model:'alpha',messages:[{role:'user',content:'secret prompt'}]};
  assert.equal((await request('/v1/chat/completions',input,{token:keyA.token,headers:{'x-tenant-id':tenantB.id}})).status,409);
  assert.equal((await request('/v1/chat/completions',input,{token:keyA.token})).status,200);
  assert.equal((await request('/api/analytics',null,{cookie:owner})).body.totals.requests,0);
  await request('/api/account/switch',{tenantId:'default'},{cookie:owner});
  const summary=(await request('/api/analytics',null,{cookie:owner})).body;assert.equal(summary.totals.requests,1);assert.equal(summary.totals.tokens,15);
  const logs=(await request('/api/logs',null,{cookie:owner})).body;assert.equal(logs.items[0].api_key_id,keyA.key.id);assert.ok(!JSON.stringify(logs).includes('secret prompt'));
  const invite=(await request('/api/account/invite',{email:'member@example.com',role:'member'},{cookie:owner})).body;
  const register=await request('/api/account/register',{name:'Member',email:'member@example.com',password,inviteCode:invite.code});const member=register.cookie;assert.equal(register.status,200);
  assert.equal((await request('/api/account/password-reset/issue',{userId:register.body.user.id},{cookie:member})).status,403);
  assert.equal((await request('/api/account/password-reset/issue',{userId:setup.body.user.id},{cookie:owner})).status,400);
  const reset=(await request('/api/account/password-reset/issue',{userId:register.body.user.id},{cookie:owner})).body;
  assert.equal(reset.code.length,48);
  assert.equal((await request('/api/account/password-reset/complete',{email:'other@example.com',code:reset.code,newPassword:password+'reset'})).status,400);
  assert.equal((await request('/api/account/password-reset/complete',{email:'member@example.com',code:reset.code,newPassword:password+'reset'})).status,200);
  assert.equal((await request('/api/account/me',null,{cookie:member})).status,401,'重置后旧会话必须失效');
  assert.equal((await request('/api/account/login',{email:'member@example.com',password})).status,401);
  assert.equal((await request('/api/account/login',{email:'member@example.com',password:password+'reset'})).status,200);
  assert.equal((await request('/api/account/password-reset/complete',{email:'member@example.com',code:reset.code,newPassword:password+'again'})).status,400,'重置码仅能用一次');
  assert.ok(!readFileSync(path.join(dir,'accounts.json'),'utf8').includes(reset.code),'磁盘上不能保存明文重置码');
  const memberRestored=(await request('/api/account/login',{email:'member@example.com',password:password+'reset'})).cookie;
  assert.equal((await request('/api/account/register',{name:'Again',email:'member@example.com',password,inviteCode:invite.code})).status,400);
  assert.equal((await request('/api/provider',provider,{cookie:memberRestored})).status,403);
  assert.equal((await request('/api/account/audit?category=provider',null,{cookie:memberRestored})).status,403);
  assert.equal((await request('/api/keys',null,{cookie:memberRestored})).status,403);
  assert.equal((await request('/api/account/switch',{tenantId:tenantB.id},{cookie:memberRestored})).status,403);
  assert.equal((await request('/api/account/invite',{email:'evil@example.com',role:'owner'},{cookie:memberRestored})).status,403);
  assert.equal((await request('/api/chat',input,{cookie:memberRestored})).status,200);
  const auditUsage=(await request('/api/account/usage-audit?days=30',null,{cookie:owner})).body;
  assert.equal(auditUsage.members.find(row=>row.name==='Owner').requests,1);assert.equal(auditUsage.members.find(row=>row.name==='Member').tokens,15);
  assert.equal(auditUsage.keys.find(row=>row.apiKeyId===keyA.key.id).name,'Owner');
  const ws=new WebSocket(base.replace('http:','ws:')+'/v1/realtime',{headers:{cookie:memberRestored}});await once(ws,'open');const ready=once(ws,'message');ws.send(JSON.stringify({type:'auth',token:''}));assert.equal(JSON.parse((await ready)[0]).type,'ready');
  await request('/api/account/member-role',{userId:register.body.user.id,role:'viewer'},{cookie:owner});
  const denied=once(ws,'message');ws.send(JSON.stringify({type:'chat',id:'viewer',input}));assert.equal(JSON.parse((await denied)[0]).type,'error');ws.close();await once(ws,'close');
  assert.equal((await request('/api/chat',input,{cookie:memberRestored})).status,403);
  assert.equal((await request('/api/account/member-remove',{userId:setup.body.user.id},{cookie:owner})).status,403);
  assert.equal((await request('/api/keys/delete',{id:keyA.key.id},{cookie:owner})).status,200);
  assert.equal((await request('/v1/models',null,{token:keyA.token})).status,403);
  assert.equal((await request('/api/keys/toggle',{id:keyA.key.id,enabled:true},{cookie:owner})).status,404);
  const changed=await request('/api/account/password',{currentPassword:password,newPassword:password+'new'},{cookie:owner});assert.equal(changed.status,200);assert.equal((await request('/api/account/me',null,{cookie:owner})).status,401);owner=changed.cookie;
  assert.equal((await request('/api/account/me',null,{cookie:owner})).status,200);
  assert.equal((await request('/api/account/tenants/delete',{tenantId:tenantB.id},{cookie:owner})).status,200);
  assert.ok((await request('/api/account/audit?category=tenant',null,{cookie:owner})).body.items.some(item=>item.action==='tenant.delete'&&item.target.includes(tenantB.id)),'原租户应看到删除事件');
  const disk=readFileSync(path.join(dir,'accounts.json'),'utf8');assert.ok(!disk.includes(password));assert.ok(!disk.includes(invite.code));assert.ok(!disk.includes(owner.split('=')[1]));assert.equal(calls,2);
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('只有平台主账号可跨租户管理，租户所有者仅能改本租户名称',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tenant-scope-')),app=createPlatform({dir,admin,gateway});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,cookie='')=>{const res=await fetch(base+'/api/account/'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const setup=await request('setup',{name:'Platform Owner',email:'owner@example.com',password,bootstrapToken:admin});const root=setup.cookie;
  assert.equal(setup.body.platformAccess,true);
  const company=(await request('tenants',{name:'Company'},root)).body;
  const other=(await request('tenants',{name:'Other'},root)).body;
  assert.equal((await request('switch',{tenantId:company.id},root)).status,200);
  const invite=(await request('invite',{email:'company@example.com',role:'owner'},root)).body;
  const companyUser=await request('register',{name:'Company Owner',email:'company@example.com',password,inviteCode:invite.code});const scoped=companyUser.cookie;
  assert.equal(companyUser.body.platformAccess,false);
  assert.deepEqual(companyUser.body.tenants.map(tenant=>tenant.id),[company.id]);
  const hidden=(await request('tenants',{name:'Hidden sibling'},root)).body;
  assert.equal((await request('tenants',{name:'Forbidden'},scoped)).status,403);
  assert.equal((await request('switch',{tenantId:hidden.id},scoped)).status,403);
  assert.equal((await request('tenants/delete',{tenantId:other.id},scoped)).status,403);
  assert.equal((await request('tenants/rename',{name:'Company renamed'},scoped)).status,200);
  const renamed=await request('me',null,scoped);assert.deepEqual(renamed.body.tenants.map(tenant=>tenant.name),['Company renamed']);
  const companyAudit=(await request('audit?category=tenant',null,scoped)).body.items;
  assert.ok(companyAudit.some(item=>item.action==='tenant.rename'));
  assert.ok(!companyAudit.some(item=>item.target==='Hidden sibling'),'其他租户的创建事件不得泄漏到当前租户审计');
  assert.equal((await request('tenants/rename',{name:'Other'},scoped)).status,409);
  const rootProfile=await request('me',null,root);assert.equal(rootProfile.body.platformAccess,true);assert.equal(rootProfile.body.tenants.length,4);
  const relogin=await request('login',{email:'owner@example.com',password});assert.equal(relogin.body.platformAccess,true);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
