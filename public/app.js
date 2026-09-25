import {renderMediaLab,stopMediaLab} from './media-lab.js';
import {renderModelCatalog} from './model-catalog.js';
import {renderApiGuide} from './api-docs.js';
import {startAccountUI,showLogin,accountRequest,renderMembers,renderAccount,confirmAction} from './accounts.js';
import {renderAnalytics,renderLogs} from './analytics.js';
import {renderPrices} from './prices.js';
import {renderPlayground,stopPlayground,resetPlayground} from './playground.js';
import {renderRouting} from './routing.js';
import {renderApiKeys} from './api-keys.js';
import {providerCards,providerReady,refreshProviderHealth} from './provider-ui.js';
import {renderDashboard,renderDashboardRoutePreview,renderDashboardSummary} from './dashboard.js';
import {renderAudit} from './audit.js';
import {modelCapabilities} from './model-capability.js';
let modelList=[],modelSelected=new Set(),modelEpoch=0,modelChannelAssignments={},editingProviderId='';
let token='',profile=null,state,tab=location.hash.slice(1)||'overview',toastTimer,providerPoll;
// 导航重组：模型价格并入用量分析、组织审计并入成员与角色，均为页面内二级标签
const names={overview:'路由控制台',providers:'服务商与模型',playground:'模型实验室',logs:'请求日志',api:'API 文档',keys:'API Key 管理',routing:'路由策略',analytics:'用量分析',audit:'组织审计',prices:'模型价格',members:'成员与角色',account:'账户与租户',models:'模型目录',media:'媒体实验室'};
const groups={providers:['providers','models'],playground:['playground','media'],analytics:['analytics','prices'],members:['members','audit']};
const managerViews=new Set(['keys','members','prices','routing','audit']);
document.querySelector('#provider-form [name="protocol"]').closest('label').insertAdjacentHTML('afterend','<label>Anthropic 鉴权方式<select name="anthropicAuth"><option value="x-api-key">x-api-key（官方默认）</option><option value="bearer">Authorization: Bearer（部分网关）</option></select></label>');
document.querySelector('[data-tab="providers"] .nav-name').textContent='服务商与模型';
document.querySelector('[data-tab="models"]')?.remove();
document.querySelector('[data-tab="media"]')?.remove();
const navDetails={providers:'服务商 · 模型目录',playground:'对话 · 媒体',analytics:'用量 · 模型价格',members:'成员 · 审计'};
for(const [id,detail] of Object.entries(navDetails)){
 const button=document.querySelector(`.sidebar [data-tab="${id}"]`),name=button?.querySelector('.nav-name');if(!name)continue;
 const copy=document.createElement('span'),sub=document.createElement('small');copy.className='nav-copy';sub.className='nav-children';sub.textContent=detail;name.before(copy);copy.append(name,sub);
 button.title=`${name.textContent}：${detail}`;button.setAttribute('aria-label',button.title);
}
for(const [node,label] of [...document.querySelectorAll('.sidebar .nav-label')].map((node,index)=>[node,['核心工作流','开发接入','团队与用量'][index]]))node.textContent=label;
document.querySelector('#provider-form [name="apiKey"]').closest('label').insertAdjacentHTML('afterend','<details class="key-advanced"><summary>备用密钥（可选）<small>同服务商配置第二把 Key 用于故障转移；只配一把时无需关心</small></summary><label>Metered API Key<input name="meteredApiKey" type="password" autocomplete="new-password" placeholder="留空保留已有备用密钥"></label></details>');
const providerForm=document.querySelector('#provider-form'),providerTitle=providerForm.querySelector('.modal-title'),providerActions=providerForm.querySelector('.dialog-actions'),providerBody=document.createElement('div');
providerBody.className='provider-form-body';
while(providerTitle.nextSibling!==providerActions)providerBody.append(providerTitle.nextSibling);
providerActions.before(providerBody);
const defaultModelField=providerForm.elements.model.closest('label');
const manualModelField=providerForm.elements.models.closest('label');
const modelPicker=providerForm.querySelector('.model-picker');
const modelSection=document.createElement('section');
modelSection.className='provider-model-section';
modelSection.innerHTML='<div class="provider-model-heading"><div><span class="eyebrow">MODEL ACCESS</span><h3>模型与调用列表</h3></div><small id="configured-model-count">0 个已选模型</small></div>';
defaultModelField.before(modelSection);
defaultModelField.firstChild.textContent='默认模型 ID';
providerForm.elements.model.setAttribute('list','provider-default-model-options');
const defaultModelOptions=document.createElement('datalist');defaultModelOptions.id='provider-default-model-options';defaultModelField.append(defaultModelOptions);
defaultModelField.insertAdjacentHTML('beforeend','<small class="field-help">默认模型会加入调用列表；取消勾选当前默认模型时，自动切换到其他已选对话模型。</small>');
modelSection.append(defaultModelField,modelPicker);
const manualModels=document.createElement('details');
manualModels.className='model-manual';
manualModels.innerHTML='<summary>手动编辑模型 ID <small>仅在服务商不支持获取列表或需要自定义 ID 时使用</small></summary>';
manualModelField.firstChild.textContent='可切换模型（每行一个 ID）';
manualModels.append(manualModelField);
modelSection.append(manualModels);
providerForm.querySelectorAll('[data-model-bulk="invert"], [data-model-bulk="clear"]').forEach(button=>button.remove());

