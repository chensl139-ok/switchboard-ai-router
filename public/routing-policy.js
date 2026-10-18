// Pure policy helpers shared by the UI and platform; no credentials or DOM.
export const routingObjectives=[
 ['fallback','优先级优先','默认模型优先，按服务商顺序容灾。'],
 ['economy','经济优先','按有效同币种参考价排序，未知价格不当作免费。'],
 ['latency','延迟优先','按真实成功样本的平均总耗时排序，无样本按优先级。'],
 ['weighted','权重分流','按服务商权重分配首选，失败继续容灾。'],
];
export function routingView(policy){
 return {mode:policy.strategy==='manual'?'fixed':'auto',objective:routingObjectives.some(([id])=>id===policy.strategy)?policy.strategy:'fallback',rulesEnabled:policy.strategy==='rules'||Boolean(policy.routing?.rulesEnabled)};
}
export function routingLabel(strategy){return {manual:'固定模型',fallback:'优先级优先',economy:'经济优先',latency:'延迟优先',weighted:'权重分流',rules:'优先级 + 任务规则'}[strategy]||strategy;}
export function routingDraft(policy){
 const view=routingView(policy),provider=policy.providers.find(p=>p.id===policy.active),model=policy.routing.primaryModel||provider?.model;
 return {preferred:provider&&model?JSON.stringify([provider.id,model]):'',backupMode:view.mode==='fixed'?'off':policy.routing.backupMode||'auto',backups:(policy.routing.backups||[]).map(p=>JSON.stringify([p.providerId,p.model])),goal:view.objective,rulesEnabled:view.rulesEnabled,rules:structuredClone(policy.rules||[]),timeoutSeconds:policy.routing.timeoutMs/1000,maxAttempts:policy.routing.maxAttempts,currency:policy.routing.currency||'USD',requestsPerMinute:policy.routing.requestsPerMinute,concurrency:policy.routing.concurrency};
}
export function draftPolicy(draft){
 const parse=value=>{try{const pair=JSON.parse(value);if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>typeof v!=='string'||!v))throw Error();return pair;}catch{throw Error('请选择一个有效的模型');}};
 const [active,primaryModel]=draft.preferred?parse(draft.preferred):['',''];
 if(draft.backupMode!=='auto'&&!active)throw Error('手动设置备用或只用一个模型时，请先选择首选模型');
 const backups=draft.backupMode==='selected'?draft.backups.map(value=>{const [providerId,model]=parse(value);return {providerId,model};}):[];
 if(draft.backupMode==='selected'&&!backups.length)throw Error('请添加至少一个备用模型，或选择自动挑选');
 const rulesEnabled=draft.backupMode!=='off'&&draft.rulesEnabled;
 const rules=rulesEnabled?draft.rules:draft.rules.filter(r=>r.name.trim()&&r.keywords.length&&r.providerId&&r.model);
 return {strategy:draft.backupMode==='off'?'manual':draft.backupMode==='selected'?'fallback':draft.goal,active,rules,routing:{primaryModel,backupMode:draft.backupMode==='selected'?'selected':'auto',backups,rulesEnabled,timeoutMs:Math.round(Number(draft.timeoutSeconds)*1000),maxAttempts:Number(draft.maxAttempts),currency:draft.currency,requestsPerMinute:Number(draft.requestsPerMinute),concurrency:Number(draft.concurrency)}};
}
export function routingOverrides(shared,policy){
 const overrides={};
 for(const key of ['strategy','active','rules'])if(JSON.stringify(policy[key])!==JSON.stringify(shared[key]))overrides[key]=policy[key];
 const routing={};
 for(const key of ['currency','timeoutMs','maxAttempts','rulesEnabled','primaryModel','backupMode','backups']){
  const defaults={rulesEnabled:(overrides.strategy??shared.strategy)==='rules'||Boolean(shared.routing?.rulesEnabled),backupMode:'auto',backups:[],primaryModel:shared.providers?.find(p=>p.id===shared.active)?.model||''};
  const value=policy.routing[key],base=shared.routing[key]??defaults[key];
  if(value!==undefined&&(key==='primaryModel'&&overrides.active!==undefined||JSON.stringify(value)!==JSON.stringify(base)))routing[key]=value;
 }
 if(Object.keys(routing).length)overrides.routing=routing;
 return overrides;
}
