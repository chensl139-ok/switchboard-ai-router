import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {UsageStore} from '../usage-store.mjs';
import {matchOpenRouterModel,refreshedReferencePrice} from '../pricing.mjs';

test('OpenRouter 参考价可导入其他服务商，保留手动价且不泄露目标密钥',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-reference-price-'));
 const calls=[];const rows=[
  {id:'openai/gpt-4o',pricing:{prompt:'0.000002',completion:'0.000008',request:'0'}},
  {id:'z-ai/glm-5',pricing:{prompt:'0.000001',completion:'0.000003',request:'0'}},
  {id:'z-ai/glm-5.3',hugging_face_id:'zai-org/GLM-5.3',pricing:{prompt:'0.0000006496',completion:'0.0000020416'}},
  {id:'z-ai/glm-5.3:free',hugging_face_id:'zai-org/GLM-5.3',pricing:{prompt:'0',completion:'0'}},
  {id:'vendor-a/shared',pricing:{prompt:'0.000001',completion:'0.000003',request:'0'}},
  {id:'vendor-b/shared',pricing:{prompt:'0.000002',completion:'0.000004',request:'0'}}
 ];
 const app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,options)=>{calls.push({url,options});return Response.json({data:rows});}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data)=>{const response=await fetch(base+route,{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};};
 try{
  const provider={id:'other',name:'其他服务商',baseUrl:'https://other.example/v1',protocol:'openai',model:'gpt-4o',models:['gpt-4o','zai-org/GLM-5.3','zai-org/GLM-5','shared','manual'],enabled:true,apiKey:'other-provider-secret'};
  assert.equal((await request('/api/provider',provider)).status,200);
  assert.equal((await request('/api/prices',{providerId:'other',model:'manual',currency:'USD',inputPerMillion:9,outputPerMillion:18})).status,200);
  let result=await request('/api/prices/sync',{providerId:'other'});
  assert.equal(result.status,200);assert.equal(result.body.count,2);assert.equal(result.body.skippedManual,1);assert.equal(result.body.unmatched,2);
  let prices=result.body.state.providers.find(p=>p.id==='other').prices;
  assert.equal(prices['gpt-4o'].source,'openrouter-reference');assert.equal(prices['gpt-4o'].referenceModel,'openai/gpt-4o');
  assert.ok(prices['gpt-4o'].expiresAt);
  assert.equal(prices['zai-org/GLM-5.3'].referenceModel,'z-ai/glm-5.3');assert.equal(prices['zai-org/GLM-5.3'].inputPerMillion,0.6496);
  assert.equal(prices.manual.inputPerMillion,9);
  assert.equal(calls[0].url,'https://openrouter.ai/api/v1/models');
  assert.equal(calls[0].options.headers.authorization,undefined);
  result=await request('/api/prices/sync',{providerId:'other',modelId:'zai-org/GLM-5',openRouterModelId:'z-ai/glm-5'});
  assert.equal(result.status,200);prices=result.body.state.providers.find(p=>p.id==='other').prices;
  assert.equal(prices['zai-org/GLM-5'].referenceModel,'z-ai/glm-5');assert.equal(prices['zai-org/GLM-5'].inputPerMillion,1);
  assert.equal(prices.manual.source,'manual');
  result=await request('/api/prices/sync',{providerId:'other',modelId:'zai-org/GLM-5',openRouterModelId:'not-listed'});
  assert.equal(result.status,400);assert.match(result.body.error.message,/找不到/);
  assert.equal((await request('/api/prices/sync',{providerId:'other',modelId:'not-configured',openRouterModelId:'openai/gpt-4o'})).status,400);
  assert.equal(matchOpenRouterModel('shared',rows),null);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('重新同步参考价时保留现有无限期设置，但新导入仍有复核期限',()=>{
 const imported={source:'openrouter-reference',expiresAt:'2026-10-02',observedAt:'2026-09-25',inputPerMillion:2};
 assert.equal(refreshedReferencePrice({source:'openrouter-reference',expiresAt:null},imported).expiresAt,null);
 assert.equal(refreshedReferencePrice(undefined,imported).expiresAt,imported.expiresAt);
 assert.equal(refreshedReferencePrice({source:'openrouter-reference',expiresAt:'2026-09-29'},imported).expiresAt,imported.expiresAt);
 assert.equal(refreshedReferencePrice({source:'manual',inputPerMillion:9},imported).inputPerMillion,9);
});

test('API 重新同步后不覆盖已保存参考价的无限期策略',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-indefinite-price-'));
 const fetcher=async()=>Response.json({data:[{id:'openai/gpt-4o',pricing:{prompt:'0.000002',completion:'0.000008'}}]});
 const call=async(app,route,data)=>{const response=await fetch(`http://127.0.0.1:${app.address().port}${route}`,{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'application/json'},body:JSON.stringify(data)});return response.json();};
 let app;
 try{
  app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  await call(app,'/api/provider',{id:'other',name:'Other',baseUrl:'https://other.example/v1',protocol:'openai',model:'gpt-4o',models:['gpt-4o'],enabled:true,apiKey:'test-secret'});
  await call(app,'/api/prices/sync',{providerId:'other'});await new Promise(resolve=>app.close(resolve));app=null;
  const file=path.join(dir,'state.json'),state=JSON.parse(readFileSync(file,'utf8'));state.providers.find(p=>p.id==='other').prices['gpt-4o'].expiresAt=null;writeFileSync(file,JSON.stringify(state));
  app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const result=await call(app,'/api/prices/sync',{providerId:'other'});
  assert.equal(result.count,1);assert.equal(result.state.providers.find(p=>p.id==='other').prices['gpt-4o'].expiresAt,null);
 }finally{if(app)await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('调用日志的模型搜索与服务商、状态条件一起在数据库中过滤',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-log-search-'));const store=new UsageStore(dir);
 try{
  for(const [id,model,providerId,status] of [['1','gpt-4o','a',200],['2','gpt-4o-mini','b',502],['3','GLM-5','a',200]])store.record({id,time:new Date().toISOString(),model,providerId,status,provider:providerId});
  assert.equal(store.logs({q:'GPT-4O'}).total,2);
  assert.equal(store.logs({q:'gpt-4o',provider:'a',status:'success'}).total,1);
  assert.equal(store.logs({q:'gpt-4o',provider:'a',status:'error'}).total,0);
  assert.equal(store.logs({q:'not-a-model'}).total,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
