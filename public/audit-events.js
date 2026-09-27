import {auditCategories} from './audit-format.js';

export async function renderAuditEvents({root,request,esc,canClear=false}){
 let page=1,version=0,timer,items=[];
 root.classList.add('record-explorer');
 root.innerHTML=`<div class="record-heading"><div><h2>租户操作审计</h2><p>默认只看最近 7 天的管理变更；历史登录等例行记录可按需展开。</p></div><div class="record-heading-actions"><button type="button" data-refresh>刷新</button>${canClear?'<button type="button" class="danger-text" data-clear-audit>清除全部审计日志</button>':''}</div></div>
 <form class="record-filters"><label>搜索<input name="q" type="search" placeholder="成员、操作、对象或事件 ID" autocomplete="off"></label><label>时间范围<select name="days"><option value="7" selected>最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="">全部保留记录</option></select></label><label>操作类型<select name="category"><option value="">全部类型</option>${Object.entries(auditCategories).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>操作人<select name="actor"><option value="">全部成员</option></select></label><label class="record-routine-filter"><input name="includeRoutine" type="checkbox" value="1">包含历史登录等例行记录</label><div class="record-filter-actions"><button class="primary">查询</button><button type="reset">重置</button></div></form>
 <div class="record-meta"><span data-summary role="status">正在读取操作记录…</span><span data-updated></span></div><div class="record-alert" role="alert"></div><div class="record-table" data-results></div><div class="record-pagination"><span data-range></span><div><button type="button" data-prev>上一页</button><span data-page></span><button type="button" data-next>下一页</button></div></div>`;
 const form=root.querySelector('form'),results=root.querySelector('[data-results]'),prev=root.querySelector('[data-prev]'),next=root.querySelector('[data-next]');
 async function load(){
  clearTimeout(timer);const current=++version;
  const params=new URLSearchParams(new FormData(form));params.set('page',String(page));params.set('limit','10');
  root.setAttribute('aria-busy','true');prev.disabled=next.disabled=true;
  root.querySelector('[data-summary]').textContent='正在查询…';root.querySelector('.record-alert').textContent='';
  try{
   const data=await request('audit?'+params);if(current!==version||!root.isConnected)return;
   page=data.page;items=data.items;
   const actor=form.elements.actor,selected=actor.value;
   actor.innerHTML='<option value="">全部成员</option>'+data.actors.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');actor.value=selected;
   results.innerHTML=items.length?`<table><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象 / 说明</th><th><span class="sr-only">详情</span></th></tr></thead><tbody>${items.map((item,index)=>`<tr><td>${esc(new Date(item.time).toLocaleDateString())}<small>${esc(new Date(item.time).toLocaleTimeString())}</small></td><td><strong>${esc(item.actorName)}</strong><small>${esc(item.actorEmail)}</small></td><td>${esc(item.label)}<small>${esc(auditCategories[item.category])}</small></td><td class="record-target">${esc(item.targetName||'—')}</td><td><button type="button" data-detail="${index}" aria-expanded="false" aria-controls="audit-detail-${index}">详情</button></td></tr><tr class="record-detail" id="audit-detail-${index}" hidden><td colspan="5"><dl class="record-details"><div><dt>事件 ID</dt><dd><code>${esc(item.id)}</code></dd></div><div><dt>操作标识</dt><dd><code>${esc(item.action)}</code></dd></div><div><dt>操作人 ID</dt><dd><code>${esc(item.actorId)}</code></dd></div><div class="record-wide"><dt>原始对象 / 说明</dt><dd>${esc(item.target||'—')}</dd></div></dl></td></tr>`).join('')}</tbody></table>`:'<div class="record-empty"><strong>没有匹配的操作记录</strong><p>可扩大时间范围，或清除搜索和筛选条件。</p></div>';
   root.querySelector('[data-summary]').textContent=`共 ${data.total.toLocaleString()} 条匹配记录`;
   root.querySelector('[data-updated]').textContent='更新于 '+new Date().toLocaleTimeString();
   root.querySelector('[data-range]').textContent=data.total?`${(page-1)*data.limit+1}–${Math.min(page*data.limit,data.total)} / ${data.total}`:'0 条记录';
   root.querySelector('[data-page]').textContent=`${page} / ${Math.max(1,Math.ceil(data.total/data.limit))}`;
   prev.disabled=page<=1;next.disabled=page*data.limit>=data.total;
  }catch(error){if(current===version&&root.isConnected){root.querySelector('.record-alert').textContent=error.message;root.querySelector('[data-summary]').textContent='查询未完成，请重试';results.innerHTML='';root.querySelector('[data-range]').textContent='';root.querySelector('[data-page]').textContent='';}}
  finally{if(current===version)root.setAttribute('aria-busy','false');}
 }
 const search=()=>{page=1;void load();};
 form.onsubmit=event=>{event.preventDefault();search();};
 form.onreset=()=>{queueMicrotask(search);};
 form.onchange=event=>{if(event.target.tagName==='SELECT'||event.target.name==='includeRoutine')search();};
 form.elements.q.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(root.isConnected)search();},300);};
 root.querySelector('[data-refresh]').onclick=()=>void load();
 root.querySelector('[data-clear-audit]')?.addEventListener('click',()=>{
  const phrase='清除全部审计日志',dialog=document.createElement('dialog');dialog.className='confirm-dialog audit-clear-dialog';
  dialog.innerHTML='<h2>清空所有租户操作审计？</h2><p>这将永久删除全部租户的操作审计记录，无法从平台恢复。请求日志、用量、API Key 和实验室历史不会被清除。</p><label>输入“清除全部审计日志”以确认<input type="text" autocomplete="off" aria-label="清除全部审计日志确认文字"></label><p class="record-alert" role="alert"></p><div class="confirm-actions"><button type="button" data-cancel>取消</button><button type="button" class="danger-primary" data-confirm disabled>永久清除</button></div>';
  root.append(dialog);dialog.showModal();const input=dialog.querySelector('input'),confirm=dialog.querySelector('[data-confirm]');input.focus();
  input.oninput=()=>confirm.disabled=input.value!==phrase;
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  confirm.onclick=async()=>{confirm.disabled=true;try{const result=await request('audit/clear',{confirm:input.value});dialog.close();page=1;await load();root.querySelector('[data-updated]').textContent=`已清除 ${result.deleted.toLocaleString()} 条操作审计记录`;}
   catch(error){dialog.querySelector('.record-alert').textContent=error.message;confirm.disabled=input.value!==phrase;}};
 });
 prev.onclick=()=>{page--;void load();};next.onclick=()=>{page++;void load();};
 results.onclick=event=>{const button=event.target.closest('[data-detail]');if(!button)return;const detail=results.querySelector('#audit-detail-'+button.dataset.detail);detail.hidden=!detail.hidden;button.setAttribute('aria-expanded',String(!detail.hidden));button.textContent=detail.hidden?'详情':'收起';};
 await load();
}
