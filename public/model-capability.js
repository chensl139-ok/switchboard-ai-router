// 媒体能力分类正则。
// 关键语义：图片「生成」(image generation) 与视觉「理解」(vision/VL) 必须分开——
// 后者是聊天模型（能看图+文字输出），应留在模型实验室，绝不算 mediaOnly。
const mediaPatterns={
 // 图片生成：仅匹配真正输出图片的模型。避免 sd-/lama 等宽泛词误伤 TTS/Llama。
 image:/dall|dalle|gpt[-_ ]?image|stable[-_ ]?diffusion|sdxl|sd[-_ ]?(1\.5|xl|3|turbo)|flux|imagen|cogview|kandinsky|midjourney|recraft|playground|waifu|controlnet|qwen[-_ ]?image|siliconflow[-_ ]?image|animagine|dreamshaper|openjourney|pixart|kolors|hunyuan[-_ ]?(image|dit)/i,
 // 语音合成（TTS）：只匹配输出音频的合成模型。whisper/ASR/SenseVoice 归 transcription。
 speech:/tts|text.?to.?speech|cosyvoice|moss.?tts|sovits|gpt.?sovits|azure.?tts|vits|fish[-_ ]?speech|chattts|bark|xtts|elevenlabs/i,
 // 音频转写/识别（ASR/STT/翻译）：whisper、SenseVoice 等识别类。
 transcription:/whisper|asr|stt|speech.?to.?text|audio.?transcribe|transcribe|sensevoice|parakeet|translate/i,
 // 视频生成。
 video:/video|wan|svd|i2v|t2v|sora|pika|luma|cogvideo|text.?to.?video|video.?gen|text2video|hailuo|kling|hunyuan[-_ ]?video/i
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
