export async function streamChat(transport,token,input,onText,signal){
 let content='',reasoning='';const result=()=>({role:'assistant',content,reasoning_content:reasoning});const receive=chunk=>{const delta=chunk.choices?.[0]?.delta||{};if(typeof delta.content==='string')content+=delta.content;if(typeof delta.reasoning_content==='string')reasoning+=delta.reasoning_content;onText(result());};
 if(transport==='ws')return new Promise((resolve,reject)=>{
  const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/v1/realtime`);let finished=false;
  const id=crypto.randomUUID();const timer=setTimeout(()=>{ws.close();reject(Error('实时连接超时'))},130000);
  const close=()=>{ws.close();};signal.addEventListener('abort',close,{once:true});
  const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',close);ws.close()};
  ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token}));
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='ready')ws.send(JSON.stringify({type:'chat',id,input}));
   if(m.type==='delta')receive(m.chunk);if(m.type==='done'){finished=true;cleanup();resolve(result())}
   if(m.type==='error'){finished=true;cleanup();reject(Error(m.message))}}catch{cleanup();reject(Error('实时响应格式错误'))}};
  ws.onerror=()=>{cleanup();reject(Error('WebSocket 连接失败'))};
  ws.onclose=()=>{cleanup();if(!finished)reject(Error(signal.aborted?'请求已取消':'实时连接已中断'))};
 });
 const response=await fetch('/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({...input,stream:true}),signal});
 if(!response.ok){const data=await response.json();throw Error(data.error?.message||'请求失败')}
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
 try{while(!done){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true}).replace(/\r\n/g,'\n');let index;
  while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(block.startsWith('event: error'))throw Error('上游流式响应中断');
   const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
   if(data==='[DONE]'){done=true;break}if(data)receive(JSON.parse(data));
  }}if(!done)throw Error('流式连接意外关闭');return result();
 }finally{await reader.cancel();reader.releaseLock()}
}
