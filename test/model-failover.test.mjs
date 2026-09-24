import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';

test('同一服务商内起始模型失败后切换到备用模型',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'model-failover-')),admin='a'.repeat(32),gateway='g'.repeat(32),calls=[];
 const fetcher=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,model:body.model});return body.model==='primary'?new Response('{}',{status:503}):Response.json({model:body.model,choices:[{message:{role:'assistant',content:'backup ok'}}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}});};
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data,token=admin)=>{const response=await fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
 try{
  await post('/api/provider',{id:'one',name:'One',baseUrl:'https://one.example/v1',protocol:'openai',model:'primary',models:['primary','backup'],priority:10,enabled:true,apiKey:'upstream-key'});
  await post('/api/routing',{active:'one',strategy:'fallback',routing:{timeoutMs:3000,maxAttempts:3,requestsPerMinute:60,concurrency:5}});
  const result=await post('/v1/chat/completions',{model:'one',upstream_model:'primary',messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(result.status,200);assert.equal(result.data.model,'backup');assert.deepEqual(calls.map(call=>call.model),['primary','backup']);
  calls.length=0;const exact=await post('/v1/chat/completions',{model:'one::primary',messages:[{role:'user',content:'ping'}]},gateway);
  assert.equal(exact.status,502);assert.deepEqual(calls.map(call=>call.model),['primary']);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
