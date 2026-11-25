import {providerHealth} from './provider-ui.js';
import {modelCapabilities,enhancementLabel} from './model-capability.js';
import {inferAgentProtocol} from './connect.js';

const PAGE_SIZE=40;
const modelList=models=>(models||[]).map(model=>typeof model==='string'?{id:model,name:model}:model).filter(model=>model&&typeof model.id==='string'&&model.id);
const category=model=>{const capability=modelCapabilities(model);return capability.chat?'chat':capability.mediaOnly?'media':'other';};
const categoryLabel=model=>{const capability=modelCapabilities(model);return capability.videoUnderstanding?'对话 · 视频理解':capability.enhancement?enhancementLabel(capability.enhancement)+' · 专用接口待适配':capability.vision?'视觉理解 · 非对话':capability.chat?'对话':capability.mediaOnly?'媒体 / 非对话':'其他 / 非对话';};

const protocolLabel=protocol=>({openai:'OpenAI Chat Completions',responses:'OpenAI Responses',anthropic:'Anthropic Messages'}[protocol]||'协议未知');
const capabilityLabels=model=>{
 const caps=modelCapabilities(model),labels=[];
 for(const [key,label] of [['chat','对话'],['videoUnderstanding','视频理解'],['image','图片生成'],['speech','语音合成'],['transcription','音频转写'],['video','视频生成'],['vision','视觉理解 · 非对话']])if(caps[key])labels.push(label);
 if(caps.enhancement)labels.push(enhancementLabel(caps.enhancement),'专用接口待适配');
 return labels.length?labels:['其他 / 非对话'];
};

// Prices are provider-specific references, not subscription fees or a live quote.
export function catalogPriceSummary(provider,model,now=Date.now()){
 const unknown={known:false,expired:false,lines:['价格未知'],source:'未配置',validity:'有效期未知',notice:'未知不代表免费'};
 if(provider.private)return {...unknown,lines:['个人订阅 · 不折算单 Token 价格'],source:'订阅权益',validity:'以订阅约定为准',notice:'不参与组织 API 费用估算'};
 const price=provider.prices?.[model];if(!price)return unknown;
 const valid=value=>Number.isFinite(value)&&value>=0;
 const rate=value=>valid(value)?String(Number(value.toPrecision(12))):'未知';
 const currency=typeof price.currency==='string'&&price.currency?price.currency:'币种未知';
 const unit=price.billingUnit||'tokens';
 const fields={tokens:['inputPerMillion','outputPerMillion'],image:['perImage'],video:['perVideo'],audio:['perThousandChars']}[unit];
 const lines=unit==='tokens'?[`${currency} / 百万 Tokens · 输入 ${rate(price.inputPerMillion)} / 输出 ${rate(price.outputPerMillion)}`]:fields?[`${currency} ${rate(price[fields[0]])} / ${{image:'张图片',video:'个视频',audio:'千字符'}[unit]}`]:['计价单位未知'];
 if(unit==='tokens'){
  if(price.cachedInputPerMillion!==undefined||price.cacheWritePerMillion!==undefined)lines.push(`缓存读 ${rate(price.cachedInputPerMillion)} / 写 ${rate(price.cacheWritePerMillion)} ${currency} / 百万 Tokens`);
  if(price.perRequest!==undefined)lines.push(`固定费用 ${rate(price.perRequest)} ${currency} / 请求`);
 }
 const reference=['openrouter','openrouter-reference'].includes(price.source);
 const source=({manual:'手动维护',openrouter:'OpenRouter 报价','openrouter-reference':'OpenRouter 参考价'}[price.source]||price.source||'来源未知')+(price.referenceModel?` · ${price.referenceModel}`:'');
 const deadline=price.expiresAt==null?null:Date.parse(price.expiresAt),expired=deadline!==null&&Number.isFinite(deadline)&&deadline<=now;
 const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN'):'未知时间';
 const validity=deadline===null?(reference?'未设复核期限 · 建议定期复核':'长期有效'):!Number.isFinite(deadline)?'期限无效 · 请复核':`${reference?(expired?'复核已逾期':'复核截至'):(expired?'已过期':'有效至')} ${date(price.expiresAt)}`;
 const notice=[reference?`采集于 ${date(price.observedAt)}；复核期限非上游承诺有效期；仅供参考，非合同价或实际账单`:'参考价格，非实际账单',price.periods?.length?`此处为基础价；另有 ${price.periods.length} 个分时时段（${price.timeZone||'Asia/Shanghai'}），请查看模型价格页`:null].filter(Boolean).join('。');
 return {known:Boolean(fields&&fields.every(key=>valid(price[key]))&&currency!=='币种未知'),expired,lines,source,validity,notice};
}

