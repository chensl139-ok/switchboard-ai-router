import {renderMediaLab,stopMediaLab} from './media-lab.js';
import {renderModelCatalog,renderApiGuide} from './model-catalog.js';
import {startAccountUI,showLogin,accountRequest,renderMembers,renderAccount} from './accounts.js';
import {renderAnalytics,renderLogs} from './analytics.js';
import {renderPrices} from './prices.js';
import {renderPlayground,stopPlayground,resetPlayground} from './playground.js';
import {renderRouting,routeModes} from './routing.js';
import {renderApiKeys} from './api-keys.js';
import {providerCards,providerReady} from './provider-ui.js';
let modelList=[],modelEpoch=0,modelChannelAssignments={},editingProviderId='';
let token='',profile=null,state,tab=location.hash.slice(1)||'overview',toastTimer;
document.querySelector('#provider-form [name="protocol"]').closest('label').insertAdjacentHTML('afterend','<label>Anthropic 鉴权方式<select name="anthropicAuth"><option value="x-api-key">x-api-key（官方默认）</option><option value="bearer">Authorization: Bearer（部分网关）</option></select></label>');
document.querySelector('#provider-form [name="apiKey"]').closest('label').insertAdjacentHTML('afterend','<label>Metered API Key<input name="meteredApiKey" type="password" autocomplete="new-password" placeholder="留空保留已有计量密钥"></label>');
const isManager=()=>['owner','admin'].includes(profile?.role);
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={overview:'路由控制台',providers:'服务商管理',playground:'模型实验室',logs:'请求日志',api:'API 文档',keys:'API Key 管理',routing:'路由策略',analytics:'用量分析',prices:'模型价格',members:'成员与角色',account:'账户与租户',models:'模型目录',media:'媒体实验室'};
async function api(url,data){const tenantAtCall=profile?.tenantId;const r=await fetch(url,{method:data?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json',...(profile?.tenantId?{'X-Tenant-ID':profile.tenantId}:{})},...(data?{body:JSON.stringify(data)}:{})});const b=await r.json();if(profile?.tenantId!==tenantAtCall)throw Error('租户已切换，请重试');if(!r.ok){if(r.status===401)showLogin();throw Error(b.error?.message||'请求失败')}return b}
function toast(s){clearTimeout(toastTimer);$('#toast').textContent=s;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',4500)}
function navigate(next){if(!names[next]||next===tab)return;tab=next;history.pushState(null,'','#'+tab);render();window.scrollTo({top:0});$('#content').focus({preventScroll:true});}
window.addEventListener('popstate',()=>{if(!state)return;tab=names[location.hash.slice(1)]?location.hash.slice(1):'overview';render();});
const ready=providerReady;
const heading=(title,desc,action='')=>`<div class="heading"><div><div class="eyebrow">YOUR MODELS. ONE GATEWAY.</div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;
function cards(manage=false){return providerCards({state,esc,isManager:isManager(),manage})}
function logs(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>请求时间</th><th>服务商 / 模型</th><th>API Key</th><th>状态</th><th>耗时</th><th>Tokens</th></tr></thead><tbody>${rows.map(l=>`<tr><td>${esc(new Date(l.time).toLocaleString())}</td><td>${esc(l.provider)}<br><small class="muted">${esc(l.model)}</small></td><td>${esc(l.apiKeyId?l.apiKeyId.slice(0,10):'管理员 / 旧令牌')}</td><td><span class="tag ${l.status===200?'green':''}">${l.status}</span></td><td>${l.latency} ms</td><td>${l.tokens.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">还没有请求记录。配置服务商后，前往模型实验室发起第一次调用。</div>'}
function render(){
 stopPlayground();stopMediaLab();
 if(!names[tab]||(!isManager()&&['keys','members','prices','routing'].includes(tab))||(profile?.role==='viewer'&&['playground','media'].includes(tab)))tab='overview';
 history.replaceState(null,'','#'+tab);document.title=names[tab]+' · Switchboard';
 const previous=$('#content'),view=document.createElement('section');view.id='content';view.tabIndex=-1;previous.replaceWith(view);
 document.querySelectorAll('nav [data-tab]').forEach(b=>{b.hidden=(['keys','members','prices','routing'].includes(b.dataset.tab)&&!isManager())||(['playground','media'].includes(b.dataset.tab)&&profile?.role==='viewer');});
 $('#breadcrumb').textContent=names[tab];document.querySelectorAll('nav button[data-tab]').forEach(b=>{const active=b.dataset.tab===tab;b.classList.toggle('selected',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 const nav=document.querySelector('.sidebar nav'),selected=nav.querySelector('[aria-current=page]');if(selected&&matchMedia('(max-width:720px)').matches)nav.scrollLeft+=selected.getBoundingClientRect().left-nav.getBoundingClientRect().left-(nav.clientWidth-selected.clientWidth)/2;
 let html='';const active=state.providers.find(p=>p.id===state.active),total=state.logs.length,success=state.logs.filter(l=>l.status===200),average=success.length?Math.round(success.reduce((s,l)=>s+l.latency,0)/success.length):0;
 if(tab==='overview')html=heading('路由控制台','管理模型连接，掌握每一次调用。','<button id="go-providers" class="primary">管理服务商 →</button>')+`<div class="metrics"><div class="metric"><label>可用服务商</label><strong>${state.providers.filter(ready).length}<span class="muted"> / ${state.providers.length}</span></strong><small>已配置并启用的路由</small></div><div class="metric"><label>请求尝试</label><strong>${total}</strong><small>最近 500 次尝试 · 含回退</small></div><div class="metric"><label>尝试成功率</label><strong>${total?Math.round(success.length/total*100)+'%':'—'}</strong><small>基于已记录的真实调用</small></div><div class="metric"><label>平均响应时间</label><strong>${average?average+' ms':'—'}</strong><small>成功请求 · 非流式总耗时</small></div></div><div class="hero"><div><div class="eyebrow">ACTIVE ROUTE <span class="tag">${routeModes.find(m=>m[0]===state.strategy)?.[1]||'故障转移'}</span></div><h2>${esc(active?.name||'准备好，连接第一个模型。')}</h2><p>${esc(active?.model||'添加 API Key 和模型 ID 后，即可一键启用。所有应用共用一个稳定的 API 入口。')}</p><div class="route-options"><button data-strategy="fallback" ${!isManager()?'disabled':''} class="${state.strategy==='fallback'?'selected':''}">自动故障转移</button><button data-strategy="manual" ${!isManager()?'disabled':''} class="${state.strategy==='manual'?'selected':''}">仅使用默认模型</button></div></div><div class="hero-symbol">⌘</div></div><div class="section-title"><h2>模型网络</h2><span>一键切换，下一次请求立即生效</span></div>`+cards()+`<div class="section-title"><h2>最近请求</h2><button data-tab="logs" class="subtle">查看全部 →</button></div><div class="panel">${logs(state.logs.slice(0,5))}</div>`;
 if(tab==='providers')html=heading('服务商与故障转移','按优先级管理模型入口；上方服务商会被优先尝试。',isManager()?'<button id="add-provider" class="primary">＋ 添加服务商</button>':'')+`<div class="workflow-strip"><div><b>1</b><span>连接服务商<small>填写地址与密钥</small></span></div><div><b>2</b><span>选择模型<small>协议自动匹配</small></span></div><div><b>3</b><span>调整顺序<small>失败自动向下切换</small></span></div></div><div class="filter-bar"><label class="search-field"><span class="sr-only">搜索服务商或模型</span><input type="search" id="provider-search" placeholder="搜索服务商、模型名称或 ID…"></label><select id="provider-filter" aria-label="服务商状态"><option value="">全部状态</option><option value="true">可用</option><option value="false">待配置 / 未启用</option></select><span id="provider-count" class="muted"></span></div>`+cards(true)+`<div id="provider-empty" class="empty" hidden>未找到匹配服务商。试试其他关键词或调整状态筛选。</div>`+'<div class="info">只需调整顺序：越靠前优先级越高，默认服务商始终置顶。模型协议和密钥选择由系统自动处理；删除服务商不会删除历史用量日志。</div>';
 if(tab==='legacy-logs')html=heading('请求日志','仅记录路由元数据，不保存对话正文和密钥。','<button id="refresh">↻ 刷新</button>')+`<div class="panel">${logs(state.logs)}</div>`;


 $('#content').innerHTML=html||'<div class="view-loading" role="status"><span class="loading-dot"></span>正在加载…</div>';
 if(tab==='providers'){const filter=()=>{let count=0;document.querySelectorAll('[data-provider-card]').forEach(card=>{card.hidden=!card.dataset.search.includes($('#provider-search').value.trim().toLowerCase())||!!($('#provider-filter').value&&card.dataset.ready!==$('#provider-filter').value);if(!card.hidden)count++;});$('#provider-count').textContent=count+' 个服务商';$('#provider-empty').hidden=count>0;};$('#provider-search').oninput=filter;$('#provider-filter').onchange=filter;filter();}
 if(tab==='media')renderMediaLab({state,tenantId:profile?.tenantId,esc});
 if(tab==='api')renderApiGuide({esc,toast});
 if(tab==='models')renderModelCatalog({state,api,esc,toast,isManager:isManager(),onSaved:s=>{state=s;}});
 if(tab==='members')void renderMembers({profile,esc,toast});
 if(tab==='account')void renderAccount({profile,esc,toast,onReady:accountReady});
 if(tab==='analytics')void renderAnalytics({api,esc});
 if(tab==='logs')void renderLogs({api,esc,state});
 if(tab==='prices')renderPrices({state,api,esc,toast,onSaved:s=>{state=s;}});if(tab==='routing'&&isManager())renderRouting({state,api,esc,toast,updated:s=>{state=s;render();}});if(tab==='keys'&&isManager())void renderApiKeys({api,esc,toast});if(tab==='playground')renderPlayground({state,token,tenantId:profile?.tenantId,esc,refresh:async()=>{try{state=await api('/api/state')}catch(e){toast(e.message)}}});
}
function edit(id){const p=state.providers.find(p=>p.id===id)||{id:'',name:'',baseUrl:'',model:'',protocol:'openai',weight:1,enabled:false};const f=$('#provider-form');f.reset();resetModels();editingProviderId=id||'';modelChannelAssignments={...(p.modelChannels||{})};for(const k of ['id','name','baseUrl','model','protocol'])f.elements[k].value=p[k];f.elements.anthropicAuth.value=p.anthropicAuth||'x-api-key';f.elements.models.value=(p.models||[]).join('\n');f.elements.id.readOnly=!!id;f.elements.enabled.checked=p.enabled;$('#edit-error').textContent='';$('#edit').showModal()}
function resetModels(){modelEpoch++;modelList=[];$('#model-search').value='';$('#model-search').disabled=true;$('#model-results').innerHTML='';$('#model-status').textContent='填写 API Key 后获取此账户可见的模型。';$('#fetch-models').disabled=false;$('#fetch-models').textContent='↻ 获取所有模型'}
function showModels(){
 const query=$('#model-search').value.trim().toLowerCase();
 const matches=modelList.filter(m=>(m.id+' '+m.name).toLowerCase().includes(query));
 $('#model-results').innerHTML=matches.map(m=>`<button type="button" class="model-choice" data-model-id="${esc(m.id)}" data-model-channel="${m.channel}"><span>${esc(m.name)}</span>${m.name!==m.id?`<small>${esc(m.id)}</small>`:''}</button>`).join('')||'<p class="muted">没有匹配的模型</p>';
 $('#model-status').textContent=`已获取 ${modelList.length} 个模型 · 当前显示 ${matches.length} 个，点击添加至可切换模型列表，再保存配置。`;
}
$('#model-search').addEventListener('input',showModels);
$('#provider-form').addEventListener('input',e=>{if(['id','baseUrl','protocol','apiKey','meteredApiKey','clearKey'].includes(e.target.name))resetModels()});
$('#fetch-models').onclick=async()=>{
 const f=$('#provider-form'),epoch=++modelEpoch,b=$('#fetch-models');
 b.disabled=true;b.textContent='获取中…';$('#model-status').textContent='正在读取模型列表，自动获取后续分页…';$('#model-results').innerHTML='';modelList=[];$('#model-search').disabled=true;
 try{
  const payload={id:f.elements.id.value,baseUrl:f.elements.baseUrl.value,protocol:f.elements.protocol.value,anthropicAuth:f.elements.anthropicAuth.value,apiKey:f.elements.apiKey.value,meteredApiKey:f.elements.meteredApiKey.value,clearKey:f.elements.clearKey.checked};
  const current=state.providers.find(provider=>provider.id===editingProviderId),channels=[...(payload.apiKey||current?.hasKey?['subscription']:[]),...(payload.meteredApiKey||current?.hasMeteredKey?['metered']:[])];
  if(!channels.length)channels.push('subscription');
  const results=await Promise.allSettled(channels.map(channel=>api('/api/provider/models',{...payload,channel})));
  if(epoch!==modelEpoch)return;const merged=new Map();
  results.forEach((result,index)=>{if(result.status==='fulfilled')for(const model of result.value.data){const channel=channels[index];if(!merged.has(model.id)||channel==='subscription')merged.set(model.id,{...model,channel});}});
  if(!merged.size)throw results.find(result=>result.status==='rejected')?.reason||Error('没有获取到模型');
  modelList=[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id));$('#model-search').disabled=false;showModels();
  if(!modelList.length)$('#model-status').textContent='服务商返回了空列表；可手动填写模型 ID。';
 }catch(e){if(epoch===modelEpoch)$('#model-status').textContent=e.message}
 finally{if(epoch===modelEpoch){b.disabled=false;b.textContent='↻ 重新获取所有模型'}}
};
$('#logout').onclick=async()=>{try{await accountRequest('logout',{});profile=null;state=null;token='';resetPlayground();stopMediaLab();$('#current-account').textContent='';document.querySelector('.workspace-chip').textContent='登录后选择租户';$('#content').innerHTML='';showLogin();}catch(e){toast(e.message)}};
$('#close-edit').onclick=()=>$('#edit').close();
$('#cancel-edit').onclick=()=>$('#edit').close();
$('#edit').addEventListener('close',()=>{resetModels();editingProviderId='';modelChannelAssignments={};});
$('#provider-form').onsubmit=async e=>{e.preventDefault();const f=e.target,submit=f.querySelector('[type=submit]'),b=Object.fromEntries(new FormData(f));if(submit.disabled)return;submit.disabled=true;submit.textContent='保存中…';b.enabled=f.elements.enabled.checked;b.clearKey=f.elements.clearKey.checked;b.models=f.elements.models.value.split('\n').map(m=>m.trim()).filter(Boolean);b.modelChannels=Object.fromEntries(b.models.filter(model=>modelChannelAssignments[model]==='metered').map(model=>[model,'metered']));try{state=await api('/api/provider',b);f.elements.apiKey.value='';f.elements.meteredApiKey.value='';$('#edit').close();render();toast('服务商配置已保存，协议与密钥路由已自动匹配')}catch(e){$('#edit-error').textContent=e.message}finally{submit.disabled=false;submit.textContent='保存配置'}};
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
 if(b.dataset.modelId){const f=$('#provider-form'),items=f.elements.models.value.split('\n').map(m=>m.trim()).filter(Boolean);f.elements.models.value=[...new Set([...items,b.dataset.modelId])].join('\n');modelChannelAssignments[b.dataset.modelId]=b.dataset.modelChannel;if(!f.elements.model.value)f.elements.model.value=b.dataset.modelId;$('#model-status').textContent='已添加 '+b.dataset.modelId+'，协议与密钥将自动匹配。'}
 if(b.dataset.tab){navigate(b.dataset.tab)}
 if(b.id==='go-providers'){navigate('providers')}
 if(b.dataset.edit&&isManager())edit(b.dataset.edit);
 if(b.id==='add-provider'&&isManager())edit();
 if(b.dataset.providerMove&&isManager()){const index=state.providers.findIndex(provider=>provider.id===b.dataset.providerId),next=b.dataset.providerMove==='up'?index-1:index+1,ids=state.providers.map(provider=>provider.id);if(index>=0&&next>=0&&next<ids.length){[ids[index],ids[next]]=[ids[next],ids[index]];state=await api('/api/provider/reorder',{ids});render();toast('故障转移顺序已更新')}}
 if(b.dataset.providerDelete&&isManager()){const provider=state.providers.find(item=>item.id===b.dataset.providerDelete);if(provider&&confirm(`删除服务商“${provider.name}”？模型配置和密钥将被移除，历史日志会保留。`)){state=await api('/api/provider/delete',{id:provider.id});render();toast('服务商已删除')}}
 if(b.dataset.switch){b.disabled=true;state=await api('/api/routing',{active:b.dataset.switch,strategy:state.strategy});render();toast('默认模型已切换，下一次调用生效')}
 if(b.dataset.strategy&&isManager()){b.disabled=true;state=await api('/api/routing',{active:state.active,strategy:b.dataset.strategy});render();toast('路由策略已更新')}
 if(b.id==='refresh'){await accountReady(await accountRequest('me'));}
 }catch(e){toast(e.message);b.disabled=false}});
document.addEventListener('change',async e=>{const id=e.target.dataset.providerModel;if(!id)return;const select=e.target;select.disabled=true;try{state=await api('/api/provider/switch-model',{id,model:select.value});render();toast('服务商模型已切换，下一次调用生效')}catch(err){select.value=state.providers.find(p=>p.id===id).model;toast(err.message)}finally{select.disabled=false}});

async function accountReady(value){
 const previous=profile?.tenantId,previousUser=profile?.user?.id;profile=value;token='';sessionStorage.removeItem('router-token');
 if(previous&&(previous!==profile.tenantId||previousUser!==profile.user.id)){resetPlayground();stopMediaLab();tab='overview';}
 const chip=document.querySelector('.workspace-chip');chip.innerHTML='<label class="tenant-label">当前租户<select id="tenant-select" aria-label="切换租户"></select></label>';
 const select=document.querySelector('#tenant-select');select.innerHTML=profile.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');select.value=profile.tenantId;
 select.onchange=async()=>{try{resetPlayground();await accountReady(await accountRequest('switch',{tenantId:select.value}));}catch(e){toast(e.message);select.value=profile.tenantId;}};
 document.querySelector('#current-account').textContent=profile.user.name+' · '+({owner:'所有者',admin:'管理员',member:'成员',viewer:'只读'}[profile.role]);
 state=await api('/api/state');if(!isManager()&&['keys','members','prices','routing'].includes(tab))tab='overview';render();
}
try{await startAccountUI(accountReady);}catch(error){$('#content').textContent=error.message;}


const sidebarToggle=document.querySelector('#sidebar-toggle');
function setSidebarCompact(compact){
 document.body.classList.toggle('sidebar-compact',compact);
 sidebarToggle.setAttribute('aria-expanded',String(!compact));
 sidebarToggle.setAttribute('aria-label',compact?'展开侧边栏':'收起侧边栏');
 sidebarToggle.title=compact?'展开侧边栏':'收起侧边栏';
}
try{setSidebarCompact(localStorage.getItem('sidebar-compact')==='true')}catch{setSidebarCompact(false)}
sidebarToggle.addEventListener('click',()=>{const compact=!document.body.classList.contains('sidebar-compact');setSidebarCompact(compact);try{localStorage.setItem('sidebar-compact',String(compact))}catch{/* Optional appearance preference. */}});
