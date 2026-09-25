import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlatform} from '../platform.mjs';
import {protocolForModel} from '../model-protocol.mjs';

test('MOSS-VL 使用专用非流式视觉理解接口，不混入对话路由',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-moss-vl-'));
 const upstream=[];
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,options)=>{
  upstream.push({url,body:JSON.parse(options.body)});
  assert.equal(url,'https://api.mosi.cn/v1/responses');
  assert.equal(options.headers.authorization,'Bearer moss-fixture-secret');
  return Response.json({id:'resp_test',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'图中有一只猫'}]}],usage:{input_tokens:10,output_tokens:6,total_tokens:16}});
 }});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.address().port;
 const request=(endpoint,data,headers={})=>fetch(base+endpoint,{method:data?'POST':'GET',headers:{'content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});
 try{
  const setup=await request('/api/account/setup',{bootstrapToken:'a'.repeat(32),name:'Vision Owner',email:'vision@example.test',password:'fixture-password-123'});
  assert.equal(setup.status,200);
  const session={cookie:setup.headers.get('set-cookie').split(';')[0]};
  const provider=await request('/api/provider',{id:'moss',name:'Moss',protocol:'openai',baseUrl:'https://api.mosi.cn/v1',apiKey:'moss-fixture-secret',models:['moss-vl-1.0'],model:'moss-vl-1.0',enabled:true,priority:1},session);
  assert.equal(provider.status,200);
  assert.equal(protocolForModel({protocol:'openai',modelProtocols:{'moss-vl-1.0':'openai'}},'moss-vl-1.0'),'responses');
  const key=(await (await request('/api/keys',{name:'vision',totalLimit:2},session)).json()).token;
  const auth={authorization:'Bearer '+key};
  const chat=await request('/v1/chat/completions',{model:'moss::moss-vl-1.0',messages:[{role:'user',content:'你好'}]},auth);
  assert.equal(chat.status,400);
  const auto=await request('/v1/chat/completions',{model:'auto',messages:[{role:'user',content:'你好'}]},auth);
  assert.notEqual(auto.status,200);
  assert.equal(upstream.length,0);
  const imageInput=[{role:'user',content:[{type:'input_text',text:'这是什么？'},{type:'input_image',image_url:'https://example.test/cat.png'}]}];
  const image=await request('/v1/responses',{model:'moss::moss-vl-1.0',input:imageInput},auth);
  assert.equal(image.status,200);
  assert.equal((await image.json()).output[0].content[0].text,'图中有一只猫');
  assert.deepEqual(upstream[0].body,{model:'moss-vl-1.0',input:imageInput,max_output_tokens:1024});
  const videoInput=[{role:'user',content:[{type:'input_text',text:'描述这个视频'},{type:'input_video',video_url:'https://example.test/clip.mp4'}]}];
  const video=await request('/v1/responses',{model:'moss::moss-vl-1.0',input:videoInput,max_output_tokens:256},auth);
  assert.equal(video.status,200);
  assert.deepEqual(upstream[1].body,{model:'moss-vl-1.0',input:videoInput,max_output_tokens:256});
  const invalid=[
   {model:'moss::moss-vl-1.0',input:'只有文字'},
   {model:'moss::moss-vl-1.0',input:[{role:'user',content:[{type:'input_text',text:'文本'}]}]},
   {model:'moss::moss-vl-1.0',input:imageInput,stream:true},
   {model:'moss::moss-vl-1.0',input:[{role:'user',content:[...imageInput[0].content,{type:'input_video',video_url:'https://example.test/clip.mp4'}]}]}
  ];
  for(const payload of invalid)assert.equal((await request('/v1/responses',payload,auth)).status,400);
  assert.equal(upstream.length,2);
  const logs=(await (await request('/api/logs',null,session)).json()).items;
  assert.equal(logs.filter(log=>log.model==='moss-vl-1.0'&&log.status===200).length,2);
  assert.equal((await request('/v1/responses',{model:'moss::moss-vl-1.0',input:imageInput},auth)).status,429);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
