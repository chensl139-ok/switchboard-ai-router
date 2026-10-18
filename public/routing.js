import {modelCapabilities} from './model-capability.js';
import {routingObjectives,routingDraft,draftPolicy} from './routing-policy.js';

// This page edits a local draft. Only the Save button changes live routing.
export function renderRouting({state,api,esc,updated,toast,personalAvailable=false,sharedState=state,canManageShared=true}){
 const root=document.querySelector('#content'),personal=Boolean(state.personalRouting),endpoint=personal?'/api/account/chatgpt/routing':'/api/routing';
 const providers=state.providers.filter(p=>p.enabled&&(p.private||p.hasKey||p.hasMeteredKey));
 const targets=providers.flatMap(p=>[...new Set([p.model,...p.models].filter(Boolean))].filter(model=>modelCapabilities(model).chat).map(model=>({value:JSON.stringify([p.id,model]),label:p.name+' / '+model,private:p.private})));
 let draft=routingDraft(state),inheriting=personal&&state.inherited===true,previewVersion=0,previewTimer=null;
 const label=value=>targets.find(t=>t.value===value)?.label||'已不可用的模型';
 const options=(value,exclude=[])=>'<option value="">请选择模型</option>'+targets.map(t=>`<option value="${esc(t.value)}" ${t.value===value?'selected':''} ${exclude.includes(t.value)&&t.value!==value?'disabled':''}>${esc(t.label)}${t.private?'（仅本人）':''}</option>`).join('')+(value&&!targets.some(t=>t.value===value)?`<option selected value="${esc(value)}">已不可用，请重新选择</option>`:'');
 root.innerHTML=`<div class="heading"><div><h1>模型路由</h1><p>选好常用模型，再决定失败后怎么办。只在保存后生效。</p></div></div>
 <div class="route-audience" id="routing-scope" aria-label="设置应用范围">${canManageShared?`<button type="button" data-scope="shared" aria-pressed="${!personal}">团队共用</button>`:''}${personalAvailable?`<button type="button" data-scope="personal" aria-pressed="${personal}">仅我的实验室</button>`:''}<p>${personal?'只影响本人、当前租户。个人订阅不会共享给其他成员或业务 API。':'同事与对外 API 使用 model=auto 时，都会使用这里的设置。'}</p></div>
 ${personal?`<section class="route-inherit panel"><div><strong>${inheriting?'正在沿用团队设置':'已使用个人设置'}</strong><p>${inheriting?'团队更新路由后会自动跟随，无需再配置一遍。':'未修改的项目继续跟随团队，个人订阅仍只限本人使用。'}</p></div><button type="button" id="routing-inherit">${inheriting?'为我单独设置':'恢复跟随团队'}</button></section>`:''}
 <div class="route-workbench"><form id="routing-form" class="route-editor" ${inheriting?'hidden':''}>
 <section class="panel route-question"><div class="route-question-title"><span>1</span><div><h2>平时先用哪个模型？</h2><p>直接选模型，不用先理解服务商优先级或协议。</p></div></div><label for="route-preferred">首选模型</label><select id="route-preferred" name="preferred"><option value="">让平台按可用模型挑选</option>${options(draft.preferred).replace('<option value="">请选择模型</option>','')}</select><p id="route-primary-note" class="muted"></p>${!targets.length?'<p class="info">当前没有可用的对话模型。请先在<a href="#providers">服务商与模型</a>完成配置。</p>':''}</section>
 <section class="panel route-question"><div class="route-question-title"><span>2</span><div><h2>失败后怎么办？</h2><p>同一服务商和不同服务商的模型，都可以作为备用。</p></div></div>
 <div class="route-backup-choices">${[['auto','自动挑选备用（推荐）','从已启用的模型中选择可用备用，省去逐个配置。'],['selected','我来指定顺序','按列表顺序尝试备用；若配置了关键词例外，例外优先生效。'],['off','不换其他模型','只调用首选模型；如已配备用密钥，仍可重试同模型。']].map(([id,title,desc])=>`<label><input type="radio" name="backupMode" value="${id}" ${draft.backupMode===id?'checked':''}><span><strong>${title}</strong><small>${desc}</small></span></label>`).join('')}</div>
 <div id="route-backups" hidden><div id="route-backup-list"></div><button type="button" id="route-add-backup">＋ 添加备用模型</button><p class="muted">只对兼容且健康的模型发起调用；主、备用密钥都占用尝试次数。</p></div></section>
 <details class="panel route-advanced" id="route-advanced"><summary><span>进阶设置</span><small>省钱、响应速度、例外规则与调用限制</small></summary>
 <label>自动挑选时，更看重什么？<select name="goal">${routingObjectives.map(([id,name,desc])=>`<option value="${id}" ${draft.goal===id?'selected':''}>${id==='fallback'?'先用我的首选模型':id==='economy'?'优先选参考价更低的':id==='latency'?'优先选近期响应更快的':'按服务商权重分配'}</option>`).join('')}</select></label><p id="route-goal-note" class="muted"></p>
 <div id="route-currency"><label>参考价格币种<select name="currency"><option value="USD">美元 USD</option><option value="CNY">人民币 CNY</option></select></label><p class="muted">价格仅作参考；无有效同币种价格的模型不会当作免费使用。</p></div>
 <div class="route-exceptions"><h3>什么情况下换用特定模型？</h3><label class="check"><input type="checkbox" name="rulesEnabled" ${draft.rulesEnabled?'checked':''}>按消息关键词选择模型</label><p class="muted">从上往下匹配第一条。没有命中或目标不兼容时，继续按常规设置执行。</p><div id="routing-rule-editor"><div id="rule-list"></div><button type="button" id="add-rule">＋ 添加例外</button></div></div>
 <div class="route-limits"><h3>最多等多久、尝试几次？</h3><div class="form-grid"><label>整次请求最长等待（秒）<input name="timeoutSeconds" type="number" min="3" max="120" step="0.001" value="${draft.timeoutSeconds}" required></label><label>最多尝试次数（含首选）<input name="maxAttempts" type="number" min="1" max="10" value="${draft.maxAttempts}" required></label><label>每分钟请求上限<input name="requestsPerMinute" type="number" min="1" max="10000" value="${draft.requestsPerMinute}" required ${personal?'readonly title="由团队管理员设置"':''}></label><label>同时处理请求数<input name="concurrency" type="number" min="1" max="100" value="${draft.concurrency}" required ${personal?'readonly title="由团队管理员设置"':''}></label></div><p class="muted">所有尝试共用等待时间。${personal?'团队的请求与并发上限不可在个人设置中扩大。':''}</p></div></details>
 <div class="route-save"><div><strong id="route-save-state">已保存的设置</strong><p id="routing-error" role="alert"></p></div><button type="button" id="route-revert" disabled>撤销修改</button><button type="submit" class="primary" id="save-routing">保存并生效</button></div></form>
 <section class="panel route-outcome" role="complementary" aria-label="调用顺序预览"><div class="panel-title"><h2>实际会怎么调用？</h2><span id="route-preview-badge" class="tag">当前设置</span></div><p id="route-overview"></p><label>试一句话（可选）<input id="route-preview-prompt" maxlength="2000" placeholder="例如：帮我写一段 SQL"></label><p class="route-preview-help">这里只算顺序，不发送消息给模型，不消耗模型额度。</p><div id="route-preview-result" aria-live="polite">正在计算…</div><button type="button" id="route-preview-run">重新检查顺序</button><p class="route-safety-note">已开始输出内容后，不会换模型拼接回答。显式指定 provider::model 的 API 调用，不受这里的自动切换设置影响。</p></section></div>`;
 const form=root.querySelector('#routing-form'),list=root.querySelector('#rule-list'),backupList=root.querySelector('#route-backup-list');
 const current=()=>root.isConnected&&root.querySelector('#routing-form')===form;
 const rerender=next=>{if(current()){clearTimeout(previewTimer);renderRouting({state:next,api,esc,updated,toast,personalAvailable,sharedState,canManageShared});}};
 form.elements.preferred.value=draft.preferred;form.elements.currency.value=draft.currency;
 function capture(){
  for(const key of ['preferred','backupMode','goal','currency','timeoutSeconds','maxAttempts','requestsPerMinute','concurrency'])draft[key]=form.elements[key].value;
  draft.rulesEnabled=form.elements.rulesEnabled.checked;
  draft.backups=[...backupList.querySelectorAll('select')].map(select=>select.value);
  draft.rules=[...list.querySelectorAll('[data-rule]')].map(row=>{let pair=['',''];try{pair=JSON.parse(row.querySelector('[data-field=target]').value);}catch{}return {name:row.querySelector('[data-field=name]').value,keywords:row.querySelector('[data-field=keywords]').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean),providerId:pair[0],model:pair[1]};});
 }
 // Compare semantic drafts rather than number/string control representations.
 const signature=()=>{try{return JSON.stringify(draftPolicy(draft));}catch{return JSON.stringify(draft);}};
 const savedSignature=signature();
 const dirty=()=>!inheriting&&signature()!==savedSignature;
 function sync(){
  const auto=draft.backupMode==='auto',rulesOn=draft.backupMode!=='off'&&draft.rulesEnabled,sorting=auto&&draft.goal!=='fallback';
  form.elements.goal.disabled=!auto;form.elements.preferred.disabled=sorting;form.elements.rulesEnabled.disabled=draft.backupMode==='off';
  root.querySelector('#route-backups').hidden=draft.backupMode!=='selected';for(const node of backupList.querySelectorAll('select,button')){const index=Number(node.closest('[data-backup]').dataset.backup);node.disabled=draft.backupMode!=='selected'||node.dataset.move==='up'&&index===0||node.dataset.move==='down'&&index===draft.backups.length-1;}
  root.querySelector('#routing-rule-editor').hidden=!rulesOn;for(const node of list.querySelectorAll('input,select,button'))node.disabled=!rulesOn;
  root.querySelector('#route-currency').hidden=!auto||draft.goal!=='economy';
  root.querySelector('#route-primary-note').textContent=sorting?'当前按'+({economy:'参考价格',latency:'近期响应耗时',weighted:'服务商权重'}[draft.goal])+'自动挑选，首选模型不保证排在第一。':'先尝试这里的模型；临时不可用或能力不匹配时，按下方备用方式处理。';
  root.querySelector('#route-goal-note').textContent=!auto?'手动指定备用或不换模型时，按你明确选择的模型执行。':routingObjectives.find(([id])=>id===draft.goal)?.[2]||'';
  root.querySelector('#route-add-backup').disabled=draft.backups.length>=9;
  root.querySelector('#route-revert').disabled=!dirty();root.querySelector('#route-save-state').textContent=dirty()?'有未保存的修改':'已保存的设置';
  root.querySelector('#route-preview-badge').textContent=dirty()?'草稿 · 未生效':inheriting?'跟随团队':'当前设置';
  const policy=draftPolicySafe();root.querySelector('#route-overview').textContent=policy?`${policy.strategy==='manual'?'只使用 '+label(draft.preferred):sorting?'由平台按进阶设置挑选模型':'先用 '+(draft.preferred?label(draft.preferred):'平台选出的可用模型')}。${policy.strategy!=='manual'?'失败后'+(draft.backupMode==='selected'?'按你指定的顺序切换。':'自动尝试备用。'):''}整次最多等待 ${draft.timeoutSeconds} 秒，最多 ${draft.maxAttempts} 次尝试。`:'请先把首选与备用模型填写完整。';
 }
 function draftPolicySafe(){try{return draftPolicy(draft);}catch{return null;}}
 function drawBackups(){backupList.innerHTML=draft.backups.map((value,index)=>`<div class="route-backup-row" data-backup="${index}"><span>${index+1}</span><label>备用模型 ${index+1}<select required>${options(value,[draft.preferred,...draft.backups.filter((_,i)=>i!==index)])}</select></label><div><button type="button" data-move="up" ${index===0?'disabled':''} aria-label="备用 ${index+1} 上移">↑</button><button type="button" data-move="down" ${index===draft.backups.length-1?'disabled':''} aria-label="备用 ${index+1} 下移">↓</button><button type="button" data-remove-backup="${index}" aria-label="移除备用 ${index+1}">移除</button></div></div>`).join('');}
 function drawRules(){list.innerHTML=draft.rules.map((r,index)=>`<div class="route-exception-row" data-rule="${index}"><label>备注名称<input data-field="name" required maxlength="80" value="${esc(r.name)}" placeholder="例如：编程任务"></label><label>消息包含任一关键词<input data-field="keywords" required value="${esc(r.keywords.join('，'))}" placeholder="例如：SQL，代码"></label><label>改用这个模型<select data-field="target" required>${options(r.providerId&&r.model?JSON.stringify([r.providerId,r.model]):'')}</select></label><button type="button" data-remove-rule="${index}">删除例外</button></div>`).join('')||'<p class="muted">还没有例外，所有请求按常规设置处理。</p>';}
 function changed(){capture();sync();previewVersion++;clearTimeout(previewTimer);previewTimer=setTimeout(preview,300);}
 async function preview(){
  if(!current())return;clearTimeout(previewTimer);const version=++previewVersion,target=root.querySelector('#route-preview-result');
  let policy;try{if(!inheriting)policy=draftPolicy(draft);}catch(error){target.textContent=error.message;return;}
  target.textContent='正在检查可用模型与顺序…';
  try{const result=await api(endpoint+'/preview',{model:'auto',prompt:root.querySelector('#route-preview-prompt').value,...(policy?{policy}:{})});if(!current()||version!==previewVersion)return;
   const inside=result.candidates.filter(p=>p.withinAttemptBudget),outside=result.candidates.filter(p=>!p.withinAttemptBudget);
   target.innerHTML=inside.length?`<ol class="route-result-steps">${inside.map((p,index)=>`<li><span>${index+1}</span><div><small>${index===0?'先调用':p.channel==='metered'?'仍失败则用备用密钥':'失败后再调用'}</small><strong>${esc(p.provider)}</strong><code>${esc(p.model)}</code></div></li>`).join('')}</ol>`:'<p class="info">没有符合条件的可用模型，请调整首选、备用或进阶设置。</p>';
   target.insertAdjacentHTML('beforeend',`<p class="route-preview-help">${outside.length||result.total>result.candidates.length?`另有候选超出 ${result.maxAttempts} 次尝试上限，本次不会调用。可在进阶设置调整上限。`:`最多尝试 ${result.maxAttempts} 次；成功后立即停止，不会重复调用后面的模型。`}</p><details class="route-technical"><summary>为什么是这个顺序？</summary>${result.candidates.map(p=>`<p>${p.order}. ${esc(p.provider)} / ${esc(p.model)}${p.withinAttemptBudget?'':'（超出次数上限）'}<br><small>${esc(p.reason||'按当前设置')} · ${esc(p.protocol)}</small></p>`).join('')}${result.excluded.length?`<p>另有 ${result.excluded.length} 个候选不兼容本次请求，已跳过。</p>`:''}</details>`);
  }catch(error){if(current()&&version===previewVersion)target.textContent=error.message;}
 }
 drawBackups();drawRules();sync();void preview();
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 form.addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
 root.querySelector('#route-add-backup').onclick=()=>{capture();if(draft.backups.length>=9)return;draft.backups.push('');drawBackups();sync();void preview();};
 backupList.onclick=event=>{const button=event.target.closest('button');if(!button||button.disabled)return;const row=button.closest('[data-backup]'),index=Number(row.dataset.backup);capture();if(button.hasAttribute('data-remove-backup'))draft.backups.splice(index,1);else{const next=index+(button.dataset.move==='up'?-1:1);if(next<0||next>=draft.backups.length)return;[draft.backups[index],draft.backups[next]]=[draft.backups[next],draft.backups[index]];}drawBackups();sync();void preview();};
 root.querySelector('#add-rule').onclick=()=>{capture();draft.rules.push({name:'',keywords:[],providerId:'',model:''});drawRules();sync();void preview();};
 list.onclick=event=>{const button=event.target.closest('[data-remove-rule]');if(!button)return;capture();draft.rules.splice(Number(button.dataset.removeRule),1);drawRules();sync();void preview();};
 root.querySelector('#route-revert').onclick=()=>rerender(state);
 root.querySelector('#route-preview-run').onclick=()=>{capture();sync();void preview();};root.querySelector('#route-preview-prompt').oninput=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(preview,300);};
 root.querySelectorAll('[data-scope]').forEach(button=>button.onclick=async()=>{if(button.dataset.scope===(personal?'personal':'shared'))return;if(dirty()&&!confirm('切换范围会丢弃尚未保存的修改，继续吗？'))return;button.disabled=true;try{rerender(button.dataset.scope==='personal'?await api('/api/account/chatgpt/routing'):sharedState);}catch(error){if(current())toast(error.message);}finally{button.disabled=false;}});
 const inherit=root.querySelector('#routing-inherit');if(inherit)inherit.onclick=async()=>{if(inheriting){inheriting=false;form.hidden=false;inherit.textContent='恢复跟随团队';sync();void preview();return;}if(!confirm('清除本人的路由覆盖，重新跟随团队设置？团队设置不会改变。'))return;inherit.disabled=true;try{await api(endpoint+'/inherit',{});rerender(await api(endpoint));toast('已恢复跟随团队');}catch(error){if(current())toast(error.message);}finally{inherit.disabled=false;}};
 form.onsubmit=async event=>{event.preventDefault();capture();const button=root.querySelector('#save-routing'),error=root.querySelector('#routing-error');button.disabled=true;error.textContent='';try{const policy=draftPolicy(draft),result=await api(endpoint,policy);if(!current())return;if(personal)rerender(await api(endpoint));else updated(result);toast('路由已保存，下一次自动路由调用生效');}catch(cause){if(current()){error.textContent=cause.message;root.querySelector('#route-save-state').textContent='尚未保存，请检查设置';}}finally{button.disabled=false;}};
}
