import {imageGenerationCapabilities,validateMossImagePayload} from './public/image-generation.js';
export function validateImageGeneration(provider,payload){
 if(/^moss-image-prompt-enhancer(?:-|$)/i.test(provider.model))throw Object.assign(Error('提示词增强模型不能直接生成图片；请选择 MOSS Image Base 或 SFT 并开启提示词智能改写'),{status:400});
 const capabilities=imageGenerationCapabilities(provider.baseUrl,provider.model);
 if(capabilities.moss){
  if(payload.watermark!==undefined||payload.prompt_enhancement!==undefined)throw Object.assign(Error('MOSS 图片请使用 output_watermark.enabled 与 prompt_enhance'),{status:400});
  try{validateMossImagePayload(payload);}catch(error){throw Object.assign(error,{status:400});}
 }
 return capabilities;
}
export const mossImageErrors={
 prompt_enhancement_refused:'MOSS 提示词增强拒绝了该请求，未继续生图；请调整提示词后重试。',
 prompt_enhancement_incomplete:'MOSS 提示词增强结果不完整，未继续生图；可关闭智能改写后重试。',
 safety_guardrail_blocked:'MOSS 内容审核拦截了请求，请调整提示词后重试。',
 concurrency_limit_exceeded:'MOSS 图片生成并发已满，请等待当前任务完成。',
 rate_limit_exceeded:'MOSS 图片请求过于频繁，请稍后重试。',
 upstream_invalid_result:'MOSS 返回的图片结果不完整，请保留请求 ID 后重试。',
};
