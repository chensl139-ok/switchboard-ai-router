const fileIdPattern=/^[A-Za-z0-9._-]{1,200}$/;

export function buildVisionRequest({model,instruction,mediaKind,source,entries,maxOutputTokens}){
 const text=String(instruction||'').trim();
 if(!text||text.length>10000)throw Error('理解指令需为 1～10000 个字符');
 if(!['image','video'].includes(mediaKind)||!['url','file_id'].includes(source))throw Error('请选择有效的素材类型与来源');
 const values=String(entries||'').split('\n').map(value=>value.trim()).filter(Boolean);
 if(values.length<1||values.length>(mediaKind==='image'?5:1))throw Error(mediaKind==='image'?'请填写 1～5 张图片，每行一个':'请填写 1 个视频');
 for(const value of values){
  if(source==='file_id'){
   if(!fileIdPattern.test(value))throw Error('file_id 只能包含字母、数字、点、下划线和连字符，最长 200 字符');
  }else{
   let url;try{url=new URL(value);}catch{throw Error('请输入有效的 HTTPS 素材地址');}
   if(value.length>4096||url.protocol!=='https:'||url.username||url.password)throw Error('素材地址必须为无账号密码的 HTTPS URL，且不超过 4096 字符');
  }
 }
 const max=Number(maxOutputTokens);
 if(!Number.isInteger(max)||max<1||max>8192)throw Error('最大输出需为 1～8192 tokens');
 const content=[{type:'input_text',text},...values.map(value=>({type:mediaKind==='image'?'input_image':'input_video',...(source==='file_id'?{file_id:value}:{[mediaKind==='image'?'image_url':'video_url']:value})}))];
 return {model,input:[{role:'user',content}],max_output_tokens:max};
}

export function visionOutputText(data){
 return (data?.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text||'').join('\n');
}