// Discovery is supplemental: a failed refresh must not erase configured models.
// Private subscription rows never receive a public API route ID.
export function catalogSnapshot(state,result=null){
 const providers=[...(state.providers||[]),...(state.personalProviders||[])];
 const discoveries=new Map((result?.providers||[]).map(provider=>[provider.providerId,provider]));
 const rows=[],errors=[];
 for(const configured of providers){
  const discovered=discoveries.get(configured.id),cache=state.catalog?.[configured.id];
  const currentCache=cache&&cache.baseUrl===configured.baseUrl&&cache.protocol===configured.protocol?cache:null;
  const registered=new Set(configured.models||[]);
  const known=new Map(modelList(discovered?.status==='ok'?discovered.models:currentCache?.models).map(model=>[model.id,model]));
  for(const id of registered)if(!known.has(id))known.set(id,{id,name:configured.modelNames?.[id]||id});
  const error=configured.private?configured.error:discovered?.status==='error'?discovered.error:null;
  if(error)errors.push({providerId:configured.id,name:configured.name,error});
  const authFailed=!configured.private&&providerHealth(configured,state.logs).label==='鉴权失败';
  for(const model of known.values())rows.push({
   providerId:configured.id,providerName:configured.name,id:model.id,name:configured.modelNames?.[model.id]||model.name||model.id,
   private:Boolean(configured.private),routeId:configured.private?null:configured.id+'::'+model.id,
   registered:registered.has(model.id),enabled:Boolean(configured.enabled&&(configured.private||configured.hasKey||configured.hasMeteredKey)),
   authFailed,kind:category(model.id),kindLabel:categoryLabel(model.id),capabilities:capabilityLabels(model.id),
   protocol:inferAgentProtocol(configured,model.id),protocolLabel:modelCapabilities(model.id).chat?protocolLabel(inferAgentProtocol(configured,model.id)):'媒体 / 专用接口（按能力）',
   price:catalogPriceSummary(configured,model.id)
  });
 }
 return {providers,rows,errors};
}

export function filterCatalog(rows,{search='',provider='',kind='',status=''}={}){
 const query=search.trim().toLocaleLowerCase();
 return rows.filter(row=>(!provider||row.providerId===provider)&&(!kind||row.kind===kind)&&(!status||(status==='registered'?row.registered:!row.registered))&&(!query||`${row.name} ${row.id} ${row.providerName} ${row.providerId}`.toLocaleLowerCase().includes(query)));
}

export function catalogPage(rows,page=1,pageSize=PAGE_SIZE){
 const pages=Math.max(1,Math.ceil(rows.length/pageSize));
 const current=Math.max(1,Math.min(pages,Number.isFinite(page)?Math.floor(page):1));
 const start=(current-1)*pageSize;
 return {rows:rows.slice(start,start+pageSize),page:current,pages,total:rows.length,start:rows.length?start+1:0,end:Math.min(start+pageSize,rows.length)};
}

