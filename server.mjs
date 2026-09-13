import {thinkingOptions,assertThinkingDisabled} from './thinking.mjs';
import {selectRoutes,validateRouting} from './routing.mjs';
import {ApiKeyStore} from './key-store.mjs';
import {consumeSSE, installWebSocket, writeSSE} from './realtime.mjs';
import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
export const presets=[
 ['siliconflow','硅基流动','https://api.siliconflow.cn/v1','openai'],
 ['deepseek','DeepSeek','https://api.deepseek.com/v1','openai'],
 ['openai','OpenAI','https://api.openai.com/v1','openai'],
 ['anthropic','Anthropic','https://api.anthropic.com/v1','anthropic'],
 ['gemini','Google Gemini','https://generativelanguage.googleapis.com/v1beta/openai','openai'],
 ['qwen','阿里云百炼','https://dashscope.aliyuncs.com/compatible-mode/v1','openai']
].map(([id,name,baseUrl,protocol])=>({id,name,baseUrl,protocol,model:'',enabled:false,priority:50}));
export function createApp({dir=process.env.DATA_DIR||path.join(root,'data'),admin=process.env.ADMIN_TOKEN,gateway=process.env.GATEWAY_TOKEN,fetcher=fetch,allowHttp=process.env.ALLOW_HTTP_UPSTREAM==='true'}={}){
 if(!admin||admin.length<24||!gateway||gateway.length<24) throw Error('ADMIN_TOKEN 和 GATEWAY_TOKEN 必须分别设置为至少 24 位随机字符串');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const apiKeys=new ApiKeyStore(dir);
 const keyPath=path.join(dir,'master.key');
 if(!existsSync(keyPath)){
  const statePath=path.join(dir,'state.json');
  if(existsSync(statePath)&&JSON.parse(readFileSync(statePath,'utf8')).providers?.some(p=>p.secret))throw Error('master.key 丢失：请恢复完整数据备份，不能自动替换解密密钥');
  writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
 }
 const key=readFileSync(keyPath);if(key.length!==32)throw Error('master.key 长度无效');
 const seal=s=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(s),c.final(),c.getAuthTag()]).toString('base64')};
 const unseal=s=>{const b=Buffer.from(s,'base64'),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString()};
 const file=path.join(dir,'state.json');
 let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{providers:structuredClone(presets),active:'',strategy:'fallback',logs:[]};
 for(const p of state.providers)p.models=[...new Set([...(p.models||[]),...(p.model?[p.model]:[])])];
 state.rules??=[];state.routing??={timeoutMs:30000,maxAttempts:3,requestsPerMinute:60,concurrency:5};
 for(const p of state.providers)p.weight??=1;
 let sequence=0;
 const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});renameSync(file+'.tmp',file)};
 const safe=()=>({...state,providers:state.providers.map(({secret,...p})=>({...p,hasKey:!!secret})),presets});
 const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const fail=(message,status=400)=>Object.assign(new Error(message),{status});
 const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
 async function body(req){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>262144)throw fail('请求超过 256 KB',413)}try{return JSON.parse(s)}catch{throw fail('JSON 格式错误')}}
 function upstreamURL(value){
  let u;try{u=new URL(value)}catch{throw fail('上游地址格式无效')}
  if(u.username||u.password||u.search||u.hash||!(['https:',...(allowHttp?['http:']:[])].includes(u.protocol)))throw fail('上游地址需为 HTTPS 且不含认证信息、查询或片段');
  return u.toString().replace(/\/$/,'');
 }
 async function listModels(b){
  const old=state.providers.find(p=>p.id===b.id);
  const baseUrl=upstreamURL(b.baseUrl??old?.baseUrl);
  const protocol=b.protocol??old?.protocol;
  if(!['openai','anthropic'].includes(protocol))throw fail('模型列表协议无效');
  if(b.apiKey!==undefined&&(typeof b.apiKey!=='string'||b.apiKey.length>4096))throw fail('密钥格式无效');
  // Never forward a stored credential to a different destination from its saved configuration.
  if(!b.apiKey&&old?.secret&&(baseUrl!==old.baseUrl||protocol!==old.protocol))throw fail('地址或协议已改变，请重新输入 API Key 后获取模型');
  const apiKey=b.apiKey||(!b.clearKey&&old?.secret?unseal(old.secret):'');
  if(!apiKey)throw fail('请先填写 API Key，或保存服务商密钥');
  const gemini=baseUrl==='https://generativelanguage.googleapis.com/v1beta/openai';
  const endpoint=gemini?'https://generativelanguage.googleapis.com/v1beta/models':baseUrl+'/models';
  const headers=gemini?{'x-goog-api-key':apiKey}:protocol==='anthropic'?{'x-api-key':apiKey,'anthropic-version':'2023-06-01'}:{authorization:'Bearer '+apiKey};
  const models=new Map(),seen=new Set();let cursor='';
  const signal=AbortSignal.timeout(30000);
  for(let page=0;page<100;page++){
   const u=new URL(endpoint);
   if(gemini){u.searchParams.set('pageSize','1000');if(cursor)u.searchParams.set('pageToken',cursor)}
   else if(protocol==='anthropic'){u.searchParams.set('limit','1000');if(cursor)u.searchParams.set('after_id',cursor)}
   else if(cursor)u.searchParams.set('after',cursor);
   let data;
   try{
    const response=await fetcher(u.toString(),{method:'GET',headers,redirect:'error',signal});
    if(!response.ok){
     const detail=[404,405,501].includes(response.status)?'服务商不支持模型列表接口，可手动填写模型 ID':response.status===401||response.status===403?'密钥无效或没有获取模型的权限':`服务商返回 HTTP ${response.status}`;
     throw fail(detail,502);
    }
    data=await response.json();
   }catch(e){if(e.status)throw e;throw fail('获取模型失败：网络异常、超时或响应不是有效 JSON，请稍后重试',502)}
   const rows=gemini?data?.models:data?.data;
   if(!Array.isArray(rows))throw fail('服务商模型列表格式不兼容，可手动填写模型 ID',502);
   for(const m of rows){
    const id=gemini?m?.name?.replace(/^models\//,''):m?.id;
    if(typeof id!=='string'||!id||id.length>200)throw fail('服务商返回了无效模型 ID',502);
    models.set(id,{id,name:typeof(m.display_name??m.displayName)==='string'?(m.display_name??m.displayName):id});
   }
   const next=gemini?data.nextPageToken:data.has_more?(data.last_id||rows.at(-1)?.id):'';
   if(!next&&!(!gemini&&data.has_more))return {object:'list',data:[...models.values()].sort((a,b)=>a.id.localeCompare(b.id)),fetchedAt:new Date().toISOString()};
   if(typeof next!=='string'||!next||seen.has(next))throw fail('服务商分页游标异常，未能获取完整模型列表',502);
   seen.add(next);cursor=next;
  }
  throw fail('模型列表超过 100 页，未能获取完整列表',502);
 }
 let inFlight=0;let windowStart=Date.now(),windowUsed=0;
 async function route(input,{signal:clientSignal,onChunk,apiKeyId}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('请求格式错误');
  if(input.stream!==undefined&&typeof input.stream!=='boolean')throw fail('stream 必须为布尔值');
  if(Date.now()-windowStart>=60000){windowStart=Date.now();windowUsed=0;}
  if(++windowUsed>state.routing.requestsPerMinute)throw fail('每分钟请求数已达上限',429);
  if(inFlight>=state.routing.concurrency)throw fail('并发请求已满',429);
  if(!Array.isArray(input.messages)||!input.messages.length||input.messages.length>100||input.messages.some(m=>!m||!['user','assistant','system'].includes(m.role)||typeof m.content!=='string'))throw fail('messages 仅支持 user / assistant / system 文本消息');
  if(input.temperature!==undefined&&(!Number.isFinite(input.temperature)||input.temperature<0||input.temperature>2))throw fail('temperature 需在 0–2 之间');
  if(input.max_tokens!==undefined&&(!Number.isInteger(input.max_tokens)||input.max_tokens<1||input.max_tokens>131072))throw fail('max_tokens 无效');
  if(input.upstream_model!==undefined&&(typeof input.upstream_model!=='string'||!input.model||input.model==='auto'))throw fail('指定模型需要同时指定服务商路由 ID');
  const explicit=input.model&&input.model!=='auto';
  let candidates=selectRoutes(state,input,{sequence:sequence++});
  thinkingOptions(candidates[0],input.thinking_mode);
  candidates=candidates.filter(p=>{try{thinkingOptions(p,input.thinking_mode);return true;}catch{return false;}});
  if(input.messages.some(m=>m.reasoning_content!==undefined&&typeof m.reasoning_content!=='string'))throw fail('reasoning_content 必须为文本');
  if(apiKeyId)apiKeys.admit(apiKeyId);
  let succeeded=false,usedTokens=0;
  inFlight++;const timeout=AbortSignal.timeout(state.routing.timeoutMs);const signal=clientSignal?AbortSignal.any([clientSignal,timeout]):timeout;let committed=false;
  try{
  for(const p of candidates){
   const started=Date.now();let status=502;
   try{
    const headers={'content-type':'application/json'};
    let payload={...thinkingOptions(p,input.thinking_mode,input.max_tokens),model:p.model,messages:input.messages,stream:!!input.stream,...(input.temperature!==undefined?{temperature:input.temperature}:{}),...(input.max_tokens!==undefined?{max_tokens:input.max_tokens}:{})};
    if(p.protocol==='anthropic'){
     headers['x-api-key']=unseal(p.secret);headers['anthropic-version']='2023-06-01';
     payload={...payload,max_tokens:input.max_tokens||2048,system:input.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages:input.messages.filter(m=>m.role!=='system').map(({role,content})=>({role,content}))};
    }else headers.authorization='Bearer '+unseal(p.secret);
    const resp=await fetcher(p.baseUrl+(p.protocol==='anthropic'?'/messages':'/chat/completions'),{method:'POST',headers,body:JSON.stringify(payload),signal,redirect:'error'});
    status=resp.status;
    if(!resp.ok)throw fail(`上游返回 HTTP ${status}`,status);
    if(input.stream){
     const tokens=await consumeSSE(resp,p.protocol,p.model,async chunk=>{assertThinkingDisabled(input,chunk.choices?.[0]?.delta);committed=true;await onChunk(chunk);},signal);
     state.logs.unshift({id:randomBytes(6).toString('hex'),time:new Date().toISOString(),apiKeyId:apiKeyId||null,providerId:p.id,reason:p.routeReason,provider:p.name,model:p.model,status:200,latency:Date.now()-started,tokens});state.logs=state.logs.slice(0,500);save();
     succeeded=true;usedTokens=tokens;return {provider:p.id};
    }
    let data=await resp.json();
    if(p.protocol==='anthropic')data={id:data.id,object:'chat.completion',created:Math.floor(Date.now()/1000),model:data.model,choices:[{index:0,message:{role:'assistant',content:(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''),reasoning_content:(data.content||[]).filter(c=>c.type==='thinking').map(c=>c.thinking||'').join('')},finish_reason:data.stop_reason==='max_tokens'?'length':'stop'}],usage:{prompt_tokens:data.usage?.input_tokens||0,completion_tokens:data.usage?.output_tokens||0,total_tokens:(data.usage?.input_tokens||0)+(data.usage?.output_tokens||0)}};
    if(!Array.isArray(data.choices))throw fail('上游响应格式错误',502);
    for(const choice of data.choices)assertThinkingDisabled(input,choice.message);
    state.logs.unshift({id:randomBytes(6).toString('hex'),time:new Date().toISOString(),apiKeyId:apiKeyId||null,providerId:p.id,reason:p.routeReason,provider:p.name,model:p.model,status:200,latency:Date.now()-started,tokens:data.usage?.total_tokens||0});state.logs=state.logs.slice(0,500);save();
    succeeded=true;usedTokens=data.usage?.total_tokens||0;return {data,provider:p.id};
   }catch(e){
    state.logs.unshift({id:randomBytes(6).toString('hex'),time:new Date().toISOString(),apiKeyId:apiKeyId||null,providerId:p.id,reason:p.routeReason,provider:p.name,model:p.model,status:e.status||502,latency:Date.now()-started,tokens:0});state.logs=state.logs.slice(0,500);save();
    if(e.status===422)throw e;
    if(committed||signal.aborted||explicit||![401,403,408,429,500,502,503,504,529].includes(e.status||502))throw fail(`服务商 ${p.name} 调用失败（${e.status||502}），请检查模型与配置`,502);
   }
  }
  throw fail('所有候选服务商均调用失败，请查看请求日志',502);
  }finally{inFlight--;if(apiKeyId){try{apiKeys.complete(apiKeyId,succeeded,usedTokens);}catch{console.error('API Key usage persistence failed');}}}
 }
 function identity(token){if(equal(token,admin))return {admin:true};if(apiKeys.state.legacyEnabled&&equal(token,gateway))return {legacy:true};return {apiKeyId:apiKeys.authenticate(token)};}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/healthz')return json(res,200,{ok:true});
   if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/')){
    const token=req.headers.authorization?.replace(/^Bearer /,'');
    const caller=identity(token);
    if(url.pathname.startsWith('/api/')&&!caller.admin)throw fail('需要管理员权限',403);
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)throw fail('跨域请求被拒绝',403);
    if(req.method==='GET'&&url.pathname==='/api/keys')return json(res,200,apiKeys.list());
    if(req.method==='POST'&&url.pathname==='/api/keys')return json(res,201,apiKeys.create(await body(req)));
    if(req.method==='POST'&&url.pathname==='/api/keys/update'){const b=await body(req);return json(res,200,apiKeys.update(b.id,b));}
    if(req.method==='POST'&&url.pathname==='/api/keys/toggle'){const b=await body(req);return json(res,200,apiKeys.toggle(b.id,b.enabled));}
    if(req.method==='POST'&&url.pathname==='/api/keys/legacy'){const b=await body(req);return json(res,200,apiKeys.legacy(b.enabled));}
    if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,safe());
    if(req.method==='GET'&&url.pathname==='/v1/models')return json(res,200,{object:'list',data:[{id:'auto',object:'model',owned_by:'router'},...state.providers.filter(p=>p.enabled&&p.secret&&p.model).map(p=>({id:p.id,object:'model',owned_by:p.name}))]});
    if(req.method==='POST'&&url.pathname==='/api/provider/models')return json(res,200,await listModels(await body(req)));
    if(req.method==='POST'&&url.pathname==='/api/provider'){
     const b=await body(req);if(!/^[a-z0-9-]{1,40}$/.test(b.id||''))throw fail('ID 仅限小写字母、数字和连字符');
     const baseUrl=upstreamURL(b.baseUrl);
     if(!['openai','anthropic'].includes(b.protocol)||typeof b.model!=='string'||b.model.length>200||typeof b.name!=='string'||!b.name.trim()||b.name.length>60||!Number.isFinite(b.priority)||b.priority<0||b.priority>100)throw fail('配置字段无效');
     const old=state.providers.find(p=>p.id===b.id);if(!old&&state.providers.length>=30)throw fail('最多 30 个服务商');
     if(b.apiKey!==undefined&&(typeof b.apiKey!=='string'||b.apiKey.length>4096))throw fail('密钥格式无效');
     const entries=b.models??old?.models??[];
     if(!Array.isArray(entries)||entries.length>500||entries.some(m=>typeof m!=='string'||!m.trim()||m.length>200))throw fail('模型列表最多 500 个，每个模型 ID 长度为 1–200');
     const models=[...new Set([...entries.map(m=>m.trim()),...(b.model.trim()?[b.model.trim()]:[])])];
     const weight=b.weight??old?.weight??1;if(!Number.isInteger(weight)||weight<1||weight>100)throw fail('权重需为 1–100 的整数');
     const p={weight,models,id:b.id,name:b.name,baseUrl,model:b.model.trim(),protocol:b.protocol,priority:b.priority,enabled:!!b.enabled,secret:b.clearKey?undefined:b.apiKey?seal(b.apiKey):old?.secret};
     if(p.enabled&&(!p.model||!p.secret))throw fail('启用前请填写模型 ID 和 API Key');
     if(state.rules.some(r=>r.providerId===p.id&&!p.models.includes(r.model)))throw fail('模型仍被规则引用，请先修改规则');
     if(old)state.providers[state.providers.indexOf(old)]=p;else state.providers.push(p);if(!state.active&&p.enabled)state.active=p.id;save();return json(res,200,safe());
    }
    if(req.method==='POST'&&url.pathname==='/api/provider/switch-model'){
     const b=await body(req),p=state.providers.find(p=>p.id===b.id);
     if(!p||!p.models.includes(b.model))throw fail('请选择该服务商已保存的模型');
     p.model=b.model;save();return json(res,200,safe());
    }
    if(req.method==='POST'&&url.pathname==='/api/routing'){
     const b=await body(req);Object.assign(state,validateRouting({...b,rules:b.rules??state.rules,routing:b.routing??state.routing},state.providers));save();return json(res,200,safe());
    }
    if(req.method==='POST'&&['/v1/chat/completions','/api/chat'].includes(url.pathname)){
     const input=await body(req),abort=new AbortController();
     res.on('close',()=>{if(!res.writableEnded)abort.abort();});
     const out=await route(input,{apiKeyId:caller.apiKeyId,signal:abort.signal,onChunk:async chunk=>{
      if(!res.headersSent)res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform','x-accel-buffering':'no'});
      await writeSSE(res,chunk,abort.signal);
     }});
     if(input.stream){await writeSSE(res,'[DONE]',abort.signal);res.end();return;}
     res.setHeader('x-router-provider',out.provider);return json(res,200,out.data);
    }
    throw fail('接口不存在',404);
   }
   const files={'/':'index.html','/app.js':'app.js','/routing.js':'routing.js','/playground.js':'playground.js','/thinking-capability.js':'thinking-capability.js','/api-keys.js':'api-keys.js','/stream-client.js':'stream-client.js','/style.css':'style.css'};
   if(req.method!=='GET'||!files[url.pathname])throw fail('页面不存在',404);
   const f=files[url.pathname];res.setHeader('content-type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(path.join(root,'public',f)));
  }catch(e){if(res.headersSent){if(!res.destroyed)res.end('event: error\ndata: '+JSON.stringify({error:{message:e.status===422?e.message:'流式响应中断'}})+'\n\n');return;}json(res,e.status||500,{error:{message:e.status?e.message:'服务器内部错误',type:'router_error'}})}
 });
 installWebSocket(server,{authenticate:token=>{try{return identity(token);}catch{return false;}},execute:(input,options)=>{const caller=identity(options.token);return route(input,{...options,apiKeyId:caller.apiKeyId});},originAllowed:(origin,host)=>!origin||origin===`https://${host}`||origin===`http://${host}`||(process.env.WS_ALLOWED_ORIGINS||'').split(',').includes(origin)});
 return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=createApp();
 app.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1',()=>console.log(`Switchboard listening on port ${process.env.PORT||3000}`));
 for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>{
  app.close(()=>process.exit(0));setTimeout(()=>process.exit(0),35000).unref();
 });
}
