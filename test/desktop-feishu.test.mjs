import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../accounts.mjs';
import {createPlatform} from '../platform.mjs';
import {DesktopFeishu} from '../desktop-feishu.mjs';

test('桌面飞书交接凭证一次性、绑定登录流程，取消和过期撤销未兑换会话',()=>{
 let now=0;const revoked=[],flows=new DesktopFeishu('s'.repeat(64),{now:()=>now,revoke:token=>revoked.push(token)});
 assert.throws(()=>flows.authenticate({headers:{}}),/桌面/);assert.throws(()=>flows.authenticate({headers:{'x-switchboard-desktop':'x'.repeat(64)}}),/桌面/);
 flows.authenticate({headers:{'x-switchboard-desktop':'s'.repeat(64)}});
 const first=flows.create('primary');assert.equal(flows.authorize(first.ticket).id,first.id);assert.throws(()=>flows.authorize(first.ticket),/失效/);
 const callback=flows.finish(first.id,{token:'session-private',path:'/#overview'});assert(!callback.includes('session-private'));
 const code=new URL(callback).searchParams.get('code');assert.throws(()=>flows.consume('other-flow',code),/校验/);
 assert.equal(flows.consume(first.id,code).token,'session-private');assert.throws(()=>flows.consume(first.id,code),/校验/);
 const second=flows.create('primary');flows.finish(second.id,{token:'cancelled'});flows.cancel(second.id);assert.deepEqual(revoked,['cancelled']);
 const third=flows.create('primary');flows.finish(third.id,{token:'expired'});now=600_000;flows.prune();assert.deepEqual(revoked,['cancelled','expired']);
 const fourth=flows.create('primary');flows.cancel(fourth.id);assert.throws(()=>flows.assertPending(fourth.id),/失效/);
 assert.throws(()=>flows.finish(fourth.id,{token:'late-result'}),/失效/);assert(revoked.includes('late-result'));
 for(let i=0;i<20;i++)flows.create('primary');assert.throws(()=>flows.create('primary'),/过多/);flows.close();assert.equal(flows.flows.size,0);
});

