// Local smoke test. --live sends one short, potentially billable generation.
const base=(process.env.SWITCHBOARD_URL||'http://127.0.0.1:3100').replace(/\/$/,'');
const token=process.env.SWITCHBOARD_TOKEN;
const session=process.env.SWITCHBOARD_SESSION;
const live=process.argv.includes('--live');
const model=process.env.SMOKE_MODEL||'auto';
const headers={'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})};

if(!token&&!session)throw Error('Set SWITCHBOARD_TOKEN or SWITCHBOARD_SESSION before running the smoke test');
const request=async(path,options={})=>{
 const response=await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(45000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(`${path}: HTTP ${response.status} ${data?.error?.message||''}`);
 return {response,data};
};

const ready=await fetch(base+'/readyz',{signal:AbortSignal.timeout(5000)});
if(!ready.ok)throw Error(`readiness: HTTP ${ready.status}`);
if(session)headers.cookie=`sr_session=${session}`;
const models=(await request('/v1/models')).data;
if(!Array.isArray(models?.data))throw Error('model discovery returned an invalid list');
const result={ready:true,callableModels:models.data.length,live:false};
if(session){const preview=(await request('/api/routing/preview',{method:'POST',body:JSON.stringify({model,prompt:'smoke test'})})).data;if(!Array.isArray(preview?.candidates))throw Error('routing preview returned an invalid candidate list');result.strategy=preview.strategy;result.candidates=preview.total;}
if(live){
 const {response,data}=await request('/v1/chat/completions',{method:'POST',body:JSON.stringify({model,messages:[{role:'user',content:'请只回复 OK'}],max_tokens:32,stream:false})});
 if(!Array.isArray(data?.choices)||!data.choices[0]?.message)throw Error('generation returned no assistant message');
 result.live=true;
 result.actualProvider=decodeURIComponent(response.headers.get('x-router-provider')||'');
 result.actualModel=decodeURIComponent(response.headers.get('x-router-model')||'');
 result.attempt=Number(response.headers.get('x-router-attempt')||0);
 result.requestId=response.headers.get('x-request-id');
 result.hasOutput=Boolean(data.choices[0].message.content||data.choices[0].message.tool_calls?.length);
 if(!result.hasOutput)throw Error('generation returned an empty assistant message');
}
console.log(JSON.stringify(result));
