import {mediaPaths} from './media.mjs';
import {generationPaths,apiToken,clientError} from './protocols.mjs';
import {safeFetch} from './network.mjs';
import http from 'node:http';
import path from 'node:path';
import {rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHmac,randomUUID} from 'node:crypto';
import {createApp} from './server.mjs';
import {Accounts} from './accounts.mjs';
import {installWebSocket} from './realtime.mjs';
import {FeishuOAuth,feishuConfig} from './feishu-auth.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const configAuditActions=new Map([
 ['/api/keys','签发 API Key'],['/api/keys/update','修改 API Key'],['/api/keys/toggle','切换 API Key 状态'],['/api/keys/delete','删除 API Key'],['/api/keys/legacy','切换旧版调用令牌'],
 ['/api/models/register','加入模型调用列表'],['/api/prices','修改模型价格'],['/api/prices/sync','导入参考价格'],
 ['/api/provider','保存服务商配置'],['/api/provider/switch-model','切换服务商模型'],['/api/provider/reorder','调整服务商顺序'],['/api/provider/delete','删除服务商'],['/api/routing','修改路由策略']
]);
export function createPlatform({dir=process.env.DATA_DIR||path.join(root,'data'),admin=process.env.ADMIN_TOKEN,gateway=process.env.GATEWAY_TOKEN,fetcher=safeFetch,identityFetcher=globalThis.fetch,oauthConfig=feishuConfig()}={}){
 if(!admin||admin.length<24||!gateway||gateway.length<24)throw Error('请先运行 npm run setup 或配置管理令牌');
 const accounts=new Accounts(dir,admin),oauth=new FeishuOAuth(oauthConfig,{fetcher:identityFetcher}),engines=new Map(),limits=new Map();
 let activeRequests=0;const globalLimit=Number(process.env.GLOBAL_MAX_CONCURRENCY)||20;
 function acquireGlobal(){if(activeRequests>=globalLimit)throw fail('网关总并发已满，请稍后重试',429);activeRequests++;let released=false;return ()=>{if(!released){released=true;activeRequests--;}};}
 const derive=(purpose,id)=>createHmac('sha256',admin).update(purpose+':'+id).digest('hex');
 function engine(id){
  if(!accounts.state.tenants.some(t=>t.id===id))throw fail('租户不存在',404);
  if(!engines.has(id))engines.set(id,createApp({dir:id==='default'?dir:path.join(dir,'tenants',id),admin:derive('admin',id),gateway:id==='default'?gateway:derive('gateway',id),fetcher,tenantId:id,managed:true}));
  return engines.get(id);
 }
 function sessionToken(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sr_session='))?.slice('sr_session='.length)||'';}
 function session(req){return accounts.resolve(sessionToken(req));}
 function tokenIdentity(token){
  if(typeof token!=='string'||!token)throw fail('需要 API Key 或账户登录',401);
  const hinted=token.startsWith('srk_')?token.split('_')[1]:'';
  const id=accounts.state.tenants.some(t=>t.id===hinted)?hinted:'default';
  const caller=engine(id).resolveToken(token);if(caller.admin)throw fail('管理员令牌不能用于外部调用',401);
  return {...caller,tenantId:id};
 }
 function originAllowed(origin,host){return !origin||origin===`http://${host}`||origin===`https://${host}`;}
 function caller(req,token){return token?tokenIdentity(token):session(req);}
 function cookie(req,res,token){const secure=process.env.COOKIE_SECURE==='true'||req.socket.encrypted||req.headers['x-forwarded-proto']==='https';res.setHeader('Set-Cookie',`sr_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?43200:0}${secure?'; Secure':''}`);}
 function oauthCookie(req,res,state){const secure=process.env.COOKIE_SECURE==='true'||req.socket.encrypted||req.headers['x-forwarded-proto']==='https';res.setHeader('Set-Cookie',`sr_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/account/sso/feishu/callback; Max-Age=${state?600:0}${secure?'; Secure':''}`);}
 function namedCookie(req,name){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
 function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
 async function body(req){let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>65536)throw fail('请求过大',413);}try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw fail('JSON 格式无效');}}
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
    if(req.method==='GET'&&route==='status')return json(res,200,{needsSetup:accounts.state.users.length===0,sso:{feishu:oauth.publicStatus()}});
    if(req.method==='GET'&&route==='sso/feishu/start'){rate(req);const start=oauth.start();oauthCookie(req,res,start.state);res.writeHead(302,{location:start.url,'cache-control':'no-store'});return res.end();}
    if(req.method==='GET'&&route==='sso/feishu/callback'){
     try{const state=url.searchParams.get('state')||'';if(!state||state!==namedCookie(req,'sr_oauth_state'))throw fail('飞书登录校验失败，请重新登录');oauth.consumeState(state);const identity=await oauth.identity(url.searchParams.get('code'));const token=accounts.loginWithFeishu(identity,oauthConfig);oauthCookie(req,res,'');cookie(req,res,token);res.writeHead(302,{location:'/#overview','cache-control':'no-store'});return res.end();}
     catch(error){oauthCookie(req,res,'');res.writeHead(302,{location:'/?auth_error='+encodeURIComponent(error.message||'飞书登录失败'),'cache-control':'no-store'});return res.end();}
    }
    if(req.method==='POST'&&['setup','login','register'].includes(route)){
     rate(req);const data=await body(req);const token=await accounts[route](data);cookie(req,res,token);return json(res,200,accounts.me(accounts.resolve(token)));
    }
    if(req.method==='POST'&&route==='password-reset/complete'){rate(req);return json(res,200,await accounts.completePasswordReset(await body(req)));}
    if(req.method==='POST'&&route==='logout'){accounts.logout(sessionToken(req));cookie(req,res,'');return json(res,200,{ok:true});}
    const current=session(req);if(req.headers['x-tenant-id']&&req.headers['x-tenant-id']!==current.tenantId)throw fail('租户已在其他页面切换，请刷新后重试',409);
    if(req.method==='GET'&&route==='me')return json(res,200,accounts.me(current));
    if(req.method==='GET'&&route==='members')return json(res,200,accounts.members(current));
    if(req.method==='GET'&&route==='audit')return json(res,200,accounts.auditPage(current,Object.fromEntries(url.searchParams)));
    if(req.method==='GET'&&route==='usage-audit'){
     accounts.requireAdmin(current);const report=engine(current.tenantId).usageAudit(url.searchParams.get('days'));
     const tenantMembers=accounts.state.members.filter(member=>member.tenantId===current.tenantId),users=new Map(accounts.state.users.map(user=>[user.id,user]));
     return json(res,200,{...report,members:report.members.map(row=>{const user=users.get(row.actorId),membership=tenantMembers.find(member=>member.userId===row.actorId);return {...row,name:user?.name||'未归属调用',email:user?.email||'',role:membership?.role||'',costs:report.costs.filter(cost=>cost.actorId===row.actorId).map(({currency,amount})=>({currency,amount}))};}),keys:report.keys.map(row=>({...row,name:users.get(row.actorId)?.name||'未归属 API Key'}))});
    }
    if(req.method!=='POST')throw fail('接口不存在',404);
    const data=await body(req);
    if(route==='usage/reset'||route==='usage/clear'){
     if(current.role!=='owner')throw fail('仅租户所有者可重置或清除统计数据',403);
     const mode=route==='usage/reset'?'reset':'clear';
     if(data.confirm!==mode)throw fail('请确认统计操作',400);
     const result=engine(current.tenantId).resetStatistics(mode);
     accounts.mutate(()=>accounts.event(current.tenantId,current.userId,mode==='reset'?'usage.statistics.reset':'usage.statistics.clear',mode==='reset'?`统计起点 ${result.at}`:`清除 ${result.deletedCalls} 条请求记录`));
     return json(res,200,result);
    }
    if(route==='tenants'){const tenant=accounts.createTenant(current,data.name);return json(res,201,tenant);}
    if(route==='tenants/delete'){
     const removed=accounts.deleteTenant(current,data.tenantId);
     engines.get(removed.deleted)?.close();
     engines.delete(removed.deleted);
     try{rmSync(path.join(dir,'tenants',removed.deleted),{recursive:true,force:true});}catch(error){console.error(JSON.stringify({level:'error',event:'tenant_dir_cleanup_failed',tenantId:removed.deleted,message:error?.message||String(error)}));}
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
     res.once('finish',()=>{if(res.statusCode<400){try{accounts.mutate(()=>accounts.event(current.tenantId,current.userId,url.pathname,configAuditActions.get(url.pathname)));}catch{console.error('audit_write_failed');}}});
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
 server.on('close',()=>{for(const app of engines.values())app.closeStore();});
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
