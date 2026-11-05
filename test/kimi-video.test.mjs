import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRequest,anthropicPayload,responsesPayload,chatPayload} from '../protocols.mjs';
import {createUpstreamAdapter} from '../upstream-adapter.mjs';
import {modelCapabilities} from '../public/model-capability.js';
import {validateVideoURL,videoFileDataURL,MAX_VIDEO_BYTES} from '../public/video-input.js';
import {videoFrameTimes,buildVideoFramesRequest} from '../public/video-frames.js';
import {buildVisionRequest,visionOutputText} from '../public/vision-form.js';
const part={type:'video_url',video_url:{url:'https://example.test/video.mp4'}};
const raw={model:'moss::kimi-k3',messages:[{role:'user',content:[{type:'text',text:'describe'},part]}],max_tokens:8192,allow_fallback:false};
test('Kimi K3 retains chat capability and adds video understanding without becoming video generation',()=>{
 for(const model of ['kimi-k3','mosi::kimi-k3','moonshotai/kimi-k3','tob-kimi-k3']){const c=modelCapabilities(model);assert.equal(c.chat,true);assert.equal(c.videoUnderstanding,true);assert.equal(c.vision,false);assert.equal(c.video,false);}
 for(const model of ['kimi-k2','kimi-k30','kimi-k3-other'])assert.equal(modelCapabilities(model).videoUnderstanding,false);
});
test('video normalization preserves input and refuses lossy protocol conversion or invalid sources',()=>{
 const request=normalizeRequest('chat',raw);assert.deepEqual(chatPayload(request,'kimi-k3').messages,raw.messages);
 for(const fn of [anthropicPayload,responsesPayload])assert.throws(()=>fn(request,'kimi-k3'),/不能转为/);
 for(const url of ['http://example.test/a.mp4','https://user:secret@example.test/a','file:///tmp/a','javascript:alert(1)','ms://','data:video/mp4;base64,???','data:video/mp4;base64,AAAA=AAA','data:video/mp4;base64,'+'A'.repeat((MAX_VIDEO_BYTES/3+1)*4)])assert.throws(()=>validateVideoURL(url));
 assert.equal(validateVideoURL('data:video/mp4;base64,AAAA'),'data:video/mp4;base64,AAAA');
 const fileRaw={...raw,messages:[{role:'user',content:[{type:'video_url',video_url:{url:'ms://file-1'}}]}]};
 assert.doesNotThrow(()=>normalizeRequest('chat',fileRaw));
 assert.throws(()=>normalizeRequest('chat',{...fileRaw,model:'auto'}),/provider::model/);
 assert.throws(()=>normalizeRequest('chat',{...fileRaw,allow_fallback:true}),/allow_fallback/);
 assert.throws(()=>normalizeRequest('chat',{...raw,messages:[{role:'assistant',content:[part]}]}),/user/);
 assert.throws(()=>normalizeRequest('chat',{...raw,messages:[{role:'user',content:[part,part]}]}),/最多/);
 const {payloadFor}=createUpstreamAdapter({unseal:x=>x});
 for(const provider of [{model:'deepseek-chat',protocol:'openai',baseUrl:'https://example.test/v1'},{model:'kimi-k3',protocol:'responses',baseUrl:'https://example.test/v1'},{model:'kimi-k3',protocol:'openai',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'}])assert.throws(()=>payloadFor(provider,request),{status:400});
});
test('vision form sends Kimi native videos to chat and leaves MOSS-VL responses unchanged',async()=>{
 const request=buildVisionRequest({model:'mosi::kimi-k3',instruction:'describe',mediaKind:'video',source:'file_id',entries:'file-1',maxOutputTokens:8192});
 assert.equal(request.messages[0].content[1].video_url.url,'ms://file-1');assert.equal(request.allow_fallback,false);assert.equal(request.stream,false);
 assert.equal(visionOutputText({choices:[{message:{content:'A flower opens'}}]}),'A flower opens');
 const file=new File([new Uint8Array([0,0,0])],'sample.mp4',{type:'video/mp4'});assert.equal(await videoFileDataURL(file),'data:video/mp4;base64,AAAA');
 await assert.rejects(videoFileDataURL(new File([],'empty.mp4')),/6 MB/);
});
test('frame sampling is bounded, timestamped, explicit about missing audio and never stored as native video',()=>{
 assert.equal(videoFrameTimes(600).length,12);assert.equal(videoFrameTimes(0.1).length,1);assert.throws(()=>videoFrameTimes(Infinity));assert.throws(()=>videoFrameTimes(601));
 const frames=[{timestamp:0.5,url:'data:image/jpeg;base64,AAAA'}];const payload=buildVideoFramesRequest({model:'mosi::kimi-k3',instruction:'describe',maxOutputTokens:8192,frames,duration:1});
 assert.equal(payload.allow_fallback,false);assert.match(payload.messages[0].content[0].text,/不含音轨/);assert.match(payload.messages[0].content[1].text,/0.50/);assert.equal(payload.messages[0].content[2].image_url.url,frames[0].url);
 assert.throws(()=>buildVideoFramesRequest({model:'m',instruction:'hi',maxOutputTokens:8192,frames:[{timestamp:2,url:'https://example.test'}],duration:1}));
});
test('video API supports API keys, skips incompatible candidates, falls back across providers and streams',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createPlatform}=await import('../platform.mjs');
 const dir=mkdtempSync(path.join(tmpdir(),'kimi-video-'));const seen=[];let failFirst=true,rejectNative=false;
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,options)=>{
  const payload=JSON.parse(options.body);seen.push({url,payload});assert.equal(payload.model,'kimi-k3');assert.deepEqual(payload.messages,raw.messages);
  if(rejectNative)return Response.json({error:{message:'private upstream text'}},{status:400});
  if(failFirst&&url.includes('first.example'))return Response.json({error:'temporary'},{status:503});
  if(payload.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{content:'video understood'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:3,total_tokens:103}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  return Response.json({id:'test',choices:[{message:{role:'assistant',content:'video understood'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:3,total_tokens:103}});
 }});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const post=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  const setup=await post('/api/account/setup',{bootstrapToken:'a'.repeat(32),name:'Test',email:'kimi@example.test',password:'fixture-password-123'});const auth={cookie:setup.headers.get('set-cookie').split(';')[0]};
  for(const [id,model] of [['text','deepseek-chat'],['first','kimi-k3'],['second','kimi-k3']])assert.equal((await post('/api/provider',{id,name:id,baseUrl:'https://'+id+'.example/v1',protocol:'openai',apiKey:'fixture',model,models:[model],enabled:true,priority:id==='text'?0:id==='first'?1:2},auth)).status,200);
  assert.equal((await post('/api/routing',{strategy:'fallback',active:'text',routing:{maxAttempts:3,timeoutMs:120000,requestsPerMinute:1000,concurrency:5}},auth)).status,200);
  const key=(await (await post('/api/keys',{name:'video'},auth)).json()).token;const bearer={authorization:'Bearer '+key};
  const result=await post('/v1/chat/completions',{...raw,model:'auto'},bearer);assert.equal(result.status,200);assert.equal((await result.json()).choices[0].message.content,'video understood');assert.equal(seen.length,2);assert.ok(seen[0].url.includes('first.example'));assert.ok(seen[1].url.includes('second.example'));
  failFirst=false;const stream=await post('/v1/chat/completions',{...raw,model:'second::kimi-k3',stream:true},bearer);assert.equal(stream.status,200);assert.match(await stream.text(),/video understood/);
  const count=seen.length;const invalid=await post('/v1/chat/completions',{...raw,model:'text::deepseek-chat'},bearer);assert.equal(invalid.status,400);assert.equal(seen.length,count);
  rejectNative=true;const denied=await post('/v1/chat/completions',{...raw,model:'second::kimi-k3'},bearer);assert.equal(denied.status,502);assert.match((await denied.json()).error.message,/抽帧理解/);assert.equal(seen.length,count+1);
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('sampled video context survives follow-up requests but history cannot pretend to restore frames',async()=>{
 const {conversationSnapshot}=await import('../public/lab-history-format.js');
 const {resumeConversation}=await import('../public/lab-history-client.js');
 const first=buildVideoFramesRequest({model:'moss::kimi-k3',instruction:'describe',maxOutputTokens:8192,duration:4,frames:[{timestamp:1,url:'data:image/jpeg;base64,AAAA'},{timestamp:3,url:'data:image/jpeg;base64,BBBB'}]});
 const messages=[...first.messages,{role:'assistant',content:'A flower opens'},{role:'user',content:'What changed at the end?'}];
 const normalized=normalizeRequest('chat',{...first,messages});
 assert.deepEqual(chatPayload(normalized,'kimi-k3').messages,messages);
 const serialized=conversationSnapshot(messages);
 assert.ok(!serialized.includes('base64'));
 assert.match(serialized,/不含音轨/);
 assert.throws(()=>resumeConversation({result:serialized}),/未保存的图片/);
});