const isManager=()=>['owner','admin'].includes(profile?.role);
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const navigationHint=document.createElement('div');navigationHint.id='navigation-hint';navigationHint.setAttribute('role','tooltip');navigationHint.hidden=true;document.body.append(navigationHint);
function bindNavigationHint(element,label,enabled=()=>true){
 const show=()=>{if(!enabled())return;navigationHint.textContent=label();navigationHint.hidden=false;const rect=element.getBoundingClientRect(),width=navigationHint.offsetWidth,height=navigationHint.offsetHeight;let left=rect.right+10;if(left+width>innerWidth-8)left=rect.left-width-10;navigationHint.style.left=Math.max(8,left)+'px';navigationHint.style.top=Math.max(8,Math.min(rect.top+(rect.height-height)/2,innerHeight-height-8))+'px';};
 const hide=()=>navigationHint.hidden=true;
 element.addEventListener('pointerenter',show);element.addEventListener('focus',show);element.addEventListener('pointerleave',hide);element.addEventListener('blur',hide);
 return {show,hide};
}
async function api(url,data){const tenantAtCall=profile?.tenantId;const r=await fetch(url,{method:data?'POST':'GET',headers:{...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json',...(profile?.tenantId?{'X-Tenant-ID':profile.tenantId}:{})},...(data?{body:JSON.stringify(data)}:{})});const b=await r.json();if(profile?.tenantId!==tenantAtCall)throw Error('租户已切换，请重试');if(!r.ok){if(r.status===401)showLogin();const id=r.headers.get('x-request-id');throw Error((b.error?.message||'请求失败')+(id?` · 请求 ID ${id}`:''))}return b}
function toast(s){clearTimeout(toastTimer);$('#toast').textContent=s;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',4500)}
function navigate(next){if(!names[next]||next===tab)return;tab=next;history.pushState(null,'','#'+tab);render();window.scrollTo({top:0});$('#content').focus({preventScroll:true});}
window.addEventListener('popstate',()=>{if(!state)return;tab=names[location.hash.slice(1)]?location.hash.slice(1):'overview';render();});
const ready=providerReady;
const heading=(title,desc,action='')=>`<div class="heading"><div><div class="eyebrow">YOUR MODELS. ONE GATEWAY.</div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;
function cards(manage=false){return providerCards({state,esc,isManager:isManager(),manage})}
const pageTabs=options=>`<div class="page-tabs" role="tablist">${options.map(([id,label])=>`<button type="button" role="tab" data-pagetab="${id}" aria-selected="${tab===id}" class="${tab===id?'selected':''}">${label}</button>`).join('')}</div>`;
const canOpen=view=>Boolean(names[view])&&(isManager()||!managerViews.has(view))&&!(profile?.role==='viewer'&&groups.playground.includes(view));

function syncNavigation(){
 const parent=Object.keys(groups).find(key=>key!==tab&&groups[key].includes(tab));
 $('#page-parent').textContent=parent?names[parent]:'工作空间';
 $('#breadcrumb').textContent=names[tab];
 for(const button of document.querySelectorAll('nav button[data-tab]')){
  const view=button.dataset.tab;
  button.hidden=(!isManager()&&['keys','members','routing'].includes(view))||(profile?.role==='viewer'&&groups.playground.includes(view));
  const active=(groups[view]||[view]).includes(tab);
  button.classList.toggle('selected',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 }
 const nav=document.querySelector('.sidebar nav'),selected=nav.querySelector('[aria-current=page]');
 if(selected&&matchMedia('(max-width:720px)').matches)nav.scrollLeft+=selected.getBoundingClientRect().left-nav.getBoundingClientRect().left-(nav.clientWidth-selected.clientWidth)/2;
}

function renderProviderFilter(root){
 const search=root.querySelector('#provider-search'),status=root.querySelector('#provider-filter');
 const filter=()=>{
  let count=0;
  for(const card of root.querySelectorAll('[data-provider-card]')){
   card.hidden=!card.dataset.search.includes(search.value.trim().toLowerCase())||Boolean(status.value&&card.dataset.ready!==status.value);
   if(!card.hidden)count++;
  }
  root.querySelector('#provider-count').textContent=count+' 个服务商';
  root.querySelector('#provider-empty').hidden=count>0;
 };
 search.oninput=filter;status.onchange=filter;filter();
 const tenantId=profile?.tenantId,indicator=root.querySelector('#provider-live');let busy=false;
 const refresh=async()=>{
  if(busy||document.visibilityState==='hidden'||!root.isConnected||tab!=='providers'||profile?.tenantId!==tenantId)return;
  busy=true;try{const result=await api('/api/logs?limit=100');if(!root.isConnected||profile?.tenantId!==tenantId)return;state.logs=result.items;refreshProviderHealth(root,state.providers,state.logs);if(indicator)indicator.textContent=`已更新 ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}
  catch{if(indicator)indicator.textContent='更新暂停 · 稍后重试';}finally{busy=false;}
 };
 providerPoll={timer:setInterval(refresh,10000),refresh};
 void refresh();
}

function initialPageHtml(){
 if(tab==='overview')return renderDashboard({state,esc,ready,isManager:isManager()});
 if(groups.providers.includes(tab)){
  const header=heading('服务商与模型','一处配置服务商与模型；按优先级排序，失败自动切换到下一个。',isManager()?'<button id="add-provider" class="primary">＋ 添加服务商</button>':'');
  const tabs=pageTabs([['providers','服务商'],['models','模型目录']]);
  if(tab==='models')return header+tabs;
  return header+tabs+`<div class="workflow-strip"><div><b>1</b><span>连接服务商<small>填写地址与密钥</small></span></div><div><b>2</b><span>选择模型<small>协议自动匹配</small></span></div><div><b>3</b><span>调整顺序<small>失败自动向下切换</small></span></div></div><div class="filter-bar"><label class="search-field"><span class="sr-only">搜索服务商或模型</span><input type="search" id="provider-search" placeholder="搜索服务商、模型名称或 ID…"></label><select id="provider-filter" aria-label="服务商状态"><option value="">全部状态</option><option value="true">可用</option><option value="false">待配置 / 未启用</option></select><span id="provider-count" class="muted"></span><span id="provider-live" class="provider-live" role="status">正在更新调用状态…</span></div>`+cards(true)+`<div id="provider-empty" class="empty" hidden>未找到匹配服务商。试试其他关键词或调整状态筛选。</div><div class="info">只需调整顺序：越靠前优先级越高，默认服务商始终置顶。模型协议和密钥选择由系统自动处理；删除服务商不会删除历史用量日志。</div>`;
 }
 if(groups.playground.includes(tab))return heading('模型实验室','在同一工作区测试对话与媒体模型；调用设置仅影响本次实验。')+`<div class="lab-nav-row">${pageTabs([['playground','对话'],['media','媒体']])}<div id="lab-page-actions" class="lab-embedded-toolbar"></div></div>`;
 return '<div class="view-loading" role="status"><span class="loading-dot"></span>正在加载…</div>';
}

function renderPage(root){
 const analyticsTabs=pageTabs([['analytics','用量分析'],...(isManager()?[['prices','模型价格']]:[])]);
 const membersTabs=pageTabs([['members','成员与角色'],['audit','组织审计']]);
 switch(tab){
  case 'overview':void api('/api/routing/preview',{model:'auto'}).then(preview=>{if(root.isConnected)renderDashboardRoutePreview(root,preview,esc);}).catch(error=>{if(root.isConnected){root.querySelector('#dashboard-route-chain').textContent='路由预览暂不可用';root.querySelector('#dashboard-route-note').textContent=error.message;}});void api('/api/analytics?days=7').then(summary=>{if(root.isConnected)renderDashboardSummary(root,summary);}).catch(()=>{if(root.isConnected)root.querySelector('#dashboard-final-detail').textContent='用量数据暂不可用';});break;
  case 'providers':renderProviderFilter(root);break;
  case 'models':renderModelCatalog({state,api,esc,toast,isManager:isManager(),onSaved:s=>{state=s;},embedded:true});break;
  case 'playground':renderPlayground({state,token,tenantId:profile?.tenantId,esc,embedded:true,renderView:render,navigate,refresh:async()=>{try{state=await api('/api/state')}catch(e){toast(e.message)}}});break;
  case 'media':renderMediaLab({state,tenantId:profile?.tenantId,esc,embedded:true});break;
  case 'api':renderApiGuide({esc,toast});break;
  case 'members':void renderMembers({profile,esc,toast,prefix:membersTabs});return;
  case 'audit':void renderAudit({esc});root.querySelector('.heading')?.insertAdjacentHTML('afterend',membersTabs);break;
  case 'account':void renderAccount({profile,esc,toast,onReady:accountReady});break;
  case 'analytics':void renderAnalytics({api,esc,isOwner:profile?.role==='owner',toast});root.querySelector('.heading')?.insertAdjacentHTML('afterend',analyticsTabs);break;
  case 'prices':renderPrices({state,api,esc,toast,onSaved:s=>{state=s;}});root.querySelector('.heading')?.insertAdjacentHTML('afterend',analyticsTabs);break;
  case 'logs':void renderLogs({api,esc,state});break;
  case 'routing':renderRouting({state,api,esc,toast,updated:s=>{state=s;render();}});break;
  case 'keys':void renderApiKeys({api,esc,toast});break;
 }
}

function render(){
 if(providerPoll){clearInterval(providerPoll.timer);providerPoll=undefined;}
 stopPlayground();stopMediaLab();
 if(!canOpen(tab))tab='overview';
 history.replaceState(null,'','#'+tab);document.title=names[tab]+' · Switchboard';
 const root=document.createElement('section');root.id='content';root.tabIndex=-1;
 if(groups.playground.includes(tab))root.classList.add('lab-page');
 $('#content').replaceWith(root);
 syncNavigation();
 root.innerHTML=initialPageHtml();
 if(tab==='overview')$('#breadcrumb').textContent=root.querySelector('.dashboard-heading h1')?.textContent||names.overview;
 renderPage(root);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void providerPoll?.refresh();});
function edit(id){const p=state.providers.find(p=>p.id===id)||{id:'',name:'',baseUrl:'',model:'',protocol:'openai',weight:1,enabled:false};const f=$('#provider-form');f.reset();editingProviderId=id||'';for(const key of ['enabled','apiKey','meteredApiKey'])f.elements[key].disabled=false;resetModels();modelChannelAssignments={...(p.modelChannels||{})};for(const k of ['id','name','baseUrl','model','protocol'])f.elements[k].value=p[k];f.elements.anthropicAuth.value=p.anthropicAuth||'x-api-key';f.elements.models.value=(p.models||[]).join('\n');updateConfiguredModelCount();f.elements.id.readOnly=!!id;f.elements.enabled.checked=p.enabled;if(p.hasMeteredKey||Object.values(modelChannelAssignments).includes('metered')){const adv=f.querySelector('.key-advanced');if(adv)adv.open=true;}$('#edit-error').textContent='';$('#edit').showModal()}
let formDirty=false;
$('#provider-form').addEventListener('input',()=>{formDirty=true;});
$('#provider-form').elements.clearKey.addEventListener('change',e=>{const f=e.target.form,clearing=e.target.checked;f.elements.enabled.checked=clearing?false:f.elements.enabled.checked;f.elements.enabled.disabled=clearing;f.elements.apiKey.disabled=clearing;f.elements.meteredApiKey.disabled=clearing;resetModels();});
function closeEdit(){if(formDirty&&!confirm('放弃未保存的配置修改？'))return;formDirty=false;$('#edit').close();}
function resetModels(){modelEpoch++;modelList=[];modelSelected=new Set();$('#model-search').value='';$('#model-search').disabled=true;$('#model-bulk').hidden=true;$('#model-results').innerHTML='';const saved=state?.providers?.find(provider=>provider.id===editingProviderId);$('#model-status').textContent=saved?.hasKey||saved?.hasMeteredKey?'可用已保存的密钥查询模型；若返回 401，请在上方更新 API Key。':'填写 API Key 后获取此账户可见的模型。';$('#fetch-models').disabled=false;$('#fetch-models').textContent='↻ 获取所有模型'}
function visibleModels(){const query=$('#model-search').value.trim().toLowerCase();return modelList.filter(m=>(m.id+' '+m.name).toLowerCase().includes(query));}
function updateConfiguredModelCount(){const entries=$('#provider-form').elements.models.value.split('\n').map(model=>model.trim()).filter(Boolean),models=[...new Set(entries)];$('#configured-model-count').textContent=`${models.length} 个已选模型`;defaultModelOptions.replaceChildren(...models.map(model=>{const option=document.createElement('option');option.value=model;return option;}));}
function modelSelectionFits(selected){const fetchedIds=new Set(modelList.map(model=>model.id));const manual=new Set($('#provider-form').elements.models.value.split('\n').map(model=>model.trim()).filter(model=>model&&!fetchedIds.has(model)));return manual.size+selected.size<=500;}
function syncSelectedModels(){
 const f=$('#provider-form'),fetchedIds=new Set(modelList.map(m=>m.id));
 const existing=f.elements.models.value.split('\n').map(model=>model.trim()).filter(Boolean);
 const retained=existing.filter(model=>!fetchedIds.has(model)||modelSelected.has(model));
 const models=[...new Set([...retained,...modelList.filter(model=>modelSelected.has(model.id)).map(model=>model.id)])];
 f.elements.models.value=models.join('\n');
 updateConfiguredModelCount();
 if(!models.includes(f.elements.model.value))f.elements.model.value=models.find(model=>modelCapabilities(model).chat)||models[0]||'';
 for(const model of modelList)if(modelSelected.has(model.id)&&!modelChannelAssignments[model.id])modelChannelAssignments[model.id]=model.channel;
 formDirty=true;
}
function updateModelSelectionStatus(){const visible=visibleModels(),allSelected=visible.length>0&&visible.every(model=>modelSelected.has(model.id));$('#model-bulk-count').textContent=`已勾选 ${modelSelected.size} / ${modelList.length}`;$('#model-bulk [data-model-bulk="all"]').textContent=allSelected?'取消全选当前结果':'全选当前结果';$('#model-status').textContent=`已获取 ${modelList.length} 个模型 · 当前显示 ${visible.length} 个。勾选后保存配置生效。`;}
function showModels(){
 const matches=visibleModels();
 $('#model-bulk').hidden=!modelList.length;
 $('#model-results').innerHTML=matches.map(m=>`<label class="model-choice"><input type="checkbox" data-model-id="${esc(m.id)}" ${modelSelected.has(m.id)?'checked':''}><span>${esc(m.name)}${m.name!==m.id?`<small>${esc(m.id)}</small>`:''}</span></label>`).join('')||'<p class="muted">没有匹配的模型</p>';
 updateModelSelectionStatus();
}
$('#model-search').addEventListener('input',showModels);
$('#model-results').addEventListener('change',e=>{const id=e.target.dataset.modelId;if(!id)return;const next=new Set(modelSelected);if(e.target.checked)next.add(id);else next.delete(id);if(!modelSelectionFits(next)){e.target.checked=false;toast('每个服务商最多配置 500 个模型，请缩小搜索范围后选择');return;}modelSelected=next;syncSelectedModels();updateModelSelectionStatus();});
$('#model-bulk').addEventListener('click',e=>{if(e.target.dataset.modelBulk!=='all')return;const visible=visibleModels(),next=new Set(modelSelected),allSelected=visible.length>0&&visible.every(model=>next.has(model.id));for(const model of visible){if(allSelected)next.delete(model.id);else next.add(model.id);}if(!modelSelectionFits(next)){toast('每个服务商最多配置 500 个模型，请缩小搜索范围后选择');return;}modelSelected=next;syncSelectedModels();showModels();});
$('#provider-form').elements.models.addEventListener('input',()=>{updateConfiguredModelCount();const f=$('#provider-form'),entries=new Set(f.elements.models.value.split('\n').map(model=>model.trim()).filter(Boolean));if(!entries.has(f.elements.model.value))f.elements.model.value=[...entries].find(model=>modelCapabilities(model).chat)||[...entries][0]||'';if(!modelList.length)return;modelSelected=new Set(modelList.filter(model=>entries.has(model.id)).map(model=>model.id));showModels();});
$('#provider-form').elements.model.addEventListener('change',()=>{const f=$('#provider-form'),model=f.elements.model.value.trim(),entries=f.elements.models.value.split('\n').map(id=>id.trim()).filter(Boolean);if(!model||entries.includes(model))return;entries.unshift(model);f.elements.models.value=entries.join('\n');updateConfiguredModelCount();if(modelList.some(item=>item.id===model)){modelSelected.add(model);showModels();}});
$('#provider-form').addEventListener('input',e=>{if(['id','baseUrl','protocol','apiKey','meteredApiKey','clearKey'].includes(e.target.name))resetModels()});
$('#fetch-models').onclick=async()=>{
 const f=$('#provider-form'),epoch=++modelEpoch,b=$('#fetch-models');
 b.disabled=true;b.textContent='获取中…';$('#model-status').textContent='正在读取模型列表，自动获取后续分页…';$('#model-results').innerHTML='';modelList=[];$('#model-search').disabled=true;
 try{
  const clearing=f.elements.clearKey.checked;if(clearing)throw Error('清除密钥后无法获取模型；请先保存，或取消清除选项');
  const payload={id:f.elements.id.value,baseUrl:f.elements.baseUrl.value,protocol:f.elements.protocol.value,anthropicAuth:f.elements.anthropicAuth.value,apiKey:f.elements.apiKey.value,meteredApiKey:f.elements.meteredApiKey.value};
  const current=state.providers.find(provider=>provider.id===editingProviderId),channels=[...(payload.apiKey||current?.hasKey?['subscription']:[]),...(payload.meteredApiKey||current?.hasMeteredKey?['metered']:[])];
  if(!channels.length)channels.push('subscription');
  const results=await Promise.allSettled(channels.map(channel=>api('/api/provider/models',{...payload,channel})));
  if(epoch!==modelEpoch)return;const merged=new Map();
  results.forEach((result,index)=>{if(result.status==='fulfilled')for(const model of result.value.data){const channel=channels[index];if(!merged.has(model.id)||channel==='subscription')merged.set(model.id,{...model,channel});}});
  if(!merged.size)throw results.find(result=>result.status==='rejected')?.reason||Error('没有获取到模型');
  modelList=[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id));const registered=new Set(f.elements.models.value.split('\n').map(model=>model.trim()));modelSelected=new Set(modelList.filter(model=>registered.has(model.id)).map(model=>model.id));$('#model-search').disabled=false;showModels();
  if(!modelList.length)$('#model-status').textContent='服务商返回了空列表；可手动填写模型 ID。';
 }catch(e){if(epoch===modelEpoch)$('#model-status').textContent=e.message}
 finally{if(epoch===modelEpoch){b.disabled=false;b.textContent='↻ 重新获取所有模型'}}
};
$('#logout').onclick=async()=>{try{await accountRequest('logout',{});profile=null;state=null;token='';resetPlayground();stopMediaLab();$('#current-account').textContent='';resetTenantChip();$('#content').innerHTML='';showLogin();}catch(e){toast(e.message)}};
$('#close-edit').onclick=closeEdit;
$('#cancel-edit').onclick=closeEdit;
$('#edit').addEventListener('close',()=>{formDirty=false;resetModels();editingProviderId='';modelChannelAssignments={};});
$('#provider-form').onsubmit=async e=>{e.preventDefault();const f=e.target,submit=f.querySelector('[type=submit]'),b=Object.fromEntries(new FormData(f));if(submit.disabled)return;submit.disabled=true;submit.textContent='保存中…';const clearAll=f.elements.clearKey.checked;b.enabled=clearAll?false:f.elements.enabled.checked;b.clearKey=clearAll;b.clearMeteredKey=clearAll;b.models=f.elements.models.value.split('\n').map(m=>m.trim()).filter(Boolean);b.modelChannels=Object.fromEntries(b.models.filter(model=>modelChannelAssignments[model]==='metered').map(model=>[model,'metered']));try{state=await api('/api/provider',b);formDirty=false;f.elements.apiKey.value='';f.elements.meteredApiKey.value='';$('#edit').close();render();toast(clearAll?'主、备密钥已清除，服务商已停用':'服务商配置已保存，协议与密钥路由已自动匹配')}catch(e){$('#edit-error').textContent=e.message}finally{submit.disabled=false;submit.textContent='保存配置'}};
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
 if(b.dataset.pagetab){navigate(b.dataset.pagetab);return;}
 if(b.dataset.tab){navigate(b.dataset.tab)}
 if(b.dataset.edit&&isManager())edit(b.dataset.edit);
 if(b.id==='add-provider'&&isManager())edit();
 if(b.dataset.providerMove&&isManager()){const index=state.providers.findIndex(provider=>provider.id===b.dataset.providerId),next=b.dataset.providerMove==='up'?index-1:index+1,ids=state.providers.map(provider=>provider.id);if(index>=0&&next>=0&&next<ids.length){[ids[index],ids[next]]=[ids[next],ids[index]];state=await api('/api/provider/reorder',{ids});render();toast('故障转移顺序已更新')}}
 if(b.dataset.providerDelete&&isManager()){const provider=state.providers.find(item=>item.id===b.dataset.providerDelete);if(provider)confirmAction(document.body,`删除服务商“${provider.name}”？`,'模型配置和已保存密钥将被移除，历史调用日志会继续保留。',async()=>{state=await api('/api/provider/delete',{id:provider.id});render();toast('服务商已删除');},toast)}
 if(b.dataset.switch){b.disabled=true;state=await api('/api/routing',{active:b.dataset.switch,strategy:state.strategy});render();toast('默认模型已切换，下一次调用生效')}
 if(b.dataset.strategy&&isManager()){b.disabled=true;state=await api('/api/routing',{active:state.active,strategy:b.dataset.strategy});render();toast('路由策略已更新')}
 if(b.id==='refresh'){await accountReady(await accountRequest('me'));}
 }catch(e){toast(e.message);b.disabled=false}});
