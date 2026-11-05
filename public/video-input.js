export const MAX_VIDEO_BYTES=6*1024*1024;
export function isKimiVideoModel(model=''){
 const name=String(model).toLowerCase().split('::').at(-1).split('/').at(-1);
 return /^(?:tob-)?kimi-k3(?:-\d{4}-\d{2}-\d{2})?$/.test(name);
}
export function validateVideoURL(value){
 if(typeof value!=='string')throw Error('video_url.url 必须为字符串');
 if(value.startsWith('data:')){
  const comma=value.indexOf(','),mime=value.slice(0,comma),data=value.slice(comma+1);
  if(!/^data:video\/(mp4|webm|quicktime);base64$/.test(mime)||!data.length||data.length%4||/[^A-Za-z0-9+/=]/.test(data)||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('视频 Base64 格式无效，仅支持 MP4、WebM、MOV');
  if(data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0)>MAX_VIDEO_BYTES)throw Error('本地视频最大 6 MB；更大的视频请使用服务商支持的 URL 或文件 ID');
  return value;
 }
 if(/^ms:\/\/[A-Za-z0-9._-]{1,200}$/.test(value))return value;
 let url;try{url=new URL(value);}catch{throw Error('视频需为 HTTPS URL、ms://文件ID 或视频 Base64');}
 if(value.length>4096||url.protocol!=='https:'||url.username||url.password)throw Error('视频地址必须为无账号密码的 HTTPS URL，最长 4096 字符');
 return value;
}
export async function videoFileDataURL(file){
 if(!file||file.size<1||file.size>MAX_VIDEO_BYTES)throw Error('请选择 1 字节～6 MB 的视频文件');
 const extension=file.name.split('.').at(-1).toLowerCase(),mime={mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'}[extension];
 if(!mime)throw Error('本地视频支持 MP4、WebM、MOV');
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return validateVideoURL('data:'+mime+';base64,'+btoa(binary));
}
