import {runExperiment} from './lab-request.js';

let selected=[],lastRun=null;
export function renderModelCompare({root,choices,token,tenantId,esc,onSwitch}){
 const choiceMap=new Map(choices.map(choice=>[choice.id,choice]));
 selected=selected.filter(id=>choiceMap.has(id));
 if(!selected.length)selected=choices.slice(0,Math.min(2,choices.length)).map(choice=>choice.id);
 let controller=null;
 const cards=()=>selected.map((id,index)=>`<article class="panel compare-card"><label>模型 ${index+1}<select data-compare-model="${index}">${choices.map(choice=>`<option value="${esc(choice.id)}" ${choice.id===id?'selected':''}>${esc(choice.label)}</option>`).join('')}</select></label><p class="muted">${esc(choiceMap.get(id)?.protocol||'')} · ${esc(choiceMap.get(id)?.channel||'subscription')}</p><div class="compare-result" data-compare-result="${index}"><p class="muted">等待测试</p></div></article>`).join('');
 root.innerHTML=`<div class="heading lab-heading"><div><div class="eyebrow">MODEL PLAYGROUND</div><h1>模型实验室</h1><p>同一问题独立发送给多个模型，比较输出、耗时与用量。</p></div><button id="compare-chat" class="subtle">单模型对话</button></div><div class="panel compare-controls"><label>测试问题<textarea id="compare-prompt" rows="4" maxlength="10000" placeholder="输入一个需要比较的问题"></textarea></label><div class="compare-actions"><label>最大输出 Tokens<input id="compare-tokens" type="number" min="1" max="131072" value="1024"></label><button id="compare-add" type="button">＋ 添加模型</button><button id="compare-remove" type="button">－ 移除模型</button><button id="compare-run" class="primary" type="button">开始对比</button><button id="compare-stop" type="button" hidden>停止</button><button id="compare-export" type="button" disabled>导出结果</button></div><p id="compare-error" class="lab-error" role="alert"></p><p class="muted">每个模型单独计费；最多比较 4 个模型，每次最多并发 2 个请求。问题与结果仅保留在当前页面内存中。</p></div><div id="compare-grid" class="compare-grid">${cards()}</div>`;
 const $=selector=>root.querySelector(selector);
 const setBusy=busy=>{for(const id of ['compare-run','compare-add','compare-remove','compare-prompt','compare-tokens'])$('#'+id).disabled=busy;root.querySelectorAll('[data-compare-model]').forEach(el=>el.disabled=busy);$('#compare-stop').hidden=!busy;};
 const redraw=()=>{$('#compare-grid').innerHTML=cards();root.querySelectorAll('[data-compare-model]').forEach(el=>el.onchange=()=>{selected[Number(el.dataset.compareModel)]=el.value;lastRun=null;$('#compare-export').disabled=true;redraw();});};
 $('#compare-chat').onclick=()=>{controller?.abort();onSwitch();};
 $('#compare-add').onclick=()=>{if(selected.length<Math.min(4,choices.length)){const next=choices.find(choice=>!selected.includes(choice.id));if(next){selected.push(next.id);lastRun=null;$('#compare-export').disabled=true;redraw();}}};
 $('#compare-remove').onclick=()=>{if(selected.length>2){selected.pop();lastRun=null;$('#compare-export').disabled=true;redraw();}};
 $('#compare-stop').onclick=()=>controller?.abort();
 $('#compare-export').onclick=()=>{if(!lastRun)return;const blob=new Blob([JSON.stringify(lastRun,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='model-comparison-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('#compare-run').onclick=async()=>{
  if(controller)return;
  const prompt=$('#compare-prompt').value.trim(),maxTokens=Number($('#compare-tokens').value);
  if(selected.length<2||new Set(selected).size!==selected.length){$('#compare-error').textContent='请选择至少两个不同的模型';return;}
  if(!prompt||prompt.length>10000){$('#compare-error').textContent='请输入 1–10000 个字符的问题';return;}
  if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>131072){$('#compare-error').textContent='最大输出 Tokens 需为 1–131072';return;}
  $('#compare-error').textContent='';lastRun=null;$('#compare-export').disabled=true;
  const request=new AbortController();controller=request;setBusy(true);
  const items=selected.map(id=>({choice:choiceMap.get(id),status:'等待中'}));
  const show=(index)=>{const target=$(`[data-compare-result="${index}"]`),item=items[index];if(!target)return;if(item.status!=='完成')target.innerHTML=`<p class="muted">${esc(item.status)}${item.error?'：'+esc(item.error):''}</p>`;else target.innerHTML=`<div class="compare-metrics"><span>耗时 ${item.result.elapsedMs} ms</span><span>输入 ${item.result.usage.input??'未知'} tokens</span><span>输出 ${item.result.usage.output??'未知'} tokens</span></div>${item.result.reasoning?`<details><summary>思考内容</summary><pre>${esc(item.result.reasoning)}</pre></details>`:''}<pre class="compare-output">${esc(item.result.content||'(无文字输出)')}</pre>${item.result.toolCalls.length?`<p class="muted">返回 ${item.result.toolCalls.length} 个工具调用</p>`:''}`;};
  items.forEach((_,index)=>show(index));let next=0;
  async function worker(){while(next<items.length&&!request.signal.aborted){const index=next++,item=items[index];item.status='运行中';show(index);try{item.result=await runExperiment(item.choice,prompt,maxTokens,{token,tenantId,signal:request.signal});item.status='完成';}catch(error){item.status=request.signal.aborted?'已停止':'失败';item.error=error.message;}show(index);}}
  try{await Promise.all([worker(),worker()]);if(request.signal.aborted)for(const item of items)if(item.status==='等待中')item.status='已停止';items.forEach((_,index)=>show(index));lastRun={createdAt:new Date().toISOString(),prompt,maxTokens,results:items.map(item=>({providerId:item.choice.providerId,model:item.choice.model,protocol:item.choice.protocol,channel:item.choice.channel,status:item.status,...(item.result?{result:item.result}:{}),...(item.error?{error:item.error}:{})}))};$('#compare-export').disabled=false;}
  finally{if(controller===request)controller=null;if(root.isConnected)setBusy(false);}
 };
}
