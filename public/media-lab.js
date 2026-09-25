import {filterModelsForMediaKind,modelCapabilities} from './model-capability.js';
import {buildVisionRequest,visionOutputText} from './vision-form.js';
let controller=null,objectUrl=null,pollTimer=null,viewEpoch=0;
const kinds={image:{label:'图片生成',hint:'根据文字描述生成图片',action:'生成图片'},speech:{label:'语音合成',hint:'将文字转换为自然语音',action:'生成语音'},transcription:{label:'音频转文字',hint:'上传音频并提取文本',action:'开始转录'},video:{label:'视频生成',hint:'创建文字或图片驱动的视频',action:'生成视频'},vision:{label:'视觉理解',hint:'理解图片或视频并输出文本',action:'开始理解'}};
export function stopMediaLab(){viewEpoch++;controller?.abort();controller=null;clearInterval(pollTimer);pollTimer=null;if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
export function renderMediaLab({state,tenantId,esc,embedded=false}){
 const epoch=viewEpoch,root=document.querySelector('#content'),active=()=>epoch===viewEpoch&&root.isConnected;
 const models=state.providers.filter(provider=>provider.enabled&&(provider.hasKey||provider.hasMeteredKey)&&provider.protocol!=='anthropic').flatMap(provider=>{let videoCompatible=false;try{videoCompatible=['api.siliconflow.cn','api.siliconflow.com'].includes(new URL(provider.baseUrl).hostname);}catch{/* Invalid URLs are rejected when providers are saved. */}return provider.models.map(model=>({id:provider.id+'::'+model,model,provider:provider.id,name:provider.name+' / '+model,videoCompatible,modelCapabilities:modelCapabilities(model)}));});
 const modelList=models.filter(item=>item.modelCapabilities.mediaOnly);
 if(!embedded)root.innerHTML='';
 if(embedded){const actions=root.querySelector('#lab-page-actions');if(actions)actions.innerHTML=`<span class="lab-model-count">${modelList.length} 个媒体模型可配置</span>`;}
 root.insertAdjacentHTML('beforeend',(embedded?'':`<div class="heading media-heading"><div><div class="eyebrow">MEDIA STUDIO</div><h1>媒体实验室</h1><p>选择任务类型，平台会自动筛选可用模型和对应参数。</p></div><span class="tag">${modelList.length} 个媒体模型</span></div>`)+`
 <div class="media-kind-grid" role="tablist" aria-label="媒体任务类型">${Object.entries(kinds).map(([id,item],index)=>`<button type="button" role="tab" data-media-kind="${id}" aria-selected="${index===0}" class="media-kind ${index===0?'selected':''}"><span class="media-kind-icon">${{image:'◇',speech:'◖',transcription:'≋',video:'▷',vision:'◉'}[id]}</span><b>${item.label}</b><small>${item.hint}</small></button>`).join('')}</div>
 <div class="media-workspace"><section class="panel media-form-panel"><div class="panel-title"><div><span class="eyebrow">NEW TASK</span><h2 id="media-form-title">图片生成</h2></div><span id="media-provider-note" class="tag" hidden>兼容视频任务接口</span></div><form id="media-form"><select id="media-kind" class="sr-only" aria-label="调用类型">${Object.entries(kinds).map(([id,item])=>`<option value="${id}">${item.label}</option>`).join('')}</select><label>服务商 / 模型<select id="media-model" required></select><small id="media-model-help" class="field-help">只显示已启用并加入调用列表的匹配模型。</small></label><div id="media-vision-controls" class="form-grid media-vision-controls" hidden><label>素材类型<select id="media-vision-type"><option value="image">图片 · 1～5 张</option><option value="video">视频 · 1 个</option></select></label><label>素材来源<select id="media-vision-source"><option value="url">HTTPS URL</option><option value="file_id">上游 file_id</option></select></label></div><label id="media-vision-images-label" hidden>图片 URL（每行一个，最多 5 张）<textarea id="media-vision-images" rows="3" placeholder="https://example.com/photo.jpg"></textarea></label><label id="media-vision-video-label" hidden>视频 URL<input id="media-vision-video" type="url" placeholder="https://example.com/video.mp4"></label><small id="media-vision-help" class="field-help" hidden>URL 须可由上游访问；file_id 指已上传至上游的素材，本平台暂不提供视觉素材上传。</small><label id="media-text-label">提示词<textarea id="media-text" rows="5" required placeholder="描述你希望生成的内容，细节越明确，结果越稳定"></textarea></label><div class="form-grid media-options"><label id="media-size-label">输出尺寸<input id="media-size" value="1024x1024"></label><label id="media-voice-label" hidden>音色 ID<input id="media-voice" placeholder="例如 FunAudioLLM/CosyVoice2-0.5B:alex"></label><label id="media-file-label" hidden>音频文件（最大 50 MB）<input id="media-file" type="file" accept="audio/*"></label><label id="media-image-label" hidden>参考图片 URL（图生视频）<input id="media-image" type="url" placeholder="https://…"></label><label id="media-vision-max-label" hidden>最大输出 Tokens<input id="media-vision-max" type="number" min="1" max="8192" step="1" value="1024"></label></div><div class="media-actions"><button class="primary" id="media-send">生成图片</button><button type="button" id="media-stop" hidden>取消等待</button></div><p id="media-error" role="alert" class="lab-error"></p></form></section>
 <section class="panel media-result-panel"><div class="panel-title"><div><span class="eyebrow">RESULT</span><h2 id="media-result-title">生成结果</h2></div><div class="media-result-actions"><button type="button" id="media-copy" hidden>复制文本</button><span id="media-status" role="status" class="media-status">等待任务</span></div></div><div id="media-result" class="media-result"><div class="media-placeholder"><span>＋</span><b>结果将在这里显示</b><small>切换页面前请保存所需结果；视频任务会在本页自动查询状态</small></div></div><div id="media-vision-usage" class="media-vision-usage" hidden></div></section></div>`);
 const $=selector=>root.querySelector(selector);let taskId=null,polling=false,videoFinished=false,selectionEpoch=0;
 const supportedModels=kind=>filterModelsForMediaKind(modelList,kind).filter(item=>kind!=='video'||item.videoCompatible);
 function updateVideoFields(){const selected=models.find(model=>model.id===$('#media-model').value),imageRequired=$('#media-kind').value==='video'&&/I2V/i.test(selected?.model||'');$('#media-image-label').hidden=!imageRequired;$('#media-image').required=imageRequired;}
 function refreshModels(){const kind=$('#media-kind').value,supported=supportedModels(kind),select=$('#media-model'),current=select.value;select.innerHTML=`<option value="">${supported.length?'选择一个模型':'没有匹配的已启用模型'}</option>${supported.map(model=>`<option value="${esc(model.id)}">${esc(model.name)}</option>`).join('')}`;if(supported.some(item=>item.id===current))select.value=current;else if(supported.length)select.value=(kind==='video'?supported.find(item=>/T2V/i.test(item.model)):null)?.id||supported[0].id;select.disabled=!supported.length;$('#media-send').disabled=!supported.length;$('#media-model-help').textContent=supported.length?`已找到 ${supported.length} 个可用模型；媒体任务固定使用所选模型。`:'请先在模型目录加入对应能力的模型，并在服务商页面启用。';updateVideoFields();}
 function setStatus(label){$('#media-status').textContent=label;$('#media-status').dataset.state=label;}
 function updateVisionFields(){
  const vision=$('#media-kind').value==='vision',video=$('#media-vision-type').value==='video',file=$('#media-vision-source').value==='file_id';
  $('#media-vision-controls').hidden=!vision;$('#media-vision-help').hidden=!vision;$('#media-vision-max-label').hidden=!vision;
  $('#media-vision-images-label').hidden=!vision||video;$('#media-vision-video-label').hidden=!vision||!video;
  $('#media-vision-images').required=vision&&!video;$('#media-vision-video').required=vision&&video;
  $('#media-vision-images-label').firstChild.textContent=file?'图片 file_id（每行一个，最多 5 张）':'图片 URL（每行一个，最多 5 张）';
  $('#media-vision-video-label').firstChild.textContent=file?'视频 file_id':'视频 URL';
  $('#media-vision-images').placeholder=file?'file_abcd1234':'https://example.com/photo.jpg';
  $('#media-vision-video').type=file?'text':'url';$('#media-vision-video').placeholder=file?'file_abcd1234':'https://example.com/video.mp4';
  $('#media-vision-help').textContent=file?'填写已上传至上游的 file_id；本平台暂不提供视觉素材上传，不能填本地文件路径。':'素材地址须为上游可访问的 HTTPS URL；本平台不会上传本地素材。';
 }
 function selectKind(kind){
  if($('#media-kind').value!==kind)clearSelection();
  $('#media-kind').value=kind;root.querySelectorAll('[data-media-kind]').forEach(button=>{const selected=button.dataset.mediaKind===kind;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));});
  const placeholder=$('#media-result .media-placeholder b');if(placeholder)placeholder.textContent=(kind==='vision'?'理解结果':'生成结果')+'将在这里显示';
  $('#media-form-title').textContent=kinds[kind].label;$('#media-result-title').textContent=kind==='vision'?'理解结果':kind==='transcription'?'转录结果':'生成结果';$('#media-provider-note').hidden=kind!=='video';$('#media-text-label').hidden=kind==='transcription';$('#media-text-label').firstChild.textContent=kind==='speech'?'待合成文本':kind==='video'?'视频描述':kind==='vision'?'理解指令':'提示词';$('#media-text').placeholder=kind==='vision'?'例如：描述图中的主体、文字与场景，并指出不确定之处':'描述你希望生成的内容，细节越明确，结果越稳定';$('#media-text').required=kind!=='transcription';$('#media-size-label').hidden=!['image','video'].includes(kind);$('#media-voice-label').hidden=kind!=='speech';$('#media-file-label').hidden=kind!=='transcription';$('#media-file').required=kind==='transcription';$('#media-image-label').hidden=kind!=='video';$('#media-size').value=kind==='video'?'1280x720':'1024x1024';$('#media-send').textContent=kinds[kind].action;updateVisionFields();refreshModels();
 }
 root.querySelectorAll('[data-media-kind]').forEach(button=>button.onclick=()=>selectKind(button.dataset.mediaKind));selectKind('image');
 $('#media-vision-type').onchange=()=>{clearSelection();updateVisionFields();};
 $('#media-vision-source').onchange=()=>{$('#media-vision-images').value='';$('#media-vision-video').value='';clearSelection();updateVisionFields();};
 $('#media-model').onchange=()=>{clearSelection();const selected=models.find(model=>model.id===$('#media-model').value);updateVideoFields();if(selected?.provider==='siliconflow'&&/CosyVoice2|MOSS-TTSD/.test(selected.model))$('#media-voice').value=selected.model+':alex';};
 const safeURL=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
 function resetResult(){$('#media-result').replaceChildren();$('#media-copy').hidden=true;$('#media-copy').textContent='复制文本';$('#media-vision-usage').hidden=true;$('#media-vision-usage').textContent='';}
 function showLinks(rows,type){const box=$('#media-result');for(const row of rows){const url=safeURL(row.url);if(!url)continue;const wrapper=document.createElement('div');wrapper.className='media-output';const element=document.createElement(type);element.src=url;if(type==='video')element.controls=true;else element.alt='生成图片';wrapper.append(element);const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noreferrer';link.textContent='在新窗口打开 ↗';wrapper.append(link);box.append(wrapper);}}
 const headers=()=>({'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})});
 function stopPolling(){clearInterval(pollTimer);pollTimer=null;polling=false;}
 function clearSelection(){
  selectionEpoch++;controller?.abort();controller=null;stopPolling();taskId=null;videoFinished=false;
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  $('#media-copy').hidden=true;$('#media-copy').textContent='复制文本';$('#media-vision-usage').hidden=true;$('#media-vision-usage').textContent='';
  $('#media-result').innerHTML=`<div class="media-placeholder"><span>＋</span><b>${$('#media-kind').value==='vision'?'理解结果':'生成结果'}将在这里显示</b><small>选择任务和模型后发起新调用</small></div>`;
  $('#media-error').textContent='';$('#media-stop').hidden=true;$('#media-send').disabled=!$('#media-model').value;setStatus('等待任务');
 }
 $('#media-copy').onclick=async()=>{const value=$('#media-result .media-transcript')?.textContent;if(!value)return;try{await navigator.clipboard.writeText(value);$('#media-copy').textContent='已复制';setTimeout(()=>{$('#media-copy').textContent='复制文本';},1800);}catch{$('#media-error').textContent='复制失败，请手动选中文本复制';}};
 async function poll(){
  if(polling||!taskId||!active())return;
  const id=taskId,epoch=selectionEpoch;polling=true;const button=$('#media-poll');
  if(button){button.disabled=true;button.textContent='正在查询…';}
  try{
   const response=await fetch('/v1/video/status',{method:'POST',headers:headers(),body:JSON.stringify({requestId:id})}),data=await response.json();
   if(!active()||epoch!==selectionEpoch||id!==taskId)return;
   if(!response.ok)throw Error(data.error?.message||'查询失败');
   const labels={InQueue:'排队中',InProgress:'生成中',Succeed:'已完成',Failed:'生成失败'};setStatus(labels[data.status]||data.status);
   if(data.status==='Succeed'){videoFinished=true;stopPolling();resetResult();showLinks(data.results?.videos||[],'video');button?.remove();}
   else if(data.status==='Failed'){videoFinished=true;stopPolling();throw Error(data.reason||'视频生成失败');}
  }catch(error){if(active()&&epoch===selectionEpoch&&id===taskId)$('#media-error').textContent=error.message;}
  finally{if(epoch===selectionEpoch)polling=false;if(button?.isConnected){button.disabled=false;button.textContent='立即刷新';}}
 }
 $('#media-stop').onclick=()=>controller?.abort();
 $('#media-form').onsubmit=async event=>{
  event.preventDefault();if(controller)return;const kind=$('#media-kind').value,model=$('#media-model').value,text=$('#media-text').value;let body,route;
  if(kind==='transcription'){const file=$('#media-file').files[0];if(!file||file.size>50*1024*1024){$('#media-error').textContent='请选择不超过 50 MB 的音频';return;}body=new FormData();body.set('model',model);body.set('file',file);route='/v1/audio/transcriptions';}
  else if(kind==='vision'){
   const mediaKind=$('#media-vision-type').value;
   try{body=JSON.stringify(buildVisionRequest({model,instruction:text,mediaKind,source:$('#media-vision-source').value,entries:mediaKind==='video'?$('#media-vision-video').value:$('#media-vision-images').value,maxOutputTokens:$('#media-vision-max').value}));}catch(error){$('#media-error').textContent=error.message;return;}
   route='/v1/responses';
  }
  else{const payload={model};if(kind==='speech'){payload.input=text;payload.voice=$('#media-voice').value;payload.response_format='mp3';route='/v1/audio/speech';}else{payload.prompt=text;if(kind==='image'){payload.size=$('#media-size').value;payload.n=1;payload.response_format='url';route='/v1/images/generations';}else{payload.image_size=$('#media-size').value;if($('#media-image').required)payload.image=$('#media-image').value;route='/v1/video/submit';}}body=JSON.stringify(payload);}
  const request=new AbortController(),epoch=selectionEpoch,current=()=>active()&&epoch===selectionEpoch;
  controller=request;stopPolling();videoFinished=false;$('#media-send').disabled=true;$('#media-stop').hidden=false;$('#media-error').textContent='';resetResult();setStatus('处理中');if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  try{
   const requestHeaders=headers();if(body instanceof FormData)delete requestHeaders['content-type'];
   const response=await fetch(route,{method:'POST',headers:requestHeaders,body,signal:request.signal});
   if(!current())return;
   if(!response.ok){const error=await response.json();throw Error(error.error?.message||'调用失败');}
   if(kind==='speech'){
    const blob=await response.blob();if(!current())return;
    objectUrl=URL.createObjectURL(blob);const audio=document.createElement('audio');audio.controls=true;audio.src=objectUrl;$('#media-result').append(audio);
   }else{
    const data=await response.json();if(!current())return;
    if(kind==='image')showLinks(data.data||data.images||[],'img');
    if(kind==='transcription'){const output=document.createElement('p');output.className='media-transcript';output.textContent=data.text||JSON.stringify(data);$('#media-result').append(output);}
    if(kind==='vision'){const text=visionOutputText(data);if(!text)throw Error('视觉理解未返回文本结果');const output=document.createElement('p');output.className='media-transcript';output.textContent=text;$('#media-result').append(output);$('#media-copy').hidden=false;const usage=data.usage||{},input=Number(usage.input_tokens),outputTokens=Number(usage.output_tokens);if(Number.isFinite(input)&&Number.isFinite(outputTokens)){$('#media-vision-usage').textContent=`输入 ${input} tokens · 输出 ${outputTokens} tokens`;$('#media-vision-usage').hidden=false;}}
    if(kind==='video'){
     taskId=data.requestId;const task=document.createElement('div');task.className='media-task';const code=document.createElement('code');code.textContent=taskId;const button=document.createElement('button');button.id='media-poll';button.type='button';button.textContent='立即刷新';button.onclick=poll;task.append('任务 ID ',code,button);$('#media-result').append(task);setStatus('已提交 · 自动刷新');await poll();if(current()&&!videoFinished&&taskId)pollTimer=setInterval(poll,5000);
    }
   }
   if(current()&&kind!=='video')setStatus('已完成');
  }catch(error){if(current()){$('#media-error').textContent=request.signal.aborted?'已取消等待；已提交的远程任务可能仍会继续执行。':error.message;setStatus('未完成');}}
  finally{if(controller===request)controller=null;if(current()){$('#media-send').disabled=!supportedModels(kind).length;$('#media-stop').hidden=true;}}
 };
}
