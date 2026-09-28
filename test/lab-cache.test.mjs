import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheHitMetrics,cacheHitLabel} from '../public/cache-metrics.js';
import {streamChat} from '../public/stream-client.js';
import {toChatResponse} from '../protocols.mjs';
import {consumeSSE} from '../realtime.mjs';
import {normalizeUsage} from '../pricing.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';

const sse=events=>new Response(events.map(event=>'data: '+(typeof event==='string'?event:JSON.stringify(event))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});

test('缓存命中率只使用上游报告的缓存输入 Tokens，不把未知当成 0%',()=>{
 assert.deepEqual(cacheHitMetrics({prompt_tokens:100,prompt_tokens_details:{cached_tokens:80}}),{inputTokens:100,cachedTokens:80,rate:80});
 assert.deepEqual(cacheHitMetrics({input_tokens:100,input_tokens_details:{cached_tokens:0}}),{inputTokens:100,cachedTokens:0,rate:0});
 assert.deepEqual(cacheHitMetrics({input_tokens:20,cache_read_input_tokens:80,cache_creation_input_tokens:0}),{inputTokens:100,cachedTokens:80,rate:80});
 assert.equal(cacheHitMetrics({prompt_tokens:423,prompt_tokens_details:{cached_tokens:256},prompt_cache_hit_tokens:256,prompt_cache_miss_tokens:167})?.rate,256/423*100);
 for(const usage of [{prompt_tokens:100},{prompt_tokens:0,prompt_tokens_details:{cached_tokens:0}},{prompt_tokens:10,prompt_tokens_details:{cached_tokens:11}},{prompt_tokens:10,prompt_tokens_details:{cached_tokens:-1}},{prompt_tokens:100,prompt_tokens_details:{cached_tokens:0},prompt_cache_hit_tokens:80},{prompt_tokens:100,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:30}])assert.equal(cacheHitMetrics(usage),null);
 assert.equal(normalizeUsage({prompt_tokens:100,completion_tokens:1,prompt_tokens_details:{cached_tokens:0},prompt_cache_hit_tokens:80}).cacheUsageInvalid,true);
 assert.equal(cacheHitLabel(cacheHitMetrics({prompt_tokens:31,prompt_tokens_details:{cached_tokens:0}})),'上游未命中（0/31 tokens）');
 assert.equal(cacheHitLabel(cacheHitMetrics({prompt_tokens:423,prompt_tokens_details:{cached_tokens:256}})),'256/423 tokens（60.5%）');
});

test('Anthropic 非流式协议转换保留缓存命中，并不伪造未报告字段',()=>{
 const base={id:'msg',model:'claude',content:[{type:'text',text:'ok'}],usage:{input_tokens:20,output_tokens:10}};
 assert.equal(cacheHitMetrics(toChatResponse(base,'anthropic','claude').usage),null);
 const converted=toChatResponse({...base,usage:{...base.usage,cache_read_input_tokens:80,cache_creation_input_tokens:0}},'anthropic','claude');
 assert.deepEqual(cacheHitMetrics(converted.usage),{inputTokens:100,cachedTokens:80,rate:80});
});

test('OpenAI、Responses、Anthropic 的 SSE 结束帧保留缓存明细',async()=>{
 const cases=[
  ['openai',[{choices:[{delta:{content:'ok'}}]},{choices:[],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_tokens_details:{cached_tokens:80}}},'[DONE]']],
  ['responses',[{type:'response.completed',response:{usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:80}}}}]],
  ['anthropic',[{type:'message_start',message:{usage:{input_tokens:20,cache_read_input_tokens:80,cache_creation_input_tokens:0}}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}},{type:'message_stop'}]]
 ];
 for(const [protocol,events] of cases){const chunks=[];await consumeSSE(sse(events),protocol,'model',async chunk=>chunks.push(chunk));assert.deepEqual(cacheHitMetrics(chunks.findLast(chunk=>chunk.usage)?.usage),{inputTokens:100,cachedTokens:80,rate:80},protocol);}
});

test('实验室 SSE 客户端从用量帧展示缓存命中率',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>sse([{choices:[{delta:{content:'ok'}}]},{choices:[],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_tokens_details:{cached_tokens:80}}},'[DONE]']);
 try{const result=await streamChat('sse','',{model:'auto',messages:[{role:'user',content:'hi'}]},()=>{},new AbortController().signal);assert.equal(result.content,'ok');assert.deepEqual(result.cacheMetrics,{inputTokens:100,cachedTokens:80,rate:80});}
 finally{globalThis.fetch=original;}
});

test('网关端到端保留三种上游协议的流式缓存用量',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-cache-')),admin='a'.repeat(32),gateway='g'.repeat(32);
 const fetcher=async(url,options)=>{
  if(options.method==='GET')return Response.json({data:[{id:'model'}]});
  if(url.endsWith('/messages'))return sse([{type:'message_start',message:{usage:{input_tokens:20,cache_read_input_tokens:80,cache_creation_input_tokens:0}}},{type:'content_block_delta',delta:{type:'text_delta',text:'ok'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}},{type:'message_stop'}]);
  if(url.endsWith('/responses'))return sse([{type:'response.output_text.delta',delta:'ok'},{type:'response.completed',response:{usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:80}}}}]);
  return sse([{choices:[{delta:{content:'ok'}}]},{choices:[],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,prompt_tokens_details:{cached_tokens:80}}},'[DONE]']);
 };
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  for(const protocol of ['openai','anthropic','responses']){
   const config=await fetch(base+'/api/provider',{method:'POST',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify({id:protocol,name:protocol,protocol,baseUrl:`https://${protocol}.example/v1`,model:'model',models:['model'],apiKey:'upstream-test',enabled:true,priority:1})});assert.equal(config.status,200);
   const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+gateway,'content-type':'application/json'},body:JSON.stringify({model:protocol+'::model',messages:[{role:'user',content:'hi'}],stream:true})});assert.equal(response.status,200,protocol);
   const events=(await response.text()).split('\n\n').filter(block=>block.startsWith('data:')).map(block=>block.slice(5).trim()).filter(data=>data&&data!=='[DONE]').map(JSON.parse);
   assert.deepEqual(cacheHitMetrics(events.findLast(event=>event.usage)?.usage),{inputTokens:100,cachedTokens:80,rate:80},protocol);
  }
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('上游流式缓存字段冲突时不向实验室发布错误命中率',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-cache-conflict-')),admin='a'.repeat(32),gateway='g'.repeat(32);
 const fetcher=async(url,options)=>options.method==='GET'?Response.json({data:[{id:'model'}]}):sse([{choices:[{delta:{content:'ok'}}]},{choices:[],usage:{prompt_tokens:100,completion_tokens:1,total_tokens:101,prompt_tokens_details:{cached_tokens:0},prompt_cache_hit_tokens:80}},'[DONE]']);
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  const config=await fetch(base+'/api/provider',{method:'POST',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify({id:'upstream',name:'upstream',protocol:'openai',baseUrl:'https://upstream.example/v1',model:'model',models:['model'],apiKey:'upstream-test',enabled:true,priority:1})});assert.equal(config.status,200);
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+gateway,'content-type':'application/json'},body:JSON.stringify({model:'upstream::model',messages:[{role:'user',content:'hi'}],stream:true})});assert.equal(response.status,200);
  const events=(await response.text()).split('\n\n').filter(block=>block.startsWith('data:')).map(block=>block.slice(5).trim()).filter(data=>data&&data!=='[DONE]').map(JSON.parse);
  assert.equal(cacheHitMetrics(events.findLast(event=>event.usage)?.usage),null);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
