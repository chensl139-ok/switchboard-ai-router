import {modelWorkspaceTarget} from './lab-targets.js';

const symbols={chat:'<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',video:'<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',audio:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8"/>',arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',star:'<path d="m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1Z"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]||symbols.chat}</svg>`;
const statusLabel=value=>({idle:'草稿',running:'处理中',submitted:'已提交',completed:'已完成',failed:'失败',stopped:'已停止',interrupted:'待确认'}[value]||'待确认');
const kindLabel=value=>({image:'图片',video:'视频',speech:'语音',transcription:'转写',vision:'视觉理解'}[value]||'创作');
const date=value=>new Date(value).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const conversationHref=id=>'#playground?'+new URLSearchParams({conversation:id});

export function favoriteModels(state,favorites=[]){
 const providers=[...(state.providers||[]),...(state.personalProviders||[])];
 return favorites.flatMap(target=>{let pair;try{pair=JSON.parse(target);}catch{return [];}
  if(!Array.isArray(pair)||pair.length!==2)return [];
  const provider=providers.find(row=>row.id===pair[0]);if(!provider)return [];
  return [{target,model:pair[1],provider:provider.name,route:modelWorkspaceTarget(provider,pair[1])}];
 });
}

export async function renderWorkspace({state,api,esc,profile,navigate,isCurrent}){
 const root=document.querySelector('#content'),canGenerate=profile.role!=='viewer';let alive=true;
 const active=()=>alive&&root.isConnected&&isCurrent();
 root.classList.add('start-workspace');
 root.innerHTML=`<div class="workspace-home-heading"><div><span class="eyebrow">YOUR AI, YOUR SPACE</span><h1>今天，从一个想法开始。</h1><p>${esc(profile.user.name)}，欢迎回到你的 AI 工作台。</p></div><span class="workspace-private-badge">${icon('star')} 个人工作区 · 租户隔离</span></div>
 <section class="workspace-launchpad"><div class="launchpad-copy"><span class="eyebrow">SWITCHBOARD 3.1</span><h2>不止连接模型，<br>更连接你的每一次创造。</h2><p>持续的对话，随手的创作，熟悉的模型。<br>把想法留下，让工作继续。</p><button type="button" class="primary" data-start-chat ${canGenerate?'':'disabled'}>开始新对话 ${icon('arrow')}</button></div><div class="launchpad-visual" aria-hidden="true"><div class="orbital-ring ring-one"></div><div class="orbital-ring ring-two"></div><div class="orbital-core">S</div><div class="orbital-node node-chat">${icon('chat')} 对话</div><div class="orbital-node node-image">${icon('image')} 创作</div><div class="orbital-node node-audio">${icon('audio')} 灵感</div></div></section>
 <div class="workspace-tools">${[['playground','chat','对话工作区','把问题展开，把思路留下'],['media?kind=image','image','图片创作','从文字到画面'],['media?kind=video','video','视频创作','让你的想法动起来'],['media?kind=speech','audio','语音与转写','让声音成为内容']].map(([route,glyph,title,description])=>`<button type="button" data-workspace-route="${route}" ${canGenerate?'':'disabled'}><span class="workspace-tool-icon">${icon(glyph)}</span><span><strong>${title}</strong><small>${description}</small></span><span class="workspace-tool-arrow">↗</span></button>`).join('')}</div>
 ${canGenerate?'':'<p class="info">当前为只读账户，可以查看模型和自己的记录，不能发起生成或更改收藏。</p>'}
 <div class="workspace-home-grid"><section class="panel"><div class="panel-title"><div><span class="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>继续上次的对话</h2></div>${canGenerate?'<button type="button" data-workspace-route="playground" class="subtle">全部对话 →</button>':''}</div><div id="workspace-conversations" class="workspace-recent-list" aria-live="polite">正在读取个人会话…</div></section><section class="panel"><div class="panel-title"><div><span class="eyebrow">YOUR FAVORITES</span><h2>常用模型</h2></div><button type="button" data-workspace-route="models" class="subtle">探索模型 →</button></div><div id="workspace-favorites" class="workspace-favorite-list" aria-live="polite">正在读取收藏…</div></section></div>
 <section class="panel workspace-recent-tasks"><div class="panel-title"><div><span class="eyebrow">RECENT CREATIONS</span><h2>最近的创作</h2></div><button type="button" data-workspace-route="tasks" class="subtle">任务中心 →</button></div><div id="workspace-media" class="workspace-task-list" aria-live="polite">正在读取个人任务…</div></section><div class="workspace-home-footer"><span>对话与收藏仅当前账号可见，管理后台不共享你的会话。</span><button type="button" data-workspace-route="overview" class="subtle">进入网关控制台 →</button></div>`;
 root.onclick=event=>{const button=event.target.closest('[data-workspace-route]');if(button&&!button.disabled)navigate(button.dataset.workspaceRoute);if(event.target.closest('[data-start-chat]')&&canGenerate)navigate('playground?new=1');};
 const load=async(selector,path,render)=>{try{const result=await api(path);if(active())root.querySelector(selector).innerHTML=render(result);}catch{if(active()){const box=root.querySelector(selector);box.textContent='暂时无法读取，请刷新后重试。';}}};
 await Promise.all([
  load('#workspace-conversations','/api/account/conversations?limit=5',data=>data.items.length?data.items.map(row=>`<${canGenerate?'a':'div'} ${canGenerate?`href="${esc(conversationHref(row.id))}"`:''} class="workspace-recent-item"><span class="recent-icon">${icon('chat')}</span><span><strong>${esc(row.title||'未命名对话')}</strong><small>${esc(date(row.updatedAt))} · ${statusLabel(row.status)}${row.pinned?' · 已置顶':''}</small></span><span aria-hidden="true">↗</span></${canGenerate?'a':'div'}>`).join(''):'<div class="workspace-empty"><strong>每一次对话，都是新的起点。</strong><p>新建对话后，消息与草稿会出现在这里。</p></div>'),
  load('#workspace-favorites','/api/account/workspace/preferences',data=>{const rows=favoriteModels(state,data.favorites);return rows.length?rows.slice(0,5).map(row=>`<button type="button" data-workspace-route="${esc(row.route||'models')}" class="workspace-favorite" ${!canGenerate||!row.route?'disabled':''}><span class="favorite-monogram">${esc(row.provider.slice(0,1))}</span><span><strong>${esc(row.model)}</strong><small>${esc(row.provider)}${row.route?'':' · 暂不可用'}</small></span><span>↗</span></button>`).join(''):'<div class="workspace-empty"><strong>把顺手的模型，放在手边。</strong><p>在模型探索中点击收藏，即可快速启动。</p></div>';}),
  load('#workspace-media','/api/account/lab-history?area=media&limit=4',data=>data.items.length?data.items.map(row=>`<a class="workspace-task-item" href="#tasks?${esc(new URLSearchParams({id:row.id}))}"><span class="task-kind-icon">${icon(row.kind==='video'?'video':row.kind==='image'?'image':'audio')}</span><strong>${esc(row.title||kindLabel(row.kind)+'任务')}</strong><small>${kindLabel(row.kind)} · ${esc(date(row.updatedAt))}</small><span class="task-status" data-status="${esc(row.status)}">${statusLabel(row.status)}</span></a>`).join(''):'<div class="workspace-empty"><strong>这里将收藏你的创作足迹。</strong><p>图片、视频和语音任务会在完成提交后显示。</p></div>')
 ]);
 return ()=>{alive=false;};
}

export function safeTaskURL(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function taskReplay(row){
 let result;try{result=JSON.parse(row.result||'{}');}catch{result={};}
 return {kind:['image','video','speech','transcription','vision'].includes(row.kind)?row.kind:'image',model:row.model||'',prompt:typeof result.prompt==='string'?result.prompt:'',size:typeof result.size==='string'?result.size:'',missing:!result.prompt||!['image'].includes(row.kind)};
}

export async function renderTasks({api,esc,profile,navigate,isCurrent,initialFilters={},onDelete=()=>{}}){
 const root=document.querySelector('#content'),rows=new Map(),deleting=new Set(),deleted=new Set();let alive=true,page=1,version=0,detailVersion=0,detailId='',timer;
 const active=()=>alive&&root.isConnected&&isCurrent();
 const detailActive=(id,current)=>active()&&current===detailVersion&&dialog.open&&detailId===id&&!deleting.has(id)&&!deleted.has(id);
 root.classList.add('creation-tasks');
 root.innerHTML=`<div class="heading"><div><span class="eyebrow">CREATION LIBRARY</span><h1>你的每一次创造，都在这里。</h1><p>查看历史任务、追踪远程状态，或从已有灵感重新开始。</p></div>${profile.role!=='viewer'?'<button type="button" class="primary" id="tasks-create">新的创作 ↗</button>':''}</div><form class="task-filter-bar" id="task-filters"><label><span class="sr-only">搜索任务</span><input name="q" type="search" placeholder="搜索标题、模型或任务 ID" maxlength="200"></label><select name="status" aria-label="任务状态"><option value="">全部状态</option><option value="submitted">已提交</option><option value="running">处理中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="stopped">已停止</option></select><select name="order" aria-label="任务排序"><option value="recent">最近更新</option><option value="oldest">最早更新</option></select><button type="submit">刷新任务</button></form><p id="task-list-status" role="status"></p><div id="task-cards" class="creation-task-grid"></div><div class="task-pagination"><button id="task-prev">上一页</button><span id="task-page"></span><button id="task-next">下一页</button></div><p class="muted">当前账号、当前租户的最近实验记录；与旧实验快照共用原有100条历史额度，新持久会话不受此项影响。上传素材不保存，外部结果地址可能过期；不会自动重新生成。</p><dialog class="task-detail-dialog" id="task-detail"><div class="task-detail-head"><div><span class="eyebrow">TASK DETAILS</span><h2 id="task-detail-title"></h2></div><button type="button" id="task-detail-close" aria-label="关闭任务详情">×</button></div><div id="task-detail-body"></div><div id="task-detail-actions"></div><p id="task-detail-error" role="alert"></p></dialog>`;
 const $=selector=>root.querySelector(selector),form=$('#task-filters'),dialog=$('#task-detail');
 if(typeof initialFilters.q==='string')form.elements.q.value=initialFilters.q.slice(0,200);
 const syncDeleting=()=>{
  for(const button of root.querySelectorAll('[data-task-id], [data-task-delete]')){const id=button.dataset.taskId||button.dataset.taskDelete;button.disabled=deleting.has(id)||deleted.has(id);}
  if(deleting.has(detailId))for(const button of $('#task-detail-actions').querySelectorAll('button'))button.disabled=true;
 };
 const remove=async row=>{
  if(!active()||deleting.has(row.id)||deleted.has(row.id))return;
  const warning=['running','submitted'].includes(row.status)?'\n任务仍在处理中或已提交，上游可能继续执行并计费。':'';
  if(!confirm(`删除创作记录“${row.title||'未命名任务'}”？\n仅删除本地记录，不取消上游任务、不退款，也不删除外部媒体文件、平台请求日志或用量记录。${warning}`))return;
  deleting.add(row.id);version++;if(detailId===row.id)detailVersion++;syncDeleting();$('#task-list-status').textContent='正在删除记录…';
  if(detailId===row.id)$('#task-detail-error').textContent='';
  try{
   try{const result=await api('/api/account/lab-history/delete',{id:row.id});if(result?.ok!==true)throw Error('服务器未确认删除结果');}catch(error){if(error.status!==404)throw error;}
   deleted.add(row.id);rows.delete(row.id);version++;
   if(!active())return;
   const focused=document.activeElement,restoreFocus=detailId===row.id&&dialog.open||focused?.closest('[data-task-card]')?.dataset.taskCard===row.id;
   if(detailId===row.id){detailId='';detailVersion++;if(dialog.open)dialog.close();}
   for(const card of root.querySelectorAll('[data-task-card]'))if(card.dataset.taskCard===row.id)card.remove();
   onDelete(row.id);await load({afterDelete:true});
   if(active()&&restoreFocus&&!dialog.open&&(document.activeElement===focused||document.activeElement===document.body||!document.activeElement?.isConnected))($('#task-cards [data-task-id]:not(:disabled)')||form.querySelector('button[type=submit]')).focus();
  }catch(error){if(active()){const message='删除未确认，请刷新核对后重试：'+error.message;$('#task-list-status').textContent=message;if(detailId===row.id&&dialog.open)$('#task-detail-error').textContent=message;}}
  finally{deleting.delete(row.id);if(active()){syncDeleting();if(detailId===row.id&&!deleted.has(row.id))for(const button of $('#task-detail-actions').querySelectorAll('button'))button.disabled=false;}}
 };
 const renderDetail=row=>{
  if(deleted.has(row.id)||deleting.has(row.id))return;
  rows.set(row.id,row);
  $('#task-detail-title').textContent=row.title||'未命名任务';const box=$('#task-detail-body');box.replaceChildren();
  const metadata=document.createElement('p');metadata.className='task-detail-meta';metadata.textContent=`${kindLabel(row.kind)} · ${statusLabel(row.status)} · ${row.model||'模型未记录'} · ${date(row.updatedAt)}`;box.append(metadata);
  let result;try{result=JSON.parse(row.result||'{}');}catch{result={text:row.result};}
  if(row.requestId){const id=document.createElement('p');id.textContent='任务 ID：'+row.requestId;box.append(id);}
  const resources=Array.isArray(result.images)?result.images:Array.isArray(result.videos)?result.videos:[];
  for(const item of resources){const url=safeTaskURL(typeof item==='string'?item:item.url);if(!url)continue;const media=document.createElement(row.kind==='video'?'video':'img');media.src=url;if(row.kind==='video'){media.controls=true;media.preload='none';}else{media.alt='历史生成结果';media.loading='lazy';}const failure=document.createElement('p');failure.hidden=true;failure.textContent='结果地址暂不可用或已过期；不会自动重新生成。';media.onerror=()=>{failure.hidden=false;};const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noreferrer';link.textContent='打开原始结果 ↗';box.append(media,failure,link);}
  for(const [label,text] of [['原提示词',result.prompt],['文本结果',result.text],['任务错误',row.error]])if(typeof text==='string'&&text){const section=document.createElement('section'),heading=document.createElement('h3'),body=document.createElement('p');heading.textContent=label;body.textContent=text;body.className='task-result-text';section.append(heading,body);box.append(section);}
  if(!resources.length&&!result.text&&!row.error){const note=document.createElement('p');note.textContent='没有已保存的可预览结果。语音二进制与上传素材不会长期保存在任务历史中。';box.append(note);}
  const actions=$('#task-detail-actions');actions.innerHTML=`<button type="button" class="danger-text" id="task-delete">删除记录</button><button type="button" id="task-export">导出记录</button>${profile.role!=='viewer'?'<button type="button" id="task-replay">以此开始新创作</button>':''}${row.kind==='video'&&row.requestId&&['running','submitted'].includes(row.status)&&profile.role!=='viewer'?'<button type="button" class="primary" id="task-refresh-remote">仅刷新远程状态</button>':''}`;
  $('#task-delete').onclick=()=>remove(row);
  $('#task-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(row,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='switchboard-task-'+row.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#task-replay')?.addEventListener('click',()=>{if(!confirm('只回填已保存的文字与参数，不自动生成。缺失素材需重新提供；再次提交会产生新的模型调用。'))return;dialog.close();navigate('media?'+new URLSearchParams({fromTask:row.id}));});
  $('#task-refresh-remote')?.addEventListener('click',async event=>{const button=event.currentTarget,current=detailVersion;if(button.disabled||!detailActive(row.id,current))return;button.disabled=true;$('#task-detail-error').textContent='';try{const response=await api('/v1/video/status',{requestId:row.requestId});if(!detailActive(row.id,current))return;const status=response.status==='Succeed'?'completed':response.status==='Failed'?'failed':'submitted';const updated=await api('/api/account/lab-history',{id:row.id,area:'media',kind:'video',model:row.model,title:row.title,status,requestId:row.requestId,result:JSON.stringify({...result,videos:response.results?.videos||result.videos||[],remoteStatus:response.status}),error:status==='failed'?response.reason||'视频生成失败':''});if(detailActive(row.id,current)){renderDetail(updated);void load();}}catch(error){if(detailActive(row.id,current))$('#task-detail-error').textContent=error.message;}finally{if(detailActive(row.id,current)&&button.isConnected)button.disabled=false;}});
 };
 const open=async id=>{if(!active()||deleting.has(id)||deleted.has(id))return;const current=++detailVersion;detailId=id;$('#task-detail-title').textContent='正在加载任务…';$('#task-detail-body').replaceChildren();$('#task-detail-actions').replaceChildren();$('#task-detail-error').textContent='';if(!dialog.open)dialog.showModal();try{const row=await api('/api/account/lab-history/item?'+new URLSearchParams({id}));if(detailActive(id,current)){if(row.area!=='media')throw Error('这条记录不是媒体任务');renderDetail(row);}}catch(error){if(detailActive(id,current))$('#task-detail-error').textContent=error.message;}};
 async function load({afterDelete=false}={}){const current=++version;$('#task-list-status').textContent=afterDelete?'记录已删除，正在刷新…':'正在读取…';try{const query=new URLSearchParams(new FormData(form));query.set('area','media');query.set('page',String(page));query.set('limit','12');const data=await api('/api/account/lab-history?'+query);if(!active()||current!==version)return;page=data.page;$('#task-list-status').textContent=`${afterDelete?'记录已删除 · ':''}${data.total} 条个人创作记录`;$('#task-page').textContent=`${data.page} / ${data.pages}`;$('#task-prev').disabled=page<=1;$('#task-next').disabled=page>=data.pages;const items=data.items.filter(row=>!deleted.has(row.id));rows.clear();for(const row of items)rows.set(row.id,row);$('#task-cards').innerHTML=items.length?items.map(row=>`<article class="creation-task-card" data-task-card="${esc(row.id)}"><button class="creation-task-open" type="button" data-task-id="${esc(row.id)}" aria-label="查看创作记录：${esc(row.title||'未命名任务')}"><div class="creation-task-art kind-${esc(row.kind)}">${icon(row.kind==='image'?'image':row.kind==='video'?'video':'audio')}<span>${kindLabel(row.kind)}</span></div><div class="creation-task-copy"><span class="task-status" data-status="${esc(row.status)}">${statusLabel(row.status)}</span><h3>${esc(row.title||'未命名任务')}</h3><p>${esc(row.model||'模型未记录')}</p><small>${esc(date(row.updatedAt))}</small></div></button><div class="creation-task-actions"><button type="button" class="danger-text" data-task-delete="${esc(row.id)}" aria-label="删除创作记录：${esc(row.title||'未命名任务')}">删除记录</button></div></article>`).join(''):'<div class="workspace-empty"><strong>暂无匹配的创作记录</strong><p>试试其他筛选条件，或创建你的第一个任务。</p></div>';syncDeleting();}catch(error){if(active()&&current===version){$('#task-list-status').textContent=(afterDelete?'记录已删除，但列表刷新失败：':'')+error.message;if(!afterDelete)$('#task-cards').replaceChildren();}}}
 $('#task-cards').onclick=event=>{const button=event.target.closest('[data-task-id], [data-task-delete]');if(!button||button.disabled)return;const id=button.dataset.taskDelete;if(id){const row=rows.get(id);if(row)void remove(row);}else void open(button.dataset.taskId);};
 form.onsubmit=event=>{event.preventDefault();void load();};form.onchange=()=>{page=1;void load();};form.elements.q.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(active()){page=1;void load();}},250);};
 $('#task-prev').onclick=()=>{page--;void load();};$('#task-next').onclick=()=>{page++;void load();};$('#tasks-create')?.addEventListener('click',()=>navigate('media'));
 $('#task-detail-close').onclick=()=>{detailId='';detailVersion++;dialog.close();};dialog.onclose=()=>{if(!dialog.open){detailId='';detailVersion++;}};
 const initialDetailVersion=detailVersion;await load();if(active()&&detailVersion===initialDetailVersion&&typeof initialFilters.id==='string')void open(initialFilters.id);
 return ()=>{alive=false;version++;detailVersion++;clearTimeout(timer);if(dialog.open)dialog.close();};
}
