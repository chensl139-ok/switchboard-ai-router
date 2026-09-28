import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../accounts.mjs';
import {FeishuOAuth,feishuConfig,feishuConfigs} from '../feishu-auth.mjs';
import {createPlatform} from '../platform.mjs';

const password='correct-password-12345';
test('飞书配置仅在必要字段完整时启用',()=>{
 assert.equal(feishuConfig({FEISHU_APP_ID:'id'}).enabled,false);
 const config=feishuConfig({FEISHU_APP_ID:'id',FEISHU_APP_SECRET:'secret',FEISHU_REDIRECT_URI:'https://example.com/api/account/sso/feishu/callback',FEISHU_ALLOWED_TENANT_KEY:'tenant',FEISHU_AUTO_JOIN:'true',FEISHU_DEFAULT_ROLE:'viewer'});
 assert.deepEqual({enabled:config.enabled,autoJoin:config.autoJoin,defaultRole:config.defaultRole},{enabled:true,autoJoin:true,defaultRole:'viewer'});assert.throws(()=>feishuConfig({FEISHU_APP_ID:'id',FEISHU_APP_SECRET:'secret',FEISHU_REDIRECT_URI:'http://example.com/api/account/sso/feishu/callback'}));
});

test('两家企业应用必须映射不同平台租户，并共用已验证的 HTTPS 回调',()=>{
 const env={FEISHU_APP_ID:'cli_moss',FEISHU_APP_SECRET:'secret-a',FEISHU_PROVIDER_LABEL:'模思智能',FEISHU_REDIRECT_URI:'https://switchboard.example.com/api/account/sso/feishu/callback',FEISHU_ADDITIONAL_APPS_JSON:JSON.stringify([{key:'ai-test',label:'ai test',appId:'cli_ai_test',appSecret:'secret-b',tenantId:'tenant-b',tenantKey:'tenant-key-b'}])};
 const configs=feishuConfigs(env);
 assert.deepEqual(configs.map(({key,label,tenantId,autoJoin})=>({key,label,tenantId,autoJoin})),[{key:'primary',label:'模思智能',tenantId:'default',autoJoin:false},{key:'ai-test',label:'ai test',tenantId:'tenant-b',autoJoin:false}]);
 assert.equal(configs[1].redirectUri,configs[0].redirectUri);
 assert.throws(()=>feishuConfigs({...env,FEISHU_ADDITIONAL_APPS_JSON:JSON.stringify([{key:'ai-test',label:'ai test',appId:'cli_ai_test',appSecret:'secret-b',tenantId:'default'}])}),/非默认租户/);
 assert.throws(()=>feishuConfigs({...env,FEISHU_ADDITIONAL_APPS_JSON:JSON.stringify([{key:'primary',label:'ai test',appId:'cli_ai_test',appSecret:'secret-b',tenantId:'tenant-b'}])}),/一一对应/);
 assert.throws(()=>feishuConfigs({...env,FEISHU_REDIRECT_URI:'http://public.example.com/api/account/sso/feishu/callback'}),/HTTPS/);
});

test('飞书 OAuth 使用一次性 state 并读取企业身份',async()=>{
 const calls=[];const oauth=new FeishuOAuth({enabled:true,appId:'id',appSecret:'secret',redirectUri:'https://example.com/callback'},{fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({access_token:'token'}):Response.json({data:{open_id:'ou_1',union_id:'on_1',tenant_key:'tenant',email:'USER@example.com',name:'同事'}});}});
 const start=oauth.start({purpose:'link'});assert.match(start.url,/accounts\.feishu\.cn/);assert.deepEqual(oauth.consumeState(start.state),{purpose:'link'});assert.throws(()=>oauth.consumeState(start.state));
 const identity=await oauth.identity('code');assert.equal(identity.email,'user@example.com');assert.equal(identity.openId,'ou_1');assert.equal(calls[0].url,'https://accounts.feishu.cn/oauth/v3/token');assert.equal(JSON.parse(calls[0].options.body).client_secret,'secret');assert.equal(calls[1].options.headers.authorization,'Bearer token');
});