test('桌面系统浏览器飞书登录回到 App，保持跨企业隔离并拒绝伪造、重放和跨域兑换',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-desktop-sso-')),admin='a'.repeat(64),secret='d'.repeat(64);
 const accounts=new Accounts(dir,admin);const ownerToken=await accounts.setup({bootstrapToken:admin,name:'Owner',email:'owner@fixture.invalid',password:'fixture-password-12345'});
 const second=accounts.createTenant(accounts.resolve(ownerToken),'Second');
 const configured='https://deployment.example/api/account/sso/feishu/callback',exchanges=[];
 const configs=[{enabled:true,key:'primary',tenantId:'default',legacy:true,appId:'cli_first',appSecret:'first-secret',redirectUri:configured,allowedTenantKey:'first',autoJoin:true},{enabled:true,key:'second',tenantId:second.id,appId:'cli_second',appSecret:'second-secret',redirectUri:configured,allowedTenantKey:'second',autoJoin:true}];
 const identityFetcher=async(url,options)=>{
  if(url.endsWith('/token')){const data=JSON.parse(options.body);exchanges.push(data);return Response.json({access_token:data.code==='wrong-enterprise'?'wrong':data.client_id});}
  const app=options.headers.authorization.split(' ')[1];return Response.json({data:{open_id:'ou_'+app,tenant_key:app==='cli_first'?'first':app==='cli_second'?'second':'unbound',name:'Member'}});
 };
 const server=createPlatform({dir,admin,gateway:'g'.repeat(64),desktopAuth:secret,oauthConfig:configs,identityFetcher});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port,prefix='/api/account/sso/feishu/desktop/';
 const post=(route,data,extra={})=>fetch(base+prefix+route,{method:'POST',headers:{'content-type':'application/json','x-switchboard-desktop':secret,...extra},body:JSON.stringify(data),redirect:'manual'});
 const begin=async provider=>{
  const flow=await(await post('start',{provider})).json();assert(flow.id);const authorize=await fetch(flow.url,{redirect:'manual'});assert.equal(authorize.status,302);
  const authorization=new URL(authorize.headers.get('location'));assert.equal(authorization.searchParams.get('redirect_uri'),base+'/api/account/sso/feishu/callback');assert.equal(configs[0].redirectUri,configured,'不覆盖原部署回调');
  const state=authorization.searchParams.get('state'),cookie=authorize.headers.get('set-cookie').split(';')[0];
  return {...flow,state,cookie,authorization};
 };
 const callback=flow=>base+'/api/account/sso/feishu/callback?state='+flow.state+'&code=sample';
 try{
  assert.equal((await post('start',{provider:'primary'},{'x-switchboard-desktop':''})).status,403);
  assert.equal((await post('start',{},{})).status,409);
  for(const [provider,tenant] of [['primary','default'],['second',second.id]]){
   const flow=await begin(provider);assert.equal((await fetch(flow.url,{redirect:'manual'})).status,400,'启动票据不可重放');
   const forged=await fetch(callback(flow),{redirect:'manual'});assert.match(forged.headers.get('location'),/auth_error/,'回调需要浏览器 state cookie');
   const authorized=await fetch(callback(flow),{headers:{cookie:flow.cookie},redirect:'manual'});const location=authorized.headers.get('location');assert.match(location,/^switchboard:\/\/feishu-login\?code=/);
   assert(!authorized.headers.get('set-cookie').includes('sr_session='),'系统浏览器不获取 App 会话');
   const code=new URL(location).searchParams.get('code');
   assert.equal((await post('complete',{id:flow.id,code},{origin:'https://evil.example'})).status,403);
   assert.equal((await post('complete',{id:'wrong-id',code})).status,400);
   const complete=await post('complete',{id:flow.id,code});assert.equal(complete.status,200);assert.deepEqual(await complete.json(),{path:'/#overview'});
   const cookie=complete.headers.get('set-cookie').split(';')[0],me=await(await fetch(base+'/api/account/me',{headers:{cookie}})).json();assert.equal(me.tenantId,tenant);assert.equal(me.role,'member');assert.equal(me.platformAccess,false);assert.equal(me.tenants.length,1);
   assert.equal((await post('complete',{id:flow.id,code})).status,400);
   assert.match((await fetch(callback(flow),{headers:{cookie:flow.cookie},redirect:'manual'})).headers.get('location'),/auth_error/);
  }
  assert(exchanges.every(exchange=>exchange.redirect_uri===base+'/api/account/sso/feishu/callback'),'授权和兑换必须使用相同本机回调');
  const cancelled=await begin('primary');await post('cancel',{id:cancelled.id});const afterCancel=await fetch(callback(cancelled),{headers:{cookie:cancelled.cookie},redirect:'manual'});assert.match(afterCancel.headers.get('location'),/auth_error/);
  const failed=await begin('primary');const failedAuth=await fetch(callback(failed).replace('code=sample','code=wrong-enterprise'),{headers:{cookie:failed.cookie},redirect:'manual'});const failedCode=new URL(failedAuth.headers.get('location')).searchParams.get('code');assert.equal((await post('complete',{id:failed.id,code:failedCode})).status,403,'未绑定企业不可进入租户');
  const browserStart=await fetch(base+'/api/account/sso/feishu/start?provider=primary',{redirect:'manual'}),browserUrl=new URL(browserStart.headers.get('location'));
  assert.equal(browserUrl.searchParams.get('redirect_uri'),base+'/api/account/sso/feishu/callback');
  const browserLogin=await fetch(base+'/api/account/sso/feishu/callback?state='+browserUrl.searchParams.get('state')+'&code=sample',{headers:{cookie:browserStart.headers.get('set-cookie').split(';')[0]},redirect:'manual'});
  assert.equal(browserLogin.headers.get('location'),' /#overview'.trim());assert(browserLogin.headers.get('set-cookie').includes('sr_session='),'通过浏览器打开本机平台仍可正常登录');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('桌面关联飞书账号通过系统授权返回账户页，保留现有登录；注销后不能继续关联',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-desktop-link-')),admin='a'.repeat(64),secret='d'.repeat(64),accounts=new Accounts(dir,admin);
 const token=await accounts.setup({bootstrapToken:admin,name:'Owner',email:'owner@fixture.invalid',password:'fixture-password-12345'});
 const config={enabled:true,key:'primary',tenantId:'default',legacy:true,appId:'cli_first',appSecret:'first-secret',redirectUri:'https://deployment.example/api/account/sso/feishu/callback',allowedTenantKey:'first'};
 const identityFetcher=async url=>url.endsWith('/token')?Response.json({access_token:'fixture'}):Response.json({data:{open_id:'ou_owner',tenant_key:'first',name:'Owner'}});
 const server=createPlatform({dir,admin,gateway:'g'.repeat(64),desktopAuth:secret,oauthConfig:[config],identityFetcher});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,cookie='sr_session='+token;
 const start=()=>fetch(base+'/api/account/sso/feishu/link/start',{method:'POST',headers:{'content-type':'application/json',cookie,'user-agent':'SwitchboardDesktop'},body:'{}'});
 const authorize=async()=>{const flow=await(await start()).json();assert(flow.id);const response=await fetch(flow.url,{redirect:'manual'});const url=new URL(response.headers.get('location'));return {...flow,callback:base+'/api/account/sso/feishu/callback?state='+url.searchParams.get('state')+'&code=sample',cookie:response.headers.get('set-cookie').split(';')[0]};};
 try{
  const flow=await authorize(),callback=await fetch(flow.callback,{headers:{cookie:flow.cookie},redirect:'manual'});
  assert.match(callback.headers.get('location'),/^switchboard:\/\/feishu-login\?code=/);
  const code=new URL(callback.headers.get('location')).searchParams.get('code');
  const complete=await fetch(base+'/api/account/sso/feishu/desktop/complete',{method:'POST',headers:{'content-type':'application/json','x-switchboard-desktop':secret},body:JSON.stringify({id:flow.id,code})});
  assert.deepEqual(await complete.json(),{path:'/#account'});assert(!complete.headers.get('set-cookie'),'关联不替换原登录会话');
  const me=await(await fetch(base+'/api/account/me',{headers:{cookie}})).json();assert.equal(me.user.feishuLinked,true);assert.equal(me.platformAccess,true);
  const pending=await authorize();await fetch(base+'/api/account/logout',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});
  const rejected=await fetch(pending.callback,{headers:{cookie:pending.cookie},redirect:'manual'});const rejectedCode=new URL(rejected.headers.get('location')).searchParams.get('code');
  const result=await fetch(base+'/api/account/sso/feishu/desktop/complete',{method:'POST',headers:{'content-type':'application/json','x-switchboard-desktop':secret},body:JSON.stringify({id:pending.id,code:rejectedCode})});assert.equal(result.status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
