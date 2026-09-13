export function splitModelId(entry=''){
  const [provider=''] = entry.split('::');
  const model = entry.includes('::')?entry.slice(entry.indexOf('::')+2):'';
  return {provider, model};
}

function lower(value=''){
  return String(value).toLowerCase();
}

function has(value='', patterns){
  const target=lower(value);
  return patterns.some((p)=>target.includes(p));
}

const visionKeys=['vl','vision','gpt-4o','gpt-4.1','gemma','gemma-3','gemma-3n','glm-4v','qwen2-vl','qwen2.5-vl','llava','llava-','cogvlm','yi-vl','internvl'];
const imageKeys=['image','img','flux','dall','dalle','stability','stable-diffusion','sdxl','kandinsky','cogview','mj-','kolors','wanx','cogxl','imagen','midjourney','playground-v2'];
const speechKeys=['tts','text-to-speech','text_to_speech','speech','voice','cosyvoice','moss-ttsd','parler','eleven','funaudio','audiotts','vocal','/tts-','-tts'];
const transcriptionKeys=['whisper','transcri','asr','stt','-audio'];
const videoKeys=['wan2','wan-2','wan2.2','video','txt2video','t2v','sora','kling','runway','pika','luma'];

export function modelCapabilities(entry=''){
  const model=lower(entry);
  const caps={conversation:true,vision:false,image:false,speech:false,transcription:false,video:false};
  if(has(model,visionKeys))caps.vision=true;
  if(has(model,imageKeys))caps.image=true;
  if(has(model,speechKeys))caps.speech=true;
  if(has(model,transcriptionKeys))caps.transcription=true;
  if(has(model,videoKeys))caps.video=true;
  if(caps.image||caps.speech||caps.transcription||caps.video)caps.conversation=false;
  if(caps.image || caps.speech || caps.transcription || caps.video){
    if(!caps.vision && !caps.speech && model.includes('glm-4')&&model.includes('v')){
      // 许多 GLM-4 变体主打多模态，保留为可在模型实验室展示
      caps.vision=true;
    }
  }
  if(caps.video)caps.conversation=false;
  return caps;
}

export function isModelForPlayground(entry=''){
  const caps=modelCapabilities(entry);
  return caps.conversation || caps.vision;
}

export function isMediaModelFor(entry='', kind='image'){
  const caps=modelCapabilities(entry);
  if(kind==='image')return caps.image || caps.vision;
  if(kind==='speech')return caps.speech;
  if(kind==='transcription')return caps.transcription || caps.speech;
  if(kind==='video')return caps.video;
  return caps.image||caps.speech||caps.transcription||caps.video||caps.vision;
}
