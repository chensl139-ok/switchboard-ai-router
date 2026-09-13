export function thinkingCapability(provider){
 const model=(provider?.model||'').split('/').at(-1).toLowerCase();
 if(/^glm-5\.3(?:[^0-9]|$)/.test(model))return {canDisable:false,forced:true,reason:'GLM-5.3 是强制思考模型，不支持关闭思考。请切换支持非思考模式的模型。'};
 let host='';try{host=new URL(provider?.baseUrl).hostname;}catch{/* Missing selection. */}
 const supported=['api.siliconflow.cn','api.siliconflow.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','api.deepseek.com'].includes(host);
 return {canDisable:supported,forced:false,reason:supported?'将向模型发送非思考模式参数；具体模型须支持。':'该服务商尚未适配思考开关，请选择模型默认，或切换已适配的服务商。'};
}
