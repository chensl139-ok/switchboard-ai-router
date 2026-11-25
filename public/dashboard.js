import {routingLabel} from './routing-policy.js';
import {routeDiagnosticsMarkup} from './route-diagnostics.js';

const count=value=>Number(value||0).toLocaleString('zh-CN');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function logTable(rows,esc){
 if(!rows.length)return '<div class="empty dashboard-empty"><b>这里会记录你的第一条请求</b><span>完成模型接入后，在实验室运行一次对话，即可查看真实调用记录。</span><button data-tab="playground">前往模型实验室 →</button></div>';
 return `<div class="table-wrap"><table><thead><tr><th>时间</th><th>服务商 / 模型</th><th>上游尝试状态</th><th>耗时</th><th>追踪</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${esc(new Date(item.time).toLocaleString('zh-CN'))}</td><td><b>${esc(item.provider)}</b><small>${esc(item.model)}</small></td><td><span class="tag ${item.status===200?'green':'danger'}">${item.status===200?'已完成':`未完成 · ${Number(item.status)||'未知'}`}</span></td><td>${count(item.latency)} ms</td><td><a class="text-link" href="#logs?${esc(new URLSearchParams(item.request_id?{requestId:item.request_id}:{q:item.model||''}).toString())}">查看详情 →</a></td></tr>`).join('')}</tbody></table></div>`;
}

export function renderDashboard({state,esc,ready,isManager}){
 const enabled=state.providers.filter(ready),logs=state.logs||[],success=logs.filter(item=>item.status===200),active=state.providers.find(item=>item.id===state.active);
 const modelCount=new Set(enabled.flatMap(provider=>[provider.model,...(provider.models||[])].filter(Boolean).map(model=>`${provider.id}::${model}`))).size;
 const steps=[{done:state.providers.some(item=>item.hasKey||item.hasMeteredKey),label:'连接服务商',description:'保存你的上游 API 凭据',tab:'providers'},{done:enabled.length>0,label:'启用模型路由',description:'让应用找到可调用模型',tab:'models'},{done:success.length>0,label:'完成首次成功调用',description:'在实验室验证一次对话',tab:'playground'}];
 const completed=steps.filter(step=>step.done).length;
 return `<div class="dashboard-heading"><div><div class="eyebrow">WORKSPACE OVERVIEW</div><h1>工作空间概览</h1><p>从模型接入到每一次调用，在这里掌握全局。</p></div><div class="dashboard-actions"><label class="sr-only" for="dashboard-days">概览统计周期</label><select id="dashboard-days"><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option></select><button id="refresh-dashboard" aria-label="刷新概览">刷新</button></div></div>
 <section class="workspace-banner" aria-label="当前工作空间"><div><span class="workspace-kicker">YOUR MODELS. ONE WORKSPACE.</span><h2>让 AI 接入更简单。</h2><p>统一管理模型、密钥与调用记录。<br>你的服务商，你的路由，你的数据。</p><div class="workspace-banner-actions"><button data-tab="connect" class="primary">接入我的应用 <span aria-hidden="true">↗</span></button><button data-tab="models">浏览模型目录</button></div></div><div class="workspace-snapshot"><div class="workspace-snapshot-title"><span class="health-dot ${enabled.length?'green':''}"></span>${enabled.length?'已配置调用入口':'等待配置模型'}</div><div class="workspace-snapshot-counts"><div><strong>${enabled.length}<small> / ${state.providers.length}</small></strong><span>已启用服务商</span></div><div><strong>${modelCount}</strong><span>已配置模型路由</span></div></div><div class="workspace-route-caption"><span>${esc(routingLabel(state.strategy))}</span><code>${active?esc(active.name)+' / '+esc(state.routing?.primaryModel||active.model||'待选择'):'添加你的第一个服务商'}</code></div></div></section>
 <div class="metrics dashboard-metrics"><div class="metric"><label>生成请求</label><strong id="dashboard-requests">—</strong><small>独立请求，重试不重复计数</small></div><div class="metric"><label>最终调用成功率</label><strong id="dashboard-final-rate">—</strong><small id="dashboard-final-detail">正在读取统计…</small></div><div class="metric"><label>已知 Tokens</label><strong id="dashboard-tokens">—</strong><small id="dashboard-token-detail">仅统计上游返回的用量</small></div><div class="metric"><label>成功上游尝试平均耗时</label><strong id="dashboard-average-latency">—</strong><small>非端到端请求耗时</small></div></div>
 <div class="dashboard-insights"><section class="panel dashboard-trend-panel"><div class="panel-title"><div><span class="eyebrow">TRAFFIC</span><h2>请求趋势</h2></div><a class="text-link" id="dashboard-usage-link" href="#analytics">查看用量 →</a></div><div id="dashboard-trend" aria-live="polite"><div class="empty compact">正在读取真实调用数据…</div></div></section><section class="panel dashboard-cost-panel"><span class="eyebrow">COST & HEALTH</span><h2>费用与健康</h2><div id="dashboard-costs" class="dashboard-costs" aria-live="polite"><p>正在读取估算费用…</p></div><p class="dashboard-cost-note">参考估算，非实际账单；各币种分开统计，未知费用不记为零。</p><a id="dashboard-error-link" class="dashboard-error-link" href="#logs?status=error&days=7"><span>上游失败尝试<small>含已被故障转移挽回的失败</small></span><strong id="dashboard-failed-attempts">—</strong><span aria-hidden="true">↗</span></a></section></div>
 <div class="dashboard-grid"><section class="panel route-map"><div class="panel-title"><div><span class="eyebrow">ROUTING</span><h2>当前对话候选链</h2></div><button data-tab="routing" ${isManager?'':'hidden'}>调整策略</button></div><div class="route-chain" id="dashboard-route-chain" aria-live="polite"><div class="empty compact">正在计算实际可用候选…</div></div><p class="muted" id="dashboard-route-note">按已保存策略预览，不发送模型请求。</p><div id="dashboard-route-diagnostics"></div></section><section class="panel dashboard-shortcuts"><div class="panel-title"><h2>${completed===3?'工作空间已就绪':'完成你的首次接入'}</h2><span class="setup-count">${completed} / 3</span></div><div class="setup-checklist">${steps.map((step,index)=>`<button data-tab="${step.tab}" class="check-step ${step.done?'done':''}" ${!isManager&&['providers','models'].includes(step.tab)?'disabled':''}><span class="step-number">${step.done?'✓':index+1}</span><span>${step.label}<small>${step.description}</small></span></button>`).join('')}</div><div class="dashboard-quicklinks"><button data-tab="keys">我的应用密钥 <span>↗</span></button><button data-tab="api">开发者文档 <span>↗</span></button></div></section></div>
 <section class="panel dashboard-log-panel"><div class="panel-title"><div><span class="eyebrow">ACTIVITY</span><h2>最近调用</h2><p>按上游尝试记录，包含故障转移；不代表最终请求结果。</p></div><button data-tab="logs" class="subtle">全部记录 →</button></div>${logTable(logs.slice(0,5),esc)}</section>`;
}

export function renderDashboardSummary(root,summary,esc=escape,renderChart,dailySeries){
 const rate=root.querySelector('#dashboard-final-rate'),detail=root.querySelector('#dashboard-final-detail');if(!rate||!detail)return;
 const totals=summary.totals||{},requests=Number(totals.requests||0),successes=Number(totals.requestSuccesses||0);
 rate.textContent=requests?Math.round(successes/requests*100)+'%':'—';
 detail.textContent=`近 ${summary.days} 天 · ${count(successes)} / ${count(requests)} 次最终成功`;
 const set=(selector,value)=>{const node=root.querySelector(selector);if(node)node.textContent=value;};
 set('#dashboard-requests',count(requests));set('#dashboard-tokens',count(totals.tokens));
 set('#dashboard-token-detail',`输入 ${count(totals.inputTokens)} · 输出 ${count(totals.outputTokens)} · ${count(totals.unknownUsage)} 次用量未知`);
 set('#dashboard-average-latency',Number(totals.successes||0)?`${count(totals.averageLatency)} ms`:'—');
 const failures=root.querySelector('#dashboard-failed-attempts');if(failures){failures.textContent=count(totals.failures);failures.classList?.toggle('danger-text',Number(totals.failures)>0);}
 const costs=root.querySelector('#dashboard-costs');
 if(costs)costs.innerHTML=(summary.costs||[]).map(row=>`<div><span>${esc(row.currency)}</span><strong>${Number(row.amount).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:6})}</strong><small>${count(row.pricedAttempts)} 次尝试可估价</small></div>`).join('')||'<div class="cost-unknown"><strong>尚无可估算费用</strong><small>需要已配置价格和上游用量，不表示免费。</small></div>';
 const trend=root.querySelector('#dashboard-trend');if(trend&&renderChart&&dailySeries)trend.innerHTML=renderChart(dailySeries(summary.daily||[],summary.days+1),esc);
 root.querySelector('#dashboard-usage-link')?.setAttribute('href','#analytics?days='+summary.days);
 root.querySelector('#dashboard-error-link')?.setAttribute('href','#logs?status=error&days='+summary.days);
}

export function renderDashboardRoutePreview(root,preview,esc){
 const chain=root.querySelector('#dashboard-route-chain'),note=root.querySelector('#dashboard-route-note');
 if(!chain||!note)return;
 const candidates=preview.candidates.filter(route=>route.withinAttemptBudget);
 chain.innerHTML=candidates.slice(0,5).map((route,index)=>`<div class="route-node ${index===0?'active':''}"><span>${route.order}</span><div><b>${esc(route.provider)}</b><small>${esc(route.model)}</small></div>${route.health?.circuitOpen?'<em>熔断中</em>':index===0?'<em>首选</em>':''}</div>`).join('<i>→</i>')||'<div class="empty compact">当前没有可用的对话候选，请检查模型能力、密钥与路由策略。</div>';
 note.textContent=`${routingLabel(preview.strategy)} · 最多 ${preview.maxAttempts} 次尝试 · ${preview.total} 条兼容候选。按已保存策略及空提示词预览；实际请求可能因任务规则、健康状态而变化。`;
 const diagnostics=root.querySelector('#dashboard-route-diagnostics');if(diagnostics)diagnostics.innerHTML=routeDiagnosticsMarkup(preview,esc);
}
