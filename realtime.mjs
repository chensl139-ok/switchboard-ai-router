import {WebSocketServer, WebSocket} from 'ws';
import {once} from 'node:events';

export async function consumeSSE(response, protocol, model, emit, signal) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw Error('上游未返回 SSE');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer='',done=false,tokens=0;
  const id='chatcmpl-'+crypto.randomUUID();
  const chunk=(delta,finish=null)=>({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model,
    choices:[{index:0,delta,finish_reason:finish}]});
  async function event(block) {
    const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data)return;
    if(data==='[DONE]'){done=true;return;}
    const parsed=JSON.parse(data);
    if(parsed.error||parsed.type==='error')throw Error('上游流式请求失败');
    if(protocol!=='anthropic'){
      if(!parsed.choices&&!parsed.usage)throw Error('无效流式事件');
      tokens=parsed.usage?.total_tokens??tokens;await emit(parsed);return;
    }
    if(parsed.type==='message_start'){tokens=parsed.message?.usage?.input_tokens||0;await emit(chunk({role:'assistant',content:''}));}
    if(parsed.type==='content_block_delta'&&parsed.delta?.type==='text_delta')await emit(chunk({content:parsed.delta.text}));
    if(parsed.type==='content_block_delta'&&parsed.delta?.type==='thinking_delta')await emit(chunk({reasoning_content:parsed.delta.thinking}));
    if(parsed.type==='message_delta'){tokens+=parsed.usage?.output_tokens||0;await emit(chunk({},parsed.delta?.stop_reason==='max_tokens'?'length':'stop'));}
    if(parsed.type==='message_stop')done=true;
  }
  try {
    while(!done){
      if(signal?.aborted)throw Error('请求已取消');
      const part=await reader.read();
      if(part.done)break;
      buffer+=decoder.decode(part.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      let index;
      while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);await event(block);}
      if(buffer.length>1024*1024)throw Error('上游事件超过大小限制');
    }
    if(!done)throw Error('上游流提前中断');
    return tokens;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function installWebSocket(server, {authenticate, execute, originAllowed}) {
  const wss=new WebSocketServer({noServer:true,maxPayload:256*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/v1/realtime'||!originAllowed(req.headers.origin,req.headers.host)){
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
    }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    let authorized=false,credential=null,running=null,alive=true;
    const send=value=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1024*1024){ws.close(1013,'客户端读取过慢');return;}ws.send(JSON.stringify(value));}};
    const timeout=setTimeout(()=>{if(!authorized)ws.close(1008,'需要认证');},5000);
    ws.on('pong',()=>{alive=true;});
    const heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},30000);
    ws.on('close',()=>{clearTimeout(timeout);clearInterval(heartbeat);running?.abort.abort();});
    ws.on('error',()=>{running?.abort.abort();});
    ws.on('message',async raw=>{
      let message;try{message=JSON.parse(raw.toString());}catch{send({type:'error',message:'JSON 无效'});return;}
      if(!authorized){
        if(message?.type!=='auth'||!authenticate(message.token)){ws.close(1008,'认证失败');return;}
        authorized=true;credential=message.token;clearTimeout(timeout);send({type:'ready'});return;
      }
      if(message?.type==='cancel'){if(running?.id===message.id)running.abort.abort();return;}
      if(message?.type!=='chat'||typeof message.id!=='string'||message.id.length>80||!message.input){send({type:'error',message:'请求格式无效'});return;}
      if(running){send({type:'error',id:message.id,message:'当前连接已有请求生成中'});return;}
      running={id:message.id,abort:new AbortController()};
      try{await execute({...message.input,stream:true},{token:credential,signal:running.abort.signal,onChunk:async chunk=>send({type:'delta',id:message.id,chunk})});send({type:'done',id:message.id});}
      catch(error){send({type:'error',id:message.id,message:error.status?error.message:'生成失败或已取消'});}
      finally{running=null;}
    });
  });
  server.on('close',()=>{for(const ws of wss.clients)ws.close(1001,'服务关闭');wss.close();});
  return wss;
}
export async function writeSSE(res, value, signal) {
  if(res.destroyed)throw Error('客户端连接已关闭');
  if(!res.write(`data: ${typeof value==='string'?value:JSON.stringify(value)}\n\n`))await once(res,'drain',{signal});
}
