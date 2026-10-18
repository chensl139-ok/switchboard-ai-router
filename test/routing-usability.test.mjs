import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {validateRouting,selectRoutes} from '../routing.mjs';
import {routingDraft,draftPolicy,routingOverrides} from '../public/routing-policy.js';

const providers=[
 {id:'one',name:'One',model:'first',models:['first','preferred'],enabled:true,secret:'key-a',hasKey:true,priority:0,weight:1},
 {id:'two',name:'Two',model:'backup',models:['backup'],enabled:true,secret:'key-b',hasKey:true,priority:1,weight:1},
 {id:'three',name:'Three',model:'outside',models:['outside'],enabled:true,secret:'key-c',hasKey:true,priority:2,weight:1},
];
const base=()=>({strategy:'fallback',active:'one',rules:[],providers:structuredClone(providers),logs:[],routing:{currency:'USD',maxAttempts:3,timeoutMs:30000,requestsPerMinute:100,concurrency:5}});
const input={model:'auto',messages:[{role:'user',content:'hi'}]};

test('用户选择的是模型而不是隐含的服务商默认模型；显式 API 请求保持原有含义',()=>{
 const state=base();state.routing.primaryModel='preferred';
 assert.equal(selectRoutes(state,input)[0].model,'preferred');
 assert.equal(state.providers[0].model,'first','不改变服务商当前模型');
 assert.equal(selectRoutes(state,{...input,model:'one'})[0].model,'first');
 assert.equal(selectRoutes(state,{...input,model:'one::first'})[0].model,'first');
 state.strategy='manual';assert.deepEqual(selectRoutes(state,input).map(p=>p.model),['preferred']);
});
test('手动备用严格遵守选择与顺序，支持同服务商和跨服务商，不额外加入其他模型',()=>{
 const state=base();Object.assign(state.routing,{primaryModel:'preferred',backupMode:'selected',backups:[{providerId:'two',model:'backup'},{providerId:'one',model:'first'}]});
 assert.deepEqual(selectRoutes(state,input).map(p=>p.model),['preferred','backup','first']);
 state.routing.rulesEnabled=true;state.rules=[{name:'例外',keywords:['SQL'],providerId:'three',model:'outside'}];
 assert.deepEqual(selectRoutes(state,{...input,messages:[{role:'user',content:'SQL'}]}).map(p=>p.model),['outside','preferred','backup']);
 state.logs=Array.from({length:3},()=>({providerId:'one',model:'preferred',status:503,time:new Date().toISOString()}));
 assert.deepEqual(selectRoutes(state,input).map(p=>p.model),['backup','first']);
 state.providers[0].enabled=false;assert.deepEqual(selectRoutes(state,input).map(p=>p.model),['backup'],'首选服务商被停用时仍可使用已配置的其他服务商备用');
});
test('无效、重复、媒体和跨权限备用不能保存；首选不允许混入备用',()=>{
 const state=base(),policy={...state,routing:{...state.routing,primaryModel:'preferred',backupMode:'selected',backups:[{providerId:'two',model:'backup'}]}};
 assert.equal(validateRouting(policy,state.providers).routing.primaryModel,'preferred');
 for(const backups of [[],[{providerId:'missing',model:'backup'}],[{providerId:'one',model:'preferred'}],[{providerId:'two',model:'backup'},{providerId:'two',model:'backup'}]])assert.throws(()=>validateRouting({...policy,routing:{...policy.routing,backups}},state.providers));
 assert.throws(()=>validateRouting({...policy,strategy:'economy'},state.providers),/优先级选路/);
 assert.throws(()=>validateRouting({...policy,routing:{...policy.routing,primaryModel:'not-registered'}},state.providers),/首选模型/);
 state.providers.push({id:'media',enabled:true,secret:'media-key',model:'gpt-image-1',models:['gpt-image-1']});
 assert.throws(()=>validateRouting({...policy,routing:{...policy.routing,backups:[{providerId:'media',model:'gpt-image-1'}]}},state.providers),/备用模型/);
});
test('编辑草稿与策略互转保留旧配置；关闭切换、手动链和秒数单位含义明确',()=>{
 const state=base(),draft=routingDraft(state);assert.equal(draft.preferred,JSON.stringify(['one','first']));assert.equal(draft.timeoutSeconds,30);
 draft.preferred=JSON.stringify(['one','preferred']);draft.backupMode='selected';draft.backups=[JSON.stringify(['two','backup'])];draft.timeoutSeconds='45.5';
 const policy=draftPolicy(draft);assert.equal(policy.routing.timeoutMs,45500);assert.equal(policy.routing.primaryModel,'preferred');assert.equal(policy.strategy,'fallback');
 assert.deepEqual(routingOverrides(state,policy).routing.backups,[{providerId:'two',model:'backup'}]);
 draft.backupMode='off';assert.equal(draftPolicy(draft).strategy,'manual');assert.deepEqual(draftPolicy(draft).routing.backups,[]);
 draft.preferred='';assert.throws(()=>draftPolicy(draft),/首选模型/);
});
test('个人首选是服务商与模型的整体覆盖；旧关键词模式转为新界面仍启用规则',()=>{
 const shared=base();shared.routing.primaryModel='preferred';
 const own={...shared,active:'two',routing:{...shared.routing,primaryModel:'preferred'}};
 assert.deepEqual(routingOverrides(shared,own),{active:'two',routing:{primaryModel:'preferred'}});
 shared.strategy='rules';shared.routing.rulesEnabled=false;
 const modern={...shared,strategy:'fallback',routing:{...shared.routing,rulesEnabled:true}};
 assert.equal(routingOverrides(shared,modern).routing.rulesEnabled,true);
});
test('HTTP 草稿预览不保存、不调用上游；真实手动备用执行顺序与预览一致',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-routing-ux-')),calls=[];let failModels=new Set();
 const fetcher=async(url,options)=>{if(options.method==='GET')return Response.json({data:[]});const body=JSON.parse(options.body);calls.push(body.model);if(failModels.has(body.model))return Response.json({error:'fixture outage'},{status:503});return Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}});};
 const admin='a'.repeat(32),gateway='g'.repeat(32),app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const baseURL=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,token=admin)=>{const response=await fetch(baseURL+route,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json()};};
 try{
  for(const p of providers)assert.equal((await request('/api/provider',{...p,baseUrl:`https://${p.id}.fixture.invalid/v1`,protocol:'openai',apiKey:'fake-key',secret:undefined})).status,200);
  await request('/api/routing',{strategy:'fallback',active:'one'});
  const before=(await request('/api/state')).body,policy={strategy:'fallback',active:'one',rules:[],routing:{...base().routing,primaryModel:'preferred',backupMode:'selected',backups:[{providerId:'two',model:'backup'},{providerId:'one',model:'first'}]}};
  const preview=await request('/api/routing/preview',{model:'auto',policy});assert.equal(preview.status,200);assert.equal(preview.body.draft,true);assert.deepEqual(preview.body.candidates.map(p=>p.model),['preferred','backup','first']);assert.equal(calls.length,0);
  const after=(await request('/api/state')).body;assert.deepEqual([after.active,after.strategy,after.routing],[before.active,before.strategy,before.routing]);
  assert.equal((await request('/api/routing',policy)).status,200);failModels=new Set(['preferred','backup']);
  const result=await request('/v1/chat/completions',input,gateway);assert.equal(result.status,200);assert.deepEqual(calls,['preferred','backup','first']);
  calls.length=0;failModels=new Set();assert.equal((await request('/v1/chat/completions',{...input,model:'one::first'},gateway)).status,200);assert.deepEqual(calls,['first']);
  assert.equal((await request('/api/routing',{strategy:'fallback',active:'two'})).status,200,'旧快捷操作不会带着旧首选模型保存失败');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
