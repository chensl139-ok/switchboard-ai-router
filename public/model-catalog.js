import {providerHealth} from './provider-ui.js';
import {modelCapabilities} from './model-capability.js';

const PAGE_SIZE=40;
const modelList=models=>(models||[]).map(model=>typeof model==='string'?{id:model,name:model}:model).filter(model=>model&&typeof model.id==='string'&&model.id);
const category=model=>{const capability=modelCapabilities(model);return capability.chat?'chat':capability.mediaOnly?'media':'other';};
const categoryLabel=model=>{const capability=modelCapabilities(model);return capability.vision?'视觉理解 · 非对话':capability.chat?'对话':capability.mediaOnly?'媒体 / 非对话':'其他 / 非对话';};

// Discovery is supplemental: a failed refresh must not erase configured models.
// Private subscription rows never receive a public API route ID.
export function catalogSnapshot(state,result=null){
 const providers=[...(state.providers||[]),...(state.personalProviders||[])];
 const discoveries=new Map((result?.providers||[]).map(provider=>[provider.providerId,provider]));
 const rows=[],errors=[];
 for(const configured of providers){
  const discovered=discoveries.get(configured.id),cache=state.catalog?.[configured.id];
  const currentCache=cache&&cache.baseUrl===configured.baseUrl&&cache.protocol===configured.protocol?cache:null;
  const registered=new Set(configured.models||[]);
  const known=new Map(modelList(discovered?.status==='ok'?discovered.models:currentCache?.models).map(model=>[model.id,model]));
  for(const id of registered)if(!known.has(id))known.set(id,{id,name:configured.modelNames?.[id]||id});
  const error=configured.private?configured.error:discovered?.status==='error'?discovered.error:null;
  if(error)errors.push({providerId:configured.id,name:configured.name,error});
  const authFailed=!configured.private&&providerHealth(configured,state.logs).label==='鉴权失败';
  for(const model of known.values())rows.push({
   providerId:configured.id,providerName:configured.name,id:model.id,name:configured.modelNames?.[model.id]||model.name||model.id,
   private:Boolean(configured.private),routeId:configured.private?null:configured.id+'::'+model.id,
   registered:registered.has(model.id),enabled:Boolean(configured.enabled&&(configured.private||configured.hasKey||configured.hasMeteredKey)),
   authFailed,kind:category(model.id),kindLabel:categoryLabel(model.id)
  });
 }
 return {providers,rows,errors};
}

export function filterCatalog(rows,{search='',provider='',kind='',status=''}={}){
 const query=search.trim().toLocaleLowerCase();
 return rows.filter(row=>(!provider||row.providerId===provider)&&(!kind||row.kind===kind)&&(!status||(status==='registered'?row.registered:!row.registered))&&(!query||`${row.name} ${row.id} ${row.providerName} ${row.providerId}`.toLocaleLowerCase().includes(query)));
}

export function catalogPage(rows,page=1,pageSize=PAGE_SIZE){
 const pages=Math.max(1,Math.ceil(rows.length/pageSize));
 const current=Math.max(1,Math.min(pages,Number.isFinite(page)?Math.floor(page):1));
 const start=(current-1)*pageSize;
 return {rows:rows.slice(start,start+pageSize),page:current,pages,total:rows.length,start:rows.length?start+1:0,end:Math.min(start+pageSize,rows.length)};
}

