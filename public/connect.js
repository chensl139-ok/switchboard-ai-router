// 接入向导：选工具 → Key → 模型 → 配置 → 只读校验。明文仅保留在当前页面内存。
import {modelCapabilities} from './model-capability.js';

const KEY_PLACEHOLDER='在此粘贴平台_API_Key';
const MODEL_PLACEHOLDER='provider::model';

// 与服务端 model-protocol.mjs 保持一致的轻量推断（浏览器无法直接引用根目录模块）。
export function inferAgentProtocol(provider,model){
 const configured=provider?.modelProtocols?.[model];
 if(['openai','responses','anthropic'].includes(configured))return configured;
 const id=String(model||'').toLowerCase().split('/').at(-1);
 if(/^claude(?:[-_.]|$)/.test(id))return 'anthropic';
 if(/^(?:moss-vl-1\.0|gpt-[56](?:[-.]|$)|o[134](?:[-.]|$)|codex(?:[-.]|$))/.test(id))return 'responses';
 return provider?.protocol||'openai';
}

// 客户端入口协议不等于上游协议。基础请求由网关转换，共用对话模型目录。
// 模型可选不代表第三方客户端的所有高级能力均已适配。
export function eligibleModels(state,tool){
 const providers=(state?.providers||[]).filter(p=>p.enabled&&(p.hasKey||p.hasMeteredKey));
 const rows=[];
 for(const p of providers)for(const model of [p.model,...(p.models||[])].filter(Boolean)){
  const value=`${p.id}::${model}`;
  if(rows.some(r=>r.value===value))continue;
  const protocol=inferAgentProtocol(p,model),caps=modelCapabilities(model);
  if(!caps.chat)continue;
  rows.push({value,label:`${p.name} · ${model}`,protocol});
 }
 return rows;
}

