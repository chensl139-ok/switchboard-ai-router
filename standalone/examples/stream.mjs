// Node.js 22+. Run from standalone/: node examples/stream.mjs sse|ws
import WebSocket from 'ws';
const mode=process.argv[2]||'sse';
const base=process.env.GATEWAY_URL;
const token=process.env.GATEWAY_TOKEN;
if(!base||!token)throw Error('请设置 GATEWAY_URL 与 GATEWAY_TOKEN');
if(!['sse','ws'].includes(mode))throw Error('模式必须为 sse 或 ws');
const input={model:process.env.MODEL||'auto',stream:true,max_tokens:512,
  messages:[{role:'user',content:process.env.PROMPT||'请用一句话介绍你自己。'}]};
const print=chunk=>{const delta=chunk?.choices?.[0]?.delta?.content;if(typeof delta==='string')process.stdout.write(delta)};
const abort=new AbortController();
const interrupt=()=>abort.abort();process.on('SIGINT',interrupt);
try{
 if(mode==='sse'){
  const response=await fetch(new URL('/v1/chat/completions',base),{method:'POST',
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
   body:JSON.stringify(input),signal:abort.signal});
  if(!response.ok)throw Error(`HTTP ${response.status}: ${await response.text()}`);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
  try{
   while(!complete){
    const part=await reader.read();if(part.done)break;
    buffer+=decoder.decode(part.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
    let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){
     const event=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
     if(event.startsWith('event: error'))throw Error('服务端流式响应中断');
     const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
     if(data==='[DONE]'){complete=true;break;}
     if(data)print(JSON.parse(data));
    }
   }
   if(!complete)throw Error('连接结束但未收到 [DONE]');
  }finally{await reader.cancel();reader.releaseLock();}
 }else{
  const url=new URL('/v1/realtime',base);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  await new Promise((resolve,reject)=>{
   const ws=new WebSocket(url);const id=crypto.randomUUID();let done=false;
   const timeout=setTimeout(()=>{ws.terminate();reject(Error('WebSocket 超时'));},40000);
   const cancel=()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'cancel',id}));ws.close();};
   abort.signal.addEventListener('abort',cancel,{once:true});
   ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token})));
   ws.on('message',raw=>{
    try{
     const event=JSON.parse(raw.toString());
     if(event.type==='ready')ws.send(JSON.stringify({type:'chat',id,input}));
     if(event.type==='delta')print(event.chunk);
     if(event.type==='error'){ws.close();reject(Error(event.message));}
     if(event.type==='done'){done=true;ws.close();resolve();}
    }catch(error){ws.close();reject(error);}
   });
   ws.on('error',reject);
   ws.on('close',()=>{clearTimeout(timeout);abort.signal.removeEventListener('abort',cancel);if(!done)reject(Error('连接中断或已取消'));});
  });
 }
 process.stdout.write('\n');
}finally{process.off('SIGINT',interrupt);}