document.addEventListener('change',async e=>{const id=e.target.dataset.providerModel;if(!id)return;const select=e.target;select.disabled=true;try{state=await api('/api/provider/switch-model',{id,model:select.value});render();toast('服务商模型已切换，下一次调用生效')}catch(err){select.value=state.providers.find(p=>p.id===id).model;toast(err.message)}finally{select.disabled=false}});

async function accountReady(value){
 const previous=profile?.tenantId,previousUser=profile?.user?.id;profile=value;token='';sessionStorage.removeItem('router-token');
 if(previous&&(previous!==profile.tenantId||previousUser!==profile.user.id)){resetPlayground();stopMediaLab();tab='overview';}
 renderTenantChip(profile);
 document.querySelector('#current-account').textContent=profile.user.name+' · '+({owner:'所有者',admin:'管理员',member:'成员',viewer:'只读'}[profile.role]||profile.role);
 state=await api('/api/state');if(!isManager()&&['keys','members','prices','routing','audit'].includes(tab))tab='overview';render();
}
try{await startAccountUI(accountReady);}catch(error){$('#content').textContent=error.message;}

// 品牌链接拦为 SPA 内跳转，避免整页刷新
document.querySelector('.brand')?.addEventListener('click',e=>{e.preventDefault();navigate('overview');});

