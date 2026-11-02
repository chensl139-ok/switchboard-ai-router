import test from 'node:test';
import assert from 'node:assert/strict';
import {imageGenerationCapabilities,buildImageOptions,validateMossImagePayload} from '../public/image-generation.js';
import {validateImageGeneration} from '../image-generation.mjs';
import {modelCapabilities} from '../public/model-capability.js';
const moss={baseUrl:'https://api.mosi.cn/v1',model:'moss-image-sft-1.0-2026-10-09'};
test('MOSS 原生图片选项：false、0 和默认值不丢失，不生成其他协议字段',()=>{
 const cap=imageGenerationCapabilities(moss.baseUrl,moss.model);assert.equal(cap.moss,true);
 assert.deepEqual(buildImageOptions(cap),{prompt_enhance:false});
 assert.deepEqual(buildImageOptions(cap,{watermark:'off',enhance:true,seed:'0',guidance:'0',steps:'8',negativePrompt:' blurry '}),{prompt_enhance:true,output_watermark:{enabled:false},seed:0,num_inference_steps:8,guidance_scale:0,negative_prompt:'blurry'});
 assert.deepEqual(buildImageOptions(cap,{watermark:'on'}).output_watermark,{enabled:true});
 assert.equal(imageGenerationCapabilities('https://api.mosi.cn.evil.example/v1',moss.model).moss,false);
 assert.equal(imageGenerationCapabilities(moss.baseUrl,'gpt-image-1').moss,false);
 assert.deepEqual(buildImageOptions({}, {watermark:'off',enhance:true,seed:'5'}),{});
});
test('MOSS 图片参数校验边界、尺寸与未知格式，不把字符串 false 当作开启',()=>{
 const base={model:moss.model,prompt:'cat'};
 for(const data of [{size:'2048x1024'},{size:'256x256'},{seed:9007199254740991},{guidance_scale:0},{guidance_scale:10},{num_inference_steps:100},{output_watermark:{enabled:false}},{prompt_enhance:false}])assert.doesNotThrow(()=>validateImageGeneration(moss,{...base,...data}));
 for(const data of [{size:'2048x2048'},{size:'257x512'},{size:'128x128'},{size:'1024X1024'},{seed:-1},{seed:1.5},{seed:9007199254740992},{guidance_scale:'0'},{guidance_scale:11},{num_inference_steps:0},{num_inference_steps:1.2},{n:2},{response_format:'b64_json'},{prompt_enhance:'false'},{output_watermark:false},{output_watermark:{enabled:'false'}},{output_watermark:{enabled:false,extra:true}},{prompt:'x'.repeat(4001)},{negative_prompt:'x'.repeat(4001)},{watermark:false},{prompt_enhancement:true}])assert.throws(()=>validateImageGeneration(moss,{...base,...data}),{status:400},JSON.stringify(data).slice(0,100));
 assert.doesNotThrow(()=>validateMossImagePayload({...base,seed:0}));
});
test('MOSS 提示词增强模型不出现在生图或对话候选，不可调用图片接口',()=>{
 for(const model of ['moss-image-prompt-enhancer-1.0','test::moss-image-prompt-enhancer-1.0']){const cap=modelCapabilities(model);assert.equal(cap.image,false);assert.equal(cap.chat,false);}
 for(const model of ['moss-image-sft-1.0','moss-image-base-1.0-2026-10-09']){assert.equal(modelCapabilities(model).image,true);assert.equal(modelCapabilities(model).chat,false);}
 assert.throws(()=>validateImageGeneration({...moss,model:'moss-image-prompt-enhancer-1.0'},{prompt:'cat'}),{status:400});
});

test('MOSS 图片端到端透传原生参数，拒绝无效请求且不自动重试增强失败',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createPlatform}=await import('../platform.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'moss-image-test-'));let calls=0,failCode='';
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.mosi.cn/v1/images/generations');
  const payload=JSON.parse(options.body);assert.equal(payload.model,moss.model);assert.equal(payload.prompt_enhance,true);assert.deepEqual(payload.output_watermark,{enabled:false});assert.equal(payload.guidance_scale,0);assert.equal(payload.seed,0);assert.equal(payload.num_inference_steps,8);assert.equal(payload.watermark,undefined);assert.equal(options.headers['X-Enable-Watermark'],undefined);
  if(failCode)return Response.json({error:{code:failCode,message:'private upstream text'}},{status:403});
  return Response.json({data:[{url:'https://example.test/result.png'}],usage:{generated_images:1,output_width:512,output_height:512}});
 }});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  const setup=await fetch(base+'/api/account/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bootstrapToken:'a'.repeat(32),name:'Owner',email:'moss@example.test',password:'fixture-password-123'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
  const post=(route,data)=>fetch(base+route,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await post('/api/provider',{id:'moss',name:'MOSS',protocol:'openai',baseUrl:moss.baseUrl,apiKey:'fixture-key',model:moss.model,models:[moss.model,'moss-image-prompt-enhancer-1.0'],enabled:true})).status,200);
  const input={model:'moss::'+moss.model,prompt:'cat',size:'512x512',prompt_enhance:true,output_watermark:{enabled:false},seed:0,guidance_scale:0,num_inference_steps:8};
  const generated=await post('/v1/images/generations',input);assert.equal(generated.status,200);assert.equal((await generated.json()).usage.generated_images,1);assert.equal(calls,1);
  assert.equal((await post('/v1/images/generations',{...input,size:'2048x2048'})).status,400);assert.equal(calls,1);
  assert.equal((await post('/v1/images/generations',{...input,model:'moss::moss-image-prompt-enhancer-1.0'})).status,400);assert.equal(calls,1);
  failCode='prompt_enhancement_refused';const failed=await post('/v1/images/generations',input);assert.equal(failed.status,403);assert.match((await failed.json()).error.message,/增强拒绝/);assert.equal(calls,2);
  failCode='unknown_error';const unknown=await post('/v1/images/generations',input);assert.equal(unknown.status,403);assert.doesNotMatch(await unknown.text(),/private upstream text/);assert.equal(calls,3);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
