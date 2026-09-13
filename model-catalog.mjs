export function callableModels(state){
 const data=[{id:'auto',object:'model',created:0,owned_by:'router',name:'自动路由'}];
 for(const p of state.providers.filter(p=>p.enabled&&p.secret&&p.model)){
  data.push({id:p.id,object:'model',created:0,owned_by:p.name,name:p.name+' · 当前模型',provider_id:p.id,upstream_model:p.model});
  for(const model of p.models)data.push({id:`${p.id}::${model}`,object:'model',created:0,owned_by:p.name,name:model,provider_id:p.id,upstream_model:model});
 }
 return {object:'list',data};
}
export function anthropicModels(list){const data=list.data.map(m=>({id:m.id,type:'model',display_name:m.name||m.id,created_at:new Date(m.created*1000).toISOString()}));return {data,has_more:false,first_id:data[0]?.id||null,last_id:data.at(-1)?.id||null};}
export function createDiscovery({state,listModels,save}){
 const pending=new Map(),lastStart=new Map();
 async function query(includeDisabled){
  const jobs=state.providers.filter(p=>(includeDisabled||p.enabled)&&(p.secret||p.baseUrl==='https://openrouter.ai/api/v1'));const results=new Array(jobs.length);let cursor=0;
  const signal=AbortSignal.timeout(45000);
  async function worker(){while(cursor<jobs.length){const index=cursor++,p=jobs[index];try{const result=await listModels({id:p.id},signal);if(state.providers.find(v=>v.id===p.id)!==p)throw Object.assign(Error('查询期间配置已改变，请重新查询'),{status:409});results[index]={providerId:p.id,name:p.name,status:'ok',fetchedAt:result.fetchedAt,models:result.data.map(m=>({...m,routeId:`${p.id}::${m.id}`,callable:p.enabled&&p.models.includes(m.id)}))};state.catalog??={};state.catalog[p.id]={models:result.data,fetchedAt:result.fetchedAt,baseUrl:p.baseUrl,protocol:p.protocol};}catch(error){results[index]={providerId:p.id,name:p.name,status:'error',error:error.status?error.message:'模型查询失败',models:[]};}}}
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},worker));save();return {providers:results,total:results.reduce((n,p)=>n+p.models.length,0),errors:results.filter(p=>p.status==='error').length,fetchedAt:new Date().toISOString()};
 }
 return {async refresh(includeDisabled=false){if(pending.has(includeDisabled))return pending.get(includeDisabled);if(Date.now()-(lastStart.get(includeDisabled)||0)<10000)throw Object.assign(Error('模型批量查询过于频繁，请 10 秒后重试'),{status:429});lastStart.set(includeDisabled,Date.now());const work=query(includeDisabled);pending.set(includeDisabled,work);try{return await work;}finally{pending.delete(includeDisabled);}}};
}
