export const providerReady=provider=>Boolean(provider.enabled&&provider.model&&(provider.hasKey||provider.hasMeteredKey));

export function providerHealth(provider,logs){
 const rows=(logs||[]).filter(log=>(log.providerId??log.provider_id)===provider.id).slice(0,20);
 if(!rows.length)return {label:'待验证',tone:'',detail:'尚无调用样本'};
 const successes=rows.filter(log=>log.status===200),rate=Math.round(successes.length/rows.length*100);
 const latency=successes.length?Math.round(successes.reduce((sum,log)=>sum+log.latency,0)/successes.length):0;
 return {label:rate>=95?'健康':rate>=70?'波动':'异常',tone:rate>=95?'green':rate<70?'danger':'warning',detail:`近 ${rows.length} 次成功率 ${rate}%${latency?` · ${latency} ms`:''}`};
}

const healthMarkup=health=>`<span class="health-dot ${health.tone}"></span><strong>${health.label}</strong><small>${health.detail}</small>`;

export function refreshProviderHealth(root,providers,logs){
 const byId=new Map(providers.map(provider=>[provider.id,provider]));
 for(const node of root.querySelectorAll('[data-provider-health]')){
  const provider=byId.get(node.dataset.providerHealth);
  if(provider)node.innerHTML=healthMarkup(providerHealth(provider,logs));
 }
}

export function providerCards({state,esc,isManager,manage=false}){
 return `<div class="cards provider-grid">${state.providers.map((provider,index)=>{
  const ready=providerReady(provider),health=providerHealth(provider,state.logs),active=state.active===provider.id;
  const controls=manage&&isManager?`<div class="provider-order" aria-label="调整故障转移顺序"><button class="icon-button" data-provider-move="up" data-provider-id="${esc(provider.id)}" ${index===0?'disabled':''} title="上移">↑</button><button class="icon-button" data-provider-move="down" data-provider-id="${esc(provider.id)}" ${index===state.providers.length-1?'disabled':''} title="下移">↓</button><button class="icon-button danger-button" data-provider-delete="${esc(provider.id)}" title="删除服务商">删除</button></div>`:'';
  return `<article data-provider-card data-search="${esc([provider.name,provider.id,...(provider.models||[])].join(' ').toLowerCase())}" data-ready="${ready?'true':'false'}" class="card provider-card ${active?'active':''}"><div class="provider-rank">${String(index+1).padStart(2,'0')}</div><div class="card-top"><div class="avatar">${esc(provider.name[0])}</div><div class="provider-title"><h3>${esc(provider.name)}</h3><small>${esc(provider.id)}</small></div><span class="tag ${ready?'green':''}">${!provider.enabled?'未启用':!ready?'待配置':active?'默认路由':'已启用'}</span></div><div class="provider-health" data-provider-health="${esc(provider.id)}">${healthMarkup(health)}</div><div class="provider-meta"><span>自动协议</span><span>${provider.models?.length||0} 个模型</span><span title="${provider.hasKey&&provider.hasMeteredKey?'主密钥 + 备用密钥，都可参与调用':provider.hasKey||provider.hasMeteredKey?'已配置一把密钥，够用':'尚未配置密钥'}">${provider.hasKey&&provider.hasMeteredKey?'主 + 备用双密钥':provider.hasKey||provider.hasMeteredKey?'单密钥':'无密钥'}</span></div><label>当前模型<select data-provider-model="${esc(provider.id)}" ${!provider.models?.length||!isManager?'disabled':''}>${(provider.models?.length?provider.models:['']).map(model=>`<option value="${esc(model)}" ${model===provider.model?'selected':''}>${esc(model||'尚未设置模型')}</option>`).join('')}</select></label><div class="card-actions"><button data-edit="${esc(provider.id)}" ${!isManager?'disabled':''}>配置</button><button data-switch="${esc(provider.id)}" ${!ready||active||!isManager?'disabled':''}>${active?'✓ 默认路由':'设为默认'}</button></div>${controls}</article>`;
 }).join('')}</div>`;
}
