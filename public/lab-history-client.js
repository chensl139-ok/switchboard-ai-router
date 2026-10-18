import {historyText} from './lab-history-format.js';

export async function labHistoryRequest(tenantId,route='',data,{signal}={}){
 const response=await fetch('/api/account/lab-history'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})},...(data?{body:JSON.stringify(data)}:{}),signal});
 const body=await response.json();if(!response.ok)throw Error(body.error?.message||'实验历史操作失败');return body;
}

const labels={running:'处理中',submitted:'已提交',completed:'已完成',failed:'失败',stopped:'已停止'};
const time=value=>{const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString('zh-CN'):'时间未知';};

// Resume only context that was saved in full. Attachments and tool results cannot
// be reconstructed from the text-only history format.
export function resumeConversation(row){
 if(['running','submitted'].includes(row.status))throw Error('这条对话仍在生成，请完成后再继续。');
 let snapshot;try{snapshot=JSON.parse(row.result||'{}');}catch{throw Error('记录格式不完整，请复制需要的文本开始新对话。');}
 if(!snapshot||snapshot.version!==2||snapshot.truncated)throw Error('这条记录未完整保存，请复制需要的文本开始新对话。');
 if(!Array.isArray(snapshot.messages)||!snapshot.messages.length)throw Error('这条记录没有可继续的对话。');
 if(snapshot.messages.some(item=>!item||typeof item!=='object'))throw Error('记录格式不完整，请复制需要的文本开始新对话。');
 if(snapshot.messages.some(item=>item.tools||String(item.content||'').includes('[图片未保存在历史中]')))throw Error('这条记录包含未保存的图片或工具上下文，请重新添加后开始新对话。');
 const messages=snapshot.messages.map(item=>({role:item.role,content:typeof item.content==='string'?item.content:'',...(item.role==='assistant'?{status:item.status||'完成',label:item.label,route:item.route,stats:item.stats,durationMs:item.durationMs,outputTokens:item.outputTokens,reasoning_content:item.reasoning||'',thinkingOpen:false}:{})}));
 if(messages.some(item=>!['user','assistant'].includes(item.role)))throw Error('这条记录包含不支持恢复的消息类型。');
 let draft='';
 if(messages.at(-1)?.role==='assistant'&&['失败','已停止'].includes(messages.at(-1).status))messages.pop();
 if(messages.at(-1)?.role==='user')draft=messages.pop().content;
 if(messages.some(item=>item.status==='生成中'||item.status==='等待工具结果'))throw Error('这条记录包含尚未完成的回复，请复制需要的文本开始新对话。');
 return {messages,draft};
}

