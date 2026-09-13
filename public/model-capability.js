const mediaPatterns={
 image:/dall|sd-|stable[- ]?diffusion|flux|imagen|cogview|kandinsky|midjourney|recraft|playground|gpt-image|dalle|sdxl|mj|waifu|lama|controlnet|qwen[-_ ]?image|qwen2[-_]?5[-_]?vl|llava|vit|glm-4v|vision|gemini.*1\.5(?:\.[0-9])?[-_ ]?(pro|flash)?-?vision|siliconflow[-_ ]?image/i,
 speech:/tts|text.?to.?speech|speech.?to.?text|whisper|cosyvoice|moss.?tts|sovits|funaudiollm|gpt.?sovits|azure.?tts|vits|voice/i,
 transcription:/whisper|asr|stt|speech.?to.?text|audio.?transcribe|transcribe|translate/i,
 video:/video|wan|svd|i2v|t2v|sora|pika|luma|cogvideo|text.?to.?video|video.?gen|text2video/i
};

const normalize=(model='')=>String(model).toLowerCase().replace(/\s+/g,'');

export function modelCapabilities(model){
 const normalized=normalize(model);
 const image=mediaPatterns.image.test(normalized);
 const speech=mediaPatterns.speech.test(normalized);
 const transcription=mediaPatterns.transcription.test(normalized);
 const video=mediaPatterns.video.test(normalized);
 return {
  image,
  speech,
  transcription,
  video,
  mediaOnly:image||speech||transcription||video
 };
}

export function filterModelsForMediaKind(models,kind){
 if(kind==='image')return models.filter(item=>item.modelCapabilities?.image);
 if(kind==='speech')return models.filter(item=>item.modelCapabilities?.speech);
 if(kind==='transcription')return models.filter(item=>item.modelCapabilities?.transcription);
 if(kind==='video')return models.filter(item=>item.modelCapabilities?.video);
 return models;
}

