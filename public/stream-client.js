const headerValue=(response,name)=>{const value=response.headers.get(name);if(!value)return '';try{return decodeURIComponent(value)}catch{return value}};
const responseRoute=response=>{const model=headerValue(response,'x-router-model');if(!model)return null;return {providerId:headerValue(response,'x-router-provider'),provider:headerValue(response,'x-router-provider-name'),model,protocol:headerValue(response,'x-router-protocol'),reason:headerValue(response,'x-router-reason'),attempt:Number(headerValue(response,'x-router-attempt'))||1,fallback:headerValue(response,'x-router-fallback')==='true'}};
export async function streamChat(transport,token,input,onText,signal,tenantId,onTiming=()=>{}){
 let content='',reasoning='',route=null,usage=null;const toolCalls=new Map();const result=()=>({role:'assistant',content,reasoning_content:reasoning,...(route?{route}:{}),...(usage?{totalTokens:usage.total_tokens,outputTokens:usage.completion_tokens}:{}),...(toolCalls.size?{tool_calls:[...toolCalls.values()]}:{})});const receive=chunk=>{const delta=chunk.choices?.[0]?.delta||{};if(typeof delta.content==='string')content+=delta.content;if(typeof delta.reasoning_content==='string')reasoning+=delta.reasoning_content;if(chunk.usage)usage=chunk.usage;for(const tool of delta.tool_calls||[]){const index=tool.index??0;const saved=toolCalls.get(index)||{id:tool.id||'',type:'function',function:{name:tool.function?.name||'',arguments:''}};if(tool.id)saved.id=tool.id;if(tool.function?.name&&!saved.function.name)saved.function.name=tool.function.name;if(tool.function?.arguments)saved.function.arguments+=tool.function.arguments;toolCalls.set(index,saved);}onText(result(),{hasOutput:Boolean(delta.content||delta.reasoning_content||delta.tool_calls?.some(tool=>tool.function?.arguments))});};
 if(transport==='ws')return new Promise((resolve,reject)=>{
  const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/v1/realtime`);let finished=false;
  const id=crypto.randomUUID();const timer=setTimeout(()=>{ws.close();reject(Error('实时连接超时'))},130000);
  const close=()=>{ws.close();};signal.addEventListener('abort',close,{once:true});
  const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',close);ws.close()};
  ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token,tenantId}));
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='ready')ws.send(JSON.stringify({type:'chat',id,input}));
   if(m.type==='delta'){onTiming('firstByte');receive(m.chunk)}if(m.type==='done'){onTiming('firstByte');route=m.route||route;usage=m.usage||usage;finished=true;cleanup();resolve(result())}
   if(m.type==='error'){finished=true;cleanup();reject(Error(m.message))}}catch{cleanup();reject(Error('实时响应格式错误'))}};
  ws.onerror=()=>{cleanup();reject(Error('WebSocket 连接失败'))};
  ws.onclose=()=>{cleanup();if(!finished)reject(Error(signal.aborted?'请求已取消':'实时连接已中断'))};
 });
 const response=await fetch('/v1/chat/completions',{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})},body:JSON.stringify({...input,stream:true}),signal});
 if(!response.ok){const data=await response.json();throw Error(data.error?.message||'请求失败')}
 route=responseRoute(response);
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
 try{while(!done){const part=await reader.read();if(part.done)break;if(part.value?.byteLength)onTiming('firstByte');buffer+=decoder.decode(part.value,{stream:true}).replace(/\r\n/g,'\n');let index;
  while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(block.startsWith('event: error')){const line=block.split('\n').find(l=>l.startsWith('data:'));const payload=line?JSON.parse(line.slice(5)):{};throw Error(payload.error?.message||'上游流式响应中断');}
   const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
   if(data==='[DONE]'){done=true;break}if(data)receive(JSON.parse(data));
  }}if(!done)throw Error('流式连接意外关闭');return result();
 }finally{await reader.cancel();reader.releaseLock()}
}
