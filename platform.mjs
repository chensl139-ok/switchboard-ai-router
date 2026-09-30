import {mediaPaths} from './media.mjs';
import {generationPaths,apiToken,clientError} from './protocols.mjs';
import {safeFetch} from './network.mjs';
import http from 'node:http';
import path from 'node:path';
import {rmSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHmac,randomUUID} from 'node:crypto';
import {createApp} from './server.mjs';
import {Accounts} from './accounts.mjs';
import {installWebSocket} from './realtime.mjs';
import {FeishuOAuth,feishuConfigs} from './feishu-auth.mjs';
import {FeishuBindings} from './feishu-bindings.mjs';
import {LabHistory} from './lab-history.mjs';
import {Subscriptions} from './subscriptions.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const configAuditActions=new Map([
 ['/api/keys','签发 API Key'],['/api/keys/update','修改 API Key'],['/api/keys/toggle','切换 API Key 状态'],['/api/keys/delete','删除 API Key'],['/api/keys/legacy','切换旧版调用令牌'],
 ['/api/models/register','加入模型调用列表'],['/api/prices','修改模型价格'],['/api/prices/sync','导入参考价格'],
 ['/api/provider','保存服务商配置'],['/api/provider/switch-model','切换服务商模型'],['/api/provider/reorder','调整服务商顺序'],['/api/provider/delete','删除服务商'],['/api/routing','修改路由策略']
]);
export function createPlatform({dir=process.env.DATA_DIR||path.join(root,'data'),admin=process.env.ADMIN_TOKEN,gateway=process.env.GATEWAY_TOKEN,fetcher=safeFetch,identityFetcher=globalThis.fetch,oauthConfig=feishuConfigs(),removeTenantData=rmSync}={}){
 if(!admin||admin.length<24||!gateway||gateway.length<24)throw Error('请先运行 npm run setup 或配置管理令牌');
 const accounts=new Accounts(dir,admin),labHistory=new LabHistory(dir),subscriptions=new Subscriptions(dir),environmentConfigs=(Array.isArray(oauthConfig)?oauthConfig:[oauthConfig]).filter(config=>config?.enabled).map(config=>({key:'primary',tenantId:'default',legacy:true,...config})),bindings=new FeishuBindings(dir,admin,environmentConfigs);
 let configs=bindings.configs();const oauths=new Map(configs.map(config=>[config.key,new FeishuOAuth(config,{fetcher:identityFetcher})])),engines=new Map(),limits=new Map();
 if(oauths.size!==configs.length||new Set(configs.map(config=>config.tenantId)).size!==configs.length)throw Error('飞书应用标识和租户必须一一对应');
 for(const config of configs)if(!accounts.state.tenants.some(tenant=>tenant.id===config.tenantId))throw Error(`飞书应用 ${config.key} 对应的平台租户不存在`);
 accounts.feishuAppsByTenant=new Map(configs.map(config=>[config.tenantId,config.appId]));
 accounts.platformFeishuAppId=environmentConfigs.find(config=>config.tenantId==='default'&&config.key==='primary')?.appId||'';
 const keepAfterUnbind=tenantId=>session=>session.userId===accounts.platformOwnerId()&&session.platformSource==='password'||session.tenantId!==tenantId&&!(tenantId==='default'&&session.platformSource==='feishu-primary');
 function refreshFeishu(){configs=bindings.configs();const next=new Map();for(const config of configs){const old=oauths.get(config.key);if(old&&old.config.appId===config.appId&&old.config.appSecret===config.appSecret){old.config=config;next.set(config.key,old);}else next.set(config.key,new FeishuOAuth(config,{fetcher:identityFetcher}));}oauths.clear();for(const [key,client] of next)oauths.set(key,client);accounts.feishuAppsByTenant=new Map(configs.map(config=>[config.tenantId,config.appId]));}
 const oauthForTenant=tenantId=>configs.find(config=>config.tenantId===tenantId);
 const oauthStatus=caller=>{const visible=caller&&!caller.platformAccess?configs.filter(config=>config.tenantId===caller.tenantId):configs;return {enabled:visible.length>0,autoJoin:visible.some(config=>config.autoJoin),providers:visible.map(({key,label,tenantId})=>({key,label:label||'飞书',...(caller?{tenantId}:{})}))};};
 let activeRequests=0;const globalLimit=Number(process.env.GLOBAL_MAX_CONCURRENCY)||20;
 function acquireGlobal(){if(activeRequests>=globalLimit)throw fail('网关总并发已满，请稍后重试',429);activeRequests++;let released=false;return ()=>{if(!released){released=true;activeRequests--;}};}
 const derive=(purpose,id)=>createHmac('sha256',admin).update(purpose+':'+id).digest('hex');
 function engine(id){
  if(!accounts.state.tenants.some(t=>t.id===id))throw fail('租户不存在',404);
  if(!engines.has(id))engines.set(id,createApp({dir:id==='default'?dir:path.join(dir,'tenants',id),admin:derive('admin',id),gateway:id==='default'?gateway:derive('gateway',id),fetcher,tenantId:id,managed:true}));
  if(id==='default')engines.get(id).claimUnassignedKeys(accounts.platformOwnerId());
  return engines.get(id);
 }
 function sessionToken(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sr_session='))?.slice('sr_session='.length)||'';}
 function session(req){return accounts.resolve(sessionToken(req));}
 function tokenIdentity(token){
  if(typeof token!=='string'||!token)throw fail('需要 API Key 或账户登录',401);
  const hinted=token.startsWith('srk_')?token.split('_')[1]:'';
  const id=accounts.state.tenants.some(t=>t.id===hinted)?hinted:'default';
  const caller=engine(id).resolveToken(token);if(caller.admin)throw fail('管理员令牌不能用于外部调用',401);
  if(caller.apiKeyId&&caller.userId){
   const membership=accounts.state.members.find(member=>member.userId===caller.userId&&member.tenantId===id);
   const role=membership?.role||(caller.userId===accounts.platformOwnerId()?'owner':null);
   if(!['owner','admin','member'].includes(role))throw fail('API Key 所属成员已离开租户或不再具备模型调用权限',403);
  }
  return {...caller,tenantId:id};
 }
 function originAllowed(origin,host){return !origin||origin===`http://${host}`||origin===`https://${host}`;}
 function caller(req,token){return token?tokenIdentity(token):session(req);}
 function setCookie(res,value){const previous=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',previous?[...(Array.isArray(previous)?previous:[previous]),value]:value);}
 function cookie(req,res,token){const secure=process.env.COOKIE_SECURE==='true'||req.socket.encrypted||req.headers['x-forwarded-proto']==='https';setCookie(res,`sr_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?43200:0}${secure?'; Secure':''}`);}
 function oauthCookie(req,res,state){const secure=process.env.COOKIE_SECURE==='true'||req.socket.encrypted||req.headers['x-forwarded-proto']==='https';setCookie(res,`sr_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/account/sso/feishu/callback; Max-Age=${state?600:0}${secure?'; Secure':''}`);}
 function namedCookie(req,name){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
 function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
 async function body(req,maxBytes=65536){const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>maxBytes)throw fail('请求过大',413);chunks.push(part);}try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw fail('JSON 格式无效');}}
 function rate(req){const key=req.socket.remoteAddress||'unknown';const now=Date.now();for(const [id,item] of limits)if(now-item.start>60000)limits.delete(id);if(limits.size>2000)throw fail('请求过多',429);const item=limits.get(key)||{start:now,count:0};item.count++;limits.set(key,item);if(item.count>20)throw fail('登录/注册尝试过多，请一分钟后重试',429);}
 const server=http.createServer(async(req,res)=>{
  const externalId=String(req.headers['x-request-id']||''),requestId=/^[A-Za-z0-9._:-]{1,128}$/.test(externalId)?externalId:randomUUID();
  res.setHeader('X-Request-ID',requestId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob: https: http:; media-src 'self' blob: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/healthz')return json(res,200,{ok:true});
   if(url.pathname==='/readyz'){engine('default').checkReady();return json(res,200,{ok:true,activeRequests});}
   if(!originAllowed(req.headers.origin,req.headers.host))throw fail('拒绝跨域请求',403);
   if(url.pathname.startsWith('/api/account/')){
    const route=url.pathname.slice('/api/account/'.length);
    if(req.method==='GET'&&route==='status'){let viewer=null;try{viewer=session(req);}catch{/* Anonymous login still needs enterprise entry points. */}return json(res,200,{needsSetup:accounts.state.users.length===0,sso:{feishu:oauthStatus(viewer)}});}
    if(req.method==='GET'&&route==='sso/feishu/start'){rate(req);const requested=url.searchParams.get('provider');if(!requested&&oauths.size>1)throw fail('当前有多个独立飞书企业应用，登录前须指定企业；自动识别需先部署跨企业应用',409);const key=requested||'primary',oauth=oauths.get(key);if(!oauth)throw fail('飞书企业登录入口不存在',404);const start=oauth.start();oauthCookie(req,res,start.state);res.writeHead(302,{location:start.url,'cache-control':'no-store'});return res.end();}
    if(req.method==='GET'&&route==='sso/feishu/callback'){
     let purpose='login';
     try{const state=url.searchParams.get('state')||'';if(!state||state!==namedCookie(req,'sr_oauth_state'))throw fail('飞书登录校验失败，请重新登录');const oauth=[...oauths.values()].find(client=>client.hasState(state));if(!oauth)throw fail('飞书登录请求已失效，请重新登录');const context=oauth.consumeState(state),config=oauth.config;purpose=context.purpose;const identity=await oauth.identity(url.searchParams.get('code'));oauthCookie(req,res,'');
      if(purpose==='link'){accounts.linkFeishu(identity,{...context,appId:config.appId,providerTenantId:config.tenantId,legacy:config.legacy,allowedTenantKey:config.allowedTenantKey});res.writeHead(302,{location:'/#account','cache-control':'no-store'});return res.end();}
      const token=accounts.loginWithFeishu(identity,config);cookie(req,res,token);res.writeHead(302,{location:'/#overview','cache-control':'no-store'});return res.end();}
     catch(error){oauthCookie(req,res,'');res.writeHead(302,{location:'/?auth_error='+encodeURIComponent(error.message||'飞书登录失败')+(purpose==='link'?'#account':''),'cache-control':'no-store'});return res.end();}
    }
    if(req.method==='POST'&&['setup','login','register'].includes(route)){
     rate(req);const data=await body(req);const token=await accounts[route](data);cookie(req,res,token);return json(res,200,accounts.me(accounts.resolve(token)));
    }
    if(req.method==='POST'&&route==='password-reset/complete'){rate(req);return json(res,200,await accounts.completePasswordReset(await body(req)));}
    if(req.method==='POST'&&route==='logout'){accounts.logout(sessionToken(req));cookie(req,res,'');return json(res,200,{ok:true});}
    const current=session(req);if(req.headers['x-tenant-id']&&req.headers['x-tenant-id']!==current.tenantId)throw fail('租户已在其他页面切换，请刷新后重试',409);
    if(req.method==='POST'&&route==='sso/feishu/link/start'){
     if(!req.headers['content-type']?.startsWith('application/json'))throw fail('需要同源 JSON 请求',415);
     rate(req);const config=oauthForTenant(current.tenantId);if(!config)throw fail('当前租户未配置飞书登录',404);const start=oauths.get(config.key).start({purpose:'link',userId:current.userId,tenantId:current.tenantId,sessionHash:current.sessionHash});oauthCookie(req,res,start.state);return json(res,200,{url:start.url});
    }
    if(req.method==='GET'&&route==='me')return json(res,200,accounts.me(current));
    if(req.method==='GET'&&route==='lab-history')return json(res,200,labHistory.page(current,{area:url.searchParams.get('area')||undefined,status:url.searchParams.get('status')||undefined,q:url.searchParams.get('q')||'',page:url.searchParams.get('page')||1,limit:url.searchParams.get('limit')||20,order:url.searchParams.get('order')||'recent'}));
    if(req.method==='GET'&&route==='lab-history/item')return json(res,200,labHistory.get(current,url.searchParams.get('id')));
    if(req.method==='GET'&&route==='sso/feishu/bindings'){accounts.requirePlatformOwner(current);return json(res,200,{bindings:bindings.metadata()});}
    if(req.method==='GET'&&route==='members')return json(res,200,accounts.members(current));
    if(req.method==='GET'&&route==='subscription'){
     accounts.requireAdmin(current);return json(res,200,subscriptions.view(current.tenantId));
    }
    if(req.method==='GET'&&route==='audit')return json(res,200,accounts.auditPage(current,Object.fromEntries(url.searchParams)));
    if(req.method==='GET'&&route==='usage-audit'){
     accounts.requireAdmin(current);const report=engine(current.tenantId).usageAudit(url.searchParams.get('days'));
     const tenantMembers=accounts.state.members.filter(member=>member.tenantId===current.tenantId),users=new Map(accounts.state.users.map(user=>[user.id,user]));
     return json(res,200,{...report,members:report.members.map(row=>{const user=users.get(row.actorId),membership=tenantMembers.find(member=>member.userId===row.actorId);return {...row,name:user?.name||'未归属调用',email:user?.email||'',role:membership?.role||'',costs:report.costs.filter(cost=>cost.actorId===row.actorId).map(({currency,amount})=>({currency,amount}))};}),keys:report.keys.map(row=>({...row,name:users.get(row.actorId)?.name||'未归属 API Key'}))});
    }
    if(req.method!=='POST')throw fail('接口不存在',404);
    const data=await body(req,route==='lab-history'?1024*1024:65536);
    if(route==='lab-history')return json(res,200,labHistory.put(current,data));
    if(route==='lab-history/delete')return json(res,200,labHistory.delete(current,data.id));
    if(route==='subscription/plan'){
     if(!req.headers['content-type']?.startsWith('application/json'))throw fail('需要同源 JSON 请求',415);
     accounts.requirePlatformOwner(current);const plan=subscriptions.upsertPlan(data,current.userId);
     accounts.mutate(()=>accounts.event('default',current.userId,'subscription.plan.upsert',plan.id));
     return json(res,200,plan);
    }
    if(route==='subscription/assign'){
     if(!req.headers['content-type']?.startsWith('application/json'))throw fail('需要同源 JSON 请求',415);
     accounts.requirePlatformOwner(current);const result=subscriptions.assign(data,current.userId,id=>accounts.state.tenants.some(tenant=>tenant.id===id));
     accounts.mutate(()=>accounts.event(data.tenantId,current.userId,'subscription.assign',result.plan.name));
     return json(res,200,{subscription:result});
    }
    if(route==='audit/clear'){
     if(!req.headers['content-type']?.startsWith('application/json'))throw fail('需要同源 JSON 请求',415);
     const result=accounts.clearAudit(current,data.confirm);
     console.info(JSON.stringify({level:'info',event:'tenant_audit_cleared',actorId:current.userId,deleted:result.deleted,time:new Date().toISOString()}));
     return json(res,200,result);
    }
    if(route==='sso/feishu/bindings'){
     accounts.requirePlatformOwner(current);const previous=bindings.metadata().find(item=>item.tenantId===data.tenantId),result=bindings.bind(data,accounts.state.tenants);refreshFeishu();accounts.mutate(()=>{if(previous&&previous.appId!==result.appId)accounts.state.sessions=accounts.state.sessions.filter(keepAfterUnbind(result.tenantId));accounts.event('default',current.userId,'tenant.feishu.bind',result.tenantId+' / '+result.appId);});return json(res,200,result);
    }
    if(route==='sso/feishu/bindings/delete'){
     accounts.requirePlatformOwner(current);const tenantId=String(data.tenantId||'');bindings.unbind(tenantId);refreshFeishu();accounts.mutate(()=>{accounts.state.sessions=accounts.state.sessions.filter(keepAfterUnbind(tenantId));accounts.event('default',current.userId,'tenant.feishu.unbind',tenantId);});return json(res,200,{ok:true});
    }
    if(route==='usage/reset'||route==='usage/clear'){
     if(current.role!=='owner')throw fail('仅租户所有者可重置或清除统计数据',403);
     const mode=route==='usage/reset'?'reset':'clear';
     if(data.confirm!==mode)throw fail('请确认统计操作',400);
     const result=engine(current.tenantId).resetStatistics(mode);
     accounts.mutate(()=>accounts.event(current.tenantId,current.userId,mode==='reset'?'usage.statistics.reset':'usage.statistics.clear',mode==='reset'?`统计起点 ${result.at}`:`清除 ${result.deletedCalls} 条请求记录`));
     return json(res,200,result);
    }
    if(route==='tenants'){const tenant=accounts.createTenant(current,data.name);return json(res,201,tenant);}
    if(route==='tenants/rename'){const tenant=accounts.renameTenant(current,data.name);return json(res,200,tenant);}
    if(route==='tenants/delete'){
     accounts.requirePlatformOwner(current);
     if(oauthForTenant(data.tenantId))throw fail('此租户已绑定飞书登录应用，请先移除对应配置再删除',409);
     accounts.validateDeleteTenant(current,data.tenantId);
     const tenantPath=path.join(dir,'tenants',data.tenantId),pendingRoot=path.join(dir,'tenant-deletion-pending');
     let pendingPath=null;
     if(existsSync(tenantPath)){mkdirSync(pendingRoot,{recursive:true,mode:0o700});pendingPath=path.join(pendingRoot,data.tenantId+'-'+randomUUID());renameSync(tenantPath,pendingPath);}
     let removed;
     try{removed=accounts.deleteTenant(current,data.tenantId);}
     catch(error){if(pendingPath)renameSync(pendingPath,tenantPath);throw error;}
     labHistory.deleteTenant(removed.deleted);
     try{subscriptions.deleteTenant(removed.deleted);}catch(error){console.error(JSON.stringify({level:'error',event:'tenant_subscription_cleanup_failed',tenantId:removed.deleted,message:error?.message||String(error)}));}
     engines.get(removed.deleted)?.close();
     engines.delete(removed.deleted);
     if(pendingPath)try{removeTenantData(pendingPath,{recursive:true,force:true});}catch(error){console.error(JSON.stringify({level:'error',event:'tenant_dir_cleanup_failed',tenantId:removed.deleted,path:pendingPath,message:error?.message||String(error)}));return json(res,202,{...removed,cleanupPending:true});}
     return json(res,200,removed);
    }
    if(route==='switch'){accounts.switchTenant(current,data.tenantId);return json(res,200,accounts.me(session(req)));}
    if(route==='invite')return json(res,201,accounts.invite(current,data));
    if(route==='revoke-invite'){accounts.revokeInvite(current,data.id);return json(res,200,{ok:true});}
    if(route==='accept-invite'){accounts.accept(current,data.code);return json(res,200,accounts.me(session(req)));}
    if(route==='member-role'){accounts.updateMember(current,data);return json(res,200,accounts.members(current));}
    if(route==='member-remove'){accounts.updateMember(current,data,true);return json(res,200,{ok:true});}
    if(route==='password'){const token=await accounts.changePassword(current,data);cookie(req,res,token);return json(res,200,{ok:true});}
    if(route==='password-reset/issue')return json(res,201,accounts.issuePasswordReset(current,data.userId));
    throw fail('接口不存在',404);
   }
   if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/')){
    const token=apiToken(req.headers);
    const current=url.pathname.startsWith('/api/')?session(req):caller(req,token);
    if(req.headers['x-tenant-id']&&req.headers['x-tenant-id']!==current.tenantId)throw fail('租户已切换，请刷新后重试',409);
    req.principal=current;
    if(req.method==='POST'&&configAuditActions.has(url.pathname)){
     const writeHead=res.writeHead;let audited=false;
     res.writeHead=function(status,...args){
      if(status<400&&!audited){accounts.mutate(()=>accounts.event(current.tenantId,current.userId,url.pathname,configAuditActions.get(url.pathname)));audited=true;}
      return writeHead.call(this,status,...args);
     };
    }
    if(req.method==='POST'&&(generationPaths[url.pathname]||mediaPaths.has(url.pathname)||url.pathname==='/v1/messages/count_tokens')){const release=acquireGlobal();res.once('finish',release);res.once('close',release);}
    engine(current.tenantId).emit('request',req,res);return;
   }
   engine('default').emit('request',req,res);
  }catch(error){const status=error.status||500;if(status>=500)console.error(JSON.stringify({level:'error',event:'request_failed',requestId,method:req.method,path:req.url.split('?')[0],status,message:error.message}));if(!res.headersSent)json(res,status,clientError(req.url.startsWith('/v1/messages')?'messages':'chat',error));else res.end();}
 });
 installWebSocket(server,{originAllowed,authenticate:(token,req,expectedTenant)=>{try{const current=caller(req,token);if(expectedTenant&&expectedTenant!==current.tenantId)throw fail('租户已切换',409);return current;}catch{return false;}},execute:async(input,options)=>{
  const current=caller(options.request,options.token);if(current.tenantId!==options.authContext.tenantId)throw fail('租户已切换，请重新建立连接',403);
  if(current.role==='viewer')throw fail('只读角色不可调用模型',403);
  const release=acquireGlobal();try{return await engine(current.tenantId).execute(input,{...options,apiKeyId:current.apiKeyId,actorId:current.userId,transport:'ws'});}finally{release();}
 }});
 server.on('close',()=>{for(const app of engines.values())app.closeStore();labHistory.close();});
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.on('unhandledRejection',error=>{console.error(JSON.stringify({level:'error',event:'unhandled_rejection',message:error?.message||String(error)}));});
 process.on('uncaughtException',error=>{console.error(JSON.stringify({level:'fatal',event:'uncaught_exception',message:error?.message||String(error),stack:error?.stack}));process.exit(1);});
 const app=createPlatform();
 const port=Number(process.env.PORT)||3000;
 const host=process.env.HOST||'0.0.0.0';
 app.listen(port,host,()=>console.log(`Switchboard account platform listening on ${host}:${port}`));
 for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>{app.close(()=>process.exit(0));setTimeout(()=>process.exit(0),35000).unref();});
}
