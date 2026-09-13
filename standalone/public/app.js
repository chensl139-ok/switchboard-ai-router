import {renderApiKeys} from './api-keys.js';
import {streamChat} from './stream-client.js';
let chatAbort=null;
let modelList=[],modelEpoch=0,chatBusy=false;
let token=sessionStorage.getItem('router-token')||'',state,tab='overview',messages=[];
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={overview:'路由控制台',providers:'服务商管理',playground:'模型实验室',logs:'请求日志',api:'API 接入',keys:'API Key 管理'};
async function api(url,data){const r=await fetch(url,{method:data?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const b=await r.json();if(!r.ok){if(r.status===401&&!$('#login').open)$('#login').showModal();throw Error(b.error?.message||'请求失败')}return b}
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',3500)}
const ready=p=>p.enabled&&p.hasKey&&p.model;
const heading=(title,desc,action='')=>`<div class="heading"><div><div class="eyebrow">YOUR MODELS. ONE GATEWAY.</div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;
function cards(){return `<div class="cards">${state.providers.map(p=>`<article class="card ${state.active===p.id?'active':''}"><div class="card-top"><div class="avatar">${esc(p.name[0])}</div><h3>${esc(p.name)}</h3><span class="tag ${ready(p)?'green':''}">${state.active===p.id?'默认路由':ready(p)?'已启用':'待配置'}</span></div><label>当前模型<select data-provider-model="${esc(p.id)}" ${!p.models?.length?'disabled':''}>${(p.models?.length?p.models:['']).map(m=>`<option value="${esc(m)}" ${m===p.model?'selected':''}>${esc(m||'尚未设置模型')}</option>`).join('')}</select></label><div class="card-actions"><button data-edit="${esc(p.id)}">配置服务商 ↗</button><button data-switch="${esc(p.id)}" ${!ready(p)||state.active===p.id?'disabled':''}>${state.active===p.id?'✓ 当前使用':'切换使用 →'}</button></div></article>`).join('')}</div>`}
function logs(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>请求时间</th><th>服务商 / 模型</th><th>API Key</th><th>状态</th><th>耗时</th><th>Tokens</th></tr></thead><tbody>${rows.map(l=>`<tr><td>${esc(new Date(l.time).toLocaleString())}</td><td>${esc(l.provider)}<br><small class="muted">${esc(l.model)}</small></td><td>${esc(l.apiKeyId?l.apiKeyId.slice(0,10):'管理员 / 旧令牌')}</td><td><span class="tag ${l.status===200?'green':''}">${l.status}</span></td><td>${l.latency} ms</td><td>${l.tokens.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">还没有请求记录。配置服务商后，前往模型实验室发起第一次调用。</div>'}
function render(){
 $('#breadcrumb').textContent=names[tab];document.querySelectorAll('nav button[data-tab]').forEach(b=>{const active=b.dataset.tab===tab;b.classList.toggle('selected',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 let html='';const active=state.providers.find(p=>p.id===state.active),total=state.logs.length,success=state.logs.filter(l=>l.status===200),average=success.length?Math.round(success.reduce((s,l)=>s+l.latency,0)/success.length):0;
 if(tab==='overview')html=heading('让每一次调用，都有最优路径。','连接你的模型服务商，在一个工作空间里切换、测试与观测。','<button id="go-providers">＋ 接入服务商</button>')+`<div class="metrics"><div class="metric"><label>可用服务商</label><strong>${state.providers.filter(ready).length}<span class="muted"> / ${state.providers.length}</span></strong><small>已配置并启用的路由</small></div><div class="metric"><label>请求尝试</label><strong>${total}</strong><small>最近 500 次尝试 · 含回退</small></div><div class="metric"><label>尝试成功率</label><strong>${total?Math.round(success.length/total*100)+'%':'—'}</strong><small>基于已记录的真实调用</small></div><div class="metric"><label>平均响应时间</label><strong>${average?average+' ms':'—'}</strong><small>成功请求 · 非流式总耗时</small></div></div><div class="hero"><div><div class="eyebrow">ACTIVE ROUTE <span class="tag">${state.strategy==='fallback'?'自动故障转移':'手动指定'}</span></div><h2>${esc(active?.name||'准备好，连接第一个模型。')}</h2><p>${esc(active?.model||'添加 API Key 和模型 ID 后，即可一键启用。所有应用共用一个稳定的 API 入口。')}</p><div class="route-options"><button data-strategy="fallback" class="${state.strategy==='fallback'?'selected':''}">自动故障转移</button><button data-strategy="manual" class="${state.strategy==='manual'?'selected':''}">仅使用默认模型</button></div></div><div class="hero-symbol">⌘</div></div><div class="section-title"><h2>模型网络</h2><span>一键切换，下一次请求立即生效</span></div>`+cards()+`<div class="section-title"><h2>最近请求</h2><button data-tab="logs" class="subtle">查看全部 →</button></div><div class="panel">${logs(state.logs.slice(0,5))}</div>`;
 if(tab==='providers')html=heading('你的模型网络','预置主流服务商，也支持任意 OpenAI 兼容接口。','<button id="add-provider" class="primary">＋ 自定义服务商</button>')+cards()+'<div class="info">配置服务商时可点击「获取所有模型」并搜索选择；同一服务商可保存多个模型，在卡片下拉框直接切换，共用一份密钥。启用只表示配置完整，实际连通性请在实验室验证。</div>';
 if(tab==='logs')html=heading('请求日志','仅记录路由元数据，不保存对话正文和密钥。','<button id="refresh">↻ 刷新</button>')+`<div class="panel">${logs(state.logs)}</div>`;
 if(tab==='playground')html=heading('模型实验室','用一次真实对话，验证你的模型与路由配置。','<button id="clear-chat">清空对话</button>')+`<div class="chat-layout"><div class="panel"><h3>运行参数</h3><label>传输模式<select id="chat-transport"><option value="sse">SSE 实时输出</option><option value="ws">WebSocket 实时输出</option><option value="http">标准 HTTP</option></select></label><label>调用路由<select id="chat-model"><option value="auto">auto · 跟随路由策略</option>${state.providers.filter(ready).map(p=>`<optgroup label="${esc(p.name)}"><option value="${esc(JSON.stringify([p.id,null]))}">跟随服务商当前模型 · ${esc(p.model)}</option>${p.models.map(m=>`<option value="${esc(JSON.stringify([p.id,m]))}">${esc(m)}</option>`).join('')}</optgroup>`).join('')}</select></label><label>最大输出 Tokens<input id="max-tokens" type="number" min="1" max="131072" value="2048"></label><p class="muted">显式选择服务商时，不触发跨平台回退。对话仅保留在当前页面内存中。</p></div><div class="panel"><div class="chat-window" id="chat-messages"></div><form id="chat-form" class="composer"><textarea id="prompt" required placeholder="Enter 发送，Shift+Enter 换行" aria-label="聊天消息"></textarea><button class="primary" id="send">发送 ↗</button><button type="button" id="stop-chat">停止</button></form></div></div>`;
 if(tab==='api')html=heading('一个 API，所有模型','将现有应用的 Base URL 指向此网关，即可在后台切换模型。')+`<div class="panel"><h2>统一调用入口</h2><p>Base URL：<code>${esc(location.origin)}/v1</code></p><p>在「API Key 管理」创建应用专用密钥，可设置次数配额和有效期。</p><pre>${esc(`curl ${location.origin}/v1/chat/completions \\\n  -H "Authorization: Bearer YOUR_GATEWAY_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"stream":false}'`)}</pre><div class="info">model="auto" 使用后台路由策略；指定服务商路由 ID 可固定调用。当前支持文本多轮对话、max_tokens 和 temperature，支持 SSE / WebSocket 流式；暂不支持工具调用、图像及音频。切换不会迁移第三方聊天产品中的历史记录。</div></div>`;
 $('#content').innerHTML=html;if(tab==='keys')void renderApiKeys({api,esc,toast});if(tab==='playground')renderMessages();
}
function renderMessages(){const el=$('#chat-messages');if(!el)return;el.innerHTML=messages.length?messages.map(m=>`<div class="message ${m.role==='user'?'user':''}"><small>${m.role==='user'?'YOU':'ASSISTANT'}</small>${esc(m.content)}</div>`).join(''):'<div class="empty">⌘<h2>把想法交给模型</h2>配置好服务商后，在这里开始第一次对话。</div>';el.scrollTop=el.scrollHeight}
function edit(id){const p=state.providers.find(p=>p.id===id)||{id:'',name:'',baseUrl:'',model:'',protocol:'openai',priority:50,enabled:false};const f=$('#provider-form');f.reset();resetModels();for(const k of ['id','name','baseUrl','model','protocol','priority'])f.elements[k].value=p[k];f.elements.models.value=(p.models||[]).join('\n');f.elements.id.readOnly=!!id;f.elements.enabled.checked=p.enabled;$('#edit-error').textContent='';$('#edit').showModal()}
function resetModels(){modelEpoch++;modelList=[];$('#model-search').value='';$('#model-search').disabled=true;$('#model-results').innerHTML='';$('#model-status').textContent='填写 API Key 后获取此账户可见的模型。';$('#fetch-models').disabled=false;$('#fetch-models').textContent='↻ 获取所有模型'}
function showModels(){
 const query=$('#model-search').value.trim().toLowerCase();
 const matches=modelList.filter(m=>(m.id+' '+m.name).toLowerCase().includes(query));
 $('#model-results').innerHTML=matches.map(m=>`<button type="button" class="model-choice" data-model-id="${esc(m.id)}"><span>${esc(m.name)}</span>${m.name!==m.id?`<small>${esc(m.id)}</small>`:''}</button>`).join('')||'<p class="muted">没有匹配的模型</p>';
 $('#model-status').textContent=`已获取 ${modelList.length} 个模型 · 当前显示 ${matches.length} 个，点击添加至可切换模型列表，再保存配置。`;
}
$('#model-search').addEventListener('input',showModels);
$('#provider-form').addEventListener('input',e=>{if(['id','baseUrl','protocol','apiKey','clearKey'].includes(e.target.name))resetModels()});
$('#fetch-models').onclick=async()=>{
 const f=$('#provider-form'),epoch=++modelEpoch,b=$('#fetch-models');
 b.disabled=true;b.textContent='获取中…';$('#model-status').textContent='正在读取模型列表，自动获取后续分页…';$('#model-results').innerHTML='';modelList=[];$('#model-search').disabled=true;
 try{
  const out=await api('/api/provider/models',{id:f.elements.id.value,baseUrl:f.elements.baseUrl.value,protocol:f.elements.protocol.value,apiKey:f.elements.apiKey.value,clearKey:f.elements.clearKey.checked});
  if(epoch!==modelEpoch)return;
  modelList=out.data;$('#model-search').disabled=false;showModels();
  if(!modelList.length)$('#model-status').textContent='服务商返回了空列表；可手动填写模型 ID。';
 }catch(e){if(epoch===modelEpoch)$('#model-status').textContent=e.message}
 finally{if(epoch===modelEpoch){b.disabled=false;b.textContent='↻ 重新获取所有模型'}}
};
$('#login-form').onsubmit=async e=>{e.preventDefault();token=$('#token').value;try{state=await api('/api/state');sessionStorage.setItem('router-token',token);$('#token').value='';$('#login').close();render()}catch(e){$('#login-error').textContent=e.message}};
$('#login').addEventListener('cancel',e=>e.preventDefault());
$('#logout').onclick=()=>{sessionStorage.removeItem('router-token');token='';state=null;messages=[];$('#content').innerHTML='';$('#login').showModal()};
$('#close-edit').onclick=()=>$('#edit').close();
$('#edit').addEventListener('close',resetModels);
$('#provider-form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=Object.fromEntries(new FormData(f));b.enabled=f.elements.enabled.checked;b.clearKey=f.elements.clearKey.checked;b.priority=Number(b.priority);b.models=f.elements.models.value.split('\n').map(m=>m.trim()).filter(Boolean);try{state=await api('/api/provider',b);f.elements.apiKey.value='';$('#edit').close();render();toast('服务商配置已保存')}catch(e){$('#edit-error').textContent=e.message}};
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
 if(b.dataset.modelId){const f=$('#provider-form'),items=f.elements.models.value.split('\n').map(m=>m.trim()).filter(Boolean);f.elements.models.value=[...new Set([...items,b.dataset.modelId])].join('\n');if(!f.elements.model.value)f.elements.model.value=b.dataset.modelId;$('#model-status').textContent='已添加 '+b.dataset.modelId+'，可继续添加其他模型；保存后生效。'}
 if(b.dataset.tab){tab=b.dataset.tab;render()}
 if(b.id==='go-providers'){tab='providers';render()}
 if(b.dataset.edit)edit(b.dataset.edit);
 if(b.id==='add-provider')edit();
 if(b.dataset.switch){state=await api('/api/routing',{active:b.dataset.switch,strategy:state.strategy});render();toast('默认模型已切换，下一次调用生效')}
 if(b.dataset.strategy){state=await api('/api/routing',{active:state.active,strategy:b.dataset.strategy});render();toast('路由策略已更新')}
 if(b.id==='refresh'){state=await api('/api/state');render()}
 if(b.id==='stop-chat')chatAbort?.abort();
 if(b.id==='clear-chat'&&!chatBusy){messages=[];renderMessages()}
 }catch(e){toast(e.message)}});
document.addEventListener('change',async e=>{const id=e.target.dataset.providerModel;if(!id)return;const select=e.target;select.disabled=true;try{state=await api('/api/provider/switch-model',{id,model:select.value});render();toast('服务商模型已切换，下一次调用生效')}catch(err){select.value=state.providers.find(p=>p.id===id).model;toast(err.message)}finally{select.disabled=false}});
document.addEventListener('keydown',e=>{if(e.target.id!=='prompt'||e.key!=='Enter'||e.shiftKey||e.isComposing||e.keyCode===229)return;e.preventDefault();if(!e.repeat&&!chatBusy)e.target.form.requestSubmit()});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='chat-form')return;e.preventDefault();if(chatBusy)return;
 const prompt=$('#prompt').value.trim();if(!prompt)return;
 const transport=$('#chat-transport').value,selected=$('#chat-model').value;
 const [model,upstream_model]=selected==='auto'?['auto',null]:JSON.parse(selected);
 const input={model,...(upstream_model?{upstream_model}:{}),messages:[...messages,{role:'user',content:prompt}],max_tokens:Number($('#max-tokens').value)};
 const send=$('#send');chatBusy=true;chatAbort=new AbortController();send.disabled=true;send.textContent='生成中…';
 const previous=messages;messages=[...input.messages,{role:'assistant',content:'生成中…'}];renderMessages();
 try{
  const content=transport==='http'?(await api('/api/chat',input)).choices[0].message.content:
   await streamChat(transport,token,input,text=>{messages=[...input.messages,{role:'assistant',content:text}];renderMessages()},chatAbort.signal);
  messages=[...input.messages,{role:'assistant',content:content||'（模型返回空文本）'}];renderMessages();
  if($('#prompt'))$('#prompt').value='';state=await api('/api/state');
 }catch(error){messages=previous;renderMessages();toast(error.message)}
 finally{chatBusy=false;chatAbort=null;send.disabled=false;send.textContent='发送 ↗'}
});
try{if(token){state=await api('/api/state');render()}else $('#login').showModal()}catch{$('#login').showModal()}

const sidebarToggle=document.querySelector('#sidebar-toggle');
function setSidebarCompact(compact){
 document.body.classList.toggle('sidebar-compact',compact);
 sidebarToggle.setAttribute('aria-expanded',String(!compact));
 sidebarToggle.setAttribute('aria-label',compact?'展开侧边栏':'收起侧边栏');
 sidebarToggle.title=compact?'展开侧边栏':'收起侧边栏';
}
try{setSidebarCompact(localStorage.getItem('sidebar-compact')==='true')}catch{setSidebarCompact(false)}
sidebarToggle.addEventListener('click',()=>{const compact=!document.body.classList.contains('sidebar-compact');setSidebarCompact(compact);try{localStorage.setItem('sidebar-compact',String(compact))}catch{/* Optional appearance preference. */}});
