import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {createApp} from '../server.mjs';
import {normalizeRequest,anthropicPayload,responsesPayload,apiToken} from '../protocols.mjs';
const token='g'.repeat(32),admin='a'.repeat(32);
const schema={type:'object',properties:{city:{type:'string'}},required:['city']};
const tool={type:'function',function:{name:'weather',description:'weather lookup',parameters:schema}};
const sse=(items,named=false)=>new Response(items.map(e=>(named?'event: '+e.type+'\n':'')+'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
test('请求转换保留图片、工具和工具结果；未知模态不静默丢弃',()=>{
 const canonical=normalizeRequest('messages',{model:'x',max_tokens:32,system:[{type:'text',text:'system'}],tools:[{name:'weather',input_schema:schema}],messages:[{role:'user',content:[{type:'text',text:'look'},{type:'image',source:{type:'url',url:'https://images.example/a.png'}}]},{role:'assistant',content:[{type:'tool_use',id:'call1',name:'weather',input:{city:'杭州'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call1',content:'sunny'}]}]});
 assert.equal(canonical.messages[1].content[1].image_url.url,'https://images.example/a.png');assert.equal(canonical.messages[2].tool_calls[0].id,'call1');assert.equal(canonical.messages[3].tool_call_id,'call1');
 const native=anthropicPayload(canonical,'real');assert.equal(native.messages[0].content[1].source.url,'https://images.example/a.png');assert.equal(native.messages[1].content[0].type,'tool_use');assert.equal(native.messages[2].content[0].type,'tool_result');
 assert.ok(responsesPayload(canonical,'real').input.some(i=>i.type==='function_call_output'));
 assert.throws(()=>normalizeRequest('chat',{messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:'abc'}}]}]}),/不支持/);
 assert.throws(()=>normalizeRequest('responses',{input:'hi',previous_response_id:'prior'}),/无状态/);
 assert.throws(()=>apiToken({authorization:'Bearer one','x-api-key':'two'}),/不同/);
});
test('官方 OpenAI/Anthropic SDK：四种入口、三种上游、图片和工具往返及 SSE',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'sdk-protocols-'));const seen=[];
 const fetcher=async(url,opts)=>{
  if(opts.method==='GET')return Response.json({data:[{id:'model'},{id:'vision'}]});
  const input=JSON.parse(opts.body);seen.push({url,input});
  if(url.endsWith('/count_tokens'))return Response.json({input_tokens:17});
  const usedTool=input.messages?.some(m=>m.role==='tool'||Array.isArray(m.content)&&m.content.some(p=>p.type==='tool_result'))||input.input?.some(i=>i.type==='function_call_output');
  const wantsTool=!!input.tools?.length&&!usedTool;
  const calls=[{id:'call_1',type:'function',function:{name:'weather',arguments:'{"city":"杭州"}'}}];
  const usage={prompt_tokens:10,completion_tokens:5,total_tokens:15};
  if(url.endsWith('/messages')){
   const result={id:'msg_up',type:'message',role:'assistant',model:input.model,content:wantsTool?[{type:'tool_use',id:'call_1',name:'weather',input:{city:'杭州'}}]:[{type:'text',text:'hello'}],stop_reason:wantsTool?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:5}};
   if(!input.stream)return Response.json(result);
   const events=[{type:'message_start',message:{...result,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:wantsTool?{type:'tool_use',id:'call_1',name:'weather',input:{}}:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:wantsTool?{type:'input_json_delta',partial_json:'{"city":"杭州"}'}:{type:'text_delta',text:'hello'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:result.stop_reason,stop_sequence:null},usage:{output_tokens:5}},{type:'message_stop'}];return sse(events,true);
  }
  if(url.endsWith('/responses')){
   const result={id:'resp_up',object:'response',created_at:1,model:input.model,status:'completed',output:wantsTool?[{id:'fc_up',type:'function_call',call_id:'call_1',name:'weather',arguments:'{"city":"杭州"}'}]:[{id:'msg_up',type:'message',role:'assistant',content:[{type:'output_text',text:'hello',annotations:[]}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}};
   if(!input.stream)return Response.json(result);
   return sse([{type:'response.created',response:{...result,output:[],status:'in_progress'}},...(wantsTool?[{type:'response.output_item.added',output_index:0,item:{...result.output[0],arguments:''}},{type:'response.function_call_arguments.delta',item_id:'fc_up',output_index:0,delta:'{"city":"杭州"}'}]:[{type:'response.output_text.delta',output_index:0,item_id:'msg_up',content_index:0,delta:'hello'}]),{type:'response.completed',response:result}],true);
  }
  const result={id:'chat_up',object:'chat.completion',created:1,model:input.model,choices:[{index:0,message:{role:'assistant',content:wantsTool?null:'hello',...(wantsTool?{tool_calls:calls}:{})},finish_reason:wantsTool?'tool_calls':'stop'}],usage};
  if(!input.stream)return Response.json(result);
  const chunk=delta=>({id:'chat_up',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:null}]});
  return sse([chunk({role:'assistant'}),chunk(wantsTool?{tool_calls:[{index:0,...calls[0],function:{name:'weather',arguments:'{"city":'}}]}:{content:'hel'}),chunk(wantsTool?{tool_calls:[{index:0,function:{arguments:'"杭州"}'}}]}:{content:'lo'}),{...chunk({}),choices:[{index:0,delta:{},finish_reason:wantsTool?'tool_calls':'stop'}],usage},'[DONE]']);
 };
 const app=createApp({dir,admin,gateway:token,fetcher});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(p,b)=>fetch(base+p,{method:'POST',headers:{authorization:'Bearer '+admin,'content-type':'application/json'},body:JSON.stringify(b)});
 const openai=new OpenAI({baseURL:base+'/v1',apiKey:token,maxRetries:0}),anthropic=new Anthropic({baseURL:base,apiKey:token,authToken:null,maxRetries:0});
 try{
  for(const protocol of ['openai','anthropic','responses'])await post('/api/provider',{id:protocol,name:protocol,baseUrl:`https://${protocol}.example/v1`,protocol,model:'model',models:['model'],enabled:true,priority:1,apiKey:'fake'});
  const list=await openai.models.list();assert.ok(list.data.some(m=>m.id==='responses::model'));assert.equal((await anthropic.models.list()).has_more,false);
  for(const provider of ['openai','anthropic','responses']){
   const model=provider+'::model';
   const chat=await openai.chat.completions.create({model,messages:[{role:'user',content:[{type:'text',text:'look'},{type:'image_url',image_url:{url:'https://images.example/a.png'}}]}]});assert.equal(chat.choices[0].message.content,'hello');
   const response=await openai.responses.create({model,input:'hi'});assert.equal(response.output_text,'hello');
   const message=await anthropic.messages.create({model,max_tokens:32,messages:[{role:'user',content:'hi'}]});assert.equal(message.content[0].text,'hello');
   assert.equal((await openai.completions.create({model,prompt:'hi'})).choices[0].text,'hello');
   const toolResponse=await openai.chat.completions.create({model,messages:[{role:'user',content:'weather'}],tools:[tool]});assert.equal(toolResponse.choices[0].message.tool_calls[0].function.name,'weather');
   const roundtrip=await anthropic.messages.create({model,max_tokens:32,tools:[{name:'weather',input_schema:schema}],messages:[{role:'assistant',content:[{type:'tool_use',id:'call_1',name:'weather',input:{city:'杭州'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'sunny'}]}]});assert.equal(roundtrip.content[0].text,'hello');
   const streamed=await anthropic.messages.stream({model,max_tokens:32,tools:[{name:'weather',input_schema:schema}],messages:[{role:'user',content:'weather'}]}).finalMessage();assert.equal(streamed.stop_reason,'tool_use');assert.deepEqual(streamed.content.find(c=>c.type==='tool_use').input,{city:'杭州'});
   const stream=await openai.responses.create({model,input:'weather',tools:[{type:'function',...tool.function}],stream:true});let final;
   for await(const event of stream)if(event.type==='response.completed')final=event.response;
   assert.equal(final.output.find(item=>item.type==='function_call').arguments,'{"city":"杭州"}');
  }
  assert.ok(seen.some(({url,input})=>url.endsWith('/messages')&&input.messages[0]?.content?.some(p=>p.type==='image')));
  assert.ok(seen.some(({url,input})=>url.endsWith('/responses')&&input.input[0]?.content?.some(p=>p.type==='input_image')));
  assert.equal((await anthropic.messages.countTokens({model:'anthropic::model',messages:[{role:'user',content:'hi'}]})).input_tokens,17);
  await assert.rejects(anthropic.messages.create({model:'openai::model',max_tokens:32,messages:[{role:'user',content:[{type:'document',source:{type:'text',media_type:'text/plain',data:'file'}}]}]}));
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