export function renderModelCatalog({state,api,esc,toast,isManager,onSaved,embedded=false}){
 const root=document.querySelector('#content'),personalProviders=state.personalProviders||[];let result=null,page=1,busy=false;
 const shell=root;
 if(!embedded)shell.innerHTML='';
 shell.insertAdjacentHTML('beforeend',(embedded?'':`<div class="heading"><div><h1>模型目录</h1><p>查找模型，复制调用 ID，或将新模型加入组织配置。</p></div></div>`)+`<section class="catalog-workspace" aria-label="模型目录"><div class="catalog-toolbar"><input type="search" id="catalog-search" aria-label="搜索模型" placeholder="搜索模型或服务商"><select id="catalog-provider" aria-label="筛选服务商"><option value="">全部服务商</option>${[...state.providers,...personalProviders].map(p=>`<option value="${esc(p.id)}">${esc(p.name+(p.private?'（仅本人）':''))}</option>`).join('')}</select><select id="catalog-kind" aria-label="筛选模型能力"><option value="">全部类型</option><option value="chat">对话</option><option value="media">媒体</option><option value="other">其他</option></select><select id="catalog-registration" aria-label="筛选配置状态"><option value="">全部状态</option><option value="registered">已加入</option><option value="available">未加入</option></select>${isManager?'<button id="discover-all">刷新模型目录</button>':''}</div><p id="catalog-status" class="catalog-note" role="status">显示已配置模型与最近查询结果。刷新只获取模型列表，不发起生成；个人订阅仅供本人在实验室使用。</p><div id="catalog-errors" class="catalog-errors"></div><div id="catalog-list"></div></section>`);
 const list=shell.querySelector('#catalog-list'),workspace=list.closest('.catalog-workspace');
 let snapshot=catalogSnapshot({...state,personalProviders});
 const refreshSnapshot=()=>{snapshot=catalogSnapshot({...state,personalProviders},result);};
 const current=()=>list.isConnected&&shell.contains(workspace);
 function draw(){
  if(!current())return;
  const matching=filterCatalog(snapshot.rows,{search:workspace.querySelector('#catalog-search').value,provider:workspace.querySelector('#catalog-provider').value,kind:workspace.querySelector('#catalog-kind').value,status:workspace.querySelector('#catalog-registration').value});
  const visible=catalogPage(matching,page);page=visible.page;
  workspace.querySelector('#catalog-errors').innerHTML=snapshot.errors.map(item=>`<div class="catalog-error" role="alert">${esc(item.name)}：${esc(item.error)}。已保留现有模型。</div>`).join('');
  list.innerHTML=`<div class="catalog-table">${visible.rows.length?`<div class="table-wrap"><table><thead><tr><th scope="col">模型 / 调用 ID</th><th scope="col">服务商</th><th scope="col">类型</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>${visible.rows.map(model=>{
   const status=!model.registered?'未加入':!model.enabled?'未启用':model.authFailed?'鉴权失败':'已配置';
   const tone=model.authFailed?'danger':model.registered&&model.enabled?'green':'';
   const action=model.private?'<span class="muted">仅本人</span>':!model.registered&&isManager?`<button data-register-provider="${esc(model.providerId)}" data-register-model="${esc(model.id)}" ${busy?'disabled':''}>加入模型</button>`:model.registered?`<button data-copy-route="${esc(model.routeId)}" title="复制 ${esc(model.routeId)}">复制调用 ID</button>`:'<span class="muted">需管理员加入</span>';
   return `<tr><td><span class="catalog-model-name">${esc(model.name)}</span><code class="catalog-model-id">${esc(model.private?model.id:model.routeId)}</code></td><td><span class="catalog-provider-name">${esc(model.providerName)}</span><span class="catalog-scope">${model.private?'个人订阅 · 仅本人':'组织 API'}</span></td><td><span class="muted">${model.kindLabel}</span></td><td><span class="catalog-state"><span class="health-dot ${tone}"></span>${status}</span></td><td>${action}</td></tr>`;
  }).join('')}</tbody></table></div>`:`<div class="catalog-empty"><strong>${snapshot.rows.length?'没有匹配的模型':'还没有模型'}</strong><p>${snapshot.rows.length?'调整筛选条件，或换个关键词。':isManager?'先添加服务商和密钥，然后刷新模型目录。':'请联系组织管理员配置服务商与模型。'}</p></div>`}<div class="catalog-pagination"><span role="status">${visible.total?`${visible.start}–${visible.end} / ${visible.total} 个模型`:'0 个模型'}</span><div><button data-catalog-page="${page-1}" ${page===1?'disabled':''}>上一页</button><span>${page} / ${visible.pages}</span><button data-catalog-page="${page+1}" ${page===visible.pages?'disabled':''}>下一页</button></div></div></div>`;
 }
 const filter=()=>{page=1;draw();};
 workspace.querySelector('#catalog-search').oninput=filter;
 for(const selector of ['#catalog-provider','#catalog-kind','#catalog-registration'])workspace.querySelector(selector).onchange=filter;
 workspace.querySelector('#discover-all')?.addEventListener('click',async event=>{
  if(busy)return;
  const button=event.currentTarget;busy=true;button.disabled=true;button.textContent='正在查询…';draw();
  workspace.querySelector('#catalog-status').textContent='正在查询服务商模型，最多等待 45 秒…';
  try{
   const discovered=await api('/api/models/discover',{});if(!current())return;result=discovered;refreshSnapshot();
   const refreshed=await api('/api/state');if(!current())return;state={...refreshed,personalProviders};refreshSnapshot();onSaved(state);
   workspace.querySelector('#catalog-status').textContent=`已获取 ${result.total} 个模型${result.errors?`，${result.errors} 个服务商查询失败`:''}。选择“加入模型”后才会进入组织调用列表。`;
  }catch(error){if(current()){workspace.querySelector('#catalog-status').textContent='刷新未完成，当前列表已保留。';toast(error.message);}}
  finally{busy=false;if(current()){button.disabled=false;button.textContent='刷新模型目录';draw();}}
 });
 list.onclick=async event=>{
  const copy=event.target.closest('[data-copy-route]');
  if(copy){try{await navigator.clipboard.writeText(copy.dataset.copyRoute);if(current())toast('调用 ID 已复制');}catch{if(current())toast('无法自动复制，请手动选择调用 ID');}return;}
  const pagination=event.target.closest('[data-catalog-page]');
  if(pagination&&!pagination.disabled){page=Number(pagination.dataset.catalogPage);draw();return;}
  const button=event.target.closest('[data-register-provider]');if(!button||button.disabled||busy)return;
  busy=true;button.disabled=true;const refresh=workspace.querySelector('#discover-all');if(refresh)refresh.disabled=true;
  try{
   const saved=await api('/api/models/register',{providerId:button.dataset.registerProvider,model:button.dataset.registerModel});if(!current())return;
   state={...saved,personalProviders};refreshSnapshot();onSaved(state);toast('模型已加入；可复制调用 ID 使用');
  }catch(error){if(current())toast(error.message);}
  finally{busy=false;if(current()){if(refresh)refresh.disabled=false;draw();}}
 };
 draw();
}
export {renderApiGuide} from './api-docs.js';
