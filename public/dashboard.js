const strategyName=value=>({fallback:'自动故障转移',manual:'仅默认模型',round_robin:'轮询',weighted:'权重分流'}[value]||'自动故障转移');

function logTable(rows,esc){
 if(!rows.length)return '<div class="empty dashboard-empty"><b>还没有请求记录</b><span>在模型实验室完成一次调用后，这里会显示真实运行数据。</span><button data-tab="playground">发起测试 →</button></div>';
 return `<div class="table-wrap"><table><thead><tr><th>时间</th><th>路由</th><th>状态</th><th>耗时</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${esc(new Date(item.time).toLocaleString())}</td><td><b>${esc(item.provider)}</b><br><small>${esc(item.model)}</small></td><td><span class="tag ${item.status===200?'green':'danger'}">${item.status===200?'成功':item.status}</span></td><td>${Number(item.latency)||0} ms</td></tr>`).join('')}</tbody></table></div>`;
}

export function renderDashboard({state,esc,ready,isManager}){
 const enabled=state.providers.filter(ready),logs=state.logs||[],success=logs.filter(item=>item.status===200),active=state.providers.find(item=>item.id===state.active);
 const steps=[{done:state.providers.some(item=>item.hasKey||item.hasMeteredKey),label:'连接服务商',tab:'providers'},{done:enabled.length>0,label:'启用模型路由',tab:'providers'},{done:success.length>0,label:'完成首次成功调用',tab:'playground'}];
 const readiness=Math.round(steps.filter(step=>step.done).length/steps.length*100);
 return `<div class="dashboard-heading"><div><div class="eyebrow">OPERATIONS CONSOLE</div><h1>${active?`${esc(active.name)} 正在提供服务`:'让第一个模型上线'}</h1><p>${active?`默认模型 ${esc(active.model||'待选择')} · ${strategyName(state.strategy)}`:'连接服务商、选择模型，即可获得统一稳定的 API 入口。'}</p></div><div class="dashboard-actions"><button data-tab="playground" class="primary">运行模型</button>${isManager?'<button data-tab="providers">管理路由</button>':''}</div></div>
 <div class="metrics"><div class="metric"><label>路由就绪</label><strong>${enabled.length}<span class="muted"> / ${state.providers.length}</span></strong><small>已配置并启用</small></div><div class="metric"><label>最终调用成功率</label><strong id="dashboard-final-rate">—</strong><small id="dashboard-final-detail">正在读取近 7 天请求</small></div><div class="metric"><label>平均响应</label><strong id="dashboard-average-latency">—</strong><small>统计期内成功的上游尝试</small></div><div class="metric"><label>上游失败尝试</label><strong id="dashboard-failed-attempts">—</strong><small>统计期内尝试；含已挽回失败</small></div></div>
 <div class="dashboard-grid"><section class="panel route-map"><div class="panel-title"><div><span class="eyebrow">ROUTE PREVIEW</span><h2>当前对话候选链</h2></div><button data-tab="routing" ${isManager?'':'hidden'}>调整策略</button></div><div class="route-chain" id="dashboard-route-chain" aria-live="polite"><div class="empty compact">正在计算实际可用候选…</div></div><p class="muted" id="dashboard-route-note">基于已保存策略与空提示词预览；任务规则、模型能力及当前健康状态会影响真实请求。不调用上游。</p></section>
 <section class="panel launch-card"><div class="progress-ring progress-${readiness}"><span>${readiness}%</span></div><div><span class="eyebrow">LAUNCH CHECK</span><h2>上线检查</h2>${steps.map(step=>`<button data-tab="${step.tab}" class="check-step ${step.done?'done':''}"><span>${step.done?'✓':'○'}</span>${step.label}</button>`).join('')}</div></section></div>
 <div class="section-title"><div><h2>最近调用</h2><span>请求正文与密钥不会写入日志</span></div><button data-tab="logs" class="subtle">查看全部 →</button></div><div class="panel">${logTable(logs.slice(0,6),esc)}</div>`;
}

export function renderDashboardSummary(root,summary){
 const rate=root.querySelector('#dashboard-final-rate'),detail=root.querySelector('#dashboard-final-detail');if(!rate||!detail)return;
 const requests=Number(summary.totals?.requests||0),successes=Number(summary.totals?.requestSuccesses||0);
 rate.textContent=requests?Math.round(successes/requests*100)+'%':'—';
 detail.textContent=`近 ${summary.days} 天 · ${successes} / ${requests} 次最终成功`;
 const average=root.querySelector('#dashboard-average-latency'),failures=root.querySelector('#dashboard-failed-attempts');
 if(average)average.textContent=Number(summary.totals?.successes||0)?`${Number(summary.totals?.averageLatency||0)} ms`:'—';
 if(failures){const count=Number(summary.totals?.failures||0);failures.textContent=String(count);failures.classList?.toggle('danger-text',count>0);}
}

export function renderDashboardRoutePreview(root,preview,esc){
 const chain=root.querySelector('#dashboard-route-chain'),note=root.querySelector('#dashboard-route-note');
 if(!chain||!note)return;
 const candidates=preview.candidates.filter(route=>route.withinAttemptBudget);
 chain.innerHTML=candidates.slice(0,5).map((route,index)=>`<div class="route-node ${index===0?'active':''}"><span>${route.order}</span><div><b>${esc(route.provider)}</b><small>${esc(route.model)}</small></div>${route.health?.circuitOpen?'<em>熔断中</em>':index===0?'<em>首选</em>':''}</div>`).join('<i>→</i>')||'<div class="empty compact">当前没有可用的对话候选，请检查模型能力、密钥与路由策略。</div>';
 note.textContent=`${preview.strategy} · 最多 ${preview.maxAttempts} 次尝试 · ${preview.total} 条兼容候选。按已保存策略及空提示词预览；实际请求可能因任务规则、健康状态而变化。`;
}
