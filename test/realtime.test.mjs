import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createApp} from '../server.mjs';
import {consumeSSE} from '../realtime.mjs';
const admin='a'.repeat(32),gateway='g'.repeat(32);
test('SSE 拆包解析、Anthropic 转换与截断检测',async()=>{
 const input=['data: {"type":"message_start","message":{"usage":{"input_tokens":2}}}\n\n',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n','data: {"type":"message_stop"}\n\n'].join('');
 const bytes=new TextEncoder().encode(input);let offset=0;
 const response=new Response(new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return;}c.enqueue(bytes.slice(offset,offset+7));offset+=7;}}),{headers:{'content-type':'text/event-stream'}});
 const chunks=[];assert.equal(await consumeSSE(response,'anthropic','test',async c=>chunks.push(c)),5);
 assert.equal(chunks[1].choices[0].delta.content,'你好');
 await assert.rejects(consumeSSE(new Response('data: {"choices":[]}\n\n',{headers:{'content-type':'text/event-stream'}}),'openai','test',async()=>{}),/提前中断/);
});
test('真实 HTTP SSE 与 WebSocket 鉴权、流式增量和完成事件',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-stream-'));
 const app=createApp({dir,admin,gateway,fetcher:async()=>new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 try{
 await fetch(base+'/api/provider',{method:'POST',headers:{authorization:`Bearer ${admin}`},body:JSON.stringify({id:'demo',name:'Demo',baseUrl:'https://demo.example/v1',protocol:'openai',model:'test',models:['test'],enabled:true,priority:1,apiKey:'test-key'})});
 const input={model:'demo',messages:[{role:'user',content:'hello'}],stream:true};
 const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${gateway}`},body:JSON.stringify(input)});
 assert.equal(response.headers.get('content-type'),'text/event-stream');const text=await response.text();assert.match(text,/hello/);assert.match(text,/\[DONE\]/);
 const ws=new WebSocket(base.replace('http:','ws:')+'/v1/realtime');await once(ws,'open');
 const messages=[];const finished=new Promise((resolve,reject)=>{ws.on('message',raw=>{const msg=JSON.parse(raw);messages.push(msg);if(msg.type==='ready')ws.send(JSON.stringify({type:'chat',id:'one',input}));if(msg.type==='done')resolve();if(msg.type==='error')reject(Error(msg.message));});ws.on('error',reject);});
 ws.send(JSON.stringify({type:'auth',token:gateway}));await finished;assert.equal(messages[1].type,'delta');ws.close();await once(ws,'close');
 const bad=new WebSocket(base.replace('http:','ws:')+'/v1/realtime');await once(bad,'open');bad.send(JSON.stringify({type:'auth',token:'bad'}));const [code]=await once(bad,'close');assert.equal(code,1008);
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true})}
});
