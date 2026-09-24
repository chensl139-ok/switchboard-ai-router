import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
const hash=value=>createHash('sha256').update(value).digest('hex');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
export class ApiKeyStore {
 constructor(dir,{now=()=>Date.now(),tenantId=null,legacyEnabled=true}={}){
  this.file=path.join(dir,'api-keys.json');this.now=now;this.tenantId=tenantId;
  this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{legacyEnabled,keys:[]};
 }
 persist(){
  const snapshot=this.state;
  const temp=this.file+'.tmp';
  writeFileSync(temp,JSON.stringify(snapshot),{mode:0o600});
  renameSync(temp,this.file);
 }
 mutate(fn){const before=structuredClone(this.state);let result;try{result=fn();}catch(e){this.state=before;throw e;}
  try{this.persist();}catch(e){this.state=before;throw e;}
  return result;}
 validate(input){
  if(!input||typeof input!=='object'||typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw error('请输入 1–80 字的密钥名称');
  const result={name:input.name.trim(),enabled:input.enabled??true};
  if(typeof result.enabled!=='boolean')throw error('启用状态无效');
  for(const field of ['startsAt','expiresAt']){
   const value=input[field];
   if(value!==null&&value!==undefined&&value!==''&&(typeof value!=='string'||!Number.isFinite(Date.parse(value))))throw error('生效/过期时间格式无效');
   result[field]=value?new Date(value).toISOString():null;
  }
  if(result.startsAt&&result.expiresAt&&Date.parse(result.expiresAt)<=Date.parse(result.startsAt))throw error('过期时间必须晚于生效时间');
  for(const field of ['totalLimit','dailyLimit','rpmLimit']){
   const value=input[field]??null;
   if(value!==null&&(!Number.isSafeInteger(value)||value<1||value>1000000000))throw error('配额须为正整数；留空表示不限');
   result[field]=value;
  }
  return result;
 }
 status(key){if(key.deletedAt)return 'deleted';if(!key.enabled)return 'disabled';const now=this.now();if(key.startsAt&&now<Date.parse(key.startsAt))return 'scheduled';if(key.expiresAt&&now>=Date.parse(key.expiresAt))return 'expired';return 'active';}
 publicKey(key){const {digest,...item}=key;return {...item,status:this.status(key),dailyUsed:key.day===new Date(this.now()).toISOString().slice(0,10)?key.dailyUsed:0};}
 list(){return {legacyAvailable:!this.tenantId||this.tenantId==='default',legacyEnabled:this.state.legacyEnabled,keys:this.state.keys.filter(k=>!k.deletedAt).map(k=>this.publicKey(k))};}
 create(input,createdBy=null){const policy=this.validate(input);if(this.state.keys.filter(k=>!k.deletedAt).length>=200)throw error('最多创建 200 个 Key');
  if(createdBy!==null&&(typeof createdBy!=='string'||createdBy.length>128))throw error('Key 归属成员无效');
  const id=randomBytes(10).toString('hex'),token=`srk_${this.tenantId?this.tenantId+'_':''}${id}_${randomBytes(32).toString('hex')}`;
  const key={id,...policy,createdBy,digest:hash(token),preview:token.slice(0,12)+'…'+token.slice(-4),createdAt:new Date(this.now()).toISOString(),
   requests:0,successes:0,failures:0,knownTokens:0,day:'',dailyUsed:0,minute:0,minuteUsed:0,lastUsedAt:null};
  this.mutate(()=>this.state.keys.unshift(key));return {key:this.publicKey(key),token};
 }
 update(id,input){const policy=this.validate(input);return this.mutate(()=>{const key=this.state.keys.find(k=>k.id===id);if(!key||key.deletedAt)throw error('Key 不存在',404);Object.assign(key,policy);return this.publicKey(key);});}
 toggle(id,enabled){if(typeof enabled!=='boolean')throw error('启用状态无效');return this.mutate(()=>{const key=this.state.keys.find(k=>k.id===id);if(!key||key.deletedAt)throw error('Key 不存在',404);key.enabled=enabled;return this.publicKey(key);});}
 legacy(enabled){if(typeof enabled!=='boolean')throw error('启用状态无效');this.mutate(()=>{this.state.legacyEnabled=enabled;});return this.list();}
 delete(id){return this.mutate(()=>{const key=this.state.keys.find(k=>k.id===id&&!k.deletedAt);if(!key)throw error('Key 不存在',404);key.enabled=false;key.deletedAt=new Date(this.now()).toISOString();return {deleted:true,id};});}
 authenticate(token){
  if(typeof token!=='string'||token.length>300)throw error('API Key 无效',401);
  const digest=Buffer.from(hash(token),'hex');
  const key=this.state.keys.find(k=>timingSafeEqual(Buffer.from(k.digest,'hex'),digest));
  if(!key)throw error('API Key 无效',401);
  const status=this.status(key);
  if(status!=='active')throw error({deleted:'API Key 已删除',disabled:'API Key 已停用',scheduled:'API Key 尚未生效',expired:'API Key 已过期'}[status],403);
  return key.id;
 }
 owner(id){return this.state.keys.find(key=>key.id===id)?.createdBy||null;}
 admit(id){
  return this.mutate(()=>{
   const key=this.state.keys.find(k=>k.id===id);if(!key||this.status(key)!=='active')throw error('API Key 已停用、未生效或过期',403);
   const now=this.now(),day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
   const daily=key.day===day?key.dailyUsed:0,rate=key.minute===minute?key.minuteUsed:0;
   if(key.totalLimit!==null&&key.requests>=key.totalLimit)throw error('API Key 总调用配额已用完',429);
   if(key.dailyLimit!==null&&daily>=key.dailyLimit)throw error('API Key 今日调用配额已用完（UTC 零点重置）',429);
   if(key.rpmLimit!==null&&rate>=key.rpmLimit)throw error('API Key 每分钟调用频率超限',429);
   key.requests++;key.day=day;key.dailyUsed=daily+1;key.minute=minute;key.minuteUsed=rate+1;key.lastUsedAt=new Date(now).toISOString();
  });
 }
 complete(id,success,tokens=0){this.mutate(()=>{const key=this.state.keys.find(k=>k.id===id);if(!key)return;if(success)key.successes++;else key.failures++;if(Number.isSafeInteger(tokens)&&tokens>=0)key.knownTokens+=tokens;});}
}
