import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {thinkingOptions} from '../thinking.mjs';
import {thinkingCapability} from '../public/thinking-capability.js';
test('强制思考模型在调用前拒绝 disabled，不发送假关闭参数',()=>{
 for(const model of ['zai-org/GLM-5.3','GLM-5.3-Flash']){
  const p={baseUrl:'https://api.siliconflow.cn/v1',model};
  assert.equal(thinkingCapability(p).canDisable,false);assert.throws(()=>thinkingOptions(p,'disabled'),/不支持关闭/);
 }
});
test('HTTP/SSE 发现上游违反禁用思考时失败，强制模型完全不调用',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'strict-thinking-'));let calls=0;
 const app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,opts)=>{
  calls++;const body=JSON.parse(opts.body);
  if(body.stream)return new Response('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"reasoning_content":"unexpected thought"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  return Response.json({choices:[{message:{content:'answer',reasoning_content:'unexpected thought'}}]});
 }});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const post=(url,data)=>fetch(base+url,{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32)},body:JSON.stringify(data)});
 try{
  await post('/api/provider',{id:'test',name:'Test',baseUrl:'https://api.siliconflow.cn/v1',protocol:'openai',model:'Qwen/Qwen3',models:['Qwen/Qwen3','zai-org/GLM-5.3'],enabled:true,priority:1,apiKey:'test'});
  const input={model:'test',thinking_mode:'disabled',messages:[{role:'user',content:'hi'}]};
  const denied=await post('/v1/chat/completions',{...input,upstream_model:'zai-org/GLM-5.3'});assert.equal(denied.status,400);assert.equal(calls,0);
  const http=await post('/v1/chat/completions',input);assert.equal(http.status,422);assert.match((await http.json()).error.message,/未遵守关闭思考/);
  const sse=await post('/v1/chat/completions',{...input,stream:true});const text=await sse.text();assert.equal(sse.status,422);assert.match(text,/未遵守关闭思考/);assert.ok(!text.includes('unexpected thought'));assert.ok(!text.includes('[DONE]'));
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
