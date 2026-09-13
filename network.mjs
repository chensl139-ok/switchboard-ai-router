import https from 'node:https';
import http from 'node:http';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import {Readable,Transform} from 'node:stream';
export function publicAddress(address){
 if(isIP(address)===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(db8|0|20):/i.test(address)&&!/^2002:/i.test(address);
 if(isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&[18,19,51].includes(b))||(a===203&&b===0));
}
export function safeFetch(value,options={}){
 const url=new URL(value);const host=url.hostname.replace(/^\[|\]$/g,'');
 const officialHosts=['s3.siliconflow.cn','api.siliconflow.cn','api.siliconflow.com','api.deepseek.com','api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','openrouter.ai'];
 const proxyAddressAllowed=address=>process.env.UPSTREAM_PROXY_FAKE_IP==='true'&&url.protocol==='https:'&&officialHosts.includes(host)&&/^198\.(18|19)\./.test(address);
 const allowedPrivate=(process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS||'').split(',').map(s=>s.trim()).includes(host);
 if(url.username||url.password||!['https:','http:'].includes(url.protocol))return Promise.reject(Error('上游 URL 无效'));
 if(url.protocol==='http:'&&process.env.ALLOW_HTTP_UPSTREAM!=='true')return Promise.reject(Error('HTTP 上游未允许'));
 if(isIP(host)&&!publicAddress(host)&&!allowedPrivate)return Promise.reject(Error('私网目标未允许'));
 const resolve=(hostname,opts,callback)=>lookup(hostname,{all:true},(error,addresses)=>{
  if(error)return callback(error,'');
  if(!addresses.length||(!allowedPrivate&&addresses.some(a=>!publicAddress(a.address)&&!proxyAddressAllowed(a.address))))return callback(Error('私网目标未允许'),'');
  callback(null,opts.all?addresses:addresses[0].address,addresses[0].family);
 });
 const protocol=url.protocol==='https:'?https:http;
 return new Promise((resolveResponse,reject)=>{
  const request=protocol.request(url,{method:options.method||'GET',headers:options.headers,signal:options.signal,lookup:resolve},response=>{
   const headers=new Headers();for(const [name,value] of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
   let bytes=0;const limited=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>Math.min(options.maxResponseBytes||8*1024*1024,64*1024*1024))return callback(Error('上游响应超过大小限制'));callback(null,chunk);}});response.on('error',error=>limited.destroy(error));limited.on('close',()=>response.destroy());response.pipe(limited);
   resolveResponse(new Response([204,205,304].includes(response.statusCode)?null:Readable.toWeb(limited),{status:response.statusCode,statusText:response.statusMessage,headers}));
  });
  request.on('error',reject);if(options.body)request.write(options.body);request.end();
 });
}
