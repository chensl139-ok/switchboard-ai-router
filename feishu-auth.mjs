import {randomBytes} from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const jsonHeaders={'content-type':'application/json; charset=utf-8'};

export function feishuConfig(env=process.env){
 const appId=env.FEISHU_APP_ID?.trim()||'',appSecret=env.FEISHU_APP_SECRET?.trim()||'',redirectUri=env.FEISHU_REDIRECT_URI?.trim()||'';
 const enabled=Boolean(appId&&appSecret&&redirectUri),allowedTenantKey=env.FEISHU_ALLOWED_TENANT_KEY?.trim()||'';
 if(enabled){let url;try{url=new URL(redirectUri);}catch{throw Error('FEISHU_REDIRECT_URI 格式无效');}if(url.pathname!=='/api/account/sso/feishu/callback'||url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('FEISHU_REDIRECT_URI 必须是 HTTPS 回调地址且路径为 /api/account/sso/feishu/callback');}
 return {enabled,appId,appSecret,redirectUri,autoJoin:env.FEISHU_AUTO_JOIN==='true'&&Boolean(allowedTenantKey),allowedTenantKey,defaultRole:['member','viewer'].includes(env.FEISHU_DEFAULT_ROLE)?env.FEISHU_DEFAULT_ROLE:'member'};
}

export class FeishuOAuth {
 constructor(config,{fetcher=globalThis.fetch,now=()=>Date.now()}={}){this.config=config;this.fetcher=fetcher;this.now=now;this.states=new Map();}
 publicStatus(){return {enabled:this.config.enabled,autoJoin:this.config.autoJoin};}
 start(){
  if(!this.config.enabled)throw fail('飞书登录尚未配置',503);
  const state=randomBytes(24).toString('hex');this.states.set(state,this.now()+10*60_000);this.prune();
  const url=new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  url.searchParams.set('app_id',this.config.appId);url.searchParams.set('redirect_uri',this.config.redirectUri);url.searchParams.set('state',state);
  return {state,url:url.toString()};
 }
 consumeState(state){const expiresAt=this.states.get(state);this.states.delete(state);if(!expiresAt||expiresAt<this.now())throw fail('飞书登录请求已失效，请重新登录');}
 prune(){for(const [state,expiresAt] of this.states)if(expiresAt<this.now())this.states.delete(state);while(this.states.size>1000)this.states.delete(this.states.keys().next().value);}
 async identity(code){
  if(typeof code!=='string'||!code||code.length>2048)throw fail('飞书授权码无效');
  const tokenResponse=await this.fetcher('https://open.feishu.cn/open-apis/authen/v2/oauth/token',{method:'POST',headers:jsonHeaders,body:JSON.stringify({grant_type:'authorization_code',client_id:this.config.appId,client_secret:this.config.appSecret,code,redirect_uri:this.config.redirectUri}),redirect:'error',signal:AbortSignal.timeout(15_000)});
  let token;try{token=await tokenResponse.json();}catch{throw fail('飞书登录服务响应异常',502);}
  if(!tokenResponse.ok||token.code&&token.code!==0||!token.access_token)throw fail('飞书授权失败，请重新登录',502);
  const userResponse=await this.fetcher('https://open.feishu.cn/open-apis/authen/v1/user_info',{headers:{authorization:'Bearer '+token.access_token},redirect:'error',signal:AbortSignal.timeout(15_000)});
  let body;try{body=await userResponse.json();}catch{throw fail('飞书用户信息响应异常',502);}
  if(!userResponse.ok||body.code&&body.code!==0)throw fail('无法读取飞书用户信息',502);
  const user=body.data||body,email=typeof user.email==='string'?user.email.trim().toLowerCase():'';if(typeof user.open_id!=='string'||!user.open_id||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('飞书账户未提供有效企业邮箱，请联系管理员',403);
  return {openId:user.open_id,unionId:typeof user.union_id==='string'?user.union_id:'',tenantKey:typeof user.tenant_key==='string'?user.tenant_key:'',email,name:String(user.name||user.en_name||email.split('@')[0]).trim().slice(0,80)||'飞书用户'};
 }
}
