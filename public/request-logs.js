const count=value=>Number(value||0).toLocaleString('zh-CN');
const elapsed=value=>Number(value)>=1000?`${(Number(value)/1000).toFixed(2)} s`:`${Number(value)||0} ms`;

const traceLink=filters=>'#logs?'+new URLSearchParams({days:'',...filters}).toString();
const safeFilterText=value=>typeof value==='string'&&!/[\u0000-\u001f\u007f]|\b(?:srk_[\w-]+|sk-[\w-]+|Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.|(?:api[_-]?key|token|secret)\s*[:=]\s*\S+)/i.test(value)?value.trim().slice(0,200):'';

// Only query metadata is accepted. API Key IDs are the store's 20 hex characters,
// never a token; unknown fields (including apiKey/token/Authorization) are ignored.
export function normalizeLogFilters(initialFilters={},state={}){
 const input=initialFilters&&typeof initialFilters==='object'?initialFilters:{};
 const filters={q:safeFilterText(input.q),days:'7',provider:'',status:'',acceptance:'',apiKeyId:'',requestId:safeFilterText(input.requestId),taskRequestId:safeFilterText(input.taskRequestId)};
 const days=typeof input.days==='number'?String(input.days):input.days;
 if(['','1','7','30','90'].includes(days))filters.days=days;
 if((state.providers||[]).some(provider=>provider.id===input.provider))filters.provider=input.provider;
 if(['','success','error'].includes(input.status))filters.status=input.status;
 if(['','accepted','rejected','unverified'].includes(input.acceptance))filters.acceptance=input.acceptance;
 const key=safeFilterText(input.apiKeyId);if(/^[a-f0-9]{20}$/i.test(key))filters.apiKeyId=key;
 // A task is resolved by an existing request ID, not by an unscoped task ID.
 if(filters.taskRequestId)filters.requestId='';
 if((filters.requestId||filters.taskRequestId)&&input.days===undefined)filters.days='';
 return filters;
}

export function diagnoseAttempt({failure_kind,upstream_status,status}={}){
 const http=value=>/^\d{3}$/.test(String(value))?Number(value):null;
 const upstream=http(upstream_status),result=http(status),code=upstream??result;
 const diagnosis=(kind,title,suggestion,href='#providers',label='查看服务商配置')=>({kind,title,suggestion,href,label});
 if(['cancelled','canceled','aborted','interrupted'].includes(failure_kind)||result===499)return diagnosis('cancelled','尝试已中断 / 取消','检查客户端断开、主动取消或代理连接中断；上游可能仍执行，不要直接重复提交。','#connect','查看接入向导');
 if(failure_kind==='timeout')return diagnosis('timeout','上游尝试超时','核对超时设置、模型负载和网络延迟；先追踪后续尝试，再决定是否重试。');
 if(failure_kind==='response_processing')return diagnosis('response_processing','响应处理中断或格式异常','收到上游响应不代表输出完整；核对上游协议、流式结束事件与响应格式。','#connect','查看接入向导');
 if(code===401||code===403)return diagnosis('auth','鉴权 / 权限异常','检查凭据是否过期、模型授权与访问策略；先核对上游 HTTP 状态，不要在日志或 URL 中粘贴密钥。');
 if(code===429||code===529)return diagnosis('rate_limit','限流 / 上游繁忙','检查服务商额度与并发限制，降低并发并按退避策略重试；是否可切换路由需核对配置。','#routing','查看路由策略');
 if(code===408||code===504)return diagnosis('timeout','超时响应','核对客户端、网关与上游超时设置；确认同一请求是否已有后续成功尝试。');
 if(failure_kind==='transport')return diagnosis('network','网络连接异常','检查本机或 OrbStack 到上游的 DNS、TLS、代理和连通性；未收到响应不能证明上游未执行。');
 if(result===200&&!failure_kind)return diagnosis('completed','本次上游尝试已完成','调用完成不代表输出验收通过；查看验收记录与同一任务的其他请求。','#analytics','查看用量分析');
 if(code===400||code===404||code===422)return diagnosis('request','请求 / 模型或接口不匹配','核对模型 ID、上游协议、接口路径与输入格式；仅凭状态码不能确定具体参数错误。','#models','查看模型目录');
 if(upstream>=500)return diagnosis('upstream','上游服务异常','确认服务商健康与公告；检查同一请求的回退尝试，避免盲目重复调用。');
 return diagnosis('unknown','原因待确认','现有状态不足以定位原因；核对失败阶段、上游 HTTP 状态及同一请求的全部尝试。');
}

