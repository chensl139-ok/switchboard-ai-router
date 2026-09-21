import {anthropicPayload,responsesPayload,chatPayload} from './protocols.mjs';
import {thinkingOptions} from './thinking.mjs';

export function createUpstreamAdapter({unseal}){
 function payloadFor(provider,input){
  let extra={};
  if(!(provider.protocol==='anthropic'&&input._nativeThinking)){
   if(input._nativeThinking?.budget_tokens&&provider.protocol!=='anthropic')throw Object.assign(Error('指定 Anthropic 思考预算需要 Anthropic 上游'),{status:400});
   extra=thinkingOptions(provider,input.thinking_mode);
  }
  if(provider.protocol==='anthropic')return anthropicPayload(input,provider.model);
  if(provider.protocol==='responses')return responsesPayload(input,provider.model);
  return {...chatPayload(input,provider.model),...extra};
 }
 function requestFor(provider,input,signal){
  const headers={'content-type':'application/json'};
  const secret=unseal(provider.routeSecret);
  if(provider.protocol==='anthropic'){
   if(provider.anthropicAuth==='bearer')headers.authorization='Bearer '+secret;
   else headers['x-api-key']=secret;
   headers['anthropic-version']='2023-06-01';
  }else headers.authorization='Bearer '+secret;
  const endpoint=provider.protocol==='anthropic'?'/messages':provider.protocol==='responses'?'/responses':'/chat/completions';
  return {url:provider.baseUrl+endpoint,options:{method:'POST',headers,body:JSON.stringify(payloadFor(provider,input)),signal,redirect:'error'}};
 }
 return {payloadFor,requestFor};
}
