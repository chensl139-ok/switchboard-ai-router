export function buildExperimentRequest(choice,prompt,maxTokens){
 if(!choice||typeof choice.providerId!=='string'||typeof choice.model!=='string')throw Error('请选择有效模型');
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>10000)throw Error('问题需为 1–10000 个字符');
 if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>131072)throw Error('最大输出 Tokens 需为 1–131072');
 return {model:choice.providerId,upstream_model:choice.model,messages:[{role:'user',content:prompt.trim()}],max_tokens:maxTokens};
}

export function experimentResult(data,elapsedMs){
 const message=data?.choices?.[0]?.message;
 if(!message||typeof message!=='object')throw Error('模型返回格式无效');
 const content=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'):'';
 return {content,reasoning:typeof message.reasoning_content==='string'?message.reasoning_content:'',toolCalls:Array.isArray(message.tool_calls)?message.tool_calls:[],elapsedMs,model:data.model||'',usage:{input:data.usage?.prompt_tokens??null,output:data.usage?.completion_tokens??null,total:data.usage?.total_tokens??null}};
}

export async function runExperiment(choice,prompt,maxTokens,{token,tenantId,signal,fetcher=fetch}={}){
 const input=buildExperimentRequest(choice,prompt,maxTokens),started=performance.now();
 const response=await fetcher('/api/chat',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{ }),...(tenantId?{'X-Tenant-ID':tenantId}:{})},body:JSON.stringify(input),signal});
 let data;try{data=await response.json();}catch{throw Error(`服务返回无效 JSON（HTTP ${response.status}）`);}
 if(!response.ok)throw Error(data?.error?.message||`调用失败（HTTP ${response.status}）`);
 return experimentResult(data,Math.round(performance.now()-started));
}
