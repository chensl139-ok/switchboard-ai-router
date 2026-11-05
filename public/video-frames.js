import {MAX_VIDEO_BYTES} from './video-input.js';
export function videoFrameTimes(duration){
 if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('抽帧模式支持时长不超过 10 分钟的视频');
 const count=Math.min(12,Math.max(1,Math.ceil(duration/2)));
 return Array.from({length:count},(_,index)=>duration*(index+0.5)/count);
}
export async function extractVideoFrames(file,signal){
 if(!file||file.size<1||file.size>MAX_VIDEO_BYTES)throw Error('请选择 1 字节～6 MB 的视频文件');
 if(!/\.(mp4|webm|mov)$/i.test(file.name))throw Error('本地视频支持 MP4、WebM、MOV');
 const video=document.createElement('video'),url=URL.createObjectURL(file);video.muted=true;video.preload='auto';video.playsInline=true;
 const event=name=>new Promise((resolve,reject)=>{
  let timer;const clean=()=>{clearTimeout(timer);video.removeEventListener(name,done);video.removeEventListener('error',error);signal?.removeEventListener('abort',abort);};
  const done=()=>{clean();resolve();},error=()=>{clean();reject(Error('浏览器无法解码此视频，请转换为 H.264 MP4 后重试'));},abort=()=>{clean();reject(new DOMException('已取消视频处理','AbortError'));};
  video.addEventListener(name,done,{once:true});video.addEventListener('error',error,{once:true});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{clean();reject(Error('读取视频超时，请更换文件'));},15000);if(signal?.aborted)abort();
 });
 try{
  const loaded=event('loadedmetadata');video.src=url;await loaded;
  const duration=video.duration,times=videoFrameTimes(duration),canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  if(!context||!video.videoWidth||!video.videoHeight)throw Error('视频没有可读取的画面');
  const scale=Math.min(1,768/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const frames=[];
  for(const timestamp of times){signal?.throwIfAborted();const ready=event('seeked');video.currentTime=timestamp;await ready;context.drawImage(video,0,0,canvas.width,canvas.height);frames.push({timestamp,url:canvas.toDataURL('image/jpeg',0.8)});}
  return {duration,frames};
 }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
export function buildVideoFramesRequest({model,instruction,maxOutputTokens,frames,duration}){
 if(!Array.isArray(frames)||!frames.length||frames.length>12)throw Error('视频帧数量需为 1～12');
 const max=Number(maxOutputTokens),text=String(instruction||'').trim();
 if(!text||text.length>10000)throw Error('理解指令需为 1～10000 个字符');
 if(!Number.isInteger(max)||max<1||max>8192)throw Error('最大输出需为 1～8192 tokens');
 videoFrameTimes(duration);
 const content=[{type:'text',text:`${text}\n\n以下是同一段 ${duration.toFixed(2)} 秒视频按时间顺序均匀抽取的 ${frames.length} 帧画面。仅分析这些采样画面；不含音轨，不能据此推断声音或未采样的事件。`}];
 for(const frame of frames){if(!Number.isFinite(frame.timestamp)||frame.timestamp<0||frame.timestamp>duration||typeof frame.url!=='string'||!frame.url.startsWith('data:image/jpeg;base64,'))throw Error('视频帧格式无效');content.push({type:'text',text:`时间戳 ${frame.timestamp.toFixed(2)} 秒`},{type:'image_url',image_url:{url:frame.url}});}
 const payload={model,messages:[{role:'user',content}],max_tokens:max,stream:false,allow_fallback:false};
 if(new TextEncoder().encode(JSON.stringify(payload)).length>9*1024*1024)throw Error('视频采样结果过大，请降低视频分辨率');
 return payload;
}