const shellDouble=value=>'"'+String(value).replace(/[\\"$`]/g,'\\$&')+'"';
const shellSingle=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
const tomlString=value=>JSON.stringify(String(value)).replace(/\x7f/g,'\\u007f');
const shellKey=(key,variable,prefix='',single=false)=>variable&&key==='$ROUTER_API_KEY'?`"${prefix}$ROUTER_API_KEY"`:(single?shellSingle:shellDouble)(prefix+key);

export function claudeCodeSnippets({origin,token,model,tokenVariable=false}){
 const key=token||KEY_PLACEHOLDER;
 const env=`# Claude Code CLI · macOS / Linux 终端
# ANTHROPIC_BASE_URL 填网关根地址，不加 /v1
export ANTHROPIC_BASE_URL=${shellDouble(origin)}
# 只填 Key 本身，不要带 Bearer 前缀
export ANTHROPIC_AUTH_TOKEN=${shellKey(key,tokenVariable)}
export ANTHROPIC_MODEL=${shellDouble(model)}
claude`;
 const settings=JSON.stringify({env:{ANTHROPIC_BASE_URL:origin,ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_MODEL:model}},null,2);
 const verify=`curl -N ${shellSingle(origin+'/v1/messages')} \\
  -H ${shellKey(key,tokenVariable,'x-api-key: ')} \\
  -H 'anthropic-version: 2023-06-01' \\
  -H 'Content-Type: application/json' \\
  -d ${shellSingle(JSON.stringify({model,max_tokens:64,messages:[{role:'user',content:'hi'}],stream:true}))}`;
 return {env,settings,verify};
}

export function codexSnippets({origin,token,model,tokenVariable=false}){
 const key=token||KEY_PLACEHOLDER;
 const config=`# ~/.codex/config.toml（当前用户配置）
model_provider = "switchboard"
model = ${tomlString(model)}

[model_providers.switchboard]
name = "Switchboard"
base_url = ${tomlString(origin+'/v1')}
env_key = "SWITCHBOARD_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`;
 const env=`# 设置后运行 codex
export SWITCHBOARD_API_KEY=${shellKey(key,tokenVariable)}`;
 const verify=`curl -N ${shellSingle(origin+'/v1/responses')} \\
  -H ${shellKey(key,tokenVariable,'Authorization: Bearer ')} \\
  -H 'Content-Type: application/json' \\
  -d ${shellSingle(JSON.stringify({model,input:'hi',max_output_tokens:64,stream:true,store:false}))}`;
 return {config,env,verify};
}

export function genericSnippets({origin,token,model,tokenVariable=false}){
 const key=token||KEY_PLACEHOLDER;
 const client=`OpenAI 兼容客户端（Cherry Studio / NextChat / LobeChat 等）
Base URL： ${origin}/v1
API Key：  ${key}
模型：     ${model}   # auto 跟随网关路由策略；provider::model 固定服务商与模型`;
 const curl=`curl -sS ${shellSingle(origin+'/v1/chat/completions')} \\
  -H ${shellKey(key,tokenVariable,'Authorization: Bearer ',true)} \\
  -H 'Content-Type: application/json' \\
  -d ${shellSingle(JSON.stringify({model,messages:[{role:'user',content:'你好'}],max_tokens:128}))}`;
 return {client,curl};
}

const TOOL_LABELS={claude:'Claude Code',codex:'Codex CLI',generic:'通用客户端'};
const TOOL_NOTES={
 claude:'Claude Code 向网关发送 Messages，网关按目标模型适配上游协议；auto 跟随组织策略。Anthropic 官方不支持将 Claude Code 路由至非 Claude 模型，选择其他模型仅代表基础请求可转换，不代表官方支持或完整兼容。原生 Token 计数仍要求 Anthropic 上游。配置请合并到用户级 ~/.claude/settings.json，勿提交到 Git；启动后用 /status 核对。',
 codex:'Codex 向网关发送 Responses，网关适配上游协议；auto 跟随组织策略，无需限定上游为 Responses。当前仅支持无状态 Responses 子集；思考参数、推理历史、内置与自定义工具、服务端会话续接等高级能力未完整适配，不支持的参数会明确报错。请先验证简单对话和函数工具，不代表完整 Codex 兼容。',
 generic:'任何 OpenAI 兼容客户端都可接入。auto 跟随当前租户路由策略（可能跨服务商回退）；provider::model 表示固定。模型列表查询不占用生成配额。',
};
const NO_MODEL_HINT={
 claude:'当前租户没有已启用且已配密钥的对话模型。请先在「服务商与模型」完成配置，无需按客户端手动选择上游协议。',
 codex:'当前租户没有已启用且已配密钥的对话模型。请先在「服务商与模型」完成配置，无需按客户端手动选择上游协议。',
 generic:'当前租户没有已启用且已配密钥的服务商。请先在「服务商与模型」完成配置。',
};

export function connectKeyPolicy({name,expiresAt='',dailyLimit=''},now=Date.now()){
 const policy={name:String(name||'').trim(),enabled:true};
 if(!policy.name||policy.name.length>80)throw new Error('请输入 1–80 字的 Key 名称');
 if(expiresAt){
  const time=Date.parse(expiresAt);
  if(!Number.isFinite(time)||time<=now)throw new Error('有效期必须晚于当前时间');
  policy.expiresAt=new Date(time).toISOString();
 }
 if(dailyLimit!==''){
  const limit=Number(dailyLimit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000000000)throw new Error('日限额须为 1–1000000000 的整数，留空不限');
  policy.dailyLimit=limit;
 }
 return policy;
}

export function createConnectVerifier({origin,tenantId,fetcher=globalThis.fetch,isCurrent=()=>true,onState=()=>{},timeoutMs=10000}){
 let generation=0,active=null,disposed=false;
 const publish=(id,state)=>{if(!disposed&&id===generation&&isCurrent())onState(state);};
 const invalidate=()=>{generation++;active?.abort();active=null;publish(generation,{status:'idle',message:'尚未校验；修改工具、Key 或模型后需重新校验。'});};
 return {
  invalidate,
  dispose(){disposed=true;invalidate();},
  async verify({token,model}){
   invalidate();
   const id=generation;
   if(disposed||!isCurrent())return;
   if(!token||token.length>300||token.trim()!==token||/[\r\n\0]/.test(token)||/^Bearer\s/i.test(token)){
    publish(id,{status:'error',message:'请填入完整原始业务 Key，不要带 Bearer 前缀、空白或换行。'});return;
   }
   if(!tenantId||!model){publish(id,{status:'error',message:!tenantId?'未获取当前组织，请刷新页面后重试。':'请先配置并选择一个对话模型。'});return;}
   const requestId=globalThis.crypto?.randomUUID?.()||`connect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
   const controller=new AbortController();active=controller;
   let timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
   publish(id,{status:'checking',message:'正在用此 Key 读取当前组织的模型目录…',requestId});
   try{
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
    const work=(async()=>{
     const response=await fetcher(origin+'/v1/models',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${token}`,'X-Tenant-ID':String(tenantId),'X-Request-ID':requestId},signal:controller.signal});
     return {ok:response.ok,status:response.status,data:response.ok?await response.json():null};
    })();
    const result=await Promise.race([work,aborted]);
    if(!result.ok){
     const message=result.status===401?'Key 鉴权失败，请检查完整 Key 是否正确。':result.status===403?'Key 当前不可用，请检查启用状态、有效期和组织权限。':result.status===429?'请求过于频繁，请稍后重试。':result.status>=500?'网关暂时不可用，请稍后重试。':'无法读取模型目录，请检查当前组织和网关地址后重试。';
     publish(id,{status:'error',message,requestId});return;
    }
    const rows=result.data?.data;
    if(!Array.isArray(rows)){publish(id,{status:'error',message:'网关返回的模型目录格式无效，请稍后重试。',requestId});return;}
    const found=model==='auto'?rows.some(row=>typeof row?.id==='string'&&row.id!=='auto'&&row.callable!==false&&modelCapabilities(row.upstream_model||row.id.split('::').at(-1)).chat):rows.some(row=>row?.id===model);
    publish(id,{status:found?'success':'error',message:found?'Key 鉴权通过，所选模型目录校验通过。':model==='auto'?'Key 鉴权通过，但目录中没有可用于 auto 的对话候选。':'Key 鉴权通过，但所选固定模型不在返回目录中，请重新选择。',requestId});
   }catch{
    publish(id,{status:'error',message:timedOut?'校验超时，请重试；未发送推理请求。':'无法连接网关或读取目录，请检查网络后重试。',requestId});
   }finally{clearTimeout(timer);if(active===controller)active=null;}
  }
 };
}

