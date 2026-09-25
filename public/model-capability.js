// 模型能力分类。
// MOSS-VL API 是单轮图片/视频理解任务，尽管模型架构属于 VLM，不能归入普通对话。
// 其他可多轮对话的视觉语言模型仍可归入 chat；能力不能只按通用 VL 字样推断。
const mediaPatterns={
 // 图片生成：仅匹配真正输出图片的模型。`image` 泛化词覆盖 gpt-image/ERNIE-Image/Z-Image/Qwen-Image 等。
 image:/image|dall|dalle|stable[-_ ]?diffusion|sdxl|sd[-_ ]?(1\.5|xl|3|turbo)|flux|imagen|cogview|kandinsky|midjourney|recraft|playground|waifu|controlnet|animagine|dreamshaper|openjourney|pixart|kolors|hunyuan[-_ ]?dit/i,
 // 语音合成（TTS）。
 speech:/tts|speech|voice.?generator|cosyvoice|sovits|gpt.?sovits|vits|chattts|bark|xtts|elevenlabs/i,
 // 音频转写/识别（ASR/STT/翻译）。
 transcription:/whisper|asr|stt|speech.?to.?text|audio.?transcribe|transcribe|sensevoice|parakeet|translate/i,
 // 视频生成。
 video:/video|wan|svd|i2v|t2v|sora|pika|luma|cogvideo|text.?to.?video|video.?gen|text2video|hailuo|kling|hunyuan[-_ ]?video/i
};

// 非对话模型：embedding / rerank / OCR 专用等，不进模型实验室。
const nonChatPattern=/embedding|rerank|reranker|cross.?encoder|ocr|bge/i;
const mossVisionPattern=/(?:^|\/|::)moss-vl-1\.0(?:-\d{4}-\d{2}-\d{2})?$/i;

const normalize=(model='')=>String(model).toLowerCase().replace(/\s+/g,'');

export function modelCapabilities(model){
 const normalized=normalize(model);
 const image=mediaPatterns.image.test(normalized);
 const speech=mediaPatterns.speech.test(normalized);
 const transcription=mediaPatterns.transcription.test(normalized);
 const video=mediaPatterns.video.test(normalized);
 const vision=mossVisionPattern.test(normalized);
 const mediaOnly=image||speech||transcription||video||vision;
 // 可对话：既非媒体生成模型，也非 embedding/rerank/OCR 等非对话模型。
 const chat=!mediaOnly&&!nonChatPattern.test(normalized);
 return {image,speech,transcription,video,vision,mediaOnly,chat};
}

export function filterModelsForMediaKind(models,kind){
 if(kind==='image')return models.filter(item=>item.modelCapabilities?.image);
 if(kind==='speech')return models.filter(item=>item.modelCapabilities?.speech);
 if(kind==='transcription')return models.filter(item=>item.modelCapabilities?.transcription);
 if(kind==='video')return models.filter(item=>item.modelCapabilities?.video);
 if(kind==='vision')return models.filter(item=>item.modelCapabilities?.vision);
 return models;
}
