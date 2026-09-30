// Store complete text until the total UTF-8 budget is reached; never silently
// clip every answer. Images are deliberately represented by labels, not URLs.
export function conversationSnapshot(conversation,maxBytes=256*1024){
 const messages=conversation.map(item=>({role:item.role,content:typeof item.content==='string'?item.content:Array.isArray(item.content)?item.content.map(part=>part.type==='text'?part.text:'[图片未保存在历史中]').join('\n'):'',reasoning:String(item.reasoning_content||''),status:item.status,label:item.label,route:item.route,stats:item.stats,durationMs:item.durationMs,outputTokens:item.outputTokens,...(item.tool_calls?.length?{tools:JSON.stringify(item.tool_calls)}:{})}));
 let omittedMessages=0,clipped=false;
 const serialize=()=>JSON.stringify({version:2,truncated:omittedMessages>0||clipped,omittedMessages,clipped,messages});
 const bytes=value=>new TextEncoder().encode(value).length;
 const sizes=messages.map(item=>bytes(JSON.stringify(item)));let remaining=sizes.reduce((sum,size)=>sum+size,0);
 const envelopeBytes=()=>bytes(JSON.stringify({version:2,truncated:omittedMessages>0||clipped,omittedMessages,clipped,messages:[]}));
 while(envelopeBytes()+remaining+Math.max(0,messages.length-1)>maxBytes&&messages.length>1){remaining-=sizes[omittedMessages];messages.shift();omittedMessages++;}
 if(bytes(serialize())>maxBytes&&messages.length){
  clipped=true;
  for(const field of ['tools','reasoning','content']){
   const original=messages[0][field]||'';let low=0,high=original.length;
   while(low<high){const mid=Math.ceil((low+high)/2);messages[0][field]=original.slice(0,mid);if(bytes(serialize())<=maxBytes)low=mid;else high=mid-1;}
   messages[0][field]=original.slice(0,low).replace(/[\uD800-\uDBFF]$/,'');
   if(bytes(serialize())<=maxBytes)break;
  }
 }
 return serialize();
}

export function historyText(row){
 try{const result=JSON.parse(row.result||'{}');if(Array.isArray(result.messages))return result.messages.map(item=>`${item.role==='user'?'你':item.label||'模型'}\n${item.content||''}${item.reasoning?'\n\n思考内容\n'+item.reasoning:''}${item.tools?'\n\n工具调用\n'+item.tools:''}`).join('\n\n---\n\n');if(result.text)return result.text;}catch{/* Old or non-JSON records can still be exported. */}
 return row.result||row.error||'暂无结果';
}
