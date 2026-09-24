import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';

test('同一服务商内起始模型失败后切换到备用模型',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'model-failover-')),admin='a'.repeat(32),gateway='g'.repeat(32),calls=[];let failBackup=false;
 const fetcher=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,model:body.model});return body.model==='primary'||body.model==='backup'&&failBackup?new Response('{}',{status:503}):Response.json({model:body.model,choices:[{message:{role:'assistant',content:'backup ok'}}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}});};
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data,token=admin)=>{const response=await fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
 try{
  await post('/api/provider',{id:'one',name:'One',baseUrl:'https://one.example/v1',protocol:'openai',model:'primary',models:['primary','backup'],priority:10,enabled:true,apiKey:'upstream-key'});
  await post('/api/provider',{id:'two',name:'Two',baseUrl:'https://two.example/v1',protocol:'openai',model:'secondary',models:['secondary'],priority:20,enabled:true,apiKey:'other-key'});
  await post('/api/routing',{active:'one',strategy:'fallback',routing:{timeoutMs:3000,maxAttempts:3,requestsPerMinute:60,concurrency:5}});
  const result=await post('/v1/chat/completions',{model:'one',upstream_model:'primary',messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(result.status,200);assert.equal(result.data.model,'backup');assert.deepEqual(calls.map(call=>call.model),['primary','backup']);
  calls.length=0;const exact=await post('/v1/chat/completions',{model:'one::primary',messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(exact.status,502);assert.deepEqual(calls.map(call=>call.model),['primary']);
  await post('/api/routing',{active:'one',strategy:'latency',routing:{timeoutMs:3000,maxAttempts:3,requestsPerMinute:60,concurrency:5}});
  calls.length=0;const lab=await post('/api/chat',{model:'one',upstream_model:'primary',allow_fallback:true,messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(lab.status,200);assert.equal(lab.data.model,'backup');assert.deepEqual(calls.map(call=>call.model),['primary','backup']);
  failBackup=true;calls.length=0;const cross=await post('/api/chat',{model:'one',upstream_model:'primary',allow_fallback:true,messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(cross.status,200);assert.equal(cross.data.model,'secondary');assert.deepEqual(calls.map(call=>call.model),['primary','backup','secondary']);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('自动路由先尝试同服务商备用模型，再跨服务商；能力筛选不占尝试额度',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'route-chain-')),admin='a'.repeat(32),gateway='g'.repeat(32),calls=[];
 let failPrimary=false,failBackup=false;
 const fetcher=async(url,options)=>{
  const model=JSON.parse(options.body).model;calls.push(model);
  if(model==='GLM-5.3'&&failPrimary||model==='deepseek-v4.1-flash'&&failBackup)return new Response('{}',{status:503});
  return Response.json({model,choices:[{message:{role:'assistant',content:`${model} ok`}}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}});
 };
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data,token=admin)=>{const response=await fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,data:await response.json(),headers:response.headers};};
 try{
  await post('/api/provider',{id:'first',name:'First',baseUrl:'https://api.siliconflow.cn/v1',protocol:'openai',model:'GLM-5.3',models:['GLM-5.3','deepseek-v4.1-flash','moss-tts-1.0-pro'],priority:10,enabled:true,apiKey:'first-secret'});
  await post('/api/provider',{id:'second',name:'Second',baseUrl:'https://api.deepseek.com/v1',protocol:'openai',model:'deepseek-chat',models:['deepseek-chat'],priority:20,enabled:true,apiKey:'second-secret'});
  await post('/api/routing',{active:'first',strategy:'fallback',routing:{timeoutMs:9000,maxAttempts:2,requestsPerMinute:60,concurrency:5}});
  const preview=await post('/api/routing/preview',{model:'auto',thinking_mode:'disabled',prompt:'ping'});
  assert.equal(preview.status,200);
  assert.deepEqual(preview.data.candidates.map(route=>route.model),['deepseek-v4.1-flash','deepseek-chat']);
  assert.deepEqual(preview.data.excluded.map(route=>route.model),['GLM-5.3','moss-tts-1.0-pro']);
  assert.equal(calls.length,0,'预览不得调用上游');
  assert.ok(!JSON.stringify(preview.data).includes('first-secret'));
  assert.ok(!JSON.stringify(preview.data).includes('second-secret'));
  const input={model:'auto',messages:[{role:'user',content:'ping'}]};
  failBackup=true;
  let result=await post('/v1/chat/completions',{...input,thinking_mode:'disabled'},gateway);
  assert.equal(result.status,200);assert.equal(result.data.model,'deepseek-chat');
  assert.deepEqual(calls,['deepseek-v4.1-flash','deepseek-chat'],'不兼容的 GLM-5.3 不应占用两个实际尝试名额');
  calls.length=0;failBackup=false;failPrimary=true;
  result=await post('/v1/chat/completions',input,gateway);
  assert.equal(result.status,200);assert.equal(result.data.model,'deepseek-v4.1-flash');
  assert.deepEqual(calls,['GLM-5.3','deepseek-v4.1-flash']);
  assert.equal(result.headers.get('x-router-fallback'),'true');
  calls.length=0;failBackup=true;
  await post('/api/routing',{active:'first',strategy:'fallback',routing:{timeoutMs:9000,maxAttempts:3,requestsPerMinute:60,concurrency:5}});
  result=await post('/v1/chat/completions',input,gateway);
  assert.equal(result.status,200);assert.equal(result.data.model,'deepseek-chat');
  assert.deepEqual(calls,['GLM-5.3','deepseek-v4.1-flash','deepseek-chat']);
  assert.equal(result.headers.get('x-router-attempt'),'3');
  failPrimary=false;failBackup=false;calls.length=0;
  await post('/api/provider/switch-model',{id:'first',model:'moss-tts-1.0-pro'});
  await post('/api/routing',{active:'first',strategy:'latency',routing:{timeoutMs:9000,maxAttempts:3,requestsPerMinute:60,concurrency:5}});
  const latencyPreview=await post('/api/routing/preview',{model:'auto',prompt:'ping'});
  assert.deepEqual(latencyPreview.data.candidates.slice(0,3).map(route=>route.model),['GLM-5.3','deepseek-v4.1-flash','deepseek-chat']);
  assert.equal(calls.length,0);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('流式首个正文输出前失败可丢弃思考片段并安全回退',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'stream-failover-')),admin='a'.repeat(32),gateway='g'.repeat(32),calls=[];
 const fetcher=async(url,options)=>{const model=JSON.parse(options.body).model;calls.push(model);
  const body=model==='primary'?'data: {"choices":[{"delta":{"reasoning_content":"不完整思考"}}]}\n\n':'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n';
  return new Response(body,{headers:{'content-type':'text/event-stream'}});
 };
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data,token=admin)=>fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)});
 try{
  await post('/api/provider',{id:'one',name:'One',baseUrl:'https://one.example/v1',protocol:'openai',model:'primary',models:['primary','backup'],priority:1,enabled:true,apiKey:'key'});
  await post('/api/routing',{active:'one',strategy:'fallback',routing:{timeoutMs:3000,maxAttempts:2,requestsPerMinute:60,concurrency:5}});
  const response=await post('/v1/chat/completions',{model:'auto',messages:[{role:'user',content:'ping'}],stream:true},gateway);
  const output=await response.text();assert.equal(response.status,200);assert.deepEqual(calls,['primary','backup']);assert.match(output,/OK/);assert.doesNotMatch(output,/不完整思考/);assert.equal(decodeURIComponent(response.headers.get('x-router-model')),'backup');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('单服务商默认模型返回 400 时回退其他模型；禁用默认服务商后自动改选',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'single-provider-')),admin='a'.repeat(32),gateway='g'.repeat(32),calls=[];
 const fetcher=async(url,options)=>{const model=JSON.parse(options.body).model;calls.push(model);return model==='Kev-4B'?Response.json({error:{message:'model does not support chat'}},{status:400}):Response.json({model,choices:[{message:{role:'assistant',content:'OK'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});};
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data,token=admin)=>{const response=await fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
 try{
  const first={id:'first',name:'First',baseUrl:'https://first.example/v1',protocol:'openai',model:'Kev-4B',models:['Kev-4B','zai-org/GLM-5.2'],priority:1,enabled:true,apiKey:'key'};
  await post('/api/provider',first);await post('/api/routing',{active:'first',strategy:'fallback',routing:{timeoutMs:9000,maxAttempts:3,requestsPerMinute:60,concurrency:5}});
  const result=await post('/v1/chat/completions',{model:'auto',messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(result.status,200);assert.equal(result.data.model,'zai-org/GLM-5.2');assert.deepEqual(calls,['Kev-4B','zai-org/GLM-5.2']);
  await post('/api/provider',{id:'second',name:'Second',baseUrl:'https://second.example/v1',protocol:'openai',model:'second-chat',models:['second-chat'],priority:2,enabled:true,apiKey:'key'});
  const disabled=await post('/api/provider',{...first,enabled:false,apiKey:''});assert.equal(disabled.data.active,'second');assert.equal(disabled.data.providers[0].id,'second');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