export async function renderLogs({api,esc,state,initialFilters={}}){
 const initial=normalizeLogFilters(initialFilters,state);
 const root=document.querySelector('#content');let page=1,version=0,timer,items=[],requestId=initial.requestId,taskRequestId=initial.taskRequestId;
 root.classList.add('record-explorer');
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">REQUEST LOGS</div><h1>请求日志</h1><p>每行对应一次上游尝试；分别查看网关调用结果与输出验收，追踪同一任务的多次请求和回退成本。</p></div><button type="button" id="log-refresh">刷新日志</button></div>
 <form id="log-filters" class="record-filters record-request-filters"><label>搜索<input id="log-model" name="q" type="search" placeholder="任务 / 请求 ID、模型或服务商" autocomplete="off"></label><label>时间范围<select name="days" id="log-days"><option value="1">最近 24 小时</option><option value="7" selected>最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="">全部保留记录</option></select></label><label>服务商<select id="log-provider" name="provider"><option value="">全部服务商</option>${state.providers.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label>上游尝试状态<select id="log-status" name="status"><option value="">全部状态</option><option value="success">尝试完成</option><option value="error">尝试失败</option></select></label><label>输出验收<select name="acceptance"><option value="">全部</option><option value="accepted">通过</option><option value="rejected">未通过</option><option value="unverified">未反馈</option></select></label><div class="record-filter-actions"><button id="log-query" class="primary">查询</button><button type="reset">重置</button></div></form>
 <details class="record-key-filter"><summary>按 API Key ID 精确筛选</summary><label class="sr-only" for="log-key">API Key ID</label><input form="log-filters" name="apiKeyId" id="log-key" type="search" placeholder="完整的 API Key ID，不是密钥本身" autocomplete="off"></details>
 <div id="log-trace" class="record-meta" hidden><span></span><button type="button" id="log-trace-clear">退出追踪</button></div><div class="record-meta"><span id="log-summary" role="status">正在读取日志…</span><span id="log-updated"></span></div><div class="record-alert" role="alert" id="log-error"></div>
 <div id="log-task-summary" aria-live="polite"></div><div class="record-table" id="log-data"></div><div class="record-pagination"><span id="log-range"></span><div><button id="log-prev">上一页</button><span id="log-page"></span><button id="log-next">下一页</button></div></div><p class="audit-help">日志保留 90 天，不保存提示词、回复正文或密钥。费用为参考估算；上游未返回用量时显示未知。</p>`;
 const $=selector=>root.querySelector(selector),form=$('#log-filters');
 const active=()=>form.isConnected&&root.contains(form);
 const fields=['q','days','provider','status','acceptance','apiKeyId'];
 for(const field of fields)form.elements[field].value=initial[field];
 function updateTrace(){
  $('#log-trace').hidden=!requestId&&!taskRequestId;
  $('#log-trace span').textContent=taskRequestId?'任务（关联请求） '+taskRequestId:requestId?'请求 '+requestId:'';
 }
 updateTrace();
 async function load(){
  clearTimeout(timer);const current=++version,params=new URLSearchParams();
  const filters=normalizeLogFilters(Object.fromEntries(new FormData(form)),state);
  for(const field of fields){params.set(field,filters[field]);form.elements[field].value=filters[field];}
  params.set('page',String(page));params.set('limit','25');if(requestId)params.set('requestId',requestId);if(taskRequestId)params.set('taskRequestId',taskRequestId);
  root.setAttribute('aria-busy','true');$('#log-prev').disabled=$('#log-next').disabled=true;$('#log-query').textContent='查询中…';$('#log-summary').textContent='正在查询…';$('#log-error').textContent='';
  try{
   const [data,task]=await Promise.all([api('/api/logs?'+params),taskRequestId?api('/api/tasks?'+new URLSearchParams({requestId:taskRequestId})):Promise.resolve(null)]);if(current!==version||!active())return;
   page=data.page;items=data.items;$('#log-task-summary').innerHTML=task?renderTaskSummary(task,esc):'';
   $('#log-data').innerHTML=items.length?`<table><thead><tr><th>时间 / 请求</th><th>服务商 / 模型</th><th>上游尝试 / 输出验收</th><th>耗时</th><th>用量 / 估算费用</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${items.map((item,index)=>`<tr><td>${esc(new Date(item.time).toLocaleDateString())} ${esc(new Date(item.time).toLocaleTimeString())}<small title="${esc(item.request_id)}">${esc(String(item.request_id||'').slice(0,12))} · ${esc(String(item.transport||'未知').toUpperCase())}</small></td><td class="record-model"><strong>${esc(item.provider)}</strong><small>${esc(item.model)}</small></td><td><span class="record-status ${Number(item.status)===200?'success':'error'}">${Number(item.status)===200?'尝试完成':'尝试失败'} ${esc(item.status)}</span><small>${esc(acceptanceLabel(item.acceptance))}${item.acceptance_reason?' · '+esc(reasonLabel(item.acceptance_reason)):''}</small></td><td>${elapsed(item.latency)}</td><td>${item.usage_known?count(item.tokens)+' tokens':'用量未知'}<small>${item.estimated_cost==null?'费用未知':esc(item.currency)+' '+Number(item.estimated_cost).toFixed(6)}</small></td><td><button type="button" data-detail="${index}" aria-expanded="false" aria-controls="log-detail-${index}">详情</button></td></tr><tr class="record-detail" id="log-detail-${index}" hidden><td colspan="6">${detail(item,index)}</td></tr>`).join('')}</tbody></table>`:'<div class="record-empty"><strong>没有匹配的请求</strong><p>可扩大时间范围，或重置筛选条件后重试。</p></div>';
   $('#log-summary').textContent=`共 ${count(data.total)} 条上游尝试${taskRequestId?' · 当前任务追踪':requestId?' · 当前请求追踪':''}`;
   $('#log-updated').textContent='更新于 '+new Date().toLocaleTimeString();
   $('#log-range').textContent=data.total?`${(page-1)*data.limit+1}–${Math.min(page*data.limit,data.total)} / ${data.total}`:'0 条记录';
   $('#log-page').textContent=`${page} / ${Math.max(1,Math.ceil(data.total/data.limit))}`;
   $('#log-prev').disabled=page<=1;$('#log-next').disabled=page*data.limit>=data.total;
  }catch(error){if(current===version&&active()){$('#log-error').textContent=error.message;$('#log-summary').textContent='查询未完成，请重试';$('#log-data').innerHTML='';$('#log-task-summary').innerHTML='';$('#log-range').textContent=$('#log-page').textContent='';}}
  finally{if(current===version&&active()){root.setAttribute('aria-busy','false');$('#log-query').textContent='查询';}}
 }
 function detail(item,index){const diagnosis=diagnoseAttempt(item);return `<div class="diagnostic-note"><strong>${esc(diagnosis.title)}</strong><p>${esc(diagnosis.suggestion)}</p><p>诊断仅针对本次上游尝试；失败可能已被后续尝试挽回，不能据此判断请求或任务最终结果。</p><a href="${esc(diagnosis.href)}">${esc(diagnosis.label)} →</a> · <a href="${esc('#analytics?'+new URLSearchParams({days:['7','30','90'].includes(form.elements.days.value)?form.elements.days.value:'7'}))}">查看用量分析 →</a></div><dl class="record-details"><div><dt>任务 ID</dt><dd><code>${esc(item.task_id||'旧记录未关联')}</code></dd></div><div><dt>上游 HTTP / 失败阶段</dt><dd>${esc(item.upstream_status??'未知')} · ${esc(item.failure_kind||'—')}</dd></div><div><dt>完整请求 ID</dt><dd><code>${esc(item.request_id)}</code></dd></div><div><dt>调用身份</dt><dd>${esc(item.api_key_id||'账户会话')}<small>${esc(item.actor_id||'未归属成员')}</small></dd></div><div><dt>Token 明细</dt><dd>${item.usage_known?`输入 ${count(item.input_tokens)} · 输出 ${count(item.output_tokens)}`:'上游未返回用量'}</dd></div><div><dt>模型 ID</dt><dd><code>${esc(item.model)}</code></dd></div><div><dt>价格来源</dt><dd>${esc(item.price_source||'未配置 / 未估算')}</dd></div><div><dt>尝试 ID</dt><dd><code>${esc(item.id)}</code></dd></div><div class="record-wide"><dt>路由依据</dt><dd>${esc(item.reason||'未记录')}</dd></div></dl><a href="${esc(traceLink({requestId:item.request_id}))}" data-trace="${index}">查看此请求的全部尝试 →</a> ${item.task_id?`<a href="${esc(traceLink({taskRequestId:item.request_id}))}" data-task="${index}">查看任务耗时与费用 →</a>`:''}`;}
 const search=()=>{page=1;void load();};
 form.onsubmit=event=>{event.preventDefault();search();};
 form.onchange=event=>{if(event.target.tagName==='SELECT')search();};
 form.onreset=()=>{requestId='';taskRequestId='';updateTrace();queueMicrotask(()=>{if(active())search();});};
 for(const selector of ['#log-model','#log-key'])$(selector).oninput=()=>{clearTimeout(timer);++version;timer=setTimeout(()=>{if(active())search();},300);};
 $('#log-refresh').onclick=()=>void load();
 $('#log-prev').onclick=()=>{page--;void load();};$('#log-next').onclick=()=>{page++;void load();};
 $('#log-trace-clear').onclick=()=>{requestId='';taskRequestId='';updateTrace();search();};
 function traceRequest(id,task=false){
  const trace=normalizeLogFilters(task?{taskRequestId:id}:{requestId:id},state);
  requestId=trace.requestId;taskRequestId=trace.taskRequestId;
  for(const field of fields)form.elements[field].value='';
  updateTrace();search();
 }
 $('#log-task-summary').onclick=event=>{
  const link=event.target.closest('[data-task-request]');
  if(link&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();traceRequest(link.dataset.taskRequest);}
 };
 $('#log-data').onclick=event=>{
  const button=event.target.closest('[data-detail]');if(button){const row=$('#log-detail-'+button.dataset.detail);row.hidden=!row.hidden;button.setAttribute('aria-expanded',String(!row.hidden));button.textContent=row.hidden?'详情':'收起';return;}
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const task=event.target.closest('[data-task]');if(task){event.preventDefault();traceRequest(items[Number(task.dataset.task)].request_id,true);return;}
  const trace=event.target.closest('[data-trace]');if(trace){event.preventDefault();traceRequest(items[Number(trace.dataset.trace)].request_id);}
 };
 await load();
}

const acceptanceLabel=value=>({accepted:'验收通过',rejected:'验收未通过'}[value]||'未反馈 / 不适用');
const reasonLabel=value=>({parse_error:'解析失败',schema_error:'结构校验失败',business_error:'业务校验失败',other:'其他'}[value]||value);
export function renderTaskSummary(task,esc){
 const outcome={running:'进行中',gateway_failed:'网关调用失败',accepted:'验收通过',rejected:'验收未通过',unverified:'等待验收'}[task.outcome]||'未知';
 const costs=task.costs.map(cost=>esc(cost.currency)+' '+Number(cost.amount).toFixed(6)).join(' + ')||'暂无已知费用';
 return `<section class="card task-trace-summary"><h2>任务汇总 · ${esc(outcome)}</h2><p><code>${esc(task.taskId)}</code></p><dl class="record-details"><div><dt>任务跨度（含验收等待）</dt><dd>${elapsed(task.elapsedMs)}</dd></div><div><dt>累计上游耗时（可能重叠）</dt><dd>${elapsed(task.attemptLatencyMs)}</dd></div><div><dt>请求 / 上游尝试</dt><dd>${count(task.requestCount)} / ${count(task.attemptCount)}</dd></div><div><dt>上游失败 / 验收失败</dt><dd>${count(task.upstreamFailures)} / ${count(task.acceptanceFailures)}</dd></div><div><dt>已知用量</dt><dd>${count(task.tokens)} tokens · ${count(task.unknownUsageAttempts)} 次未知</dd></div><div><dt>累计估算费用</dt><dd>${costs}<small>${count(task.unknownCostAttempts)} 次费用未知</small></dd></div></dl><p>状态以最新发起请求为准；仍有运行中的请求时显示进行中。</p><details><summary>查看 ${count(task.requestCount)} 次请求的验收记录</summary><div class="record-table"><table><thead><tr><th>请求 ID</th><th>调用结果</th><th>输出验收</th></tr></thead><tbody>${task.requests.map(r=>`<tr><td><a href="${esc(traceLink({requestId:r.request_id}))}" data-task-request="${esc(r.request_id)}"><code>${esc(r.request_id)}</code></a></td><td>${esc({completed:'调用完成',failed:'调用失败',running:'进行中'}[r.status]||r.status)}</td><td>${esc(acceptanceLabel(r.feedback))}${r.feedback_reason?' · '+esc(reasonLabel(r.feedback_reason)):''}</td></tr>`).join('')}</tbody></table></div></details><p class="audit-help">${esc(task.notice)}</p></section>`;
}
