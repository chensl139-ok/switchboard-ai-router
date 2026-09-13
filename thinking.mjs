import {thinkingCapability} from './public/thinking-capability.js';
const fail=message=>Object.assign(new Error(message),{status:400});
export function thinkingOptions(provider,mode='auto'){
 if(!['auto','enabled','disabled'].includes(mode))throw fail('thinking_mode 必须为 auto、enabled 或 disabled');
 if(mode==='auto')return {};
 const capability=thinkingCapability(provider);
 if(mode==='disabled'&&!capability.canDisable)throw fail(capability.reason);
 if(capability.forced&&mode==='enabled')return {};
 const host=new URL(provider.baseUrl).hostname;
 if(['api.siliconflow.cn','api.siliconflow.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com'].includes(host))return {enable_thinking:mode==='enabled'};
 if(host==='api.deepseek.com')return {thinking:{type:mode}};
 throw fail(capability.reason);
}
export function assertThinkingDisabled(input,message){
 if(input.thinking_mode==='disabled'&&typeof message?.reasoning_content==='string'&&message.reasoning_content.trim()){
  throw Object.assign(new Error('上游未遵守关闭思考设置，已中止本次请求。请切换支持非思考模式的模型。'),{status:422});
 }
}
