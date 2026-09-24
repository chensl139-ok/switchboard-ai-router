import {plainText,contentParts} from './protocols.mjs';
import {usablePrice,priceEstimate,priceAt} from './pricing.mjs';
import {credentialFor,hasCredential,channelFor,credentialChannels} from './provider-key.ts';
export const strategies=['manual','fallback','weighted','latency','rules','economy'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const recentlyFailed=(state,provider,model,now)=>{
 const last=state.logs.filter(log=>(log.providerId===provider.id||(!log.providerId&&log.provider===provider.name))&&log.model===model).slice(0,3);
 return last.length===3&&last.every(log=>log.status>=400)&&now-Date.parse(last[0].time)<60000;
};
const credentialRoutes=(provider,model,routeReason,channelOverride)=>{
 const channels=channelOverride?[channelOverride]:credentialChannels(provider,model);
 return channels.map((channel,index)=>({...provider,model,channelOverride:channel,routeReason:index?`${routeReason} · 备用密钥`:routeReason}));
};
const hasModelCredential=(provider,model,channelOverride)=>channelOverride?Boolean(credentialFor(provider,model,channelOverride)):credentialChannels(provider,model).length>0;
const modelRoutes=(state,provider,firstModel,now,channelOverride)=>[firstModel,...provider.models.filter(model=>model!==firstModel)]
 .filter((model,index)=>hasModelCredential(provider,model,channelOverride)&&(index===0||!recentlyFailed(state,provider,model,now)))
 .map((model,index)=>credentialRoutes(provider,model,index===0?'显式起始模型':'同服务商模型故障转移',channelOverride))
 .reduce((routes,group)=>(routes[0].push(group[0]),routes[1].push(...group.slice(1)),routes),[[],[]]).flat();
export function selectRoutes(state,input,{sequence=0,now=Date.now()}={}){
 const available=state.providers.filter(p=>p.enabled&&p.model&&hasCredential(p));
 if(input.model&&input.model!=='auto'){
  const split=input.model.indexOf('::');let p,model,channelOverride;
  if(split>=0){const id=input.model.slice(0,split),alias=state.providerAliases?.[id];p=available.find(p=>p.id===(alias?.id||id));channelOverride=alias?.channel;model=input.model.slice(split+2);if(input.upstream_model&&input.upstream_model!==model)throw fail('模型 ID 与 upstream_model 冲突');}
  else {const alias=state.providerAliases?.[input.model];p=available.find(p=>p.id===(alias?.id||input.model));channelOverride=alias?.channel;if(!p){const matches=available.filter(v=>v.models.includes(input.model));if(matches.length>1)throw fail('模型名称对应多个服务商，请使用 provider::model');p=matches[0];model=input.model;}}
  if(!p)throw fail('指定服务商尚未启用或模型未注册',503);
  model=input.upstream_model||model||p.model;
  if(!p.models.includes(model)||!hasModelCredential(p,model,channelOverride))throw fail('模型未加入服务商可切换列表，或服务商尚未配置密钥');
  if(state.strategy==='fallback'&&input.upstream_model!==undefined&&split<0)return modelRoutes(state,p,model,now,channelOverride).slice(0,state.routing.maxAttempts);
  return credentialRoutes(p,model,'显式指定服务商与模型',channelOverride).slice(0,state.routing.maxAttempts);
 }
 let candidates=[...available].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
 if(state.strategy==='manual')candidates=candidates.filter(p=>p.id===state.active);
 else if(!['economy','fallback'].includes(state.strategy))candidates=candidates.filter(p=>!recentlyFailed(state,p,p.model,now));
 if(state.strategy==='economy'){
  if(input.messages.some(m=>contentParts(m.content).some(p=>p.type==='image_url')))throw fail('经济优先尚不估算图片费用，请显式指定模型或选择其他策略');
  const currency=state.routing.currency||'USD';const estimatedInput=Math.ceil(Buffer.byteLength(JSON.stringify(input.messages),'utf8')/3);const outputBudget=input.max_tokens||2048;
  const priced=candidates.flatMap(p=>p.models.filter(model=>credentialFor(p,model)&&(!p.meteredSecret||channelFor(p,model)==='metered')&&usablePrice(p.prices?.[model],currency,now)&&!recentlyFailed(state,p,model,now)).map(model=>({...p,model,channelOverride:channelFor(p,model),routeReason:`经济优先：${currency}，${priceAt(p.prices[model],now).periodLabel||'基础'}价格，按输入估算与输出上限比较`,estimatedRequestCost:priceEstimate(p.prices[model],estimatedInput,outputBudget,0,now)})));
  priced.sort((a,b)=>a.estimatedRequestCost-b.estimatedRequestCost||a.priority-b.priority||a.id.localeCompare(b.id));
  if(!priced.length)throw fail('没有同币种且价格有效的候选模型，请同步或录入价格；未知价格不会当作免费',503);
  return priced.slice(0,state.routing.maxAttempts);
 }
 let reason='默认服务商优先，失败时按优先级回退';
 if(state.strategy==='weighted'&&candidates.length){
  let position=sequence%candidates.reduce((n,p)=>n+(p.weight||1),0),first=candidates[0];
  for(const p of candidates){if(position<(p.weight||1)){first=p;break;}position-=p.weight||1;}
  candidates=[first,...candidates.filter(p=>p.id!==first.id)];reason='按服务商权重轮询';
 }else if(state.strategy==='latency'){
  const score=p=>{
   const samples=state.logs.filter(l=>(l.providerId===p.id||(!l.providerId&&l.provider===p.name))&&l.model===p.model&&l.status===200&&now-Date.parse(l.time)<3600000).slice(0,20);
   return samples.length>=3?samples.reduce((n,l)=>n+l.latency,0)/samples.length:Infinity;
  };
  candidates.sort((a,b)=>score(a)-score(b)||a.priority-b.priority);
  reason='近一小时至少 3 条成功样本的平均耗时，无样本按优先级';
 }else{
  candidates.sort((a,b)=>Number(b.id===state.active)-Number(a.id===state.active));
 }
 candidates=candidates.map(p=>({...p,routeReason:reason}));
 if(state.strategy==='fallback'){
  const groups=[...candidates.filter(p=>!recentlyFailed(state,p,p.model,now)).map(p=>credentialRoutes(p,p.model,p.routeReason)),...candidates.flatMap(p=>p.models.filter(model=>model!==p.model&&hasModelCredential(p,model)&&!recentlyFailed(state,p,model,now)).map(model=>credentialRoutes(p,model,'同服务商模型故障转移')))];
  candidates=[...groups.map(group=>group[0]),...groups.flatMap(group=>group.slice(1))];
 }
 if(state.strategy==='rules'){
  const text=[...input.messages].reverse().find(m=>m.role==='user')?.content;
  const query=plainText(text||'').toLowerCase();
  const rule=(state.rules||[]).find(r=>r.keywords.some(word=>query.includes(word.toLowerCase())));
  const provider=rule&&candidates.find(p=>p.id===rule.providerId);
  if(provider&&provider.models.includes(rule.model)&&hasModelCredential(provider,rule.model))candidates.unshift({...provider,model:rule.model,routeReason:`匹配规则：${rule.name}`});
 }
 if(!['fallback','economy'].includes(state.strategy)){
  const groups=candidates.map(p=>credentialRoutes(p,p.model,p.routeReason,p.channelOverride));candidates=[...groups.map(group=>group[0]),...groups.flatMap(group=>group.slice(1))];
 }
 candidates=candidates.filter((p,index,all)=>all.findIndex(v=>v.id===p.id&&v.model===p.model&&v.channelOverride===p.channelOverride)===index);
 if(!candidates.length)throw fail('没有可用路由，请启用服务商并选择默认模型；熔断中的路由需等待 60 秒',503);
 return candidates.slice(0,state.routing.maxAttempts);
}
export function validateRouting(body,providers){
 if(!body||!strategies.includes(body.strategy))throw fail('路由策略无效');
 const active=body.active||'';
 if(active&&!providers.some(p=>p.id===active&&p.enabled&&hasCredential(p)))throw fail('默认服务商未完成配置或尚未启用');
 if(body.strategy==='manual'&&!active)throw fail('固定模式必须选择默认服务商');
 const rules=body.rules??[];
 if(!Array.isArray(rules)||rules.length>30)throw fail('规则最多 30 条');
 for(const r of rules){
  if(!r||typeof r.name!=='string'||!r.name.trim()||r.name.length>80||!Array.isArray(r.keywords)||!r.keywords.length||r.keywords.length>20||r.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>100))throw fail('规则名称或关键词无效');
  if(!providers.some(p=>p.id===r.providerId&&p.enabled&&p.models.includes(r.model)))throw fail('规则引用的服务商或模型不可用');
 }
 const routing={currency:'USD',timeoutMs:30000,maxAttempts:3,requestsPerMinute:60,concurrency:5,...body.routing};
 if(!['USD','CNY'].includes(routing.currency))throw fail('经济优先币种须为 USD 或 CNY');
 for(const [key,min,max] of [['timeoutMs',3000,120000],['maxAttempts',1,10],['requestsPerMinute',1,10000],['concurrency',1,100]]){
  if(!Number.isInteger(routing[key])||routing[key]<min||routing[key]>max)throw fail(`${key} 必须为 ${min}–${max} 的整数`);
 }
 return {strategy:body.strategy,active,rules,routing};
}
