import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {safeFetch} from '../network.mjs';

test('上游响应取消后不会向已关闭 Web Stream 入队或令进程退出',async()=>{
 const priorHttp=process.env.ALLOW_HTTP_UPSTREAM,priorHosts=process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS;
 process.env.ALLOW_HTTP_UPSTREAM='true';process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const server=http.createServer((req,res)=>{
  if(req.url==='/json'){res.setHeader('content-type','application/json');res.end('{"ok":true}');return;}
  res.setHeader('content-type','text/event-stream');let count=0;
  const interval=setInterval(()=>{if(count++>=20){clearInterval(interval);res.end();return;}res.write('data: chunk\n\n');},5);
  res.on('close',()=>clearInterval(interval));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.deepEqual(await (await safeFetch(base+'/json')).json(),{ok:true});
  for(let attempt=0;attempt<20;attempt++){
   const response=await safeFetch(base+'/stream');
   assert.equal(response.status,200);
   await response.body.cancel();
  }
  await new Promise(resolve=>setTimeout(resolve,75));
  const response=await safeFetch(base+'/stream'),reader=response.body.getReader();
  const first=await reader.read();assert.equal(first.done,false);assert.match(new TextDecoder().decode(first.value),/data: chunk/);
  await reader.cancel();
 }finally{
  await new Promise(resolve=>server.close(resolve));
  if(priorHttp===undefined)delete process.env.ALLOW_HTTP_UPSTREAM;else process.env.ALLOW_HTTP_UPSTREAM=priorHttp;
  if(priorHosts===undefined)delete process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS;else process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS=priorHosts;
 }
});
