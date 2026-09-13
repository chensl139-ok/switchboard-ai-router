import {streamChat} from './stream-client.js';
let history=[],controller=null,settings={target:'auto',transport:'sse',thinking:'auto',showThinking:true,maxTokens:2048};
const icon=(paths)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const spark=icon('<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>');
export function stopPlayground(){controller?.abort();}
export function renderPlayground({state,token,esc,refresh}){
 const root=document.querySelector('#content');
 const choices=state.providers.filter(p=>p.enabled&&p.hasKey).flatMap(p=>p.models.map(model=>({id:JSON.stringify([p.id,model]),label:p.name+' / '+model})));
 if(settings.target!=='auto'&&!choices.some(c=>c.id===settings.target))settings.target='auto';
 root.innerHTML=`<div class="heading lab-heading"><div><div class="eyebrow">MODEL PLAYGROUND</div><h1>模型实验室<span class="lab-beta">LIVE</span></h1><p>从一次对话开始，比较模型的回答与思考表现。</p></div><button id="lab-clear" class="subtle">清空对话</button></div>
 <div class="lab-layout"><section class="lab-main"><div class="lab-toolbar"><span>${spark}对话测试</span><span class="lab-state" id="lab-state">准备就绪</span></div>
 <div class="lab-messages" id="lab-messages" aria-live="polite"></div><div id="lab-error" class="lab-error" role="alert"></div>
 <form id="lab-form" class="lab-composer"><label for="lab-prompt" class="sr-only">输入消息</label><textarea id="lab-prompt" rows="3" placeholder="输入你的问题，开始一次真实调用…" required></textarea><div class="lab-compose-bottom"><span>Enter 发送 <i>·</i> Shift + Enter 换行</span><button type="button" id="lab-stop" hidden>停止生成</button><button class="primary" id="lab-send">发送 ${icon('<path d="m5 12 7-7 7 7M12 5v14"/>')}</button></div></form>
 <div class="lab-privacy">对话仅保留在当前页面内存中 · 调用按服务商规则计费</div></section>
 <aside class="lab-settings"><div class="lab-settings-heading">运行配置<span>PARAMETERS</span></div><label>服务商与模型<select id="lab-model"><option value="auto">自动路由 · 跟随后台策略</option>${choices.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>
 <label>传输方式<select id="lab-transport"><option value="sse">SSE · 增量输出</option><option value="ws">WebSocket · 实时连接</option><option value="http">HTTP · 完整响应</option></select></label>
 <div class="lab-settings-divider"></div><label>模型思考<select id="lab-thinking"><option value="auto">模型默认</option><option value="enabled">开启思考</option><option value="disabled">关闭思考</option></select></label><p class="lab-help">思考开关已适配硅基流动、DeepSeek、百炼，具体模型需支持。其他服务商请选择“模型默认”。</p>
 <label class="lab-switch"><span>显示思考内容<small>只控制显示，不影响模型计算</small></span><input id="lab-show-thinking" type="checkbox" role="switch"></label>
 <label>最大输出 Tokens<input id="lab-max-tokens" type="number" min="1" max="131072" value="${settings.maxTokens}" required></label>
 <div class="lab-call-info"><span>本次调用</span><strong id="lab-target-label"></strong><p>固定选择模型时，不会改变后台默认模型。</p></div></aside></div>`;
 const $=selector=>root.querySelector(selector);
 $('#lab-model').value=settings.target;$('#lab-transport').value=settings.transport;$('#lab-thinking').value=settings.thinking;$('#lab-show-thinking').checked=settings.showThinking;
 function targetLabel(){const el=$('#lab-model');$('#lab-target-label').textContent=el.options[el.selectedIndex]?.textContent||'自动路由';}
 function draw(){const list=$('#lab-messages');if(!list)return;const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<100;
  list.innerHTML=history.length?history.map((m,index)=>`<article class="lab-message ${m.role}"><div class="lab-speaker"><span class="lab-message-avatar">${m.role==='user'?'U':spark}</span><strong>${m.role==='user'?'你':esc(m.label||'模型回复')}</strong><small>${esc(m.status||'')}</small></div><div class="lab-message-body">${m.reasoning_content&&settings.showThinking?`<details class="lab-thought" data-thought="${index}" ${m.thinkingOpen===false?'':'open'}><summary>${icon('<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9z"/>')}思考内容<span>模型 API 返回</span></summary><div>${esc(m.reasoning_content)}</div></details>`:''}<div class="lab-answer">${esc(m.content|| (m.status==='生成中'?'':m.reasoning_content?'本次仅返回思考内容，可增加输出上限后重试。':''))}</div>${m.status==='生成中'?'<span class="lab-cursor"></span>':''}</div></article>`).join(''):
  `<div class="lab-empty"><span class="lab-empty-icon">${spark}</span><h2>一个问题，多种可能</h2><p>选择一个模型，或者让路由策略为你选择。</p><div class="lab-prompts"><button type="button" data-example="用一个生活中的例子解释什么是 API。">解释一个概念</button><button type="button" data-example="用 Python 编写一个带注释的快速排序函数。">编写一段代码</button><button type="button" data-example="给一个 AI 模型路由平台写三条简洁的产品介绍。">探索一个想法</button></div></div>`;
  list.querySelectorAll('[data-thought]').forEach(el=>el.addEventListener('toggle',()=>{const m=history[Number(el.dataset.thought)];if(m)m.thinkingOpen=el.open;}));
  if(nearBottom)list.scrollTop=list.scrollHeight;
 }
 const busy=value=>{for(const id of ['lab-model','lab-transport','lab-thinking','lab-max-tokens','lab-clear','lab-prompt','lab-send'])if($('#'+id))$('#'+id).disabled=value;if($('#lab-stop'))$('#lab-stop').hidden=!value;if($('#lab-send'))$('#lab-send').hidden=value;if($('#lab-state')){$('#lab-state').textContent=value?'正在生成':'准备就绪';$('#lab-state').classList.toggle('running',value);}};
 targetLabel();draw();busy(!!controller);
 $('#lab-model').onchange=()=>{settings.target=$('#lab-model').value;targetLabel();};
 $('#lab-transport').onchange=()=>settings.transport=$('#lab-transport').value;
 $('#lab-thinking').onchange=()=>settings.thinking=$('#lab-thinking').value;
 $('#lab-show-thinking').onchange=()=>{settings.showThinking=$('#lab-show-thinking').checked;draw();};
 $('#lab-max-tokens').onchange=()=>settings.maxTokens=Number($('#lab-max-tokens').value);
 $('#lab-clear').onclick=()=>{if(!controller){history=[];draw();$('#lab-error').textContent='';}};
 $('#lab-stop').onclick=()=>controller?.abort();
 $('#lab-messages').addEventListener('click',e=>{const button=e.target.closest('[data-example]');if(button){$('#lab-prompt').value=button.dataset.example;$('#lab-prompt').focus();}});
 $('#lab-prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(!e.repeat&&!controller)$('#lab-form').requestSubmit();}});
 $('#lab-form').onsubmit=async e=>{
  e.preventDefault();e.stopPropagation();if(controller)return;
  const prompt=$('#lab-prompt').value.trim();if(!prompt)return;
  const context=history.filter(m=>m.status!=='已停止'&&m.status!=='失败').map(({role,content,reasoning_content})=>({role,content,...(reasoning_content?{reasoning_content}:{})}));
  if(context.length>=99){$('#lab-error').textContent='对话达到上限，请清空对话后继续。';return;}
  const [model,upstream_model]=settings.target==='auto'?['auto']:JSON.parse(settings.target);
  const input={model,...(upstream_model?{upstream_model}:{}),messages:[...context,{role:'user',content:prompt}],max_tokens:settings.maxTokens,thinking_mode:settings.thinking};
  const response={role:'assistant',content:'',reasoning_content:'',status:'生成中',label:upstream_model||'自动路由',thinkingOpen:true};
  history.push({role:'user',content:prompt},response);$('#lab-prompt').value='';$('#lab-error').textContent='';
  const request=new AbortController();controller=request;busy(true);draw();const started=Date.now();
  try{
   let result;
   if(settings.transport==='http'){
    const res=await fetch('/api/chat',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input),signal:request.signal});
    const data=await res.json();if(!res.ok)throw Error(data.error?.message||'调用失败');result=data.choices[0].message;response.label=data.model||response.label;
   }else result=await streamChat(settings.transport,token,input,update=>{Object.assign(response,update);draw();},request.signal);
   Object.assign(response,result);response.status=`完成 · ${((Date.now()-started)/1000).toFixed(1)}s`;response.thinkingOpen=false;
  }catch(error){response.status=request.signal.aborted?'已停止':'失败';if($('#lab-error'))$('#lab-error').textContent=request.signal.aborted?'已停止生成。已返回的内容保留在对话中。':error.message;}
  finally{controller=null;busy(false);draw();void refresh();}
 };
}
