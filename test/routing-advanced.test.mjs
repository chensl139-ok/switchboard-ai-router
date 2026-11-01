import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../server.mjs';
import {selectRoutes} from '../routing.mjs';
import {routeDiagnostics,routeDiagnosticsMarkup,routeSampleLabel} from '../public/route-diagnostics.js';

test('只剩一个可用模型时使用剩余总预算，而不是除以尚未用完的尝试上限',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-attempt-budget-'));
 const admin='a'.repeat(32),gateway='g'.repeat(32);let count=0;
 const app=createApp({dir,admin,gateway,fetcher:async(url,{signal})=>{
  count++;await delay(650,null,{signal});
  return Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
 }});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.address().port;
 const post=(route,data,token=admin)=>fetch(base+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});
 try{
  assert.equal((await post('/api/provider',{id:'budget',name:'Budget',baseUrl:'https://budget.example/v1',model:'test-model',models:['test-model'],protocol:'openai',apiKey:'fake-key',enabled:true})).status,200);
  assert.equal((await post('/api/routing',{active:'budget',strategy:'fallback',routing:{maxAttempts:10,timeoutMs:3000,requestsPerMinute:100,concurrency:5}})).status,200);
  const response=await post('/v1/chat/completions',{model:'auto',messages:[{role:'user',content:'budget test'}]},gateway);
  assert.equal(response.status,200,await response.clone().text());assert.equal(count,1);
  assert.equal((await response.json()).choices[0].message.content,'ok');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('延迟优先比较同服务商内各模型，不被较慢默认模型遮蔽；无样本保持配置顺序',()=>{
 const now=Date.now(),provider=(id,models,priority)=>({id,name:id,model:models[0],models,enabled:true,secret:'fake',priority,weight:1});
 const state={strategy:'latency',active:'a',providers:[provider('a',['slow','fast'],1),provider('b',['middle'],2)],routing:{maxAttempts:3},logs:[]};
 assert.equal(selectRoutes(state,{model:'auto',messages:[]},{now})[0].model,'slow');
 for(const [providerId,model,latency] of [['a','slow',900],['a','fast',50],['b','middle',200]])for(let i=0;i<3;i++)state.logs.push({providerId,model,status:200,latency,time:new Date(now-10000-i*1000).toISOString()});
 const result=selectRoutes(state,{model:'auto',messages:[]},{now});
 assert.equal(result[0].model,'fast');assert.equal(result[0].id,'a');assert.equal(result[2].id,'b');
 state.logs.unshift(...Array.from({length:3},(_,i)=>({providerId:'a',model:'fast',status:503,time:new Date(now-i*100).toISOString()})));
 assert.equal(selectRoutes(state,{model:'auto',messages:[]},{now})[0].id,'b');
});

test('容灾预览区分单次预算、同模型双密钥和跨服务商覆盖，并转义排除原因',()=>{
 const candidate=(providerId,model)=>({providerId,model,withinAttemptBudget:true});
 assert.match(routeDiagnostics({maxAttempts:1,candidates:[candidate('a','x')]}).warnings[0],/1 次/);
 assert.match(routeDiagnostics({maxAttempts:3,candidates:[candidate('a','x'),candidate('a','x')]}).warnings[0],/主备密钥/);
 assert.match(routeDiagnostics({maxAttempts:3,candidates:[candidate('a','x'),candidate('a','y')]}).warnings[0],/一家服务商/);
 assert.equal(routeDiagnostics({maxAttempts:3,candidates:[candidate('a','x'),candidate('b','y')]}).warnings.length,0);
 const html=routeDiagnosticsMarkup({candidates:[],excluded:[{providerId:'a',model:'b',reason:'<script>'}]},v=>String(v).replaceAll('<','&lt;'));
 assert(!html.includes('<script>'));assert.match(html,/&lt;script>/);
 assert.match(routeSampleLabel({samples:2,averageLatency:5}),/不足/);
 assert.match(routeSampleLabel({samples:3,averageLatency:5.6}),/6 ms/);
});
