import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDecipheriv} from 'node:crypto';
import {safeFetch} from '../network.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=process.env.DATA_DIR||path.join(root,'data');
const state=JSON.parse(readFileSync(path.join(dir,'state.json'),'utf8'));
const provider=state.providers.find(p=>p.id==='mosi');
if(provider?.baseUrl!=='https://aigw.sotatts.online/v1'||!provider.secret)throw Error('mosi 服务商地址或密钥未就绪');
const key=readFileSync(path.join(dir,'master.key'));
const unseal=value=>{const secret=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,secret.subarray(0,12));decipher.setAuthTag(secret.subarray(-16));return Buffer.concat([decipher.update(secret.subarray(12,-16)),decipher.final()]).toString();};
const call=async(route,body,anthropic=false,channel='subscription')=>{
 const token=unseal(channel==='metered'?provider.meteredSecret:provider.secret);
 const response=await safeFetch(provider.baseUrl+route,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),authorization:'Bearer '+token,...(anthropic?{'anthropic-version':'2023-06-01'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 let data;try{data=await response.json();}catch{data=null;}
 return {status:response.status,data};
};
if(process.argv[2]==='--models'){
 const result=await call('/models');
 console.log(JSON.stringify({status:result.status,count:result.data?.data?.length||0,models:(result.data?.data||[]).map(m=>m.id),error:result.data?.error?.code||null}));
}else if(process.argv[2]==='--samples'){
 const samples=[
  ['chat','/chat/completions',{model:'deepseek-v4.1-flash',max_tokens:8,messages:[{role:'user',content:'ping'}]},false],
  ['responses','/responses',{model:'gpt-5.4',max_output_tokens:8,input:'ping'},false]
 ];
 for(const [name,route,body,anthropic] of samples){
  try{const result=await call(route,body,anthropic);console.log(JSON.stringify({protocol:name,status:result.status,valid:name==='anthropic'?Array.isArray(result.data?.content):name==='chat'?Array.isArray(result.data?.choices):Array.isArray(result.data?.output),error:result.data?.error?.code||result.data?.error?.type||null}));}
  catch(error){console.log(JSON.stringify({protocol:name,status:'network_error',error:error.message}));}
 }
}else if(process.argv[2]==='--protocols'){
 const samples=[
  ['subscription-chat','/chat/completions',{model:'deepseek-v4.1-flash',max_tokens:8,messages:[{role:'user',content:'ping'}]},false,'subscription','choices'],
  ['metered-chat','/chat/completions',{model:'deepseek-v4-flash',max_tokens:8,messages:[{role:'user',content:'ping'}]},false,'metered','choices'],
  ['metered-anthropic','/messages',{model:'claude-haiku-4-5',max_tokens:8,messages:[{role:'user',content:'ping'}]},true,'metered','content'],
  ['subscription-responses','/responses',{model:'gpt-5.4',max_output_tokens:8,input:'ping'},false,'subscription','output'],
  ['metered-responses','/responses',{model:'gpt-5.4',max_output_tokens:8,input:'ping'},false,'metered','output']
 ];
 for(const [name,route,body,anthropic,channel,field] of samples){
  try{const result=await call(route,body,anthropic,channel);console.log(JSON.stringify({sample:name,status:result.status,valid:Array.isArray(result.data?.[field]),error:result.data?.error?.code||result.data?.error?.type||result.data?.error?.message||null}));}
  catch(error){console.log(JSON.stringify({sample:name,status:'network_error',error:error.message}));}
 }
}else throw Error('用法：--models、--samples 或 --protocols');
