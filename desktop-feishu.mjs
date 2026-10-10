import {randomBytes,timingSafeEqual} from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const nonce=()=>randomBytes(32).toString('hex');

// A browser receives only an authorize ticket and a one-time return code, never
// an account session or the native process's launch-only authentication secret.
export class DesktopFeishu {
 constructor(secret,{now=()=>Date.now(),revoke=()=>{}}={}){
  if(typeof secret!=='string'||secret.length<32)throw Error('桌面登录认证配置无效');
  this.secret=secret;this.now=now;this.revoke=revoke;this.flows=new Map();
 }
 authenticate(req){
  const value=req.headers['x-switchboard-desktop'];
  if(typeof value!=='string'||Buffer.byteLength(value)!==Buffer.byteLength(this.secret)||!timingSafeEqual(Buffer.from(value),Buffer.from(this.secret)))throw fail('需要桌面 App 发起登录',403);
 }
 prune(){for(const [id,flow] of this.flows)if(flow.expires<=this.now())this.cancel(id);}
 create(provider,context={purpose:'desktop-login'}){
  this.prune();if(this.flows.size>=20)throw fail('进行中的飞书登录过多，请关闭旧授权窗口后重试',429);
  const id=nonce(),ticket=nonce();this.flows.set(id,{id,ticket,provider,context,expires:this.now()+600_000});
  return {id,ticket};
 }
 authorize(ticket){
  this.prune();const flow=[...this.flows.values()].find(item=>item.ticket&&item.ticket===ticket);
  if(!flow)throw fail('桌面授权入口已失效，请回到 App 重试');
  delete flow.ticket;return flow;
 }
 assertPending(id){this.prune();const flow=this.flows.get(id);if(!flow||flow.result)throw fail('桌面登录请求已失效');}
 finish(id,result){
  this.prune();const flow=this.flows.get(id);
  if(!flow||flow.result){if(result.token)this.revoke(result.token);throw fail('桌面登录请求已失效');}
  flow.result=result;flow.code=nonce();return 'switchboard://feishu-login?code='+flow.code;
 }
 consume(id,code){
  this.prune();const flow=this.flows.get(id);
  if(!flow?.code||typeof code!=='string'||code!==flow.code)throw fail('桌面登录校验失败或已失效');
  this.flows.delete(id);if(flow.result.error)throw fail(flow.result.error,403);
  return flow.result;
 }
 cancel(id){const flow=this.flows.get(id);if(flow?.result?.token)this.revoke(flow.result.token);this.flows.delete(id);}
 close(){for(const id of this.flows.keys())this.cancel(id);}
}