// 租户切换：头像 + 浮层
function renderTenantChip(profile){
 const chip=document.querySelector('.workspace-chip');if(!chip)return;
 document.querySelector('#tenant-popover')?.remove();navigationHint.hidden=true;
 const current=profile.tenants.find(t=>t.id===profile.tenantId)||profile.tenants[0];
 const initial=name=>String(name||'?').trim().slice(0,1).toUpperCase();
 chip.innerHTML=`<button type="button" class="tenant-button" id="tenant-button" aria-haspopup="menu" aria-controls="tenant-popover" aria-expanded="false" aria-label="当前租户：${esc(current?.name||'默认租户')}，点击切换"><span class="tenant-avatar">${esc(initial(current?.name))}</span><svg class="tenant-compact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M9 5V3h6v2M8 10h2m4 0h2m-8 4h2m4 0h2m-5 6v-4h2v4"/></svg><span class="workspace-copy">${esc(current?.name||'默认租户')}<small>数据与密钥按租户隔离</small></span><svg class="nav-icon tenant-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`;
 const button=chip.querySelector('#tenant-button'),popover=document.createElement('div');popover.className='tenant-popover';popover.id='tenant-popover';popover.setAttribute('role','menu');popover.setAttribute('aria-label','切换租户');popover.hidden=true;
 popover.innerHTML=`<div class="tenant-popover-label">工作空间 · 切换租户</div>${profile.tenants.map(t=>`<button type="button" role="menuitemradio" aria-checked="${t.id===profile.tenantId}" data-tenant="${esc(t.id)}" class="${t.id===profile.tenantId?'selected':''}"><span class="tenant-avatar">${esc(initial(t.name))}</span><span>${esc(t.name)}</span>${t.id===profile.tenantId?'<span class="tenant-check">✓</span>':''}</button>`).join('')}`;document.body.append(popover);
 bindNavigationHint(button,()=>`切换租户 · ${current?.name||'默认租户'}`,()=>document.body.classList.contains('sidebar-compact')&&innerWidth>720);
 const close=({focus=false}={})=>{popover.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus();};
 button.onclick=()=>{const open=popover.hidden;if(open){navigationHint.hidden=true;popover.hidden=false;const rect=button.getBoundingClientRect(),compact=document.body.classList.contains('sidebar-compact')&&innerWidth>720,width=compact?248:Math.max(232,rect.width);popover.style.width=width+'px';const desiredLeft=compact?rect.right+10:rect.left,desiredTop=compact?rect.top:rect.bottom+8;popover.style.left=Math.max(8,Math.min(desiredLeft,innerWidth-width-8))+'px';popover.style.top=Math.max(8,Math.min(desiredTop,innerHeight-popover.offsetHeight-8))+'px';popover.querySelector('[aria-checked="true"]')?.focus();}else close({focus:true});button.setAttribute('aria-expanded',String(open));};
 popover.onkeydown=e=>{const items=[...popover.querySelectorAll('[data-tenant]')];const index=items.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();close({focus:true});}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}};
 let switching=false;popover.querySelectorAll('[data-tenant]').forEach(item=>item.onclick=async()=>{if(switching)return;close();if(item.dataset.tenant===profile.tenantId){button.focus();return;}switching=true;try{resetPlayground();await accountReady(await accountRequest('switch',{tenantId:item.dataset.tenant}));}catch(e){switching=false;button.focus();toast(e.message);}});
}
function resetTenantChip(){
 const chip=document.querySelector('.workspace-chip');if(!chip)return;
 document.querySelector('#tenant-popover')?.remove();chip.innerHTML='<span class="workspace-avatar">S</span><span class="workspace-copy">登录后选择租户<small>数据与密钥按租户隔离</small></span>';
}
document.addEventListener('click',e=>{const chip=document.querySelector('.workspace-chip'),popover=document.querySelector('#tenant-popover'),button=document.querySelector('#tenant-button');if(chip&&popover&&!chip.contains(e.target)&&!popover.contains(e.target)&&!popover.hidden){popover.hidden=true;button?.setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',e=>{const popover=document.querySelector('#tenant-popover'),button=document.querySelector('#tenant-button');if(e.key==='Escape'&&popover&&!popover.hidden){popover.hidden=true;button?.setAttribute('aria-expanded','false');button?.focus();}});
addEventListener('resize',()=>{const popover=document.querySelector('#tenant-popover'),button=document.querySelector('#tenant-button');if(popover&&!popover.hidden){popover.hidden=true;button?.setAttribute('aria-expanded','false');}});

// 主题与全局搜索（一次性挂在 header 上）
(()=>{
 const header=document.querySelector('header');if(!header||header.querySelector('.top-actions'))return;
 const actions=document.createElement('div');actions.className='top-actions';
 const search=document.createElement('input');search.id='global-search';search.type='search';search.placeholder='搜索页面 / 功能…';search.setAttribute('aria-label','全局搜索');
 const themeBtn=document.createElement('button');themeBtn.id='theme-toggle';themeBtn.className='subtle';themeBtn.type='button';themeBtn.title='切换明暗主题';
 const systemTheme=matchMedia('(prefers-color-scheme: dark)');
 const themeIcon={dark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>',light:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8a8.5 8.5 0 1 0 11.5 11.5Z"/></svg>'};
 const applyTheme=dark=>{document.body.classList.toggle('theme-dark',dark);themeBtn.innerHTML=dark?themeIcon.dark:themeIcon.light;themeBtn.setAttribute('aria-label',dark?'切换到浅色模式':'切换到深色模式');themeBtn.title=themeBtn.getAttribute('aria-label');};
 let savedTheme=null;try{savedTheme=localStorage.getItem('theme');}catch{}
 applyTheme(savedTheme==='dark'||savedTheme===null&&systemTheme.matches);
 themeBtn.onclick=()=>{const dark=!document.body.classList.contains('theme-dark');applyTheme(dark);savedTheme=dark?'dark':'light';try{localStorage.setItem('theme',savedTheme);}catch{}};
 systemTheme.addEventListener('change',e=>{if(savedTheme===null)applyTheme(e.matches);});
 actions.append(search,themeBtn);
 document.getElementById('logout')?.before(actions);
 const sections=[['overview','控制台 · 路由与健康'],['providers','服务商与模型 · 配置入口'],['playground','实验室 · 对话与媒体'],['logs','调用日志 · 追踪请求'],['api','开发者 · API Key 与文档'],['analytics','用量分析 · 成本与趋势'],['members','组织 · 成员与角色'],['account','账户 · 租户与安全']];
 search.addEventListener('input',()=>{
  const q=search.value.trim().toLowerCase();let box=document.getElementById('search-results');
  if(!q){box?.remove();return;}
  if(!box){box=document.createElement('div');box.id='search-results';box.className='search-results';actions.append(box);}
  const hits=sections.filter(([id,label])=>label.toLowerCase().includes(q)).slice(0,8);
  box.innerHTML=hits.map(([id,label])=>`<button type="button" data-jump="${id}">${label}</button>`).join('')||'<p class="muted">没有匹配的页面</p>';
  box.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{navigate(b.dataset.jump);search.value='';box.remove();});
 });
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!e.target.matches('input,textarea,select')){e.preventDefault();search.focus();}if(e.key==='Escape'&&document.activeElement===search){search.value='';document.getElementById('search-results')?.remove();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='b'){e.preventDefault();const btn=document.querySelector('#sidebar-toggle');btn?.click();}});
})();


