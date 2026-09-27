export async function labHistoryRequest(tenantId,route='',data){
 const response=await fetch('/api/account/lab-history'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(tenantId?{'X-Tenant-ID':tenantId}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const body=await response.json();if(!response.ok)throw Error(body.error?.message||'实验历史操作失败');return body;
}

const labels={running:'处理中',submitted:'已提交',completed:'已完成',failed:'失败',stopped:'已停止'};
const time=value=>{const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString('zh-CN'):'时间未知';};

export function mountLabHistory(root,{area,tenantId,onOpen}){
 const section=document.createElement('details');section.className='panel lab-history-panel';section.innerHTML=`<summary>历史记录 <span>按当前账号与租户保存</span></summary><div class="lab-history-controls"><label>搜索记录<input type="search" placeholder="标题或模型" aria-label="搜索实验历史"></label><label>状态<select aria-label="筛选实验状态"><option value="">全部状态</option>${Object.entries(labels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><span class="lab-history-count" role="status"></span></div><div class="lab-history-list" role="list"><p class="muted">正在读取历史记录…</p></div><button type="button" class="lab-history-more" hidden>查看更多</button>`;root.append(section);
 const dialog=document.createElement('dialog');dialog.className='lab-history-dialog';dialog.innerHTML='<div class="lab-history-dialog-head"><div><small>MODEL LAB HISTORY</small><h2></h2><p class="lab-history-dialog-meta"></p></div><button type="button" class="subtle" aria-label="关闭历史详情">×</button></div><div class="lab-history-dialog-content"></div>';root.append(dialog);
 const list=section.querySelector('.lab-history-list'),search=section.querySelector('input[type=search]'),status=section.querySelector('select'),count=section.querySelector('.lab-history-count'),more=section.querySelector('.lab-history-more'),content=dialog.querySelector('.lab-history-dialog-content');
 let signature='',cached=[],shown=20,busy=false,openEpoch=0,timer=null;
 const renderRows=()=>{
  const term=search.value.trim().toLocaleLowerCase(),filtered=cached.filter(row=>(!status.value||row.status===status.value)&&(!term||[row.title,row.model,row.kind,row.status].some(value=>String(value||'').toLocaleLowerCase().includes(term))));
  count.textContent=`${filtered.length} 条记录`;more.hidden=filtered.length<=shown;list.replaceChildren();
  if(!filtered.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=term||status.value?'没有匹配的历史记录':'暂无历史记录';list.append(empty);return;}
  for(const row of filtered.slice(0,shown)){
   const card=document.createElement('article');card.className='lab-history-item';card.setAttribute('role','listitem');
   const heading=document.createElement('div');heading.className='lab-history-item-heading';const info=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small');title.textContent=row.title||row.model||'未命名实验';meta.textContent=`${time(row.updatedAt)} · ${row.model||row.kind||''}`;info.append(title,meta);heading.append(info);
   const actions=document.createElement('span');actions.className='lab-history-actions';const state=document.createElement('small');state.className='lab-history-state';state.dataset.status=row.status;state.textContent=labels[row.status]||row.status;
   const open=document.createElement('button');open.type='button';open.textContent='查看';open.onclick=()=>void openDetail(row);
   const remove=document.createElement('button');remove.type='button';remove.className='danger-text';remove.textContent='删除';remove.onclick=async()=>{if(!confirm('删除这条实验历史记录？此操作不会删除平台请求日志。'))return;remove.disabled=true;try{await labHistoryRequest(tenantId,'/delete',{id:row.id});if(dialog.open&&dialog.dataset.recordId===row.id)dialog.close();signature='';await refresh();}catch(error){remove.disabled=false;alert(error.message);}};
   actions.append(state,open,remove);heading.append(actions);card.append(heading);if(row.error){const error=document.createElement('p');error.className='lab-history-error';error.textContent=row.error;card.append(error);}list.append(card);
  }
 };
 const openDetail=async row=>{
  const epoch=++openEpoch;dialog.dataset.recordId=row.id;dialog.querySelector('h2').textContent=row.title||row.model||'未命名实验';dialog.querySelector('.lab-history-dialog-meta').textContent=`${time(row.createdAt)} · ${row.model||row.kind||''} · ${labels[row.status]||row.status}`;content.textContent='正在读取详情…';if(!dialog.open)dialog.showModal();
  try{const detail=await labHistoryRequest(tenantId,'/item?id='+encodeURIComponent(row.id));if(epoch!==openEpoch||!dialog.open)return;content.replaceChildren();if(detail.error){const error=document.createElement('p');error.className='lab-history-error';error.textContent=detail.error;content.append(error);}await onOpen?.(detail,content,refresh);}
  catch(error){if(epoch===openEpoch&&dialog.open)content.textContent=error.message;}
 };
 const refresh=async()=>{
  if(busy||!section.isConnected)return;busy=true;
  try{const rows=(await labHistoryRequest(tenantId,'?area='+encodeURIComponent(area))).items;if(!section.isConnected)return;const nextSignature=JSON.stringify(rows);if(nextSignature===signature)return;signature=nextSignature;cached=rows;renderRows();}
  catch(error){if(section.isConnected)list.textContent=error.message;}finally{busy=false;}
 };
 search.addEventListener('input',()=>{shown=20;renderRows();});status.addEventListener('change',()=>{shown=20;renderRows();});more.onclick=()=>{shown+=20;renderRows();};
 dialog.querySelector('button[aria-label="关闭历史详情"]').onclick=()=>dialog.close();dialog.onclose=()=>{openEpoch++;dialog.dataset.recordId='';};
 section.addEventListener('toggle',()=>{clearInterval(timer);if(section.open){void refresh();timer=setInterval(()=>{if(!section.isConnected){clearInterval(timer);return;}if(document.visibilityState==='visible')void refresh();},15000);}else if(dialog.open)dialog.close();});
 return {refresh,section};
}
