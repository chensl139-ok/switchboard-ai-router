import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const defaultEntitlements={maxApiKeys:null,maxMembers:null,labChat:true,labMedia:true,labCompare:true};
const builtin={id:'byok',name:'BYOK 基础使用',description:'使用本组织自己的服务商密钥；模型费用由上游服务商收取。',currency:'CNY',monthlyCents:null,yearlyCents:null,entitlements:defaultEntitlements};
const validCents=value=>value===null||Number.isSafeInteger(value)&&value>=0&&value<=100000000;
function normalizeEntitlements(input,previous=defaultEntitlements){
 if(input===undefined)return {...previous};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!(key in defaultEntitlements)))throw fail('套餐权益格式无效');
 const result={...previous,...input};
 for(const key of ['maxApiKeys','maxMembers'])if(result[key]!==null&&(!Number.isSafeInteger(result[key])||result[key]<1||result[key]>100000))throw fail('套餐数量限制须为 1–100000 或不限');
 for(const key of ['labChat','labMedia','labCompare'])if(typeof result[key]!=='boolean')throw fail('模型实验室权限须为布尔值');
 if(result.labCompare&&!result.labChat)throw fail('开启模型对比需同时开启对话实验室');
 return result;
}

export class Subscriptions {
 constructor(dir,{now=()=>Date.now()}={}){
  mkdirSync(dir,{recursive:true,mode:0o700});this.file=path.join(dir,'subscriptions.json');this.now=now;
  this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{plans:[],assignments:[],events:[]};
  for(const key of ['plans','assignments','events'])if(!Array.isArray(this.state[key]))throw Error('订阅数据格式无效：'+key);
 }
 save(){writeFileSync(this.file+'.tmp',JSON.stringify(this.state),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 mutate(fn){const before=structuredClone(this.state);try{const result=fn();this.save();return result;}catch(error){this.state=before;throw error;}}
 plans(){return [{...builtin,entitlements:{...defaultEntitlements}},...this.state.plans.map(({id,name,description,currency,monthlyCents,yearlyCents,entitlements})=>({id,name,description,currency,monthlyCents,yearlyCents,entitlements:normalizeEntitlements(entitlements)}))];}
 view(tenantId){
  const assignment=this.state.assignments.find(item=>item.tenantId===tenantId);
  const plan=this.plans().find(item=>item.id===assignment?.planId)||builtin;
  const now=this.now(),status=!assignment?'included':assignment.startsAt>now?'scheduled':assignment.endsAt!==null&&assignment.endsAt<=now?'expired':'active';
  return {tenantId,mode:'preview',entitlementsEnforced:false,paymentEnabled:false,status,plan,startsAt:assignment?.startsAt??null,endsAt:assignment?.endsAt??null,plans:this.plans(),notice:'当前为 BYOK 订阅框架预览：套餐权益仅供规划，API Key 数量与实验室权限尚不限制；未启用付费墙、购买、自动扣费或调用扣款。'};
 }
 upsertPlan(input,actorId){
  const id=String(input?.id||'').trim(),name=String(input?.name||'').trim(),description=String(input?.description||'').trim();
  if(!/^[a-z][a-z0-9-]{1,39}$/.test(id)||id==='byok')throw fail('套餐 ID 无效');
  if(!name||name.length>60||description.length>300)throw fail('套餐名称或说明无效');
  const monthlyCents=input.monthlyCents==null||input.monthlyCents===''?null:Number(input.monthlyCents),yearlyCents=input.yearlyCents==null||input.yearlyCents===''?null:Number(input.yearlyCents);
  if(!validCents(monthlyCents)||!validCents(yearlyCents))throw fail('套餐金额须为非负整数分');
  return this.mutate(()=>{
   const existing=this.state.plans.find(item=>item.id===id),plan={id,name,description,currency:'CNY',monthlyCents,yearlyCents,entitlements:normalizeEntitlements(input.entitlements,existing?.entitlements||defaultEntitlements)};
   if(existing)Object.assign(existing,plan);else{if(this.state.plans.length>=30)throw fail('套餐数量已达上限');this.state.plans.push(plan);}
   this.state.events.push({id:randomUUID(),type:'plan.upsert',actorId,planId:id,at:this.now()});return plan;
  });
 }
 assign(input,actorId,tenantExists){
  const tenantId=String(input?.tenantId||''),planId=String(input?.planId||'');
  if(!tenantExists(tenantId))throw fail('租户不存在',404);
  if(!this.plans().some(item=>item.id===planId))throw fail('套餐不存在',404);
  const startsAt=input?.startsAt==null?this.now():Date.parse(input.startsAt),endsAt=input?.endsAt==null||input.endsAt===''?null:Date.parse(input.endsAt);
  if(!Number.isSafeInteger(startsAt)||endsAt!==null&&(!Number.isSafeInteger(endsAt)||endsAt<=startsAt))throw fail('订阅起止时间无效');
  return this.mutate(()=>{
   const assignment={tenantId,planId,startsAt,endsAt,source:'manual',updatedAt:this.now(),actorId};
   this.state.assignments=this.state.assignments.filter(item=>item.tenantId!==tenantId);this.state.assignments.push(assignment);
   this.state.events.push({id:randomUUID(),type:'subscription.assign',tenantId,planId,startsAt,endsAt,actorId,at:this.now()});return this.view(tenantId);
  });
 }
 deleteTenant(tenantId){return this.mutate(()=>{this.state.assignments=this.state.assignments.filter(item=>item.tenantId!==tenantId);this.state.events=this.state.events.filter(item=>item.tenantId!==tenantId);});}
}
