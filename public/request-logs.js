const count=value=>Number(value||0).toLocaleString('zh-CN');
const elapsed=value=>Number(value)>=1000?`${(Number(value)/1000).toFixed(2)} s`:`${Number(value)||0} ms`;

export async function renderLogs({api,esc,state}){
 const root=document.querySelector('#content');let page=1,version=0,timer,items=[],requestId='';
 root.classList.add('record-explorer');
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">REQUEST LOGS</div><h1>请求日志</h1><p>每行对应一次上游尝试；展开详情可追踪同一请求的故障转移。</p></div><button type="button" id="log-refresh">刷新日志</button></div>
 <form id="log-filters" class="record-filters"><label>搜索<input id="log-model" name="q" type="search" placeholder="模型、服务商、请求 ID 或路由依据" autocomplete="off"></label><label>时间范围<select name="days" id="log-days"><option value="1">最近 24 小时</option><option value="7" selected>最近 7 天</option><option value="30">最近 30 天</option><option value="">全部保留记录</option></select></label><label>服务商<select id="log-provider" name="provider"><option value="">全部服务商</option>${state.providers.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label>调用状态<select id="log-status" name="status"><option value="">全部状态</option><option value="success">成功</option><option value="error">失败</option></select></label><div class="record-filter-actions"><button id="log-query" class="primary">查询</button><button type="reset">重置</button></div></form>
 <details class="record-key-filter"><summary>按 API Key ID 精确筛选</summary><label class="sr-only" for="log-key">API Key ID</label><input form="log-filters" name="apiKeyId" id="log-key" type="search" placeholder="完整的 API Key ID，不是密钥本身" autocomplete="off"></details>
 <div id="log-trace" class="record-meta" hidden><span></span><button type="button" id="log-trace-clear">退出请求追踪</button></div><div class="record-meta"><span id="log-summary" role="status">正在读取日志…</span><span id="log-updated"></span></div><div class="record-alert" role="alert" id="log-error"></div>
 <div class="record-table" id="log-data"></div><div class="record-pagination"><span id="log-range"></span><div><button id="log-prev">上一页</button><span id="log-page"></span><button id="log-next">下一页</button></div></div><p class="audit-help">日志保留 90 天，不保存提示词、回复正文或密钥。费用为参考估算；上游未返回用量时显示未知。</p>`;
 const $=selector=>root.querySelector(selector),form=$('#log-filters');
 async function load(){
  clearTimeout(timer);const current=++version,params=new URLSearchParams(new FormData(form));
  params.set('page',String(page));params.set('limit','25');if(requestId)params.set('requestId',requestId);
  root.setAttribute('aria-busy','true');$('#log-prev').disabled=$('#log-next').disabled=true;$('#log-query').textContent='查询中…';$('#log-summary').textContent='正在查询…';$('#log-error').textContent='';
  try{
   const data=await api('/api/logs?'+params);if(current!==version||!root.isConnected)return;
   page=data.page;items=data.items;
   $('#log-data').innerHTML=items.length?`<table><thead><tr><th>时间 / 请求</th><th>服务商 / 模型</th><th>状态</th><th>耗时</th><th>用量 / 估算费用</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${items.map((item,index)=>`<tr><td>${esc(new Date(item.time).toLocaleDateString())} ${esc(new Date(item.time).toLocaleTimeString())}<small title="${esc(item.request_id)}">${esc(item.request_id.slice(0,12))} · ${esc(item.transport.toUpperCase())}</small></td><td class="record-model"><strong>${esc(item.provider)}</strong><small>${esc(item.model)}</small></td><td><span class="record-status ${item.status===200?'success':'error'}">${item.status===200?'成功':'失败'} ${item.status}</span></td><td>${elapsed(item.latency)}</td><td>${item.usage_known?count(item.tokens)+' tokens':'用量未知'}<small>${item.estimated_cost==null?'费用未知':esc(item.currency)+' '+Number(item.estimated_cost).toFixed(6)}</small></td><td><button type="button" data-detail="${index}" aria-expanded="false" aria-controls="log-detail-${index}">详情</button></td></tr><tr class="record-detail" id="log-detail-${index}" hidden><td colspan="6">${detail(item,index)}</td></tr>`).join('')}</tbody></table>`:'<div class="record-empty"><strong>没有匹配的请求</strong><p>可扩大时间范围，或重置筛选条件后重试。</p></div>';
   $('#log-summary').textContent=`共 ${count(data.total)} 条上游尝试${requestId?' · 当前请求追踪':''}`;
   $('#log-updated').textContent='更新于 '+new Date().toLocaleTimeString();
   $('#log-range').textContent=data.total?`${(page-1)*data.limit+1}–${Math.min(page*data.limit,data.total)} / ${data.total}`:'0 条记录';
   $('#log-page').textContent=`${page} / ${Math.max(1,Math.ceil(data.total/data.limit))}`;
   $('#log-prev').disabled=page<=1;$('#log-next').disabled=page*data.limit>=data.total;
  }catch(error){if(current===version&&root.isConnected){$('#log-error').textContent=error.message;$('#log-summary').textContent='查询未完成，请重试';$('#log-data').innerHTML='';$('#log-range').textContent=$('#log-page').textContent='';}}
  finally{if(current===version){root.setAttribute('aria-busy','false');$('#log-query').textContent='查询';}}
 }
 function detail(item,index){return `<dl class="record-details"><div><dt>完整请求 ID</dt><dd><code>${esc(item.request_id)}</code></dd></div><div><dt>调用身份</dt><dd>${esc(item.api_key_id||'账户会话')}<small>${esc(item.actor_id||'未归属成员')}</small></dd></div><div><dt>Token 明细</dt><dd>${item.usage_known?`输入 ${count(item.input_tokens)} · 输出 ${count(item.output_tokens)}`:'上游未返回用量'}</dd></div><div><dt>模型 ID</dt><dd><code>${esc(item.model)}</code></dd></div><div><dt>价格来源</dt><dd>${esc(item.price_source||'未配置 / 未估算')}</dd></div><div><dt>尝试 ID</dt><dd><code>${esc(item.id)}</code></dd></div><div class="record-wide"><dt>路由依据</dt><dd>${esc(item.reason||'未记录')}</dd></div></dl><button type="button" data-trace="${index}">查看此请求的全部尝试 →</button>`;}
 const search=()=>{page=1;void load();};
 form.onsubmit=event=>{event.preventDefault();search();};
 form.onchange=event=>{if(event.target.tagName==='SELECT')search();};
 form.onreset=()=>{requestId='';$('#log-trace').hidden=true;queueMicrotask(search);};
 for(const selector of ['#log-model','#log-key'])$(selector).oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(root.isConnected)search();},300);};
 $('#log-refresh').onclick=()=>void load();
 $('#log-prev').onclick=()=>{page--;void load();};$('#log-next').onclick=()=>{page++;void load();};
 $('#log-trace-clear').onclick=()=>{requestId='';$('#log-trace').hidden=true;search();};
 $('#log-data').onclick=event=>{
  const button=event.target.closest('[data-detail]');if(button){const row=$('#log-detail-'+button.dataset.detail);row.hidden=!row.hidden;button.setAttribute('aria-expanded',String(!row.hidden));button.textContent=row.hidden?'详情':'收起';return;}
  const trace=event.target.closest('[data-trace]');if(trace){requestId=items[Number(trace.dataset.trace)].request_id;for(const field of ['provider','status','q','apiKeyId','days'])form.elements[field].value='';$('#log-trace').hidden=false;$('#log-trace span').textContent='请求 '+requestId;search();}
 };
 await load();
}
