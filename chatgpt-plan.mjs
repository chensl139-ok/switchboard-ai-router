// Official Sign in with ChatGPT flow for this locally hosted OSS client.
// Credentials are private to a platform user AND tenant; never a public pool.
import {createHash,createCipheriv,createDecipheriv,createPublicKey,verify,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';

const AUTH='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const SCOPE='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const random=()=>randomBytes(32).toString('base64url');
const permission=scopes=>String(scopes||'').split(/\s+/).includes('chatgpt.tokens.use.direct');
export function planRequest(model,messages){
 if(typeof model!=='string'||!model||model.length>200||!Array.isArray(messages)||!messages.length||messages.length>40)throw fail('请选择模型，并提供 1–40 条文本消息');
 let length=0;
 const input=messages.map(message=>{
  if(!message||!['user','assistant','developer'].includes(message.role)||typeof message.content!=='string'||!message.content.trim())throw fail('此订阅连接目前仅支持文本对话');
  length+=message.content.length;if(length>100000)throw fail('对话过长，请新建对话',413);
  return {role:message.role,content:message.content};
 });
 // Plan usage does not accept temperature, max_output_tokens or stored responses.
 return {model,input,store:false,stream:true};
}

export async function readPlanStream(response,{onDelta=()=>{},onFirstByte=()=>{}}={}){
 if(!response.body)throw fail('订阅服务没有返回响应流',502);
 const decoder=new TextDecoder();let buffer='',text='',bytes=0,completed=null;
 const event=async block=>{
  const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data||data==='[DONE]')return;
  let value;try{value=JSON.parse(data);}catch{throw fail('订阅响应流格式无效',502);}
  if(value.type==='response.failed'||value.type==='response.incomplete'||value.type==='error'){
   const code=value.response?.error?.code||value.error?.code||value.code;
   throw fail(code==='subscription_sharing_usage_limit_exceeded'?'ChatGPT 订阅用量已达到上限，请稍后重试':code==='subscription_sharing_usage_unavailable'?'当前订阅无法使用，请在 ChatGPT 中检查套餐和授权':'订阅调用未完成，请重试或检查账户授权',502);
  }
  if(value.type==='response.output_text.delta'&&typeof value.delta==='string'){text+=value.delta;await onDelta({content:value.delta});}
  if(value.type==='response.completed'){
   if(!value.response||value.response.status!=='completed')throw fail('订阅服务未确认调用完成',502);
   completed=value.response;
  }
 };
 for await(const chunk of response.body){
  if(!bytes&&chunk.byteLength)await onFirstByte();
  bytes+=chunk.byteLength;if(bytes>4*1024*1024)throw fail('订阅响应过大',502);
  buffer+=decoder.decode(chunk,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
  let index;while((index=buffer.indexOf('\n\n'))!==-1){await event(buffer.slice(0,index));buffer=buffer.slice(index+2);if(completed)break;}
  if(completed)break; // The terminal event, not TCP closure, confirms success.
 }
 buffer+=decoder.decode();if(!completed&&buffer.trim())await event(buffer);
 if(!completed)throw fail('订阅响应中断，尚未收到完成事件',502);
 if(!text)text=(completed.output||[]).flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join('');
 return {text,usage:completed.usage||null,model:completed.model||'',responseId:completed.id||''};
}

export class ChatGPTPlan {
 constructor(dir,secret,{fetcher=globalThis.fetch,now=()=>Date.now(),sessionValid=()=>false}={}){
  this.file=path.join(dir,'chatgpt-plan.json');this.key=createHash('sha256').update('switchboard-chatgpt-plan:'+secret).digest();
  this.fetcher=fetcher;this.now=now;this.sessionValid=sessionValid;this.pending=new Map();this.latest=new Map();this.locks=new Map();this.catalog=new Map();this.versions=new Map();this.jwks=null;this.closed=false;
  this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{hostId:'urn:uuid:'+randomUUID(),accounts:[]};
 }
 save(next){writeFileSync(this.file+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(this.file+'.tmp',this.file);this.state=next;}
 seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(value=>value.toString('base64')).join('.');}
 open(value){const [iv,tag,encrypted]=value.split('.').map(part=>Buffer.from(part,'base64'));const cipher=createDecipheriv('aes-256-gcm',this.key,iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(encrypted),cipher.final()]).toString('utf8'));}
 own(caller,id){const record=this.state.accounts.find(record=>record.id===id&&record.userId===caller.userId&&record.tenantId===caller.tenantId);if(!record)throw fail('订阅连接不存在',404);return record;}
 guard(caller){if(this.closed||!this.sessionValid(caller))throw fail('登录已失效，请重新登录',401);if(caller.role==='viewer')throw fail('只读成员不能连接或调用订阅',403);}
 status(caller){return {enabled:true,accounts:this.state.accounts.filter(record=>record.userId===caller.userId&&record.tenantId===caller.tenantId).map(({id,label,connected,planEnabled,expiresAt})=>({id,label,connected,planEnabled,expiresAt})),pending:[...this.pending.values()].some(flow=>flow.context.userId===caller.userId&&flow.context.tenantId===caller.tenantId&&flow.expiresAt>this.now())};}
 start(caller,redirectUri,id){
  this.guard(caller);const redirect=new URL(redirectUri);if(redirect.protocol!=='http:'||redirect.hostname!=='127.0.0.1'||redirect.pathname!=='/api/account/chatgpt/callback'||redirect.search||redirect.hash)throw fail('订阅授权必须使用本机回调');
  for(const [key,flow] of this.pending)if(flow.expiresAt<=this.now()||flow.context.sessionHash===caller.sessionHash){this.pending.delete(key);if(this.latest.get(flow.context.sessionHash)===key)this.latest.delete(flow.context.sessionHash);}
  if(this.pending.size>=20)throw fail('授权请求过多，请稍后重试',429);
  if(this.state.accounts.filter(record=>record.userId===caller.userId&&record.tenantId===caller.tenantId).length>=10&&!id)throw fail('最多保存 10 个订阅账户');
  const record=id?this.own(caller,id):null,ticket=random();
  this.save(this.state); // Persist the stable host ID before the first authorization.
  this.pending.set(ticket,{context:{...caller},recordId:record?.id,version:record?this.versions.get(record.id)||0:0,clientId:record?.clientId||'dynamic_agent_client',redirectUri,state:random(),nonce:random(),verifier:random(),expiresAt:this.now()+600000,authorized:false});
  this.latest.set(caller.sessionHash,ticket);
  return {url:redirect.origin+'/api/account/chatgpt/authorize?ticket='+ticket};
 }
 authorize(ticket){
  const flow=this.pending.get(ticket);if(!flow||flow.authorized||flow.expiresAt<=this.now())throw fail('授权链接已失效，请重新连接');
  this.guard(flow.context);flow.authorized=true;
  const url=new URL(AUTH+'/api/accounts/authorize');
  const params={client_id:flow.clientId,ext_agent_host_id:this.state.hostId,response_type:'code',redirect_uri:flow.redirectUri,scope:SCOPE,resource:RESOURCE,state:flow.state,nonce:flow.nonce,code_challenge:createHash('sha256').update(flow.verifier).digest('base64url'),code_challenge_method:'S256'};
  if(flow.clientId==='dynamic_agent_client')params.agent_name_hint='Switchboard';
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  return {url:url.href,state:flow.state};
 }
 async request(url,options={}){
  try{return await this.fetcher(url,{redirect:'error',...options,...(options.body instanceof URLSearchParams?{body:options.body.toString()}:{}),signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(20000)});}catch{throw fail('无法连接 ChatGPT 订阅服务，请检查网络后重试',502);}
 }
 async json(response){
  let value;try{const text=await response.text();if(text.length>1024*1024)throw Error();value=JSON.parse(text);}catch{throw fail('订阅服务返回格式无效',502);}
  // Upstream OAuth expiry is not a Switchboard login failure. Returning 401
  // here would incorrectly send the user back to the platform login screen.
  if(!response.ok)throw fail(response.status===401||response.status===403?'订阅授权已失效，请重新连接':response.status===429?'ChatGPT 订阅用量受限，请稍后重试':'订阅服务请求失败（HTTP '+response.status+'）',response.status===401||response.status===403?403:response.status===429?429:502);
  return value;
 }
 async identity(token,clientId,nonce){
  try{
   if(typeof token!=='string'||token.length>20000)throw Error();
   const parts=token.split('.');if(parts.length!==3)throw Error();
   const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
   if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit)throw Error();
   if(!this.jwks||this.jwks.expiresAt<this.now()||!this.jwks.keys.some(key=>key.kid===header.kid)){
    const value=await this.json(await this.request(AUTH+'/.well-known/jwks.json'));if(!Array.isArray(value.keys))throw Error();this.jwks={keys:value.keys,expiresAt:this.now()+3600000};
   }
   const key=this.jwks.keys.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.use||key.use==='sig')&&(!key.alg||key.alg==='RS256'));
   if(!key)throw Error();const publicKey=createPublicKey({key,format:'jwk'});
   if(publicKey.asymmetricKeyDetails?.modulusLength<2048||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw Error();
   const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud],now=this.now()/1000;
   if(claims.iss!==AUTH||!audiences.includes(clientId)||audiences.length>1&&claims.azp!==clientId||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+60)||nonce!==undefined&&claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>300)throw Error();
   return {sub:claims.sub,label:typeof claims.email==='string'?claims.email.slice(0,254):typeof claims.name==='string'?claims.name.slice(0,80):'ChatGPT 账户'};
  }catch{throw fail('ChatGPT 身份校验失败，请重新授权',400);}
 }
 tokens(value,previous){
  if(value.token_type?.toLowerCase()!=='bearer'||typeof value.access_token!=='string'||!value.access_token||value.access_token.length>20000||typeof value.refresh_token!=='string'||!value.refresh_token||value.refresh_token.length>20000||!Number.isFinite(value.expires_in)||value.expires_in<=0||value.expires_in>86400)throw fail('订阅服务没有返回完整授权凭证',502);
  const scopes=typeof value.scope==='string'?value.scope:previous?.scopes||'';
  return {accessToken:value.access_token,refreshToken:value.refresh_token,idToken:value.id_token||previous?.idToken,scopes,expiresAt:this.now()+value.expires_in*1000,earliestRefreshAt:Number(value.earliest_refresh_at)||0};
 }
 async callback(params,cookie){
  if(['state','code','client_id','error'].some(key=>params.getAll(key).length>1))throw fail('授权回调参数无效');
  const state=params.get('state');const entry=[...this.pending].find(([,flow])=>flow.authorized&&flow.state===state);
  if(!state||state!==cookie||!entry)throw fail('授权校验失败，请从 App 重新连接');
  const [ticket,flow]=entry;this.pending.delete(ticket);
  if(flow.expiresAt<=this.now())throw fail('授权请求已过期，请重试');this.guard(flow.context);
  if(params.has('error'))throw fail('ChatGPT 授权已取消或未获许可');
  const clientId=flow.clientId==='dynamic_agent_client'?params.get('client_id'):flow.clientId;
  if(!clientId||clientId==='dynamic_agent_client'||!/^[-\w]{1,200}$/.test(clientId)||params.get('client_id')&&params.get('client_id')!==clientId||!params.get('code'))throw fail('ChatGPT 未返回有效注册结果');
  const value=await this.json(await this.request(AUTH+'/api/accounts/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code:params.get('code'),code_verifier:flow.verifier,redirect_uri:flow.redirectUri,resource:RESOURCE})}));
  try{
  const identity=await this.identity(value.id_token,clientId,flow.nonce),tokens=this.tokens(value);
  this.guard(flow.context);
  if(this.latest.get(flow.context.sessionHash)!==ticket)throw fail('授权请求已被新的连接替代',409);
  const previous=flow.recordId?this.own(flow.context,flow.recordId):this.state.accounts.find(record=>record.userId===flow.context.userId&&record.tenantId===flow.context.tenantId&&record.clientId===clientId&&record.sub===identity.sub);
  if(flow.recordId&&(previous.clientId!==clientId||previous.sub!==identity.sub||(this.versions.get(previous.id)||0)!==flow.version))throw fail('账户身份或连接状态已变化，请重新连接',409);
  const record={...previous,id:previous?.id||randomUUID(),userId:flow.context.userId,tenantId:flow.context.tenantId,clientId,sub:identity.sub,label:identity.label,connected:true,planEnabled:permission(tokens.scopes),expiresAt:tokens.expiresAt,sealed:this.seal(tokens)};
  this.save({...this.state,accounts:[...this.state.accounts.filter(item=>item.id!==record.id),record]});this.catalog.delete(record.id);
  this.versions.set(record.id,(this.versions.get(record.id)||0)+1);
  this.latest.delete(flow.context.sessionHash);
  return {planEnabled:record.planEnabled};
  }catch(error){if(typeof value.refresh_token==='string')await this.revoke(clientId,value.refresh_token);throw error;}
 }
 async access(caller,id){
  this.guard(caller);const record=this.own(caller,id);if(!record.connected||!record.planEnabled||!record.sealed)throw fail('请连接账户并允许使用 ChatGPT 订阅',403);
  const tokens=this.open(record.sealed);if(tokens.expiresAt>this.now()+30000)return tokens.accessToken;
  if(this.locks.has(id))return this.locks.get(id);
  const version=this.versions.get(id)||0;
  const task=(async()=>{
   if(tokens.earliestRefreshAt&&this.now()/1000<tokens.earliestRefreshAt)throw fail('凭证暂不可刷新，请稍后重试',429);
   const value=await this.json(await this.request(AUTH+'/api/accounts/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:record.clientId,refresh_token:tokens.refreshToken,resource:RESOURCE})}));
   let next;
   try{next=this.tokens(value,tokens);if(value.id_token){const identity=await this.identity(value.id_token,record.clientId);if(identity.sub!==record.sub)throw fail('刷新后的订阅身份不一致',403);}
   this.guard(caller);const current=this.own(caller,id);if(!current.connected||(this.versions.get(id)||0)!==version)throw fail('订阅连接已被取消',409);
   this.save({...this.state,accounts:this.state.accounts.map(item=>item.id===id?{...item,sealed:this.seal(next),expiresAt:next.expiresAt,planEnabled:permission(next.scopes)}:item)});
   }catch(error){if(typeof value.refresh_token==='string')await this.revoke(record.clientId,value.refresh_token);throw error;}
   if(!permission(next.scopes))throw fail('ChatGPT 订阅权限未获授权',403);
   return next.accessToken;
  })().finally(()=>this.locks.delete(id));this.locks.set(id,task);return task;
 }
 async models(caller,id){
  this.guard(caller);this.own(caller,id);const cached=this.catalog.get(id);if(cached&&cached.until>this.now())return cached.models;
  const version=this.versions.get(id)||0,token=await this.access(caller,id);
  const value=await this.json(await this.request(RESOURCE+'/models',{headers:{authorization:'Bearer '+token}}));
  this.guard(caller);if(!this.own(caller,id).connected||(this.versions.get(id)||0)!==version)throw fail('订阅连接已变化',409);
  if(!Array.isArray(value.models))throw fail('订阅模型列表格式不正确',502);
  const models=value.models.filter(model=>model.visibility==='list'&&typeof model.slug==='string').map(model=>({id:model.slug,name:typeof model.display_name==='string'?model.display_name:model.slug}));
  this.catalog.set(id,{models,until:this.now()+300000});return models;
 }
 async providers(caller){
  this.guard(caller);
  const records=this.state.accounts.filter(record=>record.userId===caller.userId&&record.tenantId===caller.tenantId);
  return Promise.all(records.map(async record=>{
   let models=[],error='';if(record.connected&&record.planEnabled)try{models=await this.models(caller,record.id);}catch(cause){if(cause.status===401)throw cause;error=cause.message;}
   this.guard(caller);const current=this.own(caller,record.id);
   return {id:'chatgpt-plan:'+current.id,subscriptionId:current.id,source:'chatgpt-plan',name:'ChatGPT 订阅',accountLabel:current.label,private:true,enabled:current.connected&&current.planEnabled&&!error,connected:current.connected,planEnabled:current.planEnabled,models:models.map(model=>model.id),modelNames:Object.fromEntries(models.map(model=>[model.id,model.name])),model:models.some(model=>model.id===current.selectedModel)?current.selectedModel:models[0]?.id||'',protocol:'responses',error,lastCall:current.lastCall||null};
  }));
 }
 async selectModel(caller,id,model){
  if(!(await this.models(caller,id)).some(item=>item.id===model))throw fail('当前订阅不支持此模型');this.guard(caller);this.own(caller,id);
  this.save({...this.state,accounts:this.state.accounts.map(record=>record.id===id?{...record,selectedModel:model}:record)});return {ok:true};
 }
 routing(caller){this.guard(caller);return this.state.routing?.find(item=>item.userId===caller.userId&&item.tenantId===caller.tenantId)?.policy||null;}
 setRouting(caller,policy){this.guard(caller);this.save({...this.state,routing:[...(this.state.routing||[]).filter(item=>item.userId!==caller.userId||item.tenantId!==caller.tenantId),{userId:caller.userId,tenantId:caller.tenantId,policy}]});return {ok:true};}
 clearRouting(caller){this.guard(caller);this.save({...this.state,routing:(this.state.routing||[]).filter(item=>item.userId!==caller.userId||item.tenantId!==caller.tenantId)});return {ok:true};}
 async response(caller,{id,model,messages},signal){
  const request=planRequest(model,messages);if(!(await this.models(caller,id)).some(item=>item.id===model))throw fail('当前订阅不支持此模型');
  const token=await this.access(caller,id);
  const response=await this.request(RESOURCE+'/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(request),signal});
  if(!response.ok)await this.json(response);return response;
 }
 recordCall(caller,id,model,usage){this.guard(caller);if(!this.own(caller,id).connected)throw fail('订阅连接已变化',409);this.save({...this.state,accounts:this.state.accounts.map(record=>record.id===id?{...record,lastCall:{status:'success',time:new Date(this.now()).toISOString(),model,outputTokens:usage.outputTokens??null}}:record)});}
 async chat(caller,{id,model,messages},signal,callbacks={}){
  const request=planRequest(model,messages);if(!(await this.models(caller,id)).some(item=>item.id===model))throw fail('当前订阅不支持此模型');
  const version=this.versions.get(id)||0,token=await this.access(caller,id);
  const response=await this.request(RESOURCE+'/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(request),signal});
  if(!response.ok)await this.json(response);
  let result;try{result=await readPlanStream(response,callbacks);}catch(error){if(error.status)throw error;throw fail('订阅响应中断，请重试',502);}
  this.guard(caller);if(!this.own(caller,id).connected||(this.versions.get(id)||0)!==version)throw fail('订阅连接已变化',409);
  this.save({...this.state,accounts:this.state.accounts.map(record=>record.id===id?{...record,lastCall:{status:'success',time:new Date(this.now()).toISOString(),model:result.model||model,outputTokens:result.usage?.output_tokens??null}}:record)});
  return result;
 }
 async disconnect(caller,id){
  this.guard(caller);const record=this.own(caller,id),tokens=record.sealed?this.open(record.sealed):null;
  this.versions.set(id,(this.versions.get(id)||0)+1);this.catalog.delete(id);
  for(const [ticket,flow] of this.pending)if(flow.recordId===id)this.pending.delete(ticket);
  this.save({...this.state,accounts:this.state.accounts.map(item=>item.id===id?{...item,sealed:null,connected:false,planEnabled:false,expiresAt:null}:item)});
  const revoked=tokens?await this.revoke(record.clientId,tokens.refreshToken):true;
  return {ok:true,revoked};
 }
 async revoke(clientId,token){
  for(let attempt=0;attempt<2;attempt++)try{
   const response=await this.request(AUTH+'/api/accounts/oauth/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,token,token_type_hint:'refresh_token'}),signal:AbortSignal.timeout(5000)});
   const status=response.status;await response.body?.cancel();if(response.ok)return true;if(status<500)return false;
  }catch{/* Never put upstream token responses or credentials in logs. */}
  return false;
 }
 close(){this.closed=true;this.pending.clear();this.latest.clear();this.catalog.clear();}
}
