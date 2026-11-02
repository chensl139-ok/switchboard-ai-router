// MOSS native image controls. Share validation between the form and gateway.
export function imageGenerationCapabilities(baseUrl,model=''){
 let host='';try{host=new URL(baseUrl).hostname;}catch{/* No selected provider. */}
 const moss=host==='api.mosi.cn'&&/^moss-image-(?:base|sft)-/i.test(model);
 return {moss,watermark:moss,promptEnhance:moss,advanced:moss};
}
export function validateMossImagePayload(data){
 if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>4000)throw Error('MOSS 图片提示词需为 1～4000 字符');
 if(data.negative_prompt!==undefined&&(typeof data.negative_prompt!=='string'||data.negative_prompt.length>4000))throw Error('反向提示词最多 4000 字符');
 if(data.prompt_enhance!==undefined&&typeof data.prompt_enhance!=='boolean')throw Error('prompt_enhance 必须为布尔值');
 if(data.output_watermark!==undefined){
  const value=data.output_watermark;
  if(!value||Array.isArray(value)||typeof value!=='object'||typeof value.enabled!=='boolean'||Object.keys(value).some(key=>key!=='enabled'))throw Error('output_watermark 需为 { enabled: true 或 false }');
 }
 if(data.size!==undefined){
  const dimensions=typeof data.size==='string'&&/^(\d+)x(\d+)$/.exec(data.size);
  if(!dimensions)throw Error('图片尺寸需为 宽x高，例如 1024x1024');
  const width=Number(dimensions[1]),height=Number(dimensions[2]);
  if([width,height].some(value=>value<256||value>2048||value%16)||width*height>2097152)throw Error('MOSS 图片每边须为 256～2048 且为 16 的倍数，总像素不超过 2097152');
 }
 if(data.n!==undefined&&data.n!==1)throw Error('MOSS 图片每次仅支持生成 1 张');
 if(data.response_format!==undefined&&data.response_format!=='url')throw Error('MOSS 图片仅支持 response_format=url');
 if(data.seed!==undefined&&(!Number.isSafeInteger(data.seed)||data.seed<0))throw Error('随机种子需为 0～9007199254740991 的整数');
 if(data.num_inference_steps!==undefined&&(!Number.isInteger(data.num_inference_steps)||data.num_inference_steps<1||data.num_inference_steps>100))throw Error('推理步数需为 1～100 的整数');
 if(data.guidance_scale!==undefined&&(typeof data.guidance_scale!=='number'||!Number.isFinite(data.guidance_scale)||data.guidance_scale<0||data.guidance_scale>10))throw Error('引导系数需为 0～10');
 return data;
}
export function buildImageOptions(capabilities,{watermark='',enhance=false,seed='',negativePrompt='',steps='',guidance=''}={}){
 if(!capabilities.moss)return {};
 if(!['','on','off'].includes(watermark))throw Error('水印选项无效');
 const options={prompt_enhance:enhance};
 if(watermark!=='')options.output_watermark={enabled:watermark==='on'};
 if(seed.trim()!=='')options.seed=Number(seed);
 if(steps.trim()!=='')options.num_inference_steps=Number(steps);
 if(guidance.trim()!=='')options.guidance_scale=Number(guidance);
 if(negativePrompt.trim())options.negative_prompt=negativePrompt.trim();
 validateMossImagePayload({prompt:'validation',...options});
 return options;
}
