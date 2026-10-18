// Render personal OAuth connections alongside shared API providers. Credentials
// never enter the browser or the shared routing configuration.
export function planProviderCards(providers,esc){
 return providers.map(provider=>{
  const ready=provider.enabled&&provider.models.length>0;
  const label=providers.filter(item=>item.accountLabel===provider.accountLabel).length>1?provider.accountLabel+' · '+provider.subscriptionId.slice(0,6):provider.accountLabel;
  return `<article class="card provider-card provider-row personal-provider-card" data-provider-card data-search="${esc([provider.name,label,...provider.models].join(' ').toLowerCase())}" data-ready="${ready}"><div class="provider-identity"><div class="card-top"><div class="provider-title"><h3>${esc(provider.name)}</h3><small>${esc(label)}</small></div><span class="tag">仅本人</span></div><div class="provider-meta"><span>订阅授权</span><span>${provider.models.length} 个模型</span></div></div><div class="provider-health"><span class="health-dot ${ready?'green':provider.error?'danger':''}"></span><strong>${ready?'已授权':provider.error?'连接异常':provider.connected?'未授权订阅用量':'已断开'}</strong><small>${esc(provider.error||'用于个人路由与实验室')}${provider.lastCall?`<br>最近调用：${esc(provider.lastCall.model)}`:''}</small></div><label class="provider-model-field">默认实验模型<select aria-label="${esc(provider.name)}默认实验模型" data-plan-model="${esc(provider.subscriptionId)}" ${!ready?'disabled':''}>${provider.models.length?provider.models.map(model=>`<option value="${esc(model)}" ${model===provider.model?'selected':''}>${esc(provider.modelNames[model]||model)}</option>`).join(''):'<option>请重新连接后获取模型</option>'}</select></label><div class="card-actions"><button data-plan-run="${esc(provider.subscriptionId)}" ${!ready?'disabled':''}>在实验室对话</button><button data-plan-connect="${esc(provider.subscriptionId)}">${provider.connected?'重新授权':'连接订阅'}</button>${provider.connected?`<details class="provider-more"><summary aria-label="${esc(provider.name)}的更多操作" title="更多操作">···</summary><div class="provider-order"><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">用量与授权 ↗</a><button class="danger-button" data-plan-disconnect="${esc(provider.subscriptionId)}">断开连接</button></div></details>`:''}</div></article>`;
 }).join('');
}

export function mountPlanProviders({root,state,api,esc,toast,isCurrent,onRun,onChange}){
 const section=document.createElement('section');section.className='personal-providers section-space';
 section.innerHTML='<div class="section-title"><div><h2>个人订阅</h2><p class="muted">用于个人路由与实验室，仅本人可见。</p></div><div class="plan-provider-actions"><button type="button" data-plan-refresh>刷新模型</button><button type="button" data-plan-add>连接 ChatGPT</button></div></div><div data-plan-status role="status" hidden></div><div class="cards provider-grid provider-list" data-plan-cards aria-label="个人订阅服务商"></div><details class="personal-provider-footnote"><summary>支持哪些订阅？</summary><p>ChatGPT 可通过官方页面授权。Claude 订阅接入暂未开放。订阅凭据仅用于当前账户，不向组织成员或业务 API 共享。<a href="https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account" target="_blank" rel="noopener noreferrer">Claude 官方说明 ↗</a></p></details>';
 const shared=root.querySelector('.provider-grid');if(shared)shared.before(section);else root.append(section);
 if(shared)shared.insertAdjacentHTML('beforebegin','<h2 class="shared-provider-title">组织 API 服务商</h2>');
 let busy=false,connecting=false;
 const draw=()=>{section.querySelector('[data-plan-cards]').innerHTML=planProviderCards(state.personalProviders||[],esc);section.querySelector('[data-plan-cards]').hidden=!(state.personalProviders||[]).length;onChange?.();};
 const refresh=async()=>{if(busy||!isCurrent())return;busy=true;try{const result=await api('/api/account/chatgpt/providers');if(isCurrent()&&JSON.stringify(state.personalProviders)!==JSON.stringify(result.providers)){state.personalProviders=result.providers;draw();}}catch(error){if(isCurrent())toast(error.message);}finally{busy=false;}};
 section.onclick=async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.hasAttribute('data-plan-refresh')){await refresh();return;}
  const run=button.dataset.planRun;if(run){const provider=state.personalProviders.find(item=>item.subscriptionId===run);if(provider)onRun(provider.id,section.querySelector(`[data-plan-model="${run}"]`).value);return;}
  if(button.hasAttribute('data-plan-add')||button.hasAttribute('data-plan-connect')){
   if(connecting)return;connecting=true;button.disabled=true;const status=section.querySelector('[data-plan-status]');status.hidden=false;status.textContent='正在准备官方授权…';
   try{const result=await api('/api/account/chatgpt/start',button.dataset.planConnect?{id:button.dataset.planConnect}:{});if(isCurrent()){
    const url=new URL(result.url);if(url.origin!==location.origin||url.pathname!=='/api/account/chatgpt/authorize'||!url.searchParams.get('ticket'))throw Error('授权入口无效，请刷新 App 后重试');
    status.className='info';status.textContent='已请求在系统浏览器打开授权页。请在浏览器完成授权，再返回 App 刷新模型；若浏览器未打开，可重新打开。';
    const retry=document.createElement('button');retry.type='button';retry.textContent='重新打开授权';retry.setAttribute('data-plan-connect',button.dataset.planConnect||'');status.append(retry);location.assign(url.href);
   }}catch(error){if(isCurrent()){status.textContent=error.message;toast(error.message);}}finally{connecting=false;if(button.isConnected)button.disabled=false;}return;
  }
  if(button.dataset.planDisconnect){
   if(!confirm('断开此个人订阅？本地凭证会清除，并尝试撤销官方授权；组织 API 服务商不受影响。'))return;
   button.disabled=true;try{const result=await api('/api/account/chatgpt/disconnect',{id:button.dataset.planDisconnect});if(isCurrent()){toast(result.revoked?'订阅已断开':'本地凭证已清除，请在 ChatGPT 设置中检查官方授权');await refresh();}}catch(error){if(isCurrent())toast(error.message);}finally{if(button.isConnected)button.disabled=false;}
  }
 };
 section.onchange=async event=>{
  const select=event.target.closest('[data-plan-model]');if(!select)return;select.disabled=true;
  try{await api('/api/account/chatgpt/select-model',{id:select.dataset.planModel,model:select.value});if(!isCurrent())return;const provider=state.personalProviders.find(item=>item.subscriptionId===select.dataset.planModel);if(provider)provider.model=select.value;toast('默认实验模型已更新；不会改变组织路由');}
  catch(error){if(isCurrent()){toast(error.message);draw();}}finally{if(select.isConnected)select.disabled=false;}
 };
 const focus=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',focus);
 const timer=setInterval(()=>{if(!isCurrent()){clearInterval(timer);document.removeEventListener('visibilitychange',focus);return;}if(document.visibilityState==='visible')void refresh();},15000);
 draw();
}
