import {randomUUID,randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {priceAt,normalizeUsage,usageCost} from './pricing.mjs';
export const mediaPaths=new Set(['/v1/images/generations','/v1/images/edits','/v1/audio/speech','/v1/audio/transcriptions','/v1/audio/translations','/v1/video/submit','/v1/video/status','/v1/embeddings','/v1/rerank']);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const owner=caller=>caller.apiKeyId?'key:'+caller.apiKeyId:caller.userId?'user:'+caller.userId:caller.admin?'admin':'legacy';
const sf=p=>['api.siliconflow.cn','api.siliconflow.com'].includes(new URL(p.baseUrl).hostname);
export function mediaProvider(state,model){
 if(typeof model!=='string'||!model||model==='auto')throw fail('媒体调用需指定已配置模型，建议使用 provider::model，不支持 auto');
 const available=state.providers.filter(p=>p.enabled&&p.secret&&p.protocol!=='anthropic');
 const split=model.indexOf('::');let p,upstream;
 if(split>=0){p=available.find(p=>p.id===model.slice(0,split));upstream=model.slice(split+2);}
 else{p=available.find(p=>p.id===model);if(p)upstream=p.model;else{const matches=available.filter(p=>p.models.includes(model));if(matches.length>1)throw fail('模型名称重复，请使用 provider::model');p=matches[0];upstream=model;}}
 if(!p||!p.models.includes(upstream))throw fail('媒体模型未配置或服务商未启用，请先在模型目录中加入对应模型',404);
 return {...p,model:upstream};
}
async function readBody(req){
 const type=req.headers['content-type']||'',multipart=type.startsWith('multipart/form-data');let length=0;const chunks=[];
 for await(const chunk of req){length+=chunk.length;if(length>(multipart?52:10)*1024*1024)throw fail('媒体请求超过大小限制：JSON 10 MB，上传 52 MB',413);chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);
 if(multipart){let form;try{form=await new Response(bytes,{headers:{'content-type':type}}).formData();}catch{throw fail('multipart 表单无效');}if(form.getAll('model').length!==1)throw fail('表单需包含且仅包含一个 model');return {form,data:{model:form.get('model')}};}
 try{const data=JSON.parse(bytes.toString());if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return {data};}catch{throw fail('JSON 格式错误');}
}
async function limitedJSON(response){let length=0,parts=[];for await(const chunk of response.body||[]){length+=chunk.length;if(length>32*1024*1024)throw fail('上游媒体 JSON 超过 32 MB',502);parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw fail('上游返回了无效 JSON',502);}}
export function createMediaHandler({state,dir,fetcher,unseal,apiKeys,record,acquire}){
 const file=path.join(dir,'media-jobs.json');let jobs=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
 const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(jobs),{mode:0o600});renameSync(file+'.tmp',file);};
 return async(req,res,caller)=>{
  const pathname=new URL(req.url,'http://local').pathname,poll=pathname==='/v1/video/status';
  const {data,form}=await readBody(req);let p,job;
  if(poll){if(typeof data.requestId!=='string'||!Object.hasOwn(jobs,data.requestId))throw fail('视频任务不存在或不属于当前调用方',404);job=jobs[data.requestId];if(!job||job.expiresAt<Date.now()||(!(caller.admin||['owner','admin'].includes(caller.role))&&job.owner!==owner(caller)))throw fail('视频任务不存在或不属于当前调用方',404);p=state.providers.find(p=>p.id===job.providerId&&p.enabled&&p.secret&&p.baseUrl===job.baseUrl);if(!p)throw fail('任务对应服务商配置已改变或未启用',409);p={...p,model:job.model};}
  else p=mediaProvider(state,data.model);
  if(pathname.startsWith('/v1/video/')&&!sf(p))throw fail('视频任务协议当前支持硅基流动，其他服务商视频协议尚未适配',501);
  if(form&&!['/v1/images/edits','/v1/audio/transcriptions','/v1/audio/translations'].includes(pathname))throw fail('此接口仅接受 JSON');
  if(!form&&['/v1/audio/transcriptions','/v1/audio/translations'].includes(pathname))throw fail('音频转文字请使用 multipart/form-data，包含 model 和 file');
  if(form&&pathname.includes('/audio/')){const audio=form.get('file');if(!audio||typeof audio==='string'||audio.size===0||audio.size>50*1024*1024)throw fail('file 需为 1 字节至 50 MB 的音频文件');}
  if(pathname==='/v1/images/edits'&&sf(p))throw fail('硅基流动图像编辑请调用 /v1/images/generations，使用 image 字段',501);
  if(!poll&&!form){if(['/v1/images/generations','/v1/video/submit'].includes(pathname)&&(typeof data.prompt!=='string'||!data.prompt.trim()))throw fail('prompt 不能为空');if(pathname==='/v1/audio/speech'&&(typeof data.input!=='string'||!data.input.trim()))throw fail('input 不能为空');if(data.stream&&pathname!=='/v1/audio/speech')throw fail('此媒体接口不支持 SSE，请移除 stream 参数');}
  const payload=poll?{requestId:job.upstreamId}:{...data,model:p.model};delete payload.upstream_model;
  if(sf(p)&&pathname==='/v1/images/generations'){
   if(payload.n!==undefined&&payload.batch_size!==undefined&&payload.n!==payload.batch_size)throw fail('n 与 batch_size 不一致');
   if(payload.size!==undefined&&payload.image_size!==undefined&&payload.size!==payload.image_size)throw fail('size 与 image_size 不一致');
   payload.batch_size=payload.batch_size??payload.n??1;payload.image_size=payload.image_size??payload.size??'1024x1024';delete payload.n;delete payload.size;
   if(payload.response_format&&!['url','b64_json'].includes(payload.response_format))throw fail('response_format 需为 url 或 b64_json');delete payload.response_format;
  }
  if(pathname==='/v1/video/submit'){for(const [id,j] of Object.entries(jobs))if(j.expiresAt<Date.now())delete jobs[id];if(Object.keys(jobs).length>=2000)throw fail('视频任务记录已满，请稍后重试',429);}
  let requestBody,headers={authorization:'Bearer '+unseal(p.secret)};
  if(form){form.set('model',p.model);const encoded=new Request('http://local',{method:'POST',body:form});headers['content-type']=encoded.headers.get('content-type');requestBody=Buffer.from(await encoded.arrayBuffer());}
  else{headers['content-type']='application/json';requestBody=JSON.stringify(payload);}
  const release=acquire();try{if(caller.apiKeyId&&!poll)apiKeys.admit(caller.apiKeyId);}catch(error){release();throw error;}
  const started=Date.now(),requestId=randomUUID(),abort=new AbortController();res.setHeader('x-request-id',requestId);res.setHeader('request-id',requestId);
  const onClose=()=>{if(!res.writableEnded)abort.abort();};res.on('close',onClose);
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(180000)]);let succeeded=false,tokens=0,status=502,cost={estimatedCost:null},usage={known:false};
  try{
   const response=await fetcher(p.baseUrl+pathname.slice(3),{method:'POST',headers,body:requestBody,signal,redirect:'error',maxResponseBytes:64*1024*1024});
   status=response.status;if(!response.ok){await response.body?.cancel();throw fail(`服务商 ${p.name} 的 ${pathname} 返回 HTTP ${status}，请检查模型能力和参数`,status);}
   const type=response.headers.get('content-type')||'';
   if(pathname==='/v1/audio/speech'){
    if(!response.body||!(/^(audio\/|application\/octet-stream)/i.test(type)))throw fail('语音接口未返回音频二进制数据',502);
    res.writeHead(200,{'content-type':type,'cache-control':'no-store'});let bytes=0;const reader=response.body.getReader();
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>64*1024*1024)throw fail('音频响应超过 64 MB',502);if(!res.write(part.value))await once(res,'drain',{signal});}if(!bytes)throw fail('上游返回空音频',502);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    res.end();succeeded=true;return;
   }
   if(form&&pathname.includes('/audio/')&&!type.includes('json')){const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8*1024*1024)throw fail('转录响应超过限制',502);res.writeHead(200,{'content-type':/^text\//.test(type)?'text/plain; charset=utf-8':'application/octet-stream','cache-control':'no-store'});res.end(bytes);succeeded=true;return;}
   let result=await limitedJSON(response);
   if(pathname==='/v1/images/generations'){
    if(sf(p)){if(!Array.isArray(result.images)||!result.images.length)throw fail('上游未返回生成图片',502);result={...result,created:Math.floor(started/1000),data:result.images.map(image=>({url:image.url}))};}
    if(!Array.isArray(result.data)||!result.data.length)throw fail('上游未返回生成图片',502);
    if(sf(p)&&data.response_format==='b64_json'){
     if(result.data.length>10)throw fail('图片结果超过 10 张限制',502);let totalBytes=0;const encoded=[];
     for(const image of result.data){let url;try{url=new URL(image.url);}catch{throw fail('上游图片地址无效',502);}if(url.protocol!=='https:'||url.username||url.password)throw fail('上游图片地址必须是 HTTPS',502);
      const asset=await fetcher(url.href,{method:'GET',headers:{},redirect:'error',signal,maxResponseBytes:24*1024*1024});if(!asset.ok||!(/^(image\/|application\/octet-stream)/i.test(asset.headers.get('content-type')||''))){await asset.body?.cancel();throw fail('无法获取上游生成图片',502);}const pieces=[];for await(const piece of asset.body){totalBytes+=piece.length;if(totalBytes>24*1024*1024)throw fail('Base64 图片总大小超过 24 MB',502);pieces.push(piece);}const bytes=Buffer.concat(pieces),prefix=bytes.subarray(0,12);if(!(prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(prefix[0]===255&&prefix[1]===216&&prefix[2]===255)||/^GIF8[79]a/.test(prefix.toString('ascii'))||(prefix.toString('ascii',0,4)==='RIFF'&&prefix.toString('ascii',8,12)==='WEBP')))throw fail('上游返回的文件不是支持的图片格式',502);encoded.push({b64_json:bytes.toString('base64')});
     }result.data=encoded;
    }
    const price=priceAt(p.prices?.[p.model],started);if(price?.billingUnit==='image'&&Number.isFinite(price.perImage)&&Date.parse(price.expiresAt)>started)cost={estimatedCost:price.perImage*result.data.length,currency:price.currency,priceSource:price.source};
   }
   if(pathname==='/v1/video/submit'){
    if(typeof result.requestId!=='string'||!result.requestId||result.requestId.length>300)throw fail('上游未返回视频任务 ID',502);
    const id='video_'+randomUUID();jobs[id]={upstreamId:result.requestId,providerId:p.id,baseUrl:p.baseUrl,model:p.model,owner:owner(caller),expiresAt:Date.now()+86400000};save();result={...result,requestId:id};
   }
   if(pathname==='/v1/embeddings'){usage=normalizeUsage({prompt_tokens:result.usage?.prompt_tokens,completion_tokens:0,total_tokens:result.usage?.total_tokens});tokens=usage.totalTokens;cost=usageCost(p,p.model,usage,started);}
   res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(result));succeeded=true;
  }catch(error){status=error.status||502;if(res.headersSent){res.destroy();}else throw error.status?error:fail(abort.signal.aborted?'媒体请求已取消':'媒体上游请求失败或超时',502);}
  finally{res.off('close',onClose);release();if(!poll){record({id:randomBytes(6).toString('hex'),requestId,time:new Date().toISOString(),actorId:caller.userId,apiKeyId:caller.apiKeyId,providerId:p.id,provider:p.name,model:p.model,status:succeeded?200:status,latency:Date.now()-started,transport:'media',reason:pathname,tokens,usageKnown:usage.known,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,...cost});if(caller.apiKeyId){try{apiKeys.complete(caller.apiKeyId,succeeded,tokens);}catch{console.error('media_usage_persistence_failed');}}}}
 };
}
