export const routeModes=[
 ['economy','经济优先','按有效的同币种模型单价排序；未知或过期价格不参与。'],
 ['manual','固定模型','固定默认服务商与模型；主密钥失败时自动尝试备用密钥。'],
 ['fallback','故障转移','按服务商顺序、模型与备用密钥组成高可用候选链。'],
 ['weighted','加权轮询','按照服务商权重分配请求，失败时尝试其他路由。'],
 ['latency','最低延迟','近一小时至少 3 条成功样本的平均耗时，无样本按优先级。'],
 ['rules','任务规则','按最后一条用户消息匹配关键词，从上到下命中第一条规则。'],
];
export function renderRouting({state,api,esc,updated,toast}){
 const root=document.querySelector('#content');
 let rules=structuredClone(state.rules||[]);
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">ROUTING POLICIES</div><h1>模型路由</h1><p>选路、健康过滤和故障转移由一套策略统一完成。</p></div></div>
 <div class="routing-flow" aria-label="路由执行流程"><div><b>1</b><span><strong>选择候选</strong><small>按策略排列模型</small></span></div><i>→</i><div><b>2</b><span><strong>健康过滤</strong><small>跳过熔断路由</small></span></div><i>→</i><div><b>3</b><span><strong>失败切换</strong><small>共用总超时预算</small></span></div></div>
 <form id="routing-form"><div class="routing-config-grid"><div class="panel"><div class="panel-title"><div><span class="eyebrow">POLICY</span><h2>选择策略</h2></div><span class="tag green">协议自动适配</span></div><div class="routing-modes">${routeModes.map(([id,name,desc])=>`<label class="routing-mode"><input type="radio" name="strategy" value="${id}" ${state.strategy===id?'checked':''}><strong>${name}</strong><span>${desc}</span></label>`).join('')}</div>
 <div class="routing-primary-fields"><label>默认服务商<select name="active"><option value="">请选择</option>${state.providers.filter(p=>p.enabled&&(p.hasKey||p.hasMeteredKey)).map(p=>`<option value="${p.id}" ${p.id===state.active?'selected':''}>${esc(p.name)} · ${esc(p.model)}</option>`).join('')}</select></label><label>经济优先币种<select name="currency"><option value="USD">USD</option><option value="CNY">CNY</option></select></label></div></div>
 <section class="panel routing-guardrails"><div class="panel-title"><div><span class="eyebrow">GUARDRAILS</span><h2>可用性保护</h2></div></div><div class="form-grid">${[['timeoutMs','总超时（毫秒）',3000,120000],['maxAttempts','最多尝试次数',1,10],['requestsPerMinute','每分钟上限',1,10000],['concurrency','并发上限',1,100]].map(([key,label,min,max])=>`<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" value="${state.routing[key]}" required></label>`).join('')}</div>
 <div class="routing-note"><strong>自动熔断</strong><p>连续 3 次可重试故障后暂停路由 60 秒。参数错误不会误触发熔断；流式响应开始后不再切换模型。</p></div></section></div>
 <div class="section-title"><h2>任务规则</h2><button id="add-rule" type="button">＋ 添加规则</button></div><div id="rule-list"></div><button class="primary" id="save-routing">保存策略</button><p id="routing-error" role="alert"></p></form>`;
 const form=root.querySelector('#routing-form');form.elements.currency.value=state.routing.currency||'USD';const list=root.querySelector('#rule-list');
 const targets=state.providers.filter(p=>p.enabled&&(p.hasKey||p.hasMeteredKey)).flatMap(p=>p.models.map(model=>({providerId:p.id,model,label:p.name+' / '+model})));
 function draw(){list.innerHTML=rules.map((r,index)=>`<div class="panel rule-row" data-rule="${index}"><div class="form-grid"><label>规则名称<input data-field="name" value="${esc(r.name)}" required maxlength="80"></label><label>关键词（逗号分隔）<input data-field="keywords" value="${esc(r.keywords.join(','))}" required></label></div><label>目标模型<select data-field="target" required><option value="">选择模型</option>${targets.map(t=>`<option value="${esc(JSON.stringify([t.providerId,t.model]))}" ${t.providerId===r.providerId&&t.model===r.model?'selected':''}>${esc(t.label)}</option>`).join('')}</select></label><button type="button" data-remove="${index}">移除规则</button></div>`).join('')||'<p class="muted">暂无规则，未命中时使用默认服务商及故障转移。</p>';}
 function collect(){return [...list.querySelectorAll('[data-rule]')].map(row=>{const target=row.querySelector('[data-field=target]').value;const [providerId,model]=target?JSON.parse(target):['',''];return {name:row.querySelector('[data-field=name]').value,keywords:row.querySelector('[data-field=keywords]').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean),providerId,model}});}
 draw();root.querySelector('#add-rule').onclick=()=>{rules=collect();rules.push({name:'',keywords:[],providerId:'',model:''});draw();};
 list.onclick=e=>{const b=e.target.closest('[data-remove]');if(b){rules=collect();rules.splice(Number(b.dataset.remove),1);draw();}};
 form.onsubmit=async e=>{e.preventDefault();const button=root.querySelector('#save-routing');button.disabled=true;
  try{const routing={currency:form.elements.currency.value};for(const key of ['timeoutMs','maxAttempts','requestsPerMinute','concurrency'])routing[key]=Number(form.elements[key].value);
   updated(await api('/api/routing',{strategy:form.elements.strategy.value,active:form.elements.active.value,rules:collect(),routing}));toast('路由策略已保存');
  }catch(error){root.querySelector('#routing-error').textContent=error.message;}finally{button.disabled=false;}
 };
}
