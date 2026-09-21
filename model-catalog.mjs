import {credentialFor,hasCredential} from './provider-key.ts';
export function callableModels(state){
 const data=[{id:'auto',object:'model',created:0,owned_by:'router',name:'自动路由'}];
 for(const p of state.providers.filter(p=>p.enabled&&hasCredential(p))){
  data.push({id:p.id,object:'model',created:0,owned_by:p.name,name:p.name+' · 当前模型',provider_id:p.id,upstream_model:p.model});
  for(const model of p.models)if(credentialFor(p,model))data.push({id:`${p.id}::${model}`,object:'model',created:0,owned_by:p.name,name:model,provider_id:p.id,upstream_model:model});
 }
 return {object:'list',data};
}
export function anthropicModels(list){const data=list.data.map(m=>({id:m.id,type:'model',display_name:m.name||m.id,created_at:new Date(m.created*1000).toISOString()}));return {data,has_more:false,first_id:data[0]?.id||null,last_id:data.at(-1)?.id||null};}
export function createDiscovery({state,listModels,save}){
 const pending=new Map(),lastStart=new Map();
 async function query(includeDisabled){
  const jobs=state.providers.filter(p=>(includeDisabled||p.enabled)&&(p.secret||p.meteredSecret||p.baseUrl==='https://openrouter.ai/api/v1'));const results=new Array(jobs.length);let cursor=0;
  const signal=AbortSignal.timeout(45000);
  async function worker(){while(cursor<jobs.length){const index=cursor++,p=jobs[index];try{const result=await listModels({id:p.id},signal);if(state.providers.find(v=>v.id===p.id)!==p)throw Object.assign(Error('查询期间配置已改变，请重新查询'),{status:409});results[index]={providerId:p.id,name:p.name,status:'ok',fetchedAt:result.fetchedAt,models:result.data.map(m=>({...m,routeId:`${p.id}::${m.id}`,callable:p.enabled&&p.models.includes(m.id)}))};state.catalog??={};state.catalog[p.id]={models:result.data,fetchedAt:result.fetchedAt,baseUrl:p.baseUrl,protocol:p.protocol};}catch(error){results[index]={providerId:p.id,name:p.name,status:'error',error:error.status?error.message:'模型查询失败',models:[]};}}}
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},worker));save();return {providers:results,total:results.reduce((n,p)=>n+p.models.length,0),errors:results.filter(p=>p.status==='error').length,fetchedAt:new Date().toISOString()};
 }
 return {async refresh(includeDisabled=false){if(pending.has(includeDisabled))return pending.get(includeDisabled);if(Date.now()-(lastStart.get(includeDisabled)||0)<10000)throw Object.assign(Error('模型批量查询过于频繁，请 10 秒后重试'),{status:429});lastStart.set(includeDisabled,Date.now());const work=query(includeDisabled);pending.set(includeDisabled,work);try{return await work;}finally{pending.delete(includeDisabled);}}};
}

export function flattenDiscovery(result){
 return {object:'list',data:result.providers.flatMap(p=>p.models.map(m=>({id:m.routeId,object:'model',created:0,owned_by:p.name,provider_id:p.providerId,upstream_model:m.id,name:m.name||m.id,callable:!!m.callable}))),total:result.total,partial:result.errors>0,errors:result.providers.filter(p=>p.status==='error').map(p=>({provider_id:p.providerId,message:p.error})),fetched_at:result.fetchedAt};
}
export const modelOpenAPI={openapi:'3.1.0',info:{title:'Switchboard Model Catalog API',version:'1.0.0',description:'当前 API Key 所属租户的模型目录。全部模型查询只访问已启用且可查询的服务商，不注册或启用模型。'},servers:[{url:'/'}],security:[{bearerAuth:[]},{apiKeyAuth:[]}],paths:Object.fromEntries([
 ['/v1/models','listCallableModels','获取已配置并启用的模型及路由别名'],
 ['/v1/models/all','listAllProviderModels','一键查询所有已启用服务商的模型，统一列表；callable 标明是否已加入调用列表'],
 ['/v1/models/discover','discoverProviderModels','按服务商分组查询全部模型目录']
].map(([path,operationId,summary])=>[path,{get:{operationId,summary,description:path==='/v1/models'?'不访问上游。':'最多等待 45 秒，同范围 10 秒内限一次；部分服务商失败仍返回 200，检查 errors。查询不消耗生成次数额度。',responses:{200:{description:'模型列表；all 包含 data、total、partial、errors、fetched_at',content:{'application/json':{schema:{type:'object',properties:{object:{type:'string'},data:{type:'array',items:{type:'object',properties:{id:{type:'string'},provider_id:{type:'string'},upstream_model:{type:'string'},callable:{type:'boolean'}}}},total:{type:'integer'},partial:{type:'boolean'},errors:{type:'array',items:{type:'object'}},fetched_at:{type:'string',format:'date-time'}}}}}},401:{description:'API Key 无效或过期'},403:{description:'没有访问权限'},429:{description:'查询过于频繁'}}}}])),components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'},apiKeyAuth:{type:'apiKey',in:'header',name:'x-api-key'}}}};
