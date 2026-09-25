import {accountRequest,confirmAction} from './accounts.js';
const formatCount=value=>Number(value||0).toLocaleString('zh-CN');
const formatLatency=value=>value?`${formatCount(value)} ms`:'—';

export function dailySeries(rows,days,today=new Date()){
 const byDay=new Map(rows.map(row=>[row.day,row]));
 today=new Date(today);today.setUTCHours(0,0,0,0);
 return Array.from({length:days},(_,index)=>{
  const date=new Date(today);date.setUTCDate(today.getUTCDate()-days+index+1);
  const day=date.toISOString().slice(0,10);
  return byDay.get(day)||{day,requests:0,requestSuccesses:0,attempts:0,successes:0,tokens:0};
 });
}

function renderUsageChart(series,esc){
 const peak=Math.max(1,...series.map(day=>day.requests));
 const width=1000/series.length;
 return `<div class="usage-chart" role="img" aria-label="每日生成请求柱状图，最高 ${peak} 次">
  <svg class="usage-chart-svg" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="170" x2="1000" y2="170" class="usage-baseline"/>${series.map((day,index)=>{const height=day.requests?Math.max(4,day.requests/peak*150):0;return `<rect class="usage-chart-bar" x="${(index*width+Math.min(3,width*.1)).toFixed(2)}" y="${(170-height).toFixed(2)}" width="${Math.max(2,width-Math.min(6,width*.2)).toFixed(2)}" height="${height.toFixed(2)}" rx="2"><title>${esc(day.day)}：${formatCount(day.requests)} 次请求 · ${formatCount(day.tokens)} Tokens</title></rect>`;}).join('')}</svg>
  <div class="usage-chart-labels" aria-hidden="true"><span>${esc(series[0].day.slice(5))}</span><span>${esc(series[Math.floor((series.length-1)/2)].day.slice(5))}</span><span>${esc(series[series.length-1].day.slice(5))}</span></div>
 </div><details class="usage-daily-details"><summary>查看每日明细</summary><div class="table-wrap"><table><thead><tr><th>日期（UTC）</th><th>请求</th><th>最终成功</th><th>上游尝试</th><th>Tokens</th></tr></thead><tbody>${series.map(day=>`<tr><td>${esc(day.day)}</td><td>${formatCount(day.requests)}</td><td>${formatCount(day.requestSuccesses)}</td><td>${formatCount(day.attempts)}</td><td>${formatCount(day.tokens)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function renderUsageOverview(summary,esc){
 const totals=summary.totals;
 const attempts=Number(totals.attempts||0);
 const successes=Number(totals.successes||0);
 const attemptRate=attempts?Math.round(successes/attempts*100):0;
 const requests=Number(totals.requests||0),requestSuccesses=Number(totals.requestSuccesses||0);
 const finalRate=requests?Math.round(requestSuccesses/requests*100):null;
 const series=dailySeries(summary.daily||[],summary.days+1);
 const peak=series.reduce((best,day)=>day.requests>best.requests?day:best,series[0]);
 const pricedAttempts=(summary.costs||[]).reduce((sum,row)=>sum+Number(row.pricedAttempts||0),0);
 return `<div class="usage-metrics" aria-label="用量概览">
  <article class="usage-metric"><span>生成请求</span><strong>${formatCount(totals.requests)}</strong><small>${summary.days} 天内的独立请求</small></article>
  <article class="usage-metric"><span>最终调用成功率</span><strong>${finalRate===null?'—':finalRate+'%'}</strong><small>${formatCount(requestSuccesses)} / ${formatCount(requests)} 次请求成功；故障转移后成功也计入</small></article>
  <article class="usage-metric"><span>已知 Tokens</span><strong>${formatCount(totals.tokens)}</strong><small>输入 ${formatCount(totals.inputTokens)} · 输出 ${formatCount(totals.outputTokens)}</small></article>
  <article class="usage-metric"><span>成功请求平均耗时</span><strong>${formatLatency(totals.averageLatency)}</strong><small>${formatCount(totals.unknownUsage)} 次用量未知</small></article>
 </div>
 <div class="usage-overview-grid"><section class="panel usage-trend"><div class="usage-section-head"><div><div class="eyebrow">REQUEST VOLUME</div><h2>请求趋势</h2><p>按 UTC 日期展示；起始日可能仅包含部分时段，重试不重复计数。</p></div><span class="usage-peak">峰值 ${esc(peak.day.slice(5))} · ${formatCount(peak.requests)} 次</span></div>${renderUsageChart(series,esc)}</section>
 <section class="panel usage-health"><div class="eyebrow">UPSTREAM HEALTH</div><h2>上游尝试</h2><div class="usage-health-total"><strong>${formatCount(attempts)}</strong><span>次尝试 · ${attempts?attemptRate+'%':'—'} 成功</span></div><progress value="${attemptRate}" max="100" aria-label="上游尝试成功率 ${attemptRate}%">${attemptRate}%</progress><div class="usage-health-legend"><span><i class="usage-legend-success"></i>成功 ${formatCount(successes)}</span><span><i class="usage-legend-failure"></i>失败 ${formatCount(totals.failures)}</span></div><p>这里按每次上游尝试计算；已被故障转移挽回的失败仍保留，便于判断服务商健康。</p></section></div>
 <section class="panel usage-cost"><div class="usage-section-head"><div><div class="eyebrow">ESTIMATED COST</div><h2>费用估算</h2></div><span>${formatCount(pricedAttempts)} 次尝试可估价</span></div><div class="usage-cost-list">${(summary.costs||[]).map(row=>`<div><span>${esc(row.currency)}</span><strong>${Number(row.amount||0).toFixed(6)}</strong></div>`).join('')||'<p class="usage-empty">暂无可估算费用。配置模型价格后，且上游返回用量时才会显示。</p>'}</div><p>按币种分开统计；未知价格或用量不会被记为零费用。</p></section>`;
}

function renderUsageProviders(rows,esc){
 return rows.map(row=>{
  const attempts=Number(row.attempts||0);
  const successRate=attempts?Math.round(Number(row.successes||0)/attempts*100):0;
  return `<tr data-usage-search="${esc((row.provider+' '+row.model).toLowerCase())}"><td><strong>${esc(row.provider)}</strong><small>${esc(row.model)}</small></td><td>${formatCount(attempts)}</td><td><span class="usage-rate ${successRate<50?'usage-rate-low':''}">${successRate}%</span></td><td>${formatCount(row.tokens)}</td><td>${formatLatency(row.latency)}</td></tr>`;
 }).join('');
}

export async function renderAnalytics({api,esc,isOwner=false,toast=()=>{}}){
 const root=document.querySelector('#content');
 root.innerHTML=`<div class="heading usage-heading"><div><div class="eyebrow">USAGE ANALYTICS</div><h1>用量分析</h1><p>查看调用趋势、上游健康和模型用量。数据按当前租户隔离。</p></div><select id="usage-days" aria-label="统计周期"><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option></select></div><div id="usage-content" aria-live="polite"><div class="view-loading" role="status"><span class="loading-dot"></span>正在读取用量…</div></div>${isOwner?'<section class="panel section-space usage-data-actions"><div><h2>统计数据管理</h2><p class="muted">仅影响当前租户；账号、API Key、配额规则和服务商配置不受影响。操作会写入租户审计。</p></div><div class="usage-data-buttons"><button type="button" id="usage-reset">重置统计起点</button><button type="button" id="usage-clear" class="danger-text">清除请求记录</button></div></section>':''}`;
 const content=root.querySelector('#usage-content');
 let loadVersion=0;
 async function load(){
  const version=++loadVersion;
  content.innerHTML='<div class="view-loading" role="status"><span class="loading-dot"></span>正在读取用量…</div>';
  try{
   const summary=await api('/api/analytics?days='+root.querySelector('#usage-days').value);
   if(version!==loadVersion||!root.isConnected)return;
   content.innerHTML=`${summary.statisticsSince?`<p class="usage-disclaimer">当前统计起点：${esc(new Date(summary.statisticsSince).toLocaleString('zh-CN'))}；此前请求日志可能仍可查询。</p>`:''}${renderUsageOverview(summary,esc)}<section class="panel usage-models"><div class="usage-section-head"><div><div class="eyebrow">MODEL BREAKDOWN</div><h2>服务商与模型</h2><p>按上游尝试次数排序，便于定位低成功率模型。</p></div><label class="usage-search"><span class="sr-only">筛选服务商或模型</span><input id="usage-model-search" type="search" placeholder="筛选服务商或模型"></label></div><div class="table-wrap"><table><thead><tr><th>服务商 / 模型</th><th>尝试</th><th>成功率</th><th>Tokens</th><th>平均耗时</th></tr></thead><tbody>${renderUsageProviders(summary.providers||[],esc)}</tbody></table></div><p class="usage-empty" id="usage-model-empty" hidden>没有匹配的模型。</p>${summary.providers?.length?'':'<p class="usage-empty">当前周期暂无模型调用。</p>'}</section><div class="usage-disclaimer">${esc(summary.costNotice)} 详细日志保留 ${formatCount(summary.retentionDays)} 天。</div>`;
   const search=content.querySelector('#usage-model-search');
   search.oninput=()=>{let visible=0;const query=search.value.trim().toLowerCase();content.querySelectorAll('[data-usage-search]').forEach(row=>{row.hidden=!row.dataset.usageSearch.includes(query);if(!row.hidden)visible++;});content.querySelector('#usage-model-empty').hidden=visible>0||!summary.providers?.length;};
  }catch(error){if(version===loadVersion&&root.isConnected)content.innerHTML=`<div class="panel usage-error" role="alert">${esc(error.message)}</div>`;}
 }
 root.querySelector('#usage-days').onchange=()=>void load();
 if(isOwner)for(const [mode,label,description] of [['reset','重置统计起点','图表和成员用量从此刻重新累计；旧请求日志仍可查询，API Key 配额计数不变。'],['clear','清除请求记录','永久删除当前租户的请求日志与用量记录，无法在平台内恢复；API Key 和配置保留，配额计数不变。']]){
  root.querySelector('#usage-'+mode).onclick=()=>confirmAction(root,label+'？',description,async()=>{await accountRequest('usage/'+mode,{confirm:mode});toast(mode==='reset'?'统计起点已重置':'当前租户请求记录已清除');await load();},toast);
 }
 await load();
}
export {renderLogs} from './request-logs.js';