export function renderModelCatalog({state,api,esc,toast,isManager,onSaved,embedded=false}){
 const root=document.querySelector('#content'),personalProviders=state.personalProviders||[];let result=null,page=1,busy=false;
 const shell=root;
 if(!embedded)shell.innerHTML='';
 shell.insertAdjacentHTML('beforeend',(embedded?'':`<div class="heading"><div><h1>模型目录</h1><p>查找模型，复制调用 ID，或将新模型加入组织配置。</p></div></div>`)+`<section class="catalog-workspace" aria-label="模型目录"><div class="catalog-toolbar"><input type="search" id="catalog-search" aria-label="搜索模型" placeholder="搜索模型或服务商"><select id="catalog-provider" aria-label="筛选服务商"><option value="">全部服务商</option>${[...state.providers,...personalProviders].map(p=>`<option value="${esc(p.id)}">${esc(p.name+(p.private?'（仅本人）':''))}</option>`).join('')}</select><select id="catalog-kind" aria-label="筛选模型能力"><option value="">全部类型</option><option value="chat">对话</option><option value="media">媒体</option><option value="other">其他</option></select><select id="catalog-registration" aria-label="筛选配置状态"><option value="">全部状态</option><option value="registered">已加入</option><option value="available">未加入</option></select>${isManager?'<button id="discover-all">刷新模型目录</button>':''}</div><p id="catalog-status" class="catalog-note" role="status">显示已配置模型与最近查询结果。刷新只获取模型列表，不发起生成；个人订阅仅供本人在实验室使用。</p><div id="catalog-errors" class="catalog-errors"></div><div id="catalog-list"></div></section>`);
 const list=shell.querySelector('#catalog-list'),workspace=list.closest('.catalog-workspace');
 let snapshot=catalogSnapshot({...state,personalProviders});
 const refreshSnapshot=()=>{snapshot=catalogSnapshot({...state,personalProviders},result);};
 const current=()=>list.isConnected&&shell.contains(workspace);
 function draw(){
  if(!current())return;
  const matching=filterCatalog(snapshot.rows,{search:workspace.querySelector('#catalog-search').value,provider:workspace.querySelector('#catalog-provider').value,kind:workspace.querySelector('#catalog-kind').value,status:workspace.querySelector('#catalog-registration').value});
  const visible=catalogPage(matching,page);page=visible.page;
  workspace.querySelector('#catalog-errors').innerHTML=snapshot.errors.map(item=>`<div class="catalog-error" role="alert">${esc(item.name)}：${esc(item.error)}。已保留现有模型。</div>`).join('');
  list.innerHTML=`<div class="catalog-summary" role="status"><span>匹配 <strong>${matching.length}</strong> / ${snapshot.rows.length} 个模型</span><span>已加入 ${matching.filter(row=>row.registered).length}</span><span>组织 API ${matching.filter(row=>!row.private).length} · 个人订阅 ${matching.filter(row=>row.private).length}</span><span>已记录价格 ${matching.filter(row=>row.price.known).length} · 过期 / 复核逾期 ${matching.filter(row=>row.price.expired).length}</span></div><p class="catalog-note">上游协议不等于客户端入口协议；能力标签按模型名称识别，不保证服务商已开放对应接口。未知价格不代表免费。</p><div class="catalog-table">${visible.rows.length?`<div class="table-wrap"><table><thead><tr><th scope="col">模型 / 调用 ID</th><th scope="col">服务商</th><th scope="col">能力 / 上游协议</th><th scope="col">参考价格</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>${visible.rows.map(model=>{
   const status=!model.registered?'未加入':!model.enabled?'未启用':model.authFailed?'鉴权失败':'已配置';
   const tone=model.authFailed?'danger':model.registered&&model.enabled?'green':'';
   const action=model.private?'<span class="muted">仅本人</span>':!model.registered&&isManager?`<button data-register-provider="${esc(model.providerId)}" data-register-model="${esc(model.id)}" ${busy?'disabled':''}>加入模型</button>`:model.registered?`<button data-copy-route="${esc(model.routeId)}" title="复制 ${esc(model.routeId)}">复制调用 ID</button>`:'<span class="muted">需管理员加入</span>';
   return `<tr><td><span class="catalog-model-name">${esc(model.name)}</span><code class="catalog-model-id">${esc(model.private?model.id:model.routeId)}</code></td><td><span class="catalog-provider-name">${esc(model.providerName)}</span><span class="catalog-scope">${model.private?'个人订阅 · 仅本人':'组织 API'}</span></td><td>${model.capabilities.map(label=>`<span class="tag">${esc(label)}</span>`).join(' ')}<small class="catalog-protocol">${esc(model.protocolLabel)}</small></td><td class="catalog-price${model.price.expired?' is-overdue':''}">${model.price.lines.map(line=>`<div>${esc(line)}</div>`).join('')}<small>${esc(model.price.source)}</small><small>${esc(model.price.validity)}</small><small>${esc(model.price.notice)}</small>${isManager&&!model.private?'<a href="#prices">查看价格详情</a>':''}</td><td><span class="catalog-state"><span class="health-dot ${tone}"></span>${status}</span></td><td>${action}</td></tr>`;
  }).join('')}</tbody></table></div>`:`<div class="catalog-empty"><strong>${snapshot.rows.length?'没有匹配的模型':'还没有模型'}</strong><p>${snapshot.rows.length?'调整筛选条件，或换个关键词。':isManager?'先添加服务商和密钥，然后刷新模型目录。':'请联系组织管理员配置服务商与模型。'}</p></div>`}<div class="catalog-pagination"><span role="status">${visible.total?`${visible.start}–${visible.end} / ${visible.total} 个模型`:'0 个模型'}</span><div><button data-catalog-page="${page-1}" ${page===1?'disabled':''}>上一页</button><span>${page} / ${visible.pages}</span><button data-catalog-page="${page+1}" ${page===visible.pages?'disabled':''}>下一页</button></div></div></div>`;
 }
 const filter=()=>{page=1;draw();};
 workspace.querySelector('#catalog-search').oninput=filter;
 for(const selector of ['#catalog-provider','#catalog-kind','#catalog-registration'])workspace.querySelector(selector).onchange=filter;
 workspace.querySelector('#discover-all')?.addEventListener('click',async event=>{
  if(busy)return;
  const button=event.currentTarget;busy=true;button.disabled=true;button.textContent='正在查询…';draw();
  workspace.querySelector('#catalog-status').textContent='正在查询服务商模型，最多等待 45 秒…';
  try{
   const discovered=await api('/api/models/discover',{});if(!current())return;result=discovered;refreshSnapshot();
   const refreshed=await api('/api/state');if(!current())return;state={...refreshed,personalProviders};refreshSnapshot();onSaved(state);
   workspace.querySelector('#catalog-status').textContent=`已获取 ${result.total} 个模型${result.errors?`，${result.errors} 个服务商查询失败`:''}。选择“加入模型”后才会进入组织调用列表。`;
  }catch(error){if(current()){workspace.querySelector('#catalog-status').textContent='刷新未完成，当前列表已保留。';toast(error.message);}}
  finally{busy=false;if(current()){button.disabled=false;button.textContent='刷新模型目录';draw();}}
 });
 list.onclick=async event=>{
  const copy=event.target.closest('[data-copy-route]');
  if(copy){try{await navigator.clipboard.writeText(copy.dataset.copyRoute);if(current())toast('调用 ID 已复制');}catch{if(current())toast('无法自动复制，请手动选择调用 ID');}return;}
  const pagination=event.target.closest('[data-catalog-page]');
  if(pagination&&!pagination.disabled){page=Number(pagination.dataset.catalogPage);draw();return;}
  const button=event.target.closest('[data-register-provider]');if(!button||button.disabled||busy)return;
  busy=true;button.disabled=true;const refresh=workspace.querySelector('#discover-all');if(refresh)refresh.disabled=true;
  try{
   const saved=await api('/api/models/register',{providerId:button.dataset.registerProvider,model:button.dataset.registerModel});if(!current())return;
   state={...saved,personalProviders};refreshSnapshot();onSaved(state);toast('模型已加入；可复制调用 ID 使用');
  }catch(error){if(current())toast(error.message);}
  finally{busy=false;if(current()){if(refresh)refresh.disabled=false;draw();}}
 };
 draw();
}
export {renderApiGuide} from './api-docs.js';