export function mountLabHistory(root,{area,tenantId,onOpen,onResume}){
 const section=document.createElement('dialog');section.className='lab-history-library';section.setAttribute('aria-label',area==='chat'?'对话历史':'媒体任务历史');section.innerHTML=`<div class="lab-history-library-head"><div><h2>${area==='chat'?'对话历史':'媒体任务历史'}</h2><p>当前账号 · 当前租户</p></div><button type="button" class="subtle" aria-label="关闭历史记录">×</button></div><div class="lab-history-controls"><label>搜索<input type="search" placeholder="标题、模型或任务 ID" aria-label="搜索实验历史"></label><label>状态<select aria-label="筛选实验状态"><option value="">全部状态</option>${Object.entries(labels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>排序<select aria-label="历史排序"><option value="recent">最近更新</option><option value="oldest">最早更新</option></select></label><button type="button" class="subtle lab-history-refresh">刷新</button></div><div class="lab-history-list" role="list"><p class="muted">正在读取历史记录…</p></div><div class="lab-history-pagination"><span class="lab-history-count" role="status"></span><button type="button" class="lab-history-prev" disabled>上一页</button><button type="button" class="lab-history-more" disabled>下一页</button></div><p class="lab-history-retention">最近 100 条对话与媒体任务。上传素材不保存在历史中。</p>`;root.append(section);
 const launcher=document.createElement('button');launcher.type='button';launcher.className='subtle lab-history-launcher';launcher.textContent='历史记录';launcher.setAttribute('aria-haspopup','dialog');const actions=root.querySelector('#lab-page-actions')||root.querySelector('.compare-heading-actions')||root.querySelector('.media-heading');(actions||root).append(launcher);
 const dialog=document.createElement('dialog');dialog.className='lab-history-dialog';dialog.innerHTML='<div class="lab-history-dialog-head"><div><h2></h2><p class="lab-history-dialog-meta"></p></div><button type="button" class="subtle" aria-label="关闭历史详情">×</button></div><div class="lab-history-dialog-content"></div><div class="lab-history-dialog-footer"><span role="status"></span><button type="button" class="subtle" data-history-copy disabled>复制内容</button><button type="button" class="subtle" data-history-download disabled>导出记录</button><button type="button" class="primary" data-history-resume hidden disabled>继续对话</button></div>';root.append(dialog);
 const list=section.querySelector('.lab-history-list'),search=section.querySelector('input[type=search]'),status=section.querySelector('select'),order=section.querySelector('[aria-label="历史排序"]'),count=section.querySelector('.lab-history-count'),previous=section.querySelector('.lab-history-prev'),next=section.querySelector('.lab-history-more'),refreshButton=section.querySelector('.lab-history-refresh'),content=dialog.querySelector('.lab-history-dialog-content'),copy=dialog.querySelector('[data-history-copy]'),download=dialog.querySelector('[data-history-download]'),resume=dialog.querySelector('[data-history-resume]'),feedback=dialog.querySelector('.lab-history-dialog-footer span');
 resume.hidden=!onResume;
 let signature='',page=1,openEpoch=0,timer=null,debounce=null,listRequest=null,detailRequest=null,currentDetail=null;
 const renderRows=rows=>{
  list.replaceChildren();
  if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=search.value.trim()||status.value?'没有匹配的记录，请调整筛选条件':'暂无历史记录，完成一次实验后会自动保存';list.append(empty);return;}
  for(const row of rows){
   const card=document.createElement('article');card.className='lab-history-item';card.setAttribute('role','listitem');
   const heading=document.createElement('div');heading.className='lab-history-item-heading';const info=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small');title.textContent=row.title||row.model||'未命名实验';title.title=title.textContent;meta.textContent=`${time(row.updatedAt)} · ${row.model||row.kind||''}`;info.append(title,meta);heading.append(info);
   const actions=document.createElement('span');actions.className='lab-history-actions';const state=document.createElement('small');state.className='lab-history-state';state.dataset.status=row.status;state.textContent=labels[row.status]||row.status;
   const open=document.createElement('button');open.type='button';open.textContent='查看';open.onclick=()=>void openDetail(row);
   const remove=document.createElement('button');remove.type='button';remove.className='danger-text';remove.textContent='删除';remove.setAttribute('aria-label','删除记录：'+title.textContent);remove.onclick=async()=>{if(!confirm('删除这条实验历史记录？此操作不会删除平台请求日志。'))return;remove.disabled=true;try{await labHistoryRequest(tenantId,'/delete',{id:row.id});if(dialog.open&&dialog.dataset.recordId===row.id)dialog.close();signature='';await refresh();}catch(error){remove.disabled=false;alert(error.message);}};
   actions.append(state,open,remove);heading.append(actions);card.append(heading);if(row.error){const error=document.createElement('p');error.className='lab-history-error';error.textContent=row.error;card.append(error);}list.append(card);
  }
 };
 const openDetail=async row=>{
  detailRequest?.abort();detailRequest=new AbortController();const epoch=++openEpoch;currentDetail=null;copy.disabled=download.disabled=resume.disabled=true;feedback.textContent='';dialog.dataset.recordId=row.id;dialog.querySelector('h2').textContent=row.title||row.model||'未命名实验';dialog.querySelector('.lab-history-dialog-meta').textContent='';content.textContent='正在读取详情…';if(!dialog.open)dialog.showModal();
  try{const detail=await labHistoryRequest(tenantId,'/item?id='+encodeURIComponent(row.id),undefined,{signal:detailRequest.signal});if(epoch!==openEpoch||!dialog.open||!dialog.isConnected)return;const updateDetail=value=>{if(epoch!==openEpoch||!dialog.open)return;currentDetail=value;dialog.querySelector('.lab-history-dialog-meta').textContent=`${time(value.updatedAt)} · ${value.model||value.kind||''} · ${labels[value.status]||value.status}`;};updateDetail(detail);content.replaceChildren();await onOpen?.(detail,content,refresh,updateDetail);if(epoch!==openEpoch||!dialog.open)return;copy.disabled=download.disabled=false;if(onResume){try{resumeConversation(detail);resume.disabled=false;feedback.textContent='继续对话会创建新记录，原记录保留。';}catch(error){feedback.textContent=error.message;}}content.scrollTop=0;}
  catch(error){if(error.name!=='AbortError'&&epoch===openEpoch&&dialog.open)content.textContent=error.message;}
 };
 const refresh=async({background=false}={})=>{
  if(!section.isConnected||!section.open)return;
  if(background&&listRequest)return;
  listRequest?.abort();const request=new AbortController();listRequest=request;
  list.setAttribute('aria-busy','true');refreshButton.disabled=true;
  const params=new URLSearchParams({area,q:search.value.trim(),status:status.value,order:order.value,page:String(page),limit:'20'});
  try{const result=await labHistoryRequest(tenantId,'?'+params,undefined,{signal:request.signal});if(!section.isConnected||listRequest!==request)return;page=result.page;count.textContent=`${result.total} 条 · ${page} / ${result.pages} 页`;previous.disabled=page<=1;next.disabled=page>=result.pages;const nextSignature=JSON.stringify(result.items);if(nextSignature!==signature){signature=nextSignature;renderRows(result.items);}}
  catch(error){if(error.name!=='AbortError'&&section.isConnected&&listRequest===request){count.textContent=error.message;}}
  finally{if(listRequest===request){listRequest=null;list.setAttribute('aria-busy','false');refreshButton.disabled=false;}}
 };
 const change=()=>{page=1;void refresh();};
 search.addEventListener('input',()=>{listRequest?.abort();clearTimeout(debounce);debounce=setTimeout(change,250);});status.onchange=order.onchange=()=>{clearTimeout(debounce);change();};
 previous.onclick=()=>{page--;void refresh();};next.onclick=()=>{page++;void refresh();};refreshButton.onclick=()=>void refresh();
 copy.onclick=async()=>{if(!currentDetail)return;try{await navigator.clipboard.writeText(historyText(currentDetail));feedback.textContent='已复制';}catch{feedback.textContent='复制失败，请选择正文手动复制';}};
 download.onclick=()=>{if(!currentDetail)return;const url=URL.createObjectURL(new Blob([JSON.stringify(currentDetail,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`实验记录-${currentDetail.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 resume.onclick=async()=>{if(!currentDetail||!onResume)return;resume.disabled=true;try{await onResume(currentDetail);dialog.close();section.close();root.querySelector('#lab-prompt')?.focus();}catch(error){feedback.textContent=error.message;resume.disabled=false;}};
 content.onclick=async event=>{const button=event.target.closest('[data-copy-code]');if(!button)return;try{await navigator.clipboard.writeText(button.closest('.lab-code-block').querySelector('code').textContent);button.textContent='已复制';}catch{feedback.textContent='复制失败，请手动复制';}};
 dialog.querySelector('button[aria-label="关闭历史详情"]').onclick=()=>dialog.close();dialog.onclose=()=>{openEpoch++;detailRequest?.abort();currentDetail=null;dialog.dataset.recordId='';};
 launcher.onclick=()=>{if(section.open)return;section.showModal();void refresh();clearInterval(timer);timer=setInterval(()=>{if(!section.isConnected){clearInterval(timer);listRequest?.abort();detailRequest?.abort();dialog.close();return;}if(document.visibilityState==='visible')void refresh({background:true});},15000);};
 section.querySelector('[aria-label="关闭历史记录"]').onclick=()=>section.close();
 section.addEventListener('close',()=>{clearInterval(timer);clearTimeout(debounce);listRequest?.abort();if(dialog.open)dialog.close();});
 return {refresh,section};
}
