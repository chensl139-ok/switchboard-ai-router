import {modelCapabilities} from './model-capability.js';

export const providerReady=provider=>Boolean(provider.enabled&&provider.model&&(provider.hasKey||provider.hasMeteredKey));

export function providerHealth(provider,logs){
 const rows=(logs||[]).filter(log=>(log.providerId??log.provider_id)===provider.id).slice(0,20);
 if(!rows.length)return {label:'待验证',tone:'',detail:'尚无调用样本'};
 if(Number(rows[0].status)===401)return {label:'鉴权失败',tone:'danger',detail:'最近调用返回 401 · 请更新 API Key'};
 const successes=rows.filter(log=>Number(log.status)===200),rate=Math.round(successes.length/rows.length*100);
 const durations=successes.map(log=>Number(log.latency)).filter(value=>Number.isFinite(value)&&value>=0);
 const latency=durations.length?Math.round(durations.reduce((sum,value)=>sum+value,0)/durations.length):0;
 if(Number(rows[0].status)===200&&rate<70)return {label:'恢复中',tone:'warning',detail:`最近尝试成功 · 近 ${rows.length} 次上游尝试成功率 ${rate}%`};
 return {label:rate>=95?'健康':rate>=70?'波动':'异常',tone:rate>=95?'green':rate<70?'danger':'warning',detail:`近 ${rows.length} 次上游尝试成功率 ${rate}%${latency?` · ${latency} ms`:''}`};
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
 return `<div class="cards provider-grid provider-list" aria-label="组织 API 服务商">${state.providers.map((provider,index)=>{
  const ready=providerReady(provider),health=providerHealth(provider,state.logs),active=state.active===provider.id;
  const controls=manage&&isManager?`<details class="provider-more"><summary aria-label="${esc(provider.name)}的更多操作" title="更多操作">···</summary><div class="provider-order" aria-label="调整默认候选顺序"><button class="icon-button" data-provider-move="up" data-provider-id="${esc(provider.id)}" ${index===0?'disabled':''}>↑ 上移</button><button class="icon-button" data-provider-move="down" data-provider-id="${esc(provider.id)}" ${index===state.providers.length-1?'disabled':''}>↓ 下移</button><button class="icon-button danger-button" data-provider-delete="${esc(provider.id)}">删除服务商</button></div></details>`:'';
  return `<article data-provider-card data-search="${esc([provider.name,provider.id,...(provider.models||[])].join(' ').toLowerCase())}" data-ready="${ready?'true':'false'}" class="card provider-card provider-row ${active?'active':''}"><div class="provider-identity"><div class="card-top"><span class="provider-rank" aria-label="默认候选顺序 ${index+1}">${index+1}</span><div class="provider-title"><h3>${esc(provider.name)}</h3><small>${esc(provider.id)}</small></div><span class="tag ${ready?'green':''}">${!provider.enabled?'未启用':!ready?'待配置':'已启用'}</span></div><div class="provider-meta"><span>${provider.models?.length||0} 个模型</span><span title="${provider.hasKey&&provider.hasMeteredKey?'主密钥 + 备用密钥，都可参与调用':provider.hasKey||provider.hasMeteredKey?'已保存一把密钥':'尚未配置密钥'}">${provider.hasKey&&provider.hasMeteredKey?'双密钥':provider.hasKey||provider.hasMeteredKey?'已保存密钥':'无密钥'}</span></div></div><div class="provider-health" data-provider-health="${esc(provider.id)}">${healthMarkup(health)}</div><label class="provider-model-field">默认模型<select aria-label="${esc(provider.name)}默认模型" data-provider-model="${esc(provider.id)}" ${!provider.models?.length||!isManager?'disabled':''}>${(provider.models?.length?provider.models:['']).map(model=>`<option value="${esc(model)}" ${model===provider.model?'selected':''}>${esc(model||'尚未设置模型')}${model&&!modelCapabilities(model).chat?' · 非对话':''}</option>`).join('')}</select></label><div class="card-actions"><button data-edit="${esc(provider.id)}" ${!isManager?'disabled':''}>配置</button><button data-switch="${esc(provider.id)}" ${!ready||active||!isManager?'disabled':''}>${active?'默认服务商':'设为默认'}</button>${controls}</div></article>`;
 }).join('')}</div>`;
}