let connectRenderGeneration=0;
export async function renderConnect({api,esc,toast,tenantId,isCurrent:routeIsCurrent=()=>true}){
 const renderGeneration=++connectRenderGeneration;
 let activePage=true;
 const isCurrent=()=>activePage&&renderGeneration===connectRenderGeneration&&routeIsCurrent();
 if(!isCurrent())return;
 const root=document.querySelector('#content');
 if(!root)return;
 const origin=location.origin;
 let keys=[],keysBlocked=false;
 try{const data=await api('/api/keys');keys=(data.keys||[]).filter(k=>k.status==='active'&&k.enabled);}catch{keysBlocked=true;}
 const state=await api('/api/state').catch(()=>null);
 if(!isCurrent())return;

 let tool='claude',keyToken='',keyName='',keySource='',reveal=false,creating=false,copied=false,revision=0;
 let verification={status:'idle',message:'尚未校验；修改工具、Key 或模型后需重新校验。'};
 const picked={claude:'',codex:'',generic:''};
 const draft={name:'agent-claude-local',expiresAt:'',dailyLimit:''};
 const options=()=>eligibleModels(state,tool);
 const currentModel=()=>{
  const pool=[...(options().length?['auto']:[]),...options().map(o=>o.value)];
  if(!picked[tool]||!pool.includes(picked[tool]))picked[tool]=pool[0]||'';
  return picked[tool];
 };
 const verifier=createConnectVerifier({origin,tenantId,isCurrent,onState:value=>{verification=value;updateStatus();}});
 const changed=()=>{revision++;copied=false;reveal=false;verifier.invalidate();};
 const snippet=(title,id,code)=>`<div class="api-snippet-head"><span>${esc(title)}</span><button type="button" data-connect-copy="${id}">复制</button></div><pre id="${id}" class="connect-snippet">${esc(code)}</pre>`;
 const snippets=token=>{
  const args={origin,token,model:currentModel()||MODEL_PLACEHOLDER};
  if(tool==='claude'){const s=claudeCodeSnippets(args);return {'connect-claude-env':s.env,'connect-claude-settings':s.settings,'connect-verify':s.verify};}
  if(tool==='codex'){const s=codexSnippets(args);return {'connect-codex-config':s.config,'connect-codex-env':s.env,'connect-verify':s.verify};}
  const s=genericSnippets(args);return {'connect-generic-client':s.client,'connect-verify':s.curl};
 };
 async function copy(text,config=false){
  const version=revision;
  try{
   await navigator.clipboard.writeText(text);
   if(!isCurrent()||version!==revision)return;
   if(config){copied=true;updateStatus();}
   toast(keyToken?'已复制；完整 Key 已包含在剪贴板中，请妥善保存':'模板已复制，请替换 Key 和模型占位符');
  }catch{if(isCurrent())toast('剪贴板不可用；可显示配置后手动复制，请注意屏幕共享');}
 }
 function updateStatus(){
  if(!isCurrent())return;
  const status=root.querySelector('#connect-status');
  if(status){status.dataset.status=verification.status;status.textContent=verification.message+(verification.requestId?` 请求 ID：${verification.requestId}`:'');}
  const button=root.querySelector('#connect-check');
  if(button){button.disabled=verification.status==='checking'||!keyToken||!currentModel();button.textContent=verification.status==='checking'?'正在只读校验…':verification.status==='idle'?'只读校验 Key 与模型目录':'重新只读校验';}
  const progress=root.querySelector('#connect-progress');
  if(progress){
   const states=['已选择',keyToken?'已填入':'可用模板',currentModel()?'已选择':'待配置',copied?'已复制':'待复制',verification.status==='success'?'已通过':verification.status==='checking'?'校验中':'待校验'];
   progress.innerHTML=states.map((text,i)=>`<li><button type="button" data-connect-step="${i+1}"><span class="connect-step-number">${i+1}</span> ${['工具','Key','模型','配置','只读校验'][i]} <small>${text}</small></button></li>`).join('');
   progress.querySelectorAll('[data-connect-step]').forEach(b=>b.onclick=()=>{const step=root.querySelector('#connect-step-'+b.dataset.connectStep);step?.scrollIntoView({behavior:'smooth',block:'start'});step?.focus({preventScroll:true});});
  }
 }
 function updateKey(){
  const banner=root.querySelector('#connect-key-banner');
  if(banner)banner.textContent=keySource==='created'?`新 Key「${keyName}」的完整明文仅在本页展示这一次；刷新、清除或离开后无法找回。请立即复制密钥或配置并安全保存。`:keyToken?'已填入现有 Key，仅保存在当前页面内存，未写入浏览器存储。':'未填入 Key 也能复制配置模板；只读校验需要完整 Key。';
  for(const id of ['connect-clear-key','connect-copy-key','connect-reveal']){const button=root.querySelector('#'+id);if(button)button.disabled=!keyToken||creating;}
 }
 function updateConfig(){
  if(!isCurrent())return;
  const s=snippets(keyToken&&!reveal?'已隐藏_复制时包含完整Key':keyToken);
  const primary=tool==='claude'?'connect-claude-env':tool==='codex'?'connect-codex-config':'connect-generic-client';
  root.querySelector('#connect-config').innerHTML=(tool==='claude'?snippet('终端环境变量（当前窗口生效）','connect-claude-env',s['connect-claude-env'])+snippet('持久化 · ~/.claude/settings.json（合并进 env，勿覆盖其他配置）','connect-claude-settings',s['connect-claude-settings']):tool==='codex'?snippet('用户级 ~/.codex/config.toml','connect-codex-config',s['connect-codex-config'])+snippet('终端环境变量（还需复制此项）','connect-codex-env',s['connect-codex-env']):snippet('客户端填写内容','connect-generic-client',s['connect-generic-client']))+`<details><summary>可选：手动推理示例（会消耗配额，不属于只读校验）</summary>${snippet('仅复制，不自动执行','connect-verify',s['connect-verify'])}</details>`;
  root.querySelectorAll('[data-connect-copy]').forEach(b=>b.onclick=()=>copy(snippets(keyToken)[b.dataset.connectCopy],b.dataset.connectCopy!=='connect-verify'));
  root.querySelector('#connect-copy-config').onclick=()=>copy(snippets(keyToken)[primary],true);
  root.querySelector('#connect-reveal').textContent=reveal?'隐藏配置明文':'显示配置明文';
  root.querySelector('#connect-copy-hint').textContent=keyToken?(reveal?'当前显示完整 Key，请勿截屏或共享屏幕。':'预览已隐藏 Key，复制按钮仍会复制完整 Key。'):'当前为无 Key 模板，复制后请替换占位符。';
  updateKey();updateStatus();
 }
 function render(){
  if(!isCurrent())return;
  const model=currentModel(),opts=options();
  root.innerHTML=`<div class="heading"><div><div class="eyebrow">CONNECT YOUR TOOLS</div><h1>接入向导</h1><p>选择工具 → 准备 Key → 选择模型 → 复制配置 → 只读校验。五步可自由调整，无需按顺序解锁。</p></div><a href="#keys">管理我的 API Key</a></div>
  <div class="connect-layout">
   <nav aria-label="接入进度"><ol id="connect-progress" class="connect-progress"></ol></nav>
   <section id="connect-step-1" class="panel connect-step" tabindex="-1" aria-labelledby="connect-title-1"><h2 id="connect-title-1"><span class="connect-step-number">01</span> 选择你的工具</h2><p class="muted">按客户端生成配置，不限制上游协议。</p>
    <div class="connect-tools">${Object.entries(TOOL_LABELS).map(([id,label])=>`<button type="button" data-connect-tool="${id}" aria-pressed="${tool===id}" class="connect-tool ${tool===id?'selected':''}"><strong>${esc(label)}</strong><span>${{claude:'Messages · 终端与 JSON 配置',codex:'Responses · TOML 与环境变量',generic:'OpenAI 兼容 · 应用与 SDK'}[id]}</span></button>`).join('')}</div>
   </section>
   <section id="connect-step-2" class="panel connect-step" tabindex="-1" aria-labelledby="connect-title-2"><h2 id="connect-title-2"><span class="connect-step-number">02</span> 准备业务 API Key</h2>
    <label>粘贴现有完整 Key<input id="connect-token" type="password" maxlength="300" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="只填 Key 本身，不带 Bearer 前缀" aria-describedby="connect-key-banner" ${creating?'disabled':''}></label>
    <div class="card-actions"><button type="button" id="connect-clear-key">清除并使用模板</button><button type="button" id="connect-copy-key">复制完整 Key</button></div>
    <p id="connect-key-banner" class="info connect-key-banner" role="status"></p>
    ${keysBlocked?'<div class="info">当前无法读取或创建 Key。仍可粘贴已有业务 Key，或复制模板；无权限时请联系管理员。</div>':`
    <details><summary>新建专用 Key${keys.length?' · 已有 '+keys.length+' 把生效中的 Key':''}</summary>
     <p class="connect-key-info muted">${keys.length?`现有生效中的 Key：${keys.map(k=>`${esc(k.name)}（${esc(k.preview)}）`).join('、')}。已有 Key 的明文无法再次查看。`:'还没有生效中的业务 Key，可新建一把专用 Key。'}个人密钥仅本人可见，其他成员与管理员不可见。</p>
     <form id="connect-new-key" class="connect-new-key"><label>Key 名称<input name="name" required maxlength="80" autocomplete="off"></label><div class="form-grid"><label>有效期至（可选，本地时间）<input name="expiresAt" type="datetime-local"></label><label>日调用限额（可选）<input name="dailyLimit" type="number" min="1" max="1000000000" step="1" placeholder="留空不限"></label></div><p class="muted">默认立即生效、不过期、不限制调用次数。每日配额按 UTC 零点（北京时间 08:00）重置；更多限制可在 <a href="#keys">API Key 管理</a> 调整。</p><p id="connect-create-error" role="alert"></p><button class="primary" ${creating?'disabled':''}>${creating?'正在创建…':'创建并填入配置'}</button></form>
    </details>`}
    <p class="muted">不创建也可以：模板中的 <code>${KEY_PLACEHOLDER}</code> 是占位符。仅使用业务 Key，不要粘贴服务商上游密钥。</p>
   </section>
   <section id="connect-step-3" class="panel connect-step" tabindex="-1" aria-labelledby="connect-title-3"><h2 id="connect-title-3"><span class="connect-step-number">03</span> 选择目标模型</h2>
    ${opts.length?`<label class="connect-model-field">模型 <select id="connect-model">${[{value:'auto',label:'自动路由 · auto（推荐）'},...opts].map(o=>`<option value="${esc(o.value)}" ${o.value===model?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`:`<div class="info">${NO_MODEL_HINT[tool]} <a href="#providers">配置服务商与模型</a></div>`}
    <p class="muted">所有客户端共用全部对话模型目录：auto 跟随组织策略；provider::model 固定模型。网关自动转换协议，客户端无需选择上游协议。个人订阅不通过业务 API Key 对外调用。</p>
   </section>
   <section id="connect-step-4" class="panel connect-step" tabindex="-1" aria-labelledby="connect-title-4"><h2 id="connect-title-4"><span class="connect-step-number">04</span> 复制客户端配置</h2>
    <div class="card-actions"><button type="button" id="connect-copy-config" class="primary">复制${tool==='codex'?' TOML 配置':tool==='claude'?'终端配置':'客户端配置'}</button><button type="button" id="connect-reveal">显示配置明文</button></div><p id="connect-copy-hint" class="muted"></p><div id="connect-config"></div>
    <div class="info">${TOOL_NOTES[tool]}<br>完整 Key 写入配置文件后请勿提交到 Git。对外设备请将 <code>${esc(origin)}</code> 换成可访问的 HTTPS 地址；本机 127.0.0.1 只能本机访问。Key 泄露时在「API Key 管理」停用或删除。更多协议与参数见 <a href="#api">API 文档</a>。</div>
   </section>
   <section id="connect-step-5" class="panel connect-step" tabindex="-1" aria-labelledby="connect-title-5"><h2 id="connect-title-5"><span class="connect-step-number">05</span> 只读校验</h2><p>使用当前完整 Key 查询 <code>GET /v1/models</code>，不携带登录 Cookie，不发起付费调用。</p><button type="button" id="connect-check" class="primary">只读校验 Key 与模型目录</button><p id="connect-status" class="connect-status info" role="status" aria-live="polite"></p><p class="muted">仅确认此 Key 的鉴权与模型目录；不证明剩余额度、上游健康或推理可用，也不代表客户端高级功能完整兼容。手动推理示例需要另行执行并消耗配额。</p></section>
  </div>`;
  const tokenInput=root.querySelector('#connect-token');tokenInput.value=keyToken;
  tokenInput.oninput=()=>{keyToken=tokenInput.value;keySource=keyToken?'existing':'';keyName='';changed();updateConfig();};
  root.querySelector('#connect-clear-key').onclick=()=>{keyToken='';keyName='';keySource='';tokenInput.value='';changed();updateConfig();tokenInput.focus();};
  root.querySelector('#connect-copy-key').onclick=()=>copy(keyToken);
  root.querySelector('#connect-reveal').onclick=()=>{reveal=!reveal;updateConfig();};
  const select=root.querySelector('#connect-model');
  if(select)select.onchange=()=>{picked[tool]=select.value;changed();updateConfig();};
  root.querySelectorAll('[data-connect-tool]').forEach(b=>b.onclick=()=>{if(tool===b.dataset.connectTool)return;tool=b.dataset.connectTool;changed();render();});
  root.querySelector('#connect-check').onclick=()=>verifier.verify({token:keyToken,model:currentModel()});
  const form=root.querySelector('#connect-new-key');
  if(form){
   for(const field of Object.keys(draft)){form.elements[field].value=draft[field];form.elements[field].oninput=()=>{draft[field]=form.elements[field].value;};}
   form.onsubmit=async e=>{
    e.preventDefault();if(creating)return;
    let policy;
    try{policy=connectKeyPolicy(Object.fromEntries(Object.keys(draft).map(field=>[field,form.elements[field].value])));}catch(error){root.querySelector('#connect-create-error').textContent=error.message;return;}
    creating=true;form.querySelector('button').disabled=true;tokenInput.disabled=true;updateKey();
    root.querySelector('#connect-create-error').textContent='';
    try{
     const result=await api('/api/keys',policy);
     if(!isCurrent())return;
     if(typeof result.token!=='string'||!result.token)throw new Error('missing token');
     keyToken=result.token;keyName=result.key?.name||policy.name;keySource='created';
     if(result.key)keys=[result.key,...keys];
     changed();creating=false;render();toast('Key 已创建，完整明文只在本页展示这一次，请立即保存');
    }catch{if(isCurrent()){const error=root.querySelector('#connect-create-error');if(error)error.textContent='创建失败，请检查权限或输入；若请求已送达，请先到 API Key 管理确认是否已创建，避免重复创建。';}}
    finally{creating=false;if(isCurrent()){const button=root.querySelector('#connect-new-key button');if(button){button.disabled=false;button.textContent='创建并填入配置';}root.querySelector('#connect-token').disabled=false;updateKey();}}
   };
  }
  updateConfig();
 }
 render();
 return ()=>{activePage=false;verifier.dispose();keyToken='';};
}
