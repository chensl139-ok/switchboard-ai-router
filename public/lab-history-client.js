import {historyText} from './lab-history-format.js';

export async function labHistoryRequest(tenantId,route='',data,{signal}={}){
 const response=await fetch('/api/account/lab-history'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})},...(data?{body:JSON.stringify(data)}:{}),signal});
 const body=await response.json();if(!response.ok)throw Error(body.error?.message||'实验历史操作失败');return body;
}

const labels={running:'处理中',submitted:'已提交',completed:'已完成',failed:'失败',stopped:'已停止'};
const time=value=>{const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString('zh-CN'):'时间未知';};

export function mountLabHistory(root,{area,tenantId,onOpen}){
 const section=document.createElement('details');section.className='panel lab-history-panel';section.innerHTML=`<summary>历史记录 <span>当前账号 · 当前租户</span></summary><div class="lab-history-controls"><label>搜索<input type="search" placeholder="标题、模型或任务 ID" aria-label="搜索实验历史"></label><label>状态<select aria-label="筛选实验状态"><option value="">全部状态</option>${Object.entries(labels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>排序<select aria-label="历史排序"><option value="recent">最近更新</option><option value="oldest">最早更新</option></select></label><button type="button" class="subtle lab-history-refresh">刷新</button></div><div class="lab-history-list" role="list"><p class="muted">展开后读取历史记录</p></div><div class="lab-history-pagination"><span class="lab-history-count" role="status"></span><button type="button" class="lab-history-prev" disabled>上一页</button><button type="button" class="lab-history-more" disabled>下一页</button></div><p class="lab-history-retention">对话与媒体任务合计保留最近 100 条；仅保存文本及任务结果链接，不保存上传的图片或音频。</p>`;root.append(section);
 const dialog=document.createElement('dialog');dialog.className='lab-history-dialog';dialog.innerHTML='<div class="lab-history-dialog-head"><div><small>实验记录</small><h2></h2><p class="lab-history-dialog-meta"></p></div><button type="button" class="subtle" aria-label="关闭历史详情">×</button></div><div class="lab-history-dialog-content"></div><div class="lab-history-dialog-footer"><span role="status"></span><button type="button" class="subtle" data-history-copy disabled>复制内容</button><button type="button" class="subtle" data-history-download disabled>导出记录</button></div>';root.append(dialog);
 const list=section.querySelector('.lab-history-list'),search=section.querySelector('input[type=search]'),status=section.querySelector('select'),order=section.querySelector('[aria-label="历史排序"]'),count=section.querySelector('.lab-history-count'),previous=section.querySelector('.lab-history-prev'),next=section.querySelector('.lab-history-more'),refreshButton=section.querySelector('.lab-history-refresh'),content=dialog.querySelector('.lab-history-dialog-content'),copy=dialog.querySelector('[data-history-copy]'),download=dialog.querySelector('[data-history-download]'),feedback=dialog.querySelector('.lab-history-dialog-footer span');
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
  detailRequest?.abort();detailRequest=new AbortController();const epoch=++openEpoch;currentDetail=null;copy.disabled=download.disabled=true;feedback.textContent='';dialog.dataset.recordId=row.id;dialog.querySelector('h2').textContent=row.title||row.model||'未命名实验';dialog.querySelector('.lab-history-dialog-meta').textContent='';content.textContent='正在读取详情…';if(!dialog.open)dialog.showModal();
  try{const detail=await labHistoryRequest(tenantId,'/item?id='+encodeURIComponent(row.id),undefined,{signal:detailRequest.signal});if(epoch!==openEpoch||!dialog.open||!dialog.isConnected)return;const updateDetail=value=>{if(epoch!==openEpoch||!dialog.open)return;currentDetail=value;dialog.querySelector('.lab-history-dialog-meta').textContent=`${time(value.updatedAt)} · ${value.model||value.kind||''} · ${labels[value.status]||value.status}`;};updateDetail(detail);content.replaceChildren();await onOpen?.(detail,content,refresh,updateDetail);if(epoch!==openEpoch||!dialog.open)return;copy.disabled=download.disabled=false;content.scrollTop=0;}
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
 content.onclick=async event=>{const button=event.target.closest('[data-copy-code]');if(!button)return;try{await navigator.clipboard.writeText(button.closest('.lab-code-block').querySelector('code').textContent);button.textContent='已复制';}catch{feedback.textContent='复制失败，请手动复制';}};
 dialog.querySelector('button[aria-label="关闭历史详情"]').onclick=()=>dialog.close();dialog.onclose=()=>{openEpoch++;detailRequest?.abort();currentDetail=null;dialog.dataset.recordId='';};
 section.addEventListener('toggle',()=>{clearInterval(timer);if(section.open){void refresh();timer=setInterval(()=>{if(!section.isConnected){clearInterval(timer);listRequest?.abort();detailRequest?.abort();dialog.close();return;}if(document.visibilityState==='visible')void refresh({background:true});},15000);}else{clearTimeout(debounce);listRequest?.abort();if(dialog.open)dialog.close();}});
 return {refresh,section};
}
