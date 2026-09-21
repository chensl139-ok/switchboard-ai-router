import {thinkingCapability} from './thinking-capability.js';
import {streamChat} from './stream-client.js';
import {modelCapabilities} from './model-capability.js';
import {renderModelCompare,stopModelCompare} from './model-compare.js';
import {setLabBusy} from './lab-composer.js';
let draft='',contextVersion=0,pendingImages=[],history=[],controller=null,view='chat',settings={target:'auto',transport:'sse',thinking:'auto',showThinking:true,maxTokens:2048,tools:'[]'};
const icon=(paths)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const spark=icon('<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>');
export function stopPlayground(){stopModelCompare();if(controller){controller.abort();controller=null;for(const message of history)if(message.status==='生成中')message.status='已停止';}}
export function resetPlayground(){contextVersion++;controller?.abort();history=[];pendingImages=[];draft='';settings.target='auto';settings.tools='[]';}
export function renderPlayground({state,token,tenantId,esc,refresh}){
 const root=document.querySelector('#content');
 stopModelCompare();
 const choices=state.providers.filter(p=>p.enabled&&p.hasKey).flatMap(p=>p.models.map(model=>({id:JSON.stringify([p.id,model]),providerId:p.id,label:p.name+' / '+model,model,protocol:p.modelProtocols?.[model]||p.protocol,channel:p.modelChannels?.[model]||'subscription'}))).filter(item=>modelCapabilities(item.model).chat);
 if(view==='compare'){
  renderModelCompare({root,choices,token,tenantId,esc,onSwitch:()=>{view='chat';renderPlayground({state,token,tenantId,esc,refresh});}});
  return;
 }
 if(settings.target!=='auto'&&!choices.some(c=>c.id===settings.target))settings.target='auto';
 root.innerHTML=`<div class="heading lab-heading"><div><div class="eyebrow">MODEL PLAYGROUND</div><h1>模型实验室<span class="lab-beta">LIVE</span></h1><p>从一次对话开始，比较模型的回答与思考表现。</p></div><div class="compare-heading-actions"><button id="lab-compare" class="subtle">多模型对比</button><button id="lab-clear" class="subtle">清空对话</button></div></div>
 <div class="lab-layout"><section class="lab-main"><div class="lab-toolbar"><span>${spark}对话测试</span><span class="lab-state" id="lab-state">准备就绪</span></div>
 <div class="lab-messages" id="lab-messages" aria-live="polite"></div><div id="lab-error" class="lab-error" role="alert"></div>
 <button type="button" id="lab-jump" class="lab-jump" hidden>↓ 回到最新消息</button><div id="lab-images" class="lab-images"></div><form id="lab-form" class="lab-composer"><label for="lab-prompt" class="sr-only">输入消息</label><textarea id="lab-prompt" rows="3" aria-describedby="lab-compose-hint" placeholder="输入问题，或直接粘贴图片…"></textarea><div class="lab-compose-bottom"><button type="button" id="lab-image-button">＋ 图片</button><input id="lab-image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden multiple><span id="lab-compose-hint" aria-live="polite">Enter 发送 · Shift + Enter 换行</span><button type="button" id="lab-stop" hidden>停止生成</button><button class="primary" id="lab-send">发送 ${icon('<path d="m5 12 7-7 7 7M12 5v14"/>')}</button></div></form>
 <div class="lab-privacy">对话仅保留在当前页面内存中 · 调用按服务商规则计费</div></section>
 <aside class="lab-settings"><div class="lab-settings-heading">运行配置<span>PARAMETERS</span></div><label>服务商与模型<select id="lab-model"><option value="auto">自动路由 · 跟随后台策略</option>${choices.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>
 <label>传输方式<select id="lab-transport"><option value="sse">SSE · 增量输出</option><option value="ws">WebSocket · 实时连接</option><option value="http">HTTP · 完整响应</option></select></label>
 <div class="lab-settings-divider"></div><label>模型思考<select id="lab-thinking"><option value="auto">模型默认</option><option value="enabled">开启思考</option><option value="disabled">关闭思考</option></select></label><p class="lab-help" id="lab-thinking-help">思考开关控制模型推理，不只是隐藏显示。</p>
 <label class="lab-switch"><span>思考区可见性<small>仅调整界面，独立于模型思考开关</small></span><input id="lab-show-thinking" type="checkbox" role="switch"></label>
 <label>最大输出 Tokens<input id="lab-max-tokens" type="number" min="1" max="131072" value="${settings.maxTokens}" required></label>
 <details class="lab-tool-config"><summary>函数工具（可选）</summary><textarea id="lab-tools" rows="4" aria-label="函数工具 JSON"></textarea><p class="lab-help">填写 OpenAI tools 数组。这里只展示调用请求，不执行工具；执行后通过 API 回传结果。</p></details><div class="lab-call-info"><span>本次调用</span><strong id="lab-target-label"></strong><p>固定选择模型时，不会改变后台默认模型。</p></div></aside></div>`;
 const $=selector=>root.querySelector(selector);
 $('#lab-compare').onclick=()=>{controller?.abort();controller=null;view='compare';renderPlayground({state,token,tenantId,esc,refresh});};
 $('#lab-prompt').value=draft;
 const resizePrompt=()=>{const el=$('#lab-prompt');el.style.height='auto';el.style.height=Math.min(180,el.scrollHeight)+'px';};
 $('#lab-prompt').oninput=()=>{draft=$('#lab-prompt').value;resizePrompt();};resizePrompt();
 $('#lab-model').value=settings.target;$('#lab-transport').value=settings.transport;$('#lab-thinking').value=settings.thinking;$('#lab-show-thinking').checked=settings.showThinking;$('#lab-tools').value=settings.tools;
 function selectedCapability(){
  if(settings.target==='auto'){
   if(!['manual','fallback'].includes(state.strategy))return null;
   return thinkingCapability(state.providers.find(p=>p.id===state.active));
  }
  const [id,model]=JSON.parse(settings.target);return thinkingCapability({...state.providers.find(p=>p.id===id),model});
 }
 function targetLabel(){const el=$('#lab-model');$('#lab-target-label').textContent=el.options[el.selectedIndex]?.textContent||'自动路由';const capability=selectedCapability();$('#lab-thinking').querySelector('option[value=disabled]').disabled=capability?.canDisable===false;$('#lab-thinking-help').textContent=capability?.reason||'按实际选中的模型校验关闭能力；不支持的默认目标会拒绝请求。';} 
 function draw(){const list=$('#lab-messages');if(!list)return;const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
  list.innerHTML=history.length?history.map((m,index)=>`<article class="lab-message ${m.role}"><div class="lab-speaker"><span class="lab-message-avatar">${m.role==='user'?'U':spark}</span><strong>${m.role==='user'?'你':esc(m.label||'模型回复')}</strong><small>${esc(m.status||'')}</small>${m.role==='assistant'&&m.content&&m.status!=='生成中'?`<button type="button" class="lab-copy" data-copy-reply="${index}" aria-label="复制模型回复">复制</button>`:''}</div><div class="lab-message-body">${m.reasoning_content&&settings.showThinking?`<details class="lab-thought" data-thought="${index}" ${m.thinkingOpen===false?'':'open'}><summary>${icon('<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9z"/>')}思考内容<span>模型 API 返回</span></summary><div>${esc(m.reasoning_content)}</div></details>`:''}${m.notice?`<p class="lab-notice">${esc(m.notice)}</p>`:''}<div class="lab-answer">${esc((typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):'')|| (m.status==='生成中'?'':m.tool_calls?.length?'':m.reasoning_content?'本次仅返回思考内容，可增加输出上限后重试。':''))}</div>${Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url').map(p=>`<img class="lab-message-image" src="${esc(p.image_url.url)}" alt="用户输入的图片">`).join(''):''}${m.tool_calls?.length?`<div class="lab-tool-calls"><strong>模型请求调用工具</strong>${m.tool_calls.map(t=>`<details open><summary>${esc(t.function.name)}</summary><pre>${esc(t.function.arguments||'{}')}</pre></details>`).join('')}<p>请由调用方执行工具并带 tool_call_id 回传结果。</p></div>`:''}${m.status==='生成中'?'<span class="lab-cursor"></span>':''}</div></article>`).join(''):
  `<div class="lab-empty"><span class="lab-empty-icon">${spark}</span><h2>一个问题，多种可能</h2><p>选择一个模型，或者让路由策略为你选择。</p><div class="lab-prompts"><button type="button" data-example="用一个生活中的例子解释什么是 API。">解释一个概念</button><button type="button" data-example="用 Python 编写一个带注释的快速排序函数。">编写一段代码</button><button type="button" data-example="给一个 AI 模型路由平台写三条简洁的产品介绍。">探索一个想法</button></div></div>`;
  list.querySelectorAll('[data-thought]').forEach(el=>el.addEventListener('toggle',()=>{const m=history[Number(el.dataset.thought)];if(m)m.thinkingOpen=el.open;}));
  if(nearBottom)list.scrollTop=list.scrollHeight;$('#lab-jump').hidden=list.scrollHeight-list.scrollTop-list.clientHeight<100;
 }
 const busy=value=>setLabBusy(root,value);
 function drawImages(){const el=$('#lab-images');if(el)el.innerHTML=pendingImages.map((image,index)=>`<span><img src="${image.url}" alt="待发送图片"><button type="button" data-remove-image="${index}" aria-label="移除图片">×</button></span>`).join('');}
 targetLabel();draw();drawImages();busy(!!controller);
 $('#lab-tools').oninput=()=>settings.tools=$('#lab-tools').value;
 $('#lab-image-button').onclick=()=>$('#lab-image-input').click();
 $('#lab-images').onclick=e=>{const b=e.target.closest('[data-remove-image]');if(b&&!controller){pendingImages.splice(Number(b.dataset.removeImage),1);drawImages();}};
 let addingImages=false;
 async function addImages(files){
  if(controller||addingImages)return;const version=contextVersion;addingImages=true;const button=$('#lab-image-button');button.disabled=true;button.textContent='读取中…';
  try{
   for(const file of files){
    if(pendingImages.length>=4)throw Error('最多附加 4 张图片，请移除后再添加');
    if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)||file.size>4*1024*1024)throw Error('图片需为 PNG/JPEG/GIF/WebP，单张不超过 4 MB');
    const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败，请重试'));reader.readAsDataURL(file);});
    if(version!==contextVersion||!root.isConnected)return;
    pendingImages.push({url,name:file.name});
   }
   $('#lab-error').textContent='';
  }catch(error){if(root.isConnected)$('#lab-error').textContent=error.message;}
  finally{addingImages=false;if(root.isConnected){drawImages();button.disabled=!!controller;button.textContent='＋ 图片';}}
 }
 $('#lab-image-input').onchange=async e=>{await addImages(Array.from(e.target.files));e.target.value='';};
 $('#lab-prompt').addEventListener('paste',e=>{
  const images=Array.from(e.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
  if(images.length){e.preventDefault();void addImages(images);}
 });
 $('#lab-jump').onclick=()=>{$('#lab-messages').scrollTop=$('#lab-messages').scrollHeight;$('#lab-jump').hidden=true;};
 $('#lab-messages').onscroll=()=>{const list=$('#lab-messages');$('#lab-jump').hidden=list.scrollHeight-list.scrollTop-list.clientHeight<100;};


 $('#lab-model').onchange=()=>{settings.target=$('#lab-model').value;targetLabel();};
 $('#lab-transport').onchange=()=>settings.transport=$('#lab-transport').value;
 $('#lab-thinking').onchange=()=>settings.thinking=$('#lab-thinking').value;
 $('#lab-show-thinking').onchange=()=>{settings.showThinking=$('#lab-show-thinking').checked;draw();};
 $('#lab-max-tokens').onchange=()=>settings.maxTokens=Number($('#lab-max-tokens').value);
 $('#lab-clear').onclick=()=>{if(!controller){history=[];pendingImages=[];draft='';$('#lab-prompt').value='';resizePrompt();drawImages();draw();$('#lab-error').textContent='';}};
 $('#lab-stop').onclick=()=>controller?.abort();
 $('#lab-messages').addEventListener('click',async e=>{const copy=e.target.closest('[data-copy-reply]');if(copy){try{await navigator.clipboard.writeText(history[Number(copy.dataset.copyReply)]?.content||'');copy.textContent='已复制';}catch{$('#lab-error').textContent='无法访问剪贴板，请手动选中回复复制';}return;}const button=e.target.closest('[data-example]');if(button){$('#lab-prompt').value=button.dataset.example;draft=button.dataset.example;resizePrompt();$('#lab-prompt').focus();}});
 $('#lab-prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!controller){e.preventDefault();if(!e.repeat)$('#lab-form').requestSubmit();}});
 $('#lab-form').onsubmit=async e=>{
  e.preventDefault();e.stopPropagation();if(controller)return;if(addingImages){$('#lab-error').textContent='图片正在读取，请稍后发送';return;}
  const prompt=$('#lab-prompt').value.trim();if(!prompt&&!pendingImages.length)return;if(!choices.length){$('#lab-error').textContent='请先在服务商管理中配置密钥、添加模型并启用服务商';return;}if(!Number.isInteger(settings.maxTokens)||settings.maxTokens<1||settings.maxTokens>131072){$('#lab-error').textContent='最大输出 Tokens 需为 1 至 131072 的整数';return;}
  const capability=selectedCapability();if(settings.thinking==='disabled'&&capability?.canDisable===false){$('#lab-error').textContent=capability.reason;return;}
  if(history.at(-1)?.tool_calls?.length){$('#lab-error').textContent='上一次返回了工具调用，请通过 API 回传工具结果，或清空对话后重新测试。';return;}
  const context=history.filter(m=>m.status!=='已停止'&&m.status!=='失败').map(({role,content,reasoning_content,tool_calls})=>({role,content,...(reasoning_content?{reasoning_content}:{}),...(tool_calls?{tool_calls}:{})}));
  if(context.length>=99){$('#lab-error').textContent='对话达到上限，请清空对话后继续。';return;}
  const [model,upstream_model]=settings.target==='auto'?['auto']:JSON.parse(settings.target);
  let tools;try{tools=JSON.parse(settings.tools||'[]');if(!Array.isArray(tools))throw Error();}catch{$('#lab-error').textContent='tools 必须为有效 JSON 数组';return;}
  const userContent=pendingImages.length?[{type:'text',text:prompt},...pendingImages.map(image=>({type:'image_url',image_url:{url:image.url}}))]:prompt;
  const input={...(tools.length?{tools}:{}),model,...(upstream_model?{upstream_model}:{}),messages:[...context,{role:'user',content:userContent}],max_tokens:settings.maxTokens,thinking_mode:settings.thinking};
  const response={role:'assistant',content:'',reasoning_content:'',status:'生成中',label:upstream_model||'自动路由',thinkingOpen:true};
  if(new Blob([JSON.stringify(input)]).size>10*1024*1024){$('#lab-error').textContent='含历史的请求超过 10 MB，请移除图片或清空对话';return;}
  history.push({role:'user',content:userContent},response);pendingImages=[];drawImages();$('#lab-prompt').value='';draft='';resizePrompt();$('#lab-error').textContent='';
  const request=new AbortController();controller=request;busy(true);draw();const started=Date.now();
  try{
   let result;
   if(settings.transport==='http'){
    const res=await fetch('/api/chat',{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})},body:JSON.stringify(input),signal:request.signal});
    const data=await res.json();if(!res.ok)throw Error(data.error?.message||'调用失败');result=data.choices[0].message;response.label=data.model||response.label;
   }else result=await streamChat(settings.transport,token,input,update=>{Object.assign(response,update);draw();},request.signal,tenantId);
   Object.assign(response,result);response.status=`${response.tool_calls?.length?'等待工具结果':'完成'} · ${((Date.now()-started)/1000).toFixed(1)}s`;response.thinkingOpen=false;
  }catch(error){response.status=request.signal.aborted?'已停止':'失败';if($('#lab-error'))$('#lab-error').textContent=request.signal.aborted?'已停止生成。已返回的内容保留在对话中。':error.message;}
  finally{if(controller===request)controller=null;if(root.isConnected){busy(false);draw();$('#lab-prompt').focus();}void refresh();}
 };
}
