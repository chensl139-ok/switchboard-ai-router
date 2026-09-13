import {randomUUID} from 'node:crypto';
export const NORMALIZED=Symbol('normalized request');
export const generationPaths={'/api/chat':'chat','/v1/chat/completions':'chat','/v1/completions':'completions','/v1/responses':'responses','/v1/messages':'messages'};
export const protocolError=(message,status=400)=>Object.assign(new Error(message),{status});
export function apiToken(headers){
 const auth=headers.authorization,key=headers['x-api-key'];let bearer='';
 if(auth){if(typeof auth!=='string'||!/^Bearer\s+\S+$/i.test(auth))throw protocolError('Authorization 必须为 Bearer API_KEY',401);bearer=auth.replace(/^Bearer\s+/i,'');}
 if(key!==undefined&&(typeof key!=='string'||!key.trim()))throw protocolError('x-api-key 格式无效',401);
 if(key&&bearer&&key!==bearer)throw protocolError('两个鉴权头包含不同的 API Key',401);
 return bearer||key||'';
}
function text(value,label='文本'){if(typeof value!=='string')throw protocolError(label+'必须为字符串');return value;}
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw protocolError(label+'必须为对象');return value;}
function imageURL(value){
 text(value,'图片地址');
 if(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value))return value;
 let u;try{u=new URL(value);}catch{throw protocolError('图片需为 HTTP(S) URL 或 PNG/JPEG/GIF/WebP Base64');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw protocolError('图片 URL 无效');return value;
}
export function contentParts(value){
 if(typeof value==='string')return [{type:'text',text:value}];
 if(value===null||value===undefined)return [];
 if(!Array.isArray(value))throw protocolError('content 必须为文本或内容块数组');
 return value.map(part=>{
  object(part,'内容块');
  if(['text','input_text','output_text'].includes(part.type))return {type:'text',text:text(part.text)};
  if(part.type==='image_url')return {type:'image_url',image_url:{url:imageURL(part.image_url?.url),...(part.image_url?.detail?{detail:part.image_url.detail}:{})}};
  if(part.type==='input_image')return {type:'image_url',image_url:{url:imageURL(part.image_url),...(part.detail?{detail:part.detail}:{})}};
  if(part.type==='image'){
   const source=object(part.source,'图片 source');
   const url=source.type==='url'?source.url:source.type==='base64'?`data:${source.media_type};base64,${source.data}`:null;
   return {type:'image_url',image_url:{url:imageURL(url)}};
  }
  throw protocolError('不支持的内容块：'+part.type+'；当前支持文本与图片输入');
 });
}
const compact=value=>typeof value==='string'?value:contentParts(value);
export function plainText(value){return contentParts(value).filter(p=>p.type==='text').map(p=>p.text).join('\n');}
function toolCall(call){object(call,'tool_call');if(call.type&&call.type!=='function')throw protocolError('仅支持 function 工具');return {id:text(call.id,'工具 ID'),type:'function',function:{name:text(call.function?.name,'工具名称'),arguments:text(call.function?.arguments,'工具参数')}};}
function chatMessages(value){
 if(!Array.isArray(value)||!value.length||value.length>100)throw protocolError('messages 需为 1–100 条消息');
 return value.map(m=>{
  object(m,'消息');const role=m.role==='developer'?'system':m.role;
  if(!['system','user','assistant','tool'].includes(role))throw protocolError('消息角色无效');
  const out={role,content:compact(m.content??'')};
  if(m.tool_calls){if(role!=='assistant'||!Array.isArray(m.tool_calls))throw protocolError('工具调用只能出现在 assistant 消息');out.tool_calls=m.tool_calls.map(toolCall);}
  if(role==='tool')out.tool_call_id=text(m.tool_call_id,'工具结果 ID');
  if(m.reasoning_content!==undefined)out.reasoning_content=text(m.reasoning_content);
  if(m._thinkingBlocks){if(!Array.isArray(m._thinkingBlocks)||m._thinkingBlocks.some(p=>!p||!['thinking','redacted_thinking'].includes(p.type)))throw protocolError('thinking 历史块格式无效');out._thinkingBlocks=m._thinkingBlocks;}
  if(m._toolError)out._toolError=true;
  return out;
 });
}
function anthropicMessages(value,system){
 if(!Array.isArray(value)||!value.length)throw protocolError('messages 不能为空');const messages=[];
 if(system!==undefined)messages.push({role:'system',content:plainText(system)});
 for(const m of value){
  if(!['user','assistant'].includes(m.role))throw protocolError('Anthropic 消息角色只能为 user/assistant');
  if(typeof m.content==='string'){messages.push({role:m.role,content:m.content});continue;}
  if(!Array.isArray(m.content))throw protocolError('content 格式无效');
  const normal=[],calls=[],thinking=[];
  for(const part of m.content){
   if(part.type==='tool_use'){if(m.role!=='assistant')throw protocolError('tool_use 需要 assistant 角色');calls.push({id:text(part.id),type:'function',function:{name:text(part.name),arguments:JSON.stringify(object(part.input,'工具输入'))}});}
   else if(part.type==='tool_result'){if(m.role!=='user')throw protocolError('tool_result 需要 user 角色');messages.push({role:'tool',tool_call_id:text(part.tool_use_id),content:compact(part.content??''),_toolError:!!part.is_error});}
   else if(['thinking','redacted_thinking'].includes(part.type)){if(m.role!=='assistant')throw protocolError('thinking 需要 assistant 角色');thinking.push(part);}
   else normal.push(...contentParts([part]));
  }
  if(normal.length||calls.length||thinking.length)messages.push({role:m.role,content:normal,...(calls.length?{tool_calls:calls}:{}),...(thinking.length?{_thinkingBlocks:thinking}: {})});
 }
 return messages;
}
function responsesMessages(value){
 if(typeof value==='string')return [{role:'user',content:value}];
 if(!Array.isArray(value)||!value.length)throw protocolError('Responses input 需为文本或输入数组');
 const messages=[];
 for(const item of value){
  if(item.type==='function_call')messages.push({role:'assistant',content:'',tool_calls:[{id:text(item.call_id),type:'function',function:{name:text(item.name),arguments:text(item.arguments)}}]});
  else if(item.type==='function_call_output')messages.push({role:'tool',tool_call_id:text(item.call_id),content:compact(item.output)});
  else if(!item.type||item.type==='message')messages.push(...chatMessages([item]));
  else throw protocolError('当前不支持的 Responses 输入项：'+item.type);
 }
 return messages;
}
function tools(value,kind){
 if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>128)throw protocolError('tools 最多 128 个');
 return value.map(t=>{object(t,'工具');let fn=kind==='messages'?{name:t.name,description:t.description,parameters:t.input_schema,strict:t.strict}:kind==='responses'?t:t.function;
  if(kind!=='messages'&&t.type!=='function'||kind==='messages'&&t.type&&t.type!=='custom')throw protocolError('仅支持调用方执行的 function 工具，不支持内置工具');
  object(fn,'function');if(typeof fn.name!=='string'||!fn.name||fn.name.length>128)throw protocolError('工具名称无效');
  return {type:'function',function:{name:fn.name,...(fn.description!==undefined?{description:text(fn.description)}:{}),parameters:object(fn.parameters||{type:'object',properties:{}},'工具 schema'),...(fn.strict!==undefined?{strict:!!fn.strict}:{})}};
 });
}
function choice(value,kind){
 if(value===undefined)return undefined;
 if(kind==='messages')value=value.type==='tool'?{type:'function',function:{name:value.name}}:({any:'required',auto:'auto',none:'none'}[value.type]);
 else if(kind==='responses'&&value?.type==='function')value={type:'function',function:{name:value.name}};
 if(['none','auto','required'].includes(value))return value;
 if(value?.type==='function'&&typeof value.function?.name==='string')return value;
 throw protocolError('tool_choice 不支持');
}
export function normalizeRequest(kind,raw){
 if(raw?.[NORMALIZED])return raw;object(raw,'请求');
 for(const field of ['audio','modalities','web_search_options','functions','function_call','response_format','logprobs','top_logprobs','reasoning','reasoning_effort'])if(raw[field]!==undefined&&raw[field]!==null)throw protocolError(`当前不支持 ${field}，请移除该参数`);
 if(raw.text?.format&&raw.text.format.type!=='text')throw protocolError('当前不支持 Responses text.format 结构化输出');
 if(raw.previous_response_id||raw.conversation||raw.background||raw.store===true)throw protocolError('Responses 当前为无状态接口，不支持 previous_response_id/conversation/background/store=true');
 if(raw.n!==undefined&&raw.n!==1||raw.best_of!==undefined&&raw.best_of!==1||raw.echo)throw protocolError('当前仅支持单个生成结果，不支持 best_of/echo');
 const input={[NORMALIZED]:true,model:raw.model||'auto',stream:raw.stream??false,max_tokens:raw.max_tokens??raw.max_completion_tokens??raw.max_output_tokens??2048};
 if(typeof input.model!=='string'||input.model.length>300)throw protocolError('模型 ID 无效');
 if(kind==='messages'&&raw.max_tokens===undefined)throw protocolError('Anthropic Messages 需要 max_tokens');
 input.messages=kind==='messages'?anthropicMessages(raw.messages,raw.system):kind==='responses'?responsesMessages(raw.input):kind==='completions'?[{role:'user',content:text(raw.prompt,'prompt')}]:chatMessages(raw.messages);
 if(kind==='responses'&&raw.instructions!==undefined)input.messages.unshift({role:'system',content:text(raw.instructions,'instructions')});
 input.messages=chatMessages(input.messages);
 if(raw.max_completion_tokens!==undefined)input._maxCompletionTokens=true;
 if(raw.upstream_model!==undefined)input.upstream_model=text(raw.upstream_model);
 for(const field of ['temperature','top_p','thinking_mode'])if(raw[field]!==undefined)input[field]=raw[field];
 const stop=raw.stop??raw.stop_sequences;if(stop!==undefined){const values=typeof stop==='string'?[stop]:stop;if(!Array.isArray(values)||values.length>4||values.some(s=>typeof s!=='string'||!s||s.length>1000))throw protocolError('stop 最多四个非空字符串');input.stop=values;}
 if(raw.thinking!==undefined){if(kind!=='messages'||!['enabled','disabled'].includes(raw.thinking?.type))throw protocolError('thinking 格式不支持');input.thinking_mode=raw.thinking.type;input._nativeThinking=raw.thinking;if(raw.thinking.type==='enabled'&&(!Number.isInteger(raw.thinking.budget_tokens)||raw.thinking.budget_tokens<1024||raw.thinking.budget_tokens>=input.max_tokens))throw protocolError('thinking budget_tokens 需至少 1024 且小于 max_tokens');}
 if(kind==='completions'&&raw.tools?.length)throw protocolError('传统 Completions 不支持 tools');
 input.tools=tools(raw.tools,kind);input.tool_choice=choice(raw.tool_choice,kind);
 if(raw.parallel_tool_calls!==undefined){if(typeof raw.parallel_tool_calls!=='boolean')throw protocolError('parallel_tool_calls 必须为布尔值');input.parallel_tool_calls=raw.parallel_tool_calls;}
 if(kind==='messages'&&raw.tool_choice?.disable_parallel_tool_use!==undefined)input.parallel_tool_calls=!raw.tool_choice.disable_parallel_tool_use;
 if(input.top_p!==undefined&&(!Number.isFinite(input.top_p)||input.top_p<0||input.top_p>1))throw protocolError('top_p 需在 0–1 之间');
 return input;
}
function imageSource(part){const url=part.image_url.url;const match=/^data:([^;]+);base64,(.*)$/s.exec(url);return match?{type:'base64',media_type:match[1],data:match[2]}:{type:'url',url};}
export function anthropicPayload(input,model){
 const system=input.messages.filter(m=>m.role==='system').map(m=>plainText(m.content)).join('\n'),messages=[];
 for(const m of input.messages){if(m.role==='system')continue;const role=m.role==='tool'?'user':m.role;
  let content=m.role==='tool'?[{type:'tool_result',tool_use_id:m.tool_call_id,content:contentParts(m.content).map(p=>p.type==='text'?p:{type:'image',source:imageSource(p)}),...(m._toolError?{is_error:true}:{})}]:[
   ...(m._thinkingBlocks||[]),...contentParts(m.content).map(p=>p.type==='text'?p:{type:'image',source:imageSource(p)}),
   ...(m.tool_calls||[]).map(t=>{let data;try{data=JSON.parse(t.function.arguments);}catch{throw protocolError('转换为 Anthropic 时工具参数必须为有效 JSON');}return {type:'tool_use',id:t.id,name:t.function.name,input:data};})];
  if(!content.length)content=[{type:'text',text:''}];if(messages.at(-1)?.role===role)messages.at(-1).content.push(...content);else messages.push({role,content});
 }
 const payload={model,messages,max_tokens:input.max_tokens,stream:input.stream,...(system?{system}:{})};
 for(const k of ['temperature','top_p'])if(input[k]!==undefined)payload[k]=input[k];if(input.stop)payload.stop_sequences=input.stop;
 if(input._nativeThinking)payload.thinking=input._nativeThinking;
 if(input.tools?.length)payload.tools=input.tools.map(t=>({name:t.function.name,description:t.function.description,input_schema:t.function.parameters,...(t.function.strict!==undefined?{strict:t.function.strict}:{})}));
 if(input.tool_choice)payload.tool_choice=typeof input.tool_choice==='string'?{type:{required:'any',auto:'auto',none:'none'}[input.tool_choice]}:{type:'tool',name:input.tool_choice.function.name};
 if(input.parallel_tool_calls===false&&payload.tools)payload.tool_choice={...(payload.tool_choice||{type:'auto'}),disable_parallel_tool_use:true};return payload;
}
export function responsesPayload(input,model){
 if(input.stop)throw protocolError('Responses 上游不支持 stop 参数');
 const items=[];for(const m of input.messages){
  if(m.role==='tool'){items.push({type:'function_call_output',call_id:m.tool_call_id,output:typeof m.content==='string'?m.content:contentParts(m.content).map(p=>p.type==='text'?{type:'input_text',text:p.text}:{type:'input_image',image_url:p.image_url.url})});continue;}
  const parts=contentParts(m.content).map(p=>p.type==='text'?{type:m.role==='assistant'?'output_text':'input_text',text:p.text}:{type:'input_image',image_url:p.image_url.url,...(p.image_url.detail?{detail:p.image_url.detail}:{})});
  if(parts.length)items.push({role:m.role,content:parts});for(const t of m.tool_calls||[])items.push({type:'function_call',call_id:t.id,name:t.function.name,arguments:t.function.arguments});
 }
 const p={model,input:items,max_output_tokens:input.max_tokens,stream:input.stream,store:false};for(const k of ['temperature','top_p','parallel_tool_calls'])if(input[k]!==undefined)p[k]=input[k];
 if(input.tools?.length)p.tools=input.tools.map(t=>({type:'function',...t.function}));
 if(input.tool_choice)p.tool_choice=typeof input.tool_choice==='string'?input.tool_choice:{type:'function',name:input.tool_choice.function.name};return p;
}
export function chatPayload(input,model){
 const messages=input.messages.map(({_thinkingBlocks,_toolError,...m})=>{if(m.role==='tool'&&contentParts(m.content).some(p=>p.type==='image_url'))throw protocolError('Chat Completions 上游不支持图片型工具结果，请选择 Responses 或 Anthropic 上游');return m;});
 const p={model,messages,stream:input.stream,...(input._maxCompletionTokens?{max_completion_tokens:input.max_tokens}:{max_tokens:input.max_tokens})};for(const k of ['temperature','top_p','stop','tools','tool_choice','parallel_tool_calls'])if(input[k]!==undefined)p[k]=input[k];if(input.stream)p.stream_options={include_usage:true};return p;
}
export function toChatResponse(raw,protocol,model){
 if(protocol==='anthropic')return {id:raw.id,object:'chat.completion',created:Math.floor(Date.now()/1000),model:raw.model||model,choices:[{index:0,message:{role:'assistant',content:(raw.content||[]).filter(p=>p.type==='text').map(p=>p.text).join(''),reasoning_content:(raw.content||[]).filter(p=>p.type==='thinking').map(p=>p.thinking||'').join(''),...((raw.content||[]).some(p=>p.type==='tool_use')?{tool_calls:raw.content.filter(p=>p.type==='tool_use').map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:JSON.stringify(t.input)}}))}:{})},finish_reason:raw.stop_reason==='tool_use'?'tool_calls':raw.stop_reason==='max_tokens'?'length':'stop'}],usage:{prompt_tokens_details:{cached_tokens:raw.usage?.cache_read_input_tokens||0,cache_creation_tokens:raw.usage?.cache_creation_input_tokens||0},prompt_tokens:(raw.usage?.input_tokens||0)+(raw.usage?.cache_read_input_tokens||0)+(raw.usage?.cache_creation_input_tokens||0),completion_tokens:raw.usage?.output_tokens||0,total_tokens:(raw.usage?.input_tokens||0)+(raw.usage?.output_tokens||0)+(raw.usage?.cache_read_input_tokens||0)+(raw.usage?.cache_creation_input_tokens||0)}};
 if(protocol==='responses'){
  if(raw.error||raw.status==='failed'||!Array.isArray(raw.output))throw protocolError('Responses 上游生成失败',502);
  const calls=raw.output.filter(i=>i.type==='function_call').map(i=>({id:i.call_id,type:'function',function:{name:i.name,arguments:i.arguments}}));
  return {id:raw.id,object:'chat.completion',created:raw.created_at,model:raw.model||model,choices:[{index:0,message:{role:'assistant',content:raw.output.filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join(''),reasoning_content:raw.output.filter(i=>i.type==='reasoning').flatMap(i=>i.summary||[]).map(s=>s.text||'').join(''),...(calls.length?{tool_calls:calls}:{})},finish_reason:calls.length?'tool_calls':raw.status==='incomplete'?'length':'stop'}],usage:{prompt_tokens_details:raw.usage?.input_tokens_details,prompt_tokens:raw.usage?.input_tokens||0,completion_tokens:raw.usage?.output_tokens||0,total_tokens:raw.usage?.total_tokens||0}};
 }
 return {...raw,id:raw.id||'chatcmpl-'+randomUUID(),object:'chat.completion',created:raw.created||Math.floor(Date.now()/1000),model:raw.model||model};
}
export function clientResponse(kind,data,ids={}){
 const message=data.choices?.[0]?.message||{},finish=data.choices?.[0]?.finish_reason||'stop',usage=data.usage||{};
 if(kind==='chat')return data;
 if(kind==='completions'){if(message.tool_calls?.length)throw protocolError('传统 Completions 不支持工具调用',400);return {id:ids.id||data.id,object:'text_completion',created:data.created,model:data.model,choices:[{index:0,text:message.content||'',finish_reason:finish,logprobs:null}],usage};}
 if(kind==='messages')return {id:ids.id||'msg_'+randomUUID(),type:'message',role:'assistant',model:data.model,content:[...(message.content?[{type:'text',text:message.content}]:[]),...(message.tool_calls||[]).map(t=>{let input;try{input=JSON.parse(t.function.arguments);}catch{throw protocolError('工具调用参数不是有效 JSON',502);}return {type:'tool_use',id:t.id,name:t.function.name,input};})],stop_reason:finish==='tool_calls'?'tool_use':finish==='length'?'max_tokens':'end_turn',stop_sequence:null,usage:{input_tokens:usage.prompt_tokens||0,output_tokens:usage.completion_tokens||0}};
 const output=[];if(message.content||!message.tool_calls?.length||ids.forceMessage)output.push({id:ids.messageId||'msg_'+randomUUID(),type:'message',role:'assistant',status:finish==='length'?'incomplete':'completed',content:[{type:'output_text',text:message.content||'',annotations:[],logprobs:[]}]});
 for(const [index,t] of (message.tool_calls||[]).entries())output.push({id:ids.toolIds?.[index]||'fc_'+randomUUID(),type:'function_call',call_id:t.id,name:t.function.name,arguments:t.function.arguments,status:'completed'});
 return {id:ids.id||'resp_'+randomUUID(),object:'response',created_at:data.created||Math.floor(Date.now()/1000),model:data.model,status:finish==='length'?'incomplete':'completed',output,error:null,incomplete_details:finish==='length'?{reason:'max_output_tokens'}:null,store:false,tools:[],tool_choice:'auto',parallel_tool_calls:false,metadata:{},usage:{input_tokens:usage.prompt_tokens||0,output_tokens:usage.completion_tokens||0,total_tokens:usage.total_tokens||0,input_tokens_details:{cached_tokens:usage.prompt_tokens_details?.cached_tokens||0},output_tokens_details:{reasoning_tokens:0}}};
}
export function clientError(kind,error){const status=error.status||500;const message=error.status?error.message:'服务器内部错误';const type=status===401?'authentication_error':status===403?'permission_error':status===429?'rate_limit_error':status<500?'invalid_request_error':'api_error';return kind==='messages'?{type:'error',error:{type,message}}:{error:{type,message,code:status}};}
