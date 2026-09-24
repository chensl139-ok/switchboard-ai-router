import {filterModelsForMediaKind, modelCapabilities} from './model-capability.js';
let controller=null,objectUrl=null,viewEpoch=0;
export function stopMediaLab(){viewEpoch++;controller?.abort();controller=null;if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
export function renderMediaLab({state,tenantId,esc}){
 const epoch=viewEpoch,root=document.querySelector('#content'),active=()=>epoch===viewEpoch&&root.isConnected,models=state.providers.filter(p=>p.enabled&&(p.hasKey||p.hasMeteredKey)&&p.protocol!=='anthropic').flatMap(p=>p.models.map(model=>({id:p.id+'::'+model,model,provider:p.id,name:p.name+' / '+model})));
 for(const model of models)model.modelCapabilities=modelCapabilities(model.model);
 const modelList=models.filter(item=>item.modelCapabilities.mediaOnly);
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">MEDIA PLAYGROUND</div><h1>媒体实验室</h1><p>图片生成、语音合成、音频转文字与视频任务，使用对应的媒体接口。</p></div></div><div class="panel"><form id="media-form"><div class="form-grid"><label>调用类型<select id="media-kind"><option value="image">图片生成</option><option value="speech">语音合成</option><option value="transcription">音频转文字</option><option value="video">视频生成（硅基流动）</option></select></label><label>服务商 / 模型<select id="media-model" required><option value="">请选择具备对应能力的模型</option>${models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label></div><p class="muted">仅显示已加入调用列表的模型。请先在模型目录查询并加入图片、语音或视频模型；媒体调用不使用聊天自动路由。</p><label id="media-text-label">提示词 / 待合成文本<textarea id="media-text" rows="4" required placeholder="描述你希望生成的内容"></textarea></label><div class="form-grid"><label id="media-size-label">输出尺寸<input id="media-size" value="1024x1024"></label><label id="media-voice-label" hidden>音色 ID<input id="media-voice" placeholder="例如 FunAudioLLM/CosyVoice2-0.5B:alex"></label><label id="media-file-label" hidden>音频文件（最大 50 MB）<input id="media-file" type="file" accept="audio/*"></label><label id="media-image-label" hidden>视频参考图片 URL（图生视频必填）<input id="media-image" type="url" placeholder="https://…"></label></div><button class="primary" id="media-send">开始生成</button><button type="button" id="media-stop" hidden>取消等待</button><p id="media-error" role="alert" class="lab-error"></p></form></div><section class="panel section-space"><h2>调用结果</h2><p id="media-status" role="status">等待发起调用</p><div id="media-result"></div></section>`;
 const $=s=>root.querySelector(s);let taskId=null;
 const refreshModels=()=>{
  const kind=$('#media-kind')?.value||'image';
  const supported=filterModelsForMediaKind(modelList,kind);
  const modelSelect=$('#media-model');
  if(!modelSelect)return;
  const current=modelSelect.value;
  modelSelect.innerHTML=`<option value="">请选择具备对应能力的模型</option>${supported.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}`;
  if(!supported.some(item=>item.id===current))modelSelect.value='';
 };
 function kindChanged(){
  const kind=$('#media-kind').value;
  $('#media-text-label').hidden=kind==='transcription';
  $('#media-text').required=kind!=='transcription';
  $('#media-size-label').hidden=!['image','video'].includes(kind);
  $('#media-voice-label').hidden=kind!=='speech';
  $('#media-file-label').hidden=kind!=='transcription';
  $('#media-file').required=kind==='transcription';
  $('#media-image-label').hidden=kind!=='video';
  $('#media-size').value=kind==='video'?'1280x720':'1024x1024';
  $('#media-send').textContent=kind==='transcription'?'开始转录':'开始生成';
  refreshModels();
 }
 $('#media-kind').onchange=kindChanged;kindChanged();$('#media-model').onchange=()=>{const selected=models.find(m=>m.id===$('#media-model').value);if(selected?.provider==='siliconflow'&&/CosyVoice2|MOSS-TTSD/.test(selected.model))$('#media-voice').value=selected.model+':alex';};
 const safeURL=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
 function showLinks(rows,type){const box=$('#media-result');for(const row of rows){const url=safeURL(row.url);if(!url)continue;const el=document.createElement(type);el.src=url;if(type==='video')el.controls=true;else el.alt='生成图片';el.style.maxWidth='100%';el.style.maxHeight='480px';box.append(el);const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noreferrer';link.textContent='打开原始结果';box.append(link);}}
 const headers=()=>({'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})});
 async function poll(){const b=$('#media-poll');b.disabled=true;try{const r=await fetch('/v1/video/status',{method:'POST',headers:headers(),body:JSON.stringify({requestId:taskId})}),data=await r.json();if(!r.ok)throw Error(data.error?.message||'查询失败');if(!active())return;$('#media-status').textContent='视频状态：'+data.status;if(data.status==='Succeed'){showLinks(data.results?.videos||[],'video');b.remove();}else if(data.status==='Failed'){throw Error(data.reason||'视频生成失败');}}catch(e){if(active())$('#media-error').textContent=e.message;}finally{b.disabled=false;}}
 $('#media-stop').onclick=()=>controller?.abort();
 $('#media-form').onsubmit=async e=>{
  e.preventDefault();if(controller)return;const kind=$('#media-kind').value,model=$('#media-model').value,text=$('#media-text').value;let body,route;
  if(kind==='transcription'){const file=$('#media-file').files[0];if(!file||file.size>50*1024*1024){$('#media-error').textContent='请选择不超过 50 MB 的音频';return;}body=new FormData();body.set('model',model);body.set('file',file);route='/v1/audio/transcriptions';}
  else{const payload={model};if(kind==='speech'){payload.input=text;payload.voice=$('#media-voice').value;payload.response_format='mp3';route='/v1/audio/speech';}else{payload.prompt=text;if(kind==='image'){payload.size=$('#media-size').value;payload.n=1;payload.response_format='url';route='/v1/images/generations';}else{payload.image_size=$('#media-size').value;if($('#media-image').value)payload.image=$('#media-image').value;route='/v1/video/submit';}}body=JSON.stringify(payload);}
  const request=new AbortController();controller=request;$('#media-send').disabled=true;$('#media-stop').hidden=false;$('#media-error').textContent='';$('#media-result').replaceChildren();$('#media-status').textContent='正在处理，最长等待 180 秒…';if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  try{const h=headers();if(body instanceof FormData)delete h['content-type'];const r=await fetch(route,{method:'POST',headers:h,body,signal:request.signal});if(!r.ok){const error=await r.json();throw Error(error.error?.message||'调用失败');}if(kind==='speech'){const blob=await r.blob();if(!active())return;objectUrl=URL.createObjectURL(blob);const audio=document.createElement('audio');audio.controls=true;audio.src=objectUrl;$('#media-result').append(audio);}else{const data=await r.json();if(!active())return;if(kind==='image')showLinks(data.data||data.images||[],'img');if(kind==='transcription')$('#media-result').textContent=data.text||JSON.stringify(data);if(kind==='video'){taskId=data.requestId;const code=document.createElement('p');code.textContent='任务 ID：'+taskId;$('#media-result').append(code);const b=document.createElement('button');b.id='media-poll';b.textContent='查询视频进度';b.onclick=poll;$('#media-result').append(b);}}
   $('#media-status').textContent=kind==='video'?'已提交视频任务，点击查询获取结果':'调用完成';
  }catch(error){if(active()){$('#media-error').textContent=request.signal.aborted?'已取消等待；视频任务提交后可能仍在上游继续执行。':error.message;$('#media-status').textContent='调用未完成';}}
  finally{if(controller===request)controller=null;if(active()){$('#media-send').disabled=false;$('#media-stop').hidden=true;}}
 };
}
