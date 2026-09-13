import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {createPlatform} from '../platform.mjs';
test('媒体接口：图片格式转换、音频二进制、上传、视频持久化隔离与共用额度',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-media-'));const seen=[];let polls=0;
 const options={dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,opts)=>{
  if(url.startsWith('https://example.com/')){assert.deepEqual(opts.headers,{});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});}
  assert.equal(opts.headers.authorization,'Bearer upstream-test');assert.equal(opts.redirect,'error');
  if(url.endsWith('/audio/transcriptions')){const form=await new Response(opts.body,{headers:opts.headers}).formData();assert.equal(form.get('model'),'asr');assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()),new Uint8Array([0,128,255]));return Response.json({text:'测试转录'});}
  const b=JSON.parse(opts.body);seen.push({url,b});
  if(url.endsWith('/images/generations')){assert.equal(b.model,'image');assert.equal(b.image_size,'512x512');assert.equal(b.batch_size,2);assert.equal(b.n,undefined);return Response.json({images:[{url:'https://example.com/1.png'},{url:'https://example.com/2.png'}]});}
  if(url.endsWith('/audio/speech'))return new Response(new Uint8Array([73,68,51,0,128,255]),{headers:{'content-type':'audio/mpeg'}});
  if(url.endsWith('/video/submit'))return Response.json({requestId:'upstream-job-private'});
  if(url.endsWith('/video/status')){polls++;assert.deepEqual(b,{requestId:'upstream-job-private'});return Response.json({status:'Succeed',results:{videos:[{url:'https://example.com/video.mp4'}]}});}
  throw Error('Unexpected path');
 }};
 let app=createPlatform(options);await new Promise(r=>app.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.address().port;
 const request=(url,b,headers={})=>fetch(base+url,{method:b?'POST':'GET',headers:{...(b instanceof FormData?{}:{'content-type':'application/json'}),...headers},...(b?{body:b instanceof FormData?b:JSON.stringify(b)}:{})});
 try{
  const setup=await request('/api/account/setup',{bootstrapToken:'a'.repeat(32),name:'Media Owner',email:'media@example.test',password:'fixture-password-123'});const cookie=setup.headers.get('set-cookie').split(';')[0],session={cookie};
  assert.equal((await request('/api/provider',{id:'sf',name:'SF',protocol:'openai',baseUrl:'https://api.siliconflow.cn/v1',apiKey:'upstream-test',models:['chat','image','tts','asr','video'],model:'chat',enabled:true,priority:1},session)).status,200);
  await request('/api/prices',{providerId:'sf',model:'image',billingUnit:'image',currency:'CNY',perImage:0.1},session);
  const key=(await (await request('/api/keys',{name:'media',totalLimit:4},session)).json()).token;
  const other=(await (await request('/api/keys',{name:'other'},session)).json()).token;
  const auth={authorization:'Bearer '+key};
  assert.equal((await request('/v1/images/generations',{model:'auto',prompt:'x'},auth)).status,400);
  assert.equal((await request('/v1/images/generations',{model:'sf::missing',prompt:'x'},auth)).status,404);
  const image=await request('/v1/images/generations',{model:'sf::image',prompt:'a cat',size:'512x512',n:2},auth);assert.equal(image.status,200);assert.equal((await image.json()).data.length,2);
  const speech=await request('/v1/audio/speech',{model:'tts',input:'hello',voice:'tts:alex'},auth);assert.equal(speech.status,200);assert.equal(speech.headers.get('content-type'),'audio/mpeg');assert.deepEqual(new Uint8Array(await speech.arrayBuffer()),new Uint8Array([73,68,51,0,128,255]));
  const upload=new FormData();upload.set('model','sf::asr');upload.set('file',new Blob([new Uint8Array([0,128,255])],{type:'audio/wav'}),'clip.wav');const transcription=await request('/v1/audio/transcriptions',upload,auth);assert.equal(transcription.status,200);assert.equal((await transcription.json()).text,'测试转录');
  const video=await request('/v1/video/submit',{model:'sf::video',prompt:'moving cloud',image_size:'1280x720'},auth);assert.equal(video.status,200);const task=(await video.json()).requestId;assert.match(task,/^video_/);assert.notEqual(task,'upstream-job-private');
  assert.equal((await request('/v1/video/status',{requestId:task},{authorization:'Bearer '+other})).status,404);assert.equal(polls,0);
  assert.equal((await request('/v1/video/status',{requestId:task},auth)).status,200);
  assert.equal((await request('/v1/audio/speech',{model:'sf::tts',input:'quota'},auth)).status,429);
  const logs=(await (await request('/api/logs',null,session)).json()).items;assert.equal(logs.length,4);assert.equal(logs.find(l=>l.model==='image').estimated_cost,0.2);assert.equal(logs.find(l=>l.model==='tts').estimated_cost,null);
  const encoded=await request('/v1/images/generations',{model:'sf::image',prompt:'encoded image',size:'512x512',n:2,response_format:'b64_json'},{authorization:'Bearer '+other});assert.equal(encoded.status,200);assert.equal((await encoded.json()).data[0].b64_json,'AQID');
  await new Promise(r=>app.close(r));app=createPlatform(options);await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;
  assert.equal((await request('/v1/video/status',{requestId:task},auth)).status,200);
  const tenant=await (await request('/api/account/tenants',{name:'Other'},session)).json();await request('/api/account/switch',{tenantId:tenant.id},session);assert.equal((await request('/v1/video/status',{requestId:task},session)).status,404);
  const saved=readFileSync(path.join(dir,'media-jobs.json'),'utf8');assert.ok(!saved.includes('upstream-test'));assert.ok(!saved.includes('moving cloud'));
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