test('没有邮箱字段权限时仍可用 Open ID 识别已绑定用户',async()=>{
 const oauth=new FeishuOAuth({enabled:true,appId:'id',appSecret:'secret',redirectUri:'https://example.com/callback'},{fetcher:async url=>url.endsWith('/token')?Response.json({code:0,access_token:'token'}):Response.json({code:0,data:{open_id:'ou_2',tenant_key:'tenant',name:'同事'}})});
 assert.deepEqual(await oauth.identity('code'),{openId:'ou_2',unionId:'',tenantKey:'tenant',email:'',name:'同事'});
});

test('现有账户须主动连接飞书，随后按 Open ID 登录；邮箱不能自动认领账户',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-account-')),accounts=new Accounts(dir,'a'.repeat(32));
 try{
  const ownerToken=await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:'a'.repeat(32)}),owner=accounts.resolve(ownerToken);
  const invited=accounts.invite(owner,{email:'member@example.com',role:'member'});
  const memberToken=await accounts.register({name:'Member',email:'member@example.com',password,inviteCode:invited.code}),member=accounts.resolve(memberToken);
  const identity={openId:'ou_member',unionId:'on_member',tenantKey:'tenant',email:'member@example.com',name:'Member'};
  assert.throws(()=>accounts.loginWithFeishu(identity,{allowedTenantKey:'tenant'}),/先用密码登录/);
  assert.throws(()=>accounts.linkFeishu(identity,{...member,allowedTenantKey:'other'}),/无权访问/);
  accounts.linkFeishu(identity,{...member,allowedTenantKey:'tenant'});
  assert.equal(accounts.me(accounts.resolve(memberToken)).user.feishuLinked,true);
  const sso=accounts.resolve(accounts.loginWithFeishu({...identity,email:''},{allowedTenantKey:'tenant'}));
  assert.equal(sso.userId,member.userId,'飞书登录必须按 Open ID 匹配，不依赖返回邮箱');
  assert.throws(()=>accounts.loginWithFeishu({...identity,tenantKey:'other'},{allowedTenantKey:'tenant'}),/无权访问/);
  assert.throws(()=>accounts.linkFeishu(identity,{...owner,allowedTenantKey:'tenant'}),/其他平台账户/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('已绑定企业成员可免邀请首次飞书登录，缺少邮箱也不影响；身份保持租户隔离',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-auto-join-')),accounts=new Accounts(dir,'a'.repeat(32));
 try{
  await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:'a'.repeat(32)});
  accounts.platformFeishuAppId='cli_moss';accounts.feishuAppsByTenant=new Map([['default','cli_moss']]);
  const config={appId:'cli_moss',tenantId:'default',allowedTenantKey:'moss',autoJoin:true,defaultRole:'member'};
  const identity={openId:'ou_colleague',tenantKey:'moss',email:'',name:'Colleague'};
  const member=accounts.resolve(accounts.loginWithFeishu(identity,config));
  assert.equal(member.role,'member');assert.equal(member.platformAccess,false);
  assert.equal(accounts.me(member).tenants.length,1);
  assert.match(member.email,/^feishu-.+@accounts\.invalid$/);
  assert.equal(accounts.state.users.length,2);
  assert.equal(accounts.resolve(accounts.loginWithFeishu(identity,config)).userId,member.userId);
  assert.equal(accounts.state.users.length,2,'再次登录不应重复创建账号');
  assert.throws(()=>accounts.loginWithFeishu({...identity,openId:'ou_other',tenantKey:'other'},config),/无权访问/);
  assert.throws(()=>accounts.loginWithFeishu({...identity,openId:'ou_other',tenantKey:''},{...config,allowedTenantKey:''}),/无法验证飞书企业身份/);
  assert.throws(()=>accounts.loginWithFeishu({...identity,openId:'ou_owner',email:'owner@example.com'},config),/先用密码登录/);
  assert.throws(()=>accounts.loginWithFeishu({...identity,openId:'ou_disabled'},{...config,autoJoin:false}),/尚未连接/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('飞书绑定和登录回调完整流程使用一次性 state，不按邮箱冒认',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-platform-'));
 const oauthConfig=feishuConfig({FEISHU_APP_ID:'cli_test',FEISHU_APP_SECRET:'secret',FEISHU_REDIRECT_URI:'https://gateway.example.com/api/account/sso/feishu/callback',FEISHU_ALLOWED_TENANT_KEY:'tenant'});
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),oauthConfig,identityFetcher:async url=>url.endsWith('/token')?Response.json({code:0,access_token:'test-token'}):Response.json({code:0,data:{open_id:'ou_owner',tenant_key:'tenant',email:'OWNER@example.com',name:'Owner'}})});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  const setup=await fetch(base+'/api/account/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Owner',email:'owner@example.com',password,bootstrapToken:'a'.repeat(32)})});
  assert.equal(setup.status,200);const session=setup.headers.get('set-cookie').split(';')[0];
  const start=await fetch(base+'/api/account/sso/feishu/link/start',{method:'POST',headers:{cookie:session,'content-type':'application/json'},body:'{}'});
  assert.equal(start.status,200);const oauthCookie=start.headers.get('set-cookie').split(';')[0],link=await start.json(),state=new URL(link.url).searchParams.get('state');
  const callback=await fetch(base+'/api/account/sso/feishu/callback?state='+state+'&code=sample',{headers:{cookie:oauthCookie},redirect:'manual'});
  assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),' /#account'.trim());
  assert.match(callback.headers.get('set-cookie'),/sr_oauth_state=;[^,]*Max-Age=0/);
  const me=await fetch(base+'/api/account/me',{headers:{cookie:session}});assert.equal((await me.json()).user.feishuLinked,true);
  const replay=await fetch(base+'/api/account/sso/feishu/callback?state='+state+'&code=sample',{headers:{cookie:oauthCookie},redirect:'manual'});
  assert.match(replay.headers.get('location'),/auth_error=/);
  const loginStart=await fetch(base+'/api/account/sso/feishu/start',{redirect:'manual'}),loginState=new URL(loginStart.headers.get('location')).searchParams.get('state');
  const logged=await fetch(base+'/api/account/sso/feishu/callback?state='+loginState+'&code=sample',{headers:{cookie:loginStart.headers.get('set-cookie').split(';')[0]},redirect:'manual'});
  assert.equal(logged.headers.get('location'),' /#overview'.trim());assert.match(logged.headers.get('set-cookie'),/sr_oauth_state=;[^,]*Max-Age=0/);assert.match(logged.headers.get('set-cookie'),/sr_session=/);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('双企业同名 Open ID 不串号，登录固定落在各自租户',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-two-tenants-')),accounts=new Accounts(dir,'a'.repeat(32));
 try{
  accounts.platformFeishuAppId='cli_moss';accounts.feishuAppsByTenant=new Map([['default','cli_moss']]);
  const ownerToken=await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:'a'.repeat(32)}),owner=accounts.resolve(ownerToken);
  const second=accounts.createTenant(owner,'ai test'),invite=accounts.invite({...owner,tenantId:second.id},{email:'second@example.com',role:'member'});
  const memberToken=await accounts.register({name:'Second',email:'second@example.com',password,inviteCode:invite.code}),member=accounts.resolve(memberToken);
  assert.throws(()=>accounts.invite(owner,{email:'second@example.com',role:'viewer'}),/归属其他租户/);
  accounts.mutate(()=>accounts.state.members.push({tenantId:'default',userId:member.userId,role:'viewer'}));
  const firstIdentity={openId:'ou_same',tenantKey:'moss',email:'owner@example.com',name:'Owner'};
  const secondIdentity={openId:'ou_same',tenantKey:'other',email:'second@example.com',name:'Second'};
  accounts.linkFeishu(firstIdentity,{...owner,appId:'cli_moss',providerTenantId:'default',allowedTenantKey:'moss'});
  accounts.linkFeishu(secondIdentity,{...member,appId:'cli_ai_test',providerTenantId:second.id,allowedTenantKey:'other'});
  const ownerLogin=accounts.resolve(accounts.loginWithFeishu(firstIdentity,{appId:'cli_moss',tenantId:'default',allowedTenantKey:'moss'}));assert.equal(ownerLogin.userId,owner.userId);assert.equal(ownerLogin.platformAccess,true);
  assert.equal(accounts.state.audit.some(row=>row.action==='account.login.feishu'),false,'例行成功登录不应挤占管理操作审计');
  const secondLogin=accounts.resolve(accounts.loginWithFeishu(secondIdentity,{appId:'cli_ai_test',tenantId:second.id,allowedTenantKey:'other'}));
  assert.equal(secondLogin.userId,member.userId);assert.equal(secondLogin.tenantId,second.id);assert.equal(secondLogin.platformAccess,false);
  assert.deepEqual(accounts.me(secondLogin).tenants.map(tenant=>tenant.id),[second.id],'普通飞书登录不得列出另一个租户的成员关系');
  assert.throws(()=>accounts.switchTenant(secondLogin,'default'),/仅平台主账号/);
  assert.throws(()=>accounts.loginWithFeishu({...secondIdentity,email:''},{appId:'cli_ai_test',tenantId:'default',allowedTenantKey:'other'}),/尚未连接/);
  assert.throws(()=>accounts.linkFeishu(secondIdentity,{...owner,appId:'cli_ai_test',providerTenantId:second.id}),/不匹配/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('双企业 OAuth 入口和回调按应用隔离，不能通过回调参数切换租户',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-two-apps-')),accounts=new Accounts(dir,'a'.repeat(32));
 const ownerToken=await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:'a'.repeat(32)}),owner=accounts.resolve(ownerToken);
 const second=accounts.createTenant(owner,'ai test');
 const identity={openId:'ou_owner',unionId:'on_owner',tenantKey:'moss',email:'owner@example.com',name:'Owner'};
 accounts.linkFeishu(identity,{...owner,appId:'cli_moss',providerTenantId:'default',allowedTenantKey:'moss'});
 accounts.switchTenant(owner,second.id);
 const configs=feishuConfigs({FEISHU_APP_ID:'cli_moss',FEISHU_APP_SECRET:'secret-a',FEISHU_PROVIDER_LABEL:'模思智能',FEISHU_REDIRECT_URI:'https://gateway.example.com/api/account/sso/feishu/callback',FEISHU_ALLOWED_TENANT_KEY:'moss',FEISHU_ADDITIONAL_APPS_JSON:JSON.stringify([{key:'ai-test',label:'ai test',appId:'cli_ai_test',appSecret:'secret-b',tenantId:second.id,tenantKey:'other'}])});
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),oauthConfig:configs,identityFetcher:async(url,options)=>{
  if(url.endsWith('/token'))return Response.json({access_token:JSON.parse(options.body).client_id});
  const appId=options.headers.authorization.slice('Bearer '.length);return Response.json({data:{open_id:'ou_owner',tenant_key:appId==='cli_moss'?'moss':'other',email:'owner@example.com',name:'Owner'}});
 }});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  const status=await fetch(base+'/api/account/status').then(r=>r.json());assert.deepEqual(status.sso.feishu.providers.map(p=>p.label),['模思智能','ai test']);
  assert.ok(status.sso.feishu.providers.every(provider=>!Object.hasOwn(provider,'tenantId')),'匿名登录页只需要入口名称，不应公开内部租户 ID');
  const ambiguous=await fetch(base+'/api/account/sso/feishu/start',{redirect:'manual'});assert.equal(ambiguous.status,409,'多个企业应用时不得悄悄回退到默认企业');
  const ownerCookie='sr_session='+ownerToken;
  const beforeLink=await fetch(base+'/api/account/me',{headers:{cookie:ownerCookie}}).then(r=>r.json());assert.equal(beforeLink.tenantId,second.id);assert.equal(beforeLink.user.feishuLinked,false);assert.equal(beforeLink.tenants.find(tenant=>tenant.id===second.id).ssoProtected,true);
  const linkStart=await fetch(base+'/api/account/sso/feishu/link/start',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:'{}'});
  assert.equal(linkStart.status,200);const linkUrl=new URL((await linkStart.json()).url);assert.equal(linkUrl.searchParams.get('app_id'),'cli_ai_test');
  const linkCallback=await fetch(base+'/api/account/sso/feishu/callback?state='+linkUrl.searchParams.get('state')+'&code=sample&provider=primary',{headers:{cookie:linkStart.headers.get('set-cookie').split(';')[0]},redirect:'manual'});
  assert.equal(linkCallback.headers.get('location'),' /#account'.trim());
  const afterLink=await fetch(base+'/api/account/me',{headers:{cookie:ownerCookie}}).then(r=>r.json());assert.equal(afterLink.user.feishuLinked,true);
  for(const [key,appId,tenantId] of [['primary','cli_moss','default'],['ai-test','cli_ai_test',second.id]]){
   const start=await fetch(base+'/api/account/sso/feishu/start?provider='+key,{redirect:'manual'});assert.equal(start.status,302);
   const location=new URL(start.headers.get('location'));assert.equal(location.searchParams.get('app_id'),appId);
   const state=location.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
   const callback=await fetch(base+'/api/account/sso/feishu/callback?state='+state+'&code=sample&provider=primary',{headers:{cookie},redirect:'manual'});
   assert.equal(callback.headers.get('location'),' /#overview'.trim());
   const session=callback.headers.get('set-cookie').match(/sr_session=([^;]+)/)?.[0];assert.ok(session);
   const me=await fetch(base+'/api/account/me',{headers:{cookie:session}}).then(r=>r.json());assert.equal(me.tenantId,tenantId);assert.equal(me.platformAccess,key==='primary','仅模思智能飞书身份可获得主账号权限');assert.equal(me.tenants.length,key==='primary'?2:1);
   if(key==='ai-test'){
    const scopedStatus=await fetch(base+'/api/account/status',{headers:{cookie:session}}).then(r=>r.json());assert.deepEqual(scopedStatus.sso.feishu.providers.map(provider=>provider.tenantId),[second.id],'已登录的普通来源不得查看其他组织的飞书入口');
    const switchFromSso=await fetch(base+'/api/account/switch',{method:'POST',headers:{cookie:session,'content-type':'application/json'},body:JSON.stringify({tenantId:'default'})});
    assert.equal(switchFromSso.status,403);
    for(const [route,data] of [['tenants',{name:'forbidden'}],['tenants/delete',{tenantId:'default'}],['sso/feishu/bindings/delete',{tenantId:'default'}],['audit/clear',{confirm:'清除全部审计日志'}]]){
     const blocked=await fetch(base+'/api/account/'+route,{method:'POST',headers:{cookie:session,'content-type':'application/json'},body:JSON.stringify(data)});
     assert.equal(blocked.status,403,`同一主账号通过 ai test 飞书登录不得执行 ${route}`);
    }
    const bindings=await fetch(base+'/api/account/sso/feishu/bindings',{headers:{cookie:session}});
    assert.equal(bindings.status,403,'非主账号来源不得查看其他租户的飞书绑定');
   }
  }
  const created=await fetch(base+'/api/account/tenants',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:JSON.stringify({name:'another tenant'})});
  assert.equal(created.status,201);const third=await created.json();
  const switched=await fetch(base+'/api/account/switch',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:JSON.stringify({tenantId:third.id})});assert.equal(switched.status,200);
  const blockedDelete=await fetch(base+'/api/account/tenants/delete',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:JSON.stringify({tenantId:second.id})});
  assert.equal(blockedDelete.status,409,'切换到新租户后仍不能删除已绑定飞书应用的租户');
  const stillOwned=await fetch(base+'/api/account/me',{headers:{cookie:ownerCookie}}).then(r=>r.json());assert.ok(stillOwned.tenants.some(tenant=>tenant.id===second.id&&tenant.ssoProtected));assert.equal(stillOwned.tenants.find(tenant=>tenant.id===third.id).ssoProtected,false);
  assert.equal((await fetch(base+'/api/account/sso/feishu/start?provider=unknown',{redirect:'manual'})).status,404);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
