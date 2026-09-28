import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FeishuBindings} from '../feishu-bindings.mjs';
import {createPlatform} from '../platform.mjs';

const admin='a'.repeat(32),gateway='g'.repeat(32),password='owner-password-123';
const primary={key:'primary',label:'模思智能',tenantId:'default',legacy:true,appId:'cli_moss12345678',appSecret:'primary-secret',redirectUri:'https://switchboard.example.test/api/account/sso/feishu/callback',enabled:true};

test('企业绑定密钥加密存储，新租户可绑定且环境配置可解绑',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-feishu-bind-'));
 try{
  const store=new FeishuBindings(dir,admin,[primary]),tenants=[{id:'default'},{id:'company'}];
  assert.equal(store.configs().length,1);
  const row=store.bind({tenantId:'company',label:'Company',appId:'cli_company12345',appSecret:'company-secret'},tenants);
  assert.equal(row.appId,'cli_company12345');assert.equal(row.source,'managed');assert.equal(row.autoJoin,false);
  const enabled=store.bind({tenantId:'company',label:'Company',appId:'cli_company12345',autoJoin:'on'},tenants);
  assert.equal(enabled.autoJoin,true);
  const disk=readFileSync(path.join(dir,'feishu-bindings.json'),'utf8');assert.ok(!disk.includes('company-secret'));assert.ok(!disk.includes('primary-secret'));
  const restored=new FeishuBindings(dir,admin,[primary]);assert.equal(restored.configs().find(config=>config.tenantId==='company').appSecret,'company-secret');assert.equal(restored.configs().find(config=>config.tenantId==='company').autoJoin,true);
  assert.throws(()=>restored.bind({tenantId:'default',label:'Duplicate',appId:'cli_company12345',appSecret:'other-secret'},tenants),{status:409});
  restored.unbind('default');assert.equal(restored.configs().some(config=>config.tenantId==='default'),false);
  assert.throws(()=>new FeishuBindings(dir,'b'.repeat(32),[primary]).configs(),/无法解密/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('只有平台主账号能绑定和解绑租户飞书企业',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-feishu-bind-http-')),app=createPlatform({dir,admin,gateway,oauthConfig:[primary]});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,cookie='')=>{const response=await fetch(base+'/api/account/'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const setup=await request('setup',{name:'Owner',email:'owner@example.test',password,bootstrapToken:admin}),root=setup.cookie;
  const company=(await request('tenants',{name:'Company'},root)).body;
  const invite=(await request('invite',{email:'colleague@example.test',role:'member'},root)).body;
  const colleague=(await request('register',{name:'Colleague',email:'colleague@example.test',password,inviteCode:invite.code})).cookie;
  assert.equal((await request('sso/feishu/bindings',null,colleague)).status,403);
  assert.equal((await request('sso/feishu/bindings',{tenantId:company.id,label:'Company',appId:'cli_company12345',appSecret:'company-secret'},colleague)).status,403);
  const bound=await request('sso/feishu/bindings',{tenantId:company.id,label:'Company',appId:'cli_company12345',appSecret:'company-secret'},root);assert.equal(bound.status,200);
  assert.equal((await request('status')).body.sso.feishu.providers.length,2);
  const sso=await fetch(base+'/api/account/sso/feishu/start?provider='+encodeURIComponent(bound.body.key),{redirect:'manual'});assert.equal(sso.status,302);assert.equal(new URL(sso.headers.get('location')).searchParams.get('app_id'),'cli_company12345');
  assert.equal((await request('tenants/delete',{tenantId:company.id},root)).status,409);
  assert.equal((await request('sso/feishu/bindings/delete',{tenantId:company.id},colleague)).status,403);
  assert.equal((await request('sso/feishu/bindings/delete',{tenantId:company.id},root)).status,200);
  assert.equal((await request('status')).body.sso.feishu.providers.length,1);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('企业成员无需邀请即可通过绑定应用首次登录，自动加入开关立即生效',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-feishu-join-'));
 let openId='ou_colleague';
 const app=createPlatform({dir,admin,gateway,oauthConfig:[primary],identityFetcher:async url=>url.endsWith('/token')?Response.json({access_token:'test-token'}):Response.json({data:{open_id:openId,tenant_key:'moss',name:'Colleague'}})});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(route,data,cookie='')=>fetch(base+'/api/account/'+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
 const oauthLogin=async()=>{
  const start=await fetch(base+'/api/account/sso/feishu/start?provider=primary',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state');
  return fetch(base+'/api/account/sso/feishu/callback?state='+state+'&code=sample',{headers:{cookie:start.headers.get('set-cookie').split(';')[0]},redirect:'manual'});
 };
 try{
  const setup=await post('setup',{name:'Owner',email:'owner@example.test',password,bootstrapToken:admin}),ownerCookie=setup.headers.get('set-cookie').split(';')[0];
  let bound=await post('sso/feishu/bindings',{tenantId:'default',label:'模思智能',appId:primary.appId,autoJoin:'on'},ownerCookie);
  assert.equal((await bound.json()).autoJoin,true);
  const joined=await oauthLogin();assert.equal(joined.headers.get('location'),' /#overview'.trim());
  const memberCookie=joined.headers.get('set-cookie').match(/sr_session=[^;]+/)?.[0];assert.ok(memberCookie);
  const me=await fetch(base+'/api/account/me',{headers:{cookie:memberCookie}}).then(r=>r.json());
  assert.equal(me.role,'member');assert.equal(me.tenantId,'default');assert.equal(me.platformAccess,false);
  bound=await post('sso/feishu/bindings',{tenantId:'default',label:'模思智能',appId:primary.appId,autoJoin:false},ownerCookie);
  assert.equal((await bound.json()).autoJoin,false);
  openId='ou_other';const denied=await oauthLogin();assert.match(denied.headers.get('location'),/auth_error=/);
  bound=await post('sso/feishu/bindings',{tenantId:'default',label:'模思智能',appId:primary.appId,autoJoin:'on'},ownerCookie);
  assert.equal((await bound.json()).autoJoin,true);
  const allowed=await oauthLogin();assert.equal(allowed.headers.get('location'),' /#overview'.trim());
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