const sidebarToggle=document.querySelector('#sidebar-toggle');
const sidebarLabels=compact=>({label:compact?'展开导航（⌘B）':'收起导航（⌘B）',tip:compact?'展开导航':'收起导航'});
function setSidebarCompact(compact){
 document.body.classList.toggle('sidebar-compact',compact);
 const {label,tip}=sidebarLabels(compact);
 sidebarToggle.dataset.tooltip=tip;
 sidebarToggle.setAttribute('aria-expanded',String(!compact));
 sidebarToggle.setAttribute('aria-label',label);
 sidebarToggle.removeAttribute('title');navigationHint.hidden=true;
}
try{const saved=localStorage.getItem('sidebar-compact');setSidebarCompact(saved===null?matchMedia('(max-width:1150px) and (min-width:721px)').matches:saved==='true')}catch{setSidebarCompact(false)}
sidebarToggle.addEventListener('click',()=>{const compact=!document.body.classList.contains('sidebar-compact');setSidebarCompact(compact);try{localStorage.setItem('sidebar-compact',String(compact))}catch{/* Optional appearance preference. */}});
bindNavigationHint(sidebarToggle,()=>sidebarLabels(document.body.classList.contains('sidebar-compact')).label);
for(const button of document.querySelectorAll('.sidebar nav .nav-item')){
 const label=button.getAttribute('aria-label')||button.textContent.trim();button.removeAttribute('title');
 bindNavigationHint(button,()=>label,()=>document.body.classList.contains('sidebar-compact')&&innerWidth>720);
}
addEventListener('scroll',()=>navigationHint.hidden=true,true);
