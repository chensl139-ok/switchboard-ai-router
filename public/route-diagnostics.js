// Shared, read-only explanations. Preview never sends a generation request.
export function routeDiagnostics(preview){
 const routes=(preview.candidates||[]).filter(route=>route.withinAttemptBudget);
 const providers=new Set(routes.map(route=>route.providerId));
 const models=new Set(routes.map(route=>JSON.stringify([route.providerId,route.model])));
 const warnings=[];
 if(routes.length&&preview.maxAttempts===1)warnings.push('最多只允许 1 次尝试，失败后不会使用备用。');
 else if(models.size===1&&routes.length>1)warnings.push('当前仅切换同一模型的主备密钥，无法应对模型整体故障。');
 else if(routes.length===1)warnings.push('目前只有一个可用候选，尚无容灾路径。');
 else if(routes.length>1&&providers.size===1)warnings.push('当前尝试范围只覆盖一家服务商，无法应对服务商整体故障。');
 return {attempts:routes.length,models:models.size,providers:providers.size,warnings};
}

export function routeDiagnosticsMarkup(preview,esc){
 const info=routeDiagnostics(preview);
 return `<div class="route-diagnostics"><div class="route-coverage" aria-label="容灾覆盖"><span><b>${info.models}</b> 个模型</span><span><b>${info.providers}</b> 家服务商</span><span><b>${info.attempts}</b> 个可尝试候选</span></div>${info.warnings.map(warning=>`<p class="route-warning">${esc(warning)}</p>`).join('')}${(preview.excluded||[]).length?`<details class="route-technical"><summary>已排除的候选（${preview.excluded.length}）</summary>${preview.excluded.map(route=>`<p><code>${esc(route.providerId)} / ${esc(route.model)}</code><br>${esc(route.reason)}</p>`).join('')}</details>`:''}</div>`;
}

export function routeSampleLabel(health){
 return health?.samples>=3&&Number.isFinite(health.averageLatency)?`${Math.round(health.averageLatency)} ms · ${health.samples} 条近期成功样本`:'近期成功样本不足 3 条，暂不用于延迟排名';
}
