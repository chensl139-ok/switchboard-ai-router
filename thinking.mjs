const fail=message=>Object.assign(new Error(message),{status:400});
export function thinkingOptions(provider,mode='auto',maxTokens=2048){
 if(!['auto','enabled','disabled'].includes(mode))throw fail('thinking_mode 必须为 auto、enabled 或 disabled');
 if(mode==='auto')return {};
 const host=new URL(provider.baseUrl).hostname;
 if(['api.siliconflow.cn','api.siliconflow.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com'].includes(host))return {enable_thinking:mode==='enabled'};
 if(host==='api.deepseek.com')return {thinking:{type:mode}};
 // Other platforms can still return reasoning with their model default; do not pretend a toggle worked.
 throw fail('该服务商暂未适配思考开关，请选择“模型默认”；隐藏思考内容不受影响');
}
