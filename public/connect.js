// 接入向导：把 Claude Code / Codex / 通用 OpenAI 兼容客户端接进本网关。
// 选业务 Key → 选模型 → 复制配置。新建 Key 的明文仅在本页停留一次，不落盘、不进日志。
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

// 每个工具允许选择的模型集合：Claude Code 只接 Anthropic 原生协议模型；Codex 只接 Responses 模型；通用客户端用 chat 能力模型并额外提供 auto。
export function eligibleModels(state,tool){
 const providers=(state?.providers||[]).filter(p=>p.enabled&&(p.hasKey||p.hasMeteredKey));
 const rows=[];
 for(const p of providers)for(const model of [p.model,...(p.models||[])].filter(Boolean)){
  const value=`${p.id}::${model}`;
  if(rows.some(r=>r.value===value))continue;
  const protocol=inferAgentProtocol(p,model),caps=modelCapabilities(model);
  if(tool==='claude'&&protocol!=='anthropic')continue;
  if(tool==='codex'&&protocol!=='responses')continue;
  if(tool==='generic'&&!caps.chat)continue;
  rows.push({value,label:`${p.name} · ${model}`,protocol});
 }
 return rows;
}

export function claudeCodeSnippets({origin,token,model}){
 const key=token||KEY_PLACEHOLDER;
 const env=`# Claude Code CLI · macOS / Linux 终端
# ANTHROPIC_BASE_URL 填网关根地址，不加 /v1
export ANTHROPIC_BASE_URL="${origin}"
# 只填 Key 本身，不要带 Bearer 前缀
export ANTHROPIC_AUTH_TOKEN="${key}"
export ANTHROPIC_MODEL="${model}"
claude`;
 const settings=JSON.stringify({env:{ANTHROPIC_BASE_URL:origin,ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_MODEL:model}},null,2);
 const verify=`curl -N '${origin}/v1/messages' \\
  -H 'x-api-key: ${key}' \\
  -H 'anthropic-version: 2023-06-01' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"${model}","max_tokens":64,"messages":[{"role":"user","content":"hi"}],"stream":true}'`;
 return {env,settings,verify};
}

export function codexSnippets({origin,token,model}){
 const key=token||KEY_PLACEHOLDER;
 const config=`# ~/.codex/config.toml（当前用户配置）
model_provider = "switchboard"
model = "${model}"

[model_providers.switchboard]
name = "Switchboard"
base_url = "${origin}/v1"
env_key = "SWITCHBOARD_API_KEY"
wire_api = "responses"`;
 const env=`# 设置后运行 codex
export SWITCHBOARD_API_KEY="${key}"`;
 const verify=`curl -N '${origin}/v1/responses' \\
  -H 'Authorization: Bearer ${key}' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"${model}","input":"hi","max_output_tokens":64,"stream":true,"store":false}'`;
 return {config,env,verify};
}

export function genericSnippets({origin,token,model}){
 const key=token||KEY_PLACEHOLDER;
 const client=`OpenAI 兼容客户端（Cherry Studio / NextChat / LobeChat 等）
Base URL： ${origin}/v1
API Key：  ${key}
模型：     ${model}   # auto 跟随网关路由策略；provider::model 固定服务商与模型`;
 const curl=`curl -sS '${origin}/v1/chat/completions' \\
  -H 'Authorization: Bearer ${key}' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"你好"}],"max_tokens":128}'`;
 return {client,curl};
}

const TOOL_LABELS={claude:'Claude Code',codex:'Codex CLI',generic:'通用客户端'};
const TOOL_NOTES={
 claude:'Claude Code 只应路由到原生 Anthropic Messages 协议的 Claude 模型，列表已按此过滤；工程内复杂工具调用与扩展能力以实际验证为准。完整 Key 写入用户级 ~/.claude/settings.json 后是明文保存，切勿提交到 Git；建议不要写入项目级 .claude/settings.json。启动后用 /status 核对网关地址与认证来源。',
 codex:'Codex 通过本平台的无状态 Responses 子集接入，列表只保留 Responses 能力模型，不要使用 auto。会话续接、内置工具等高级能力可能不兼容，先用简单对话验证。更多字段见 Codex 官方配置说明。',
 generic:'任何 OpenAI 兼容客户端都可接入。auto 跟随当前租户路由策略（可能跨服务商回退）；provider::model 表示固定。模型列表查询不占用生成配额。',
};
const NO_MODEL_HINT={
 claude:'当前租户没有 Anthropic 原生协议的已启用模型。请在「服务商与模型」配置支持 Messages 协议的上游并启用 Claude 模型后重试。',
 codex:'当前租户没有 Responses 能力的已启用模型（如 GPT-5 / o 系列 / codex 模型）。请在「服务商与模型」配置并启用后重试。',
 generic:'当前租户没有已启用且已配密钥的服务商。请先在「服务商与模型」完成配置。',
};

export async function renderConnect({api,esc,toast,isCurrent=()=>true}){
 if(!isCurrent())return;
 const root=document.querySelector('#content');
 if(!root)return;
 const origin=location.origin;
 let keys=[],keysBlocked=false;
 try{const data=await api('/api/keys');keys=(data.keys||[]).filter(k=>k.status==='active'&&k.enabled);}catch{keysBlocked=true;}
 const state=await api('/api/state').catch(()=>null);
 if(!isCurrent())return;

 let tool='claude',keyToken='',keyName='';
 const picked={claude:'',codex:'',generic:''};

 const options=()=>eligibleModels(state,tool);
 const currentModel=()=>{
  const pool=[...options().map(o=>o.value),...(tool==='generic'?['auto']:[])];
  if(!picked[tool]||!pool.includes(picked[tool]))picked[tool]=tool==='generic'&&pool.includes('auto')?'auto':options()[0]?.value||'';
  return picked[tool];
 };
 const snippet=(title,id,code)=>`<div class="api-snippet-head"><span>${esc(title)}</span><button type="button" data-connect-copy="${id}">复制</button></div><pre id="${id}" class="connect-snippet">${esc(code)}</pre>`;

 function render(){
  if(!isCurrent())return;
  const model=currentModel(),token=keyToken;
  const s=tool==='claude'?claudeCodeSnippets({origin,token,model:model||MODEL_PLACEHOLDER}):tool==='codex'?codexSnippets({origin,token,model:model||MODEL_PLACEHOLDER}):genericSnippets({origin,token,model:model||'auto'});
  const opts=options();
  const modelField=opts.length?`<label class="connect-model-field">模型 <select id="connect-model">${[...(tool==='generic'?[{value:'auto',label:'自动路由 · auto'}]:[]),...opts].map(o=>`<option value="${esc(o.value)}" ${o.value===model?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label><p class="muted">${tool==='claude'?'将写入 ANTHROPIC_MODEL，格式为 provider::model。':tool==='codex'?'将写入 config.toml 的 model 字段。':'auto 跟随路由策略，provider::model 精确固定。'}</p>`:`<div class="info">${NO_MODEL_HINT[tool]}</div>`;
  const keyBanner=keyToken?`<div class="info connect-key-banner" role="status">已把新 Key「${esc(keyName)}」的完整明文填入下方配置。<strong>仅在本页展示这一次</strong>，刷新或离开后将无法找回，请确认配置已保存。</div>`:'';
  root.innerHTML=`<div class="heading"><div><div class="eyebrow">CONNECT YOUR TOOLS</div><h1>接入向导</h1><p>把 Claude Code、Codex 或其他客户端接到本网关：选 Key → 选模型 → 复制配置。</p></div></div>
  <div class="panel"><h2>① 选择业务 API Key</h2>
   ${keyBanner}
   ${keysBlocked?'<div class="info">当前角色不能读取或创建 Key。直接复制下方模板，把占位符替换为你的 Key 明文；或请管理员创建。</div>':`
   <div class="connect-key-info muted">${keys.length?`现有生效中的 Key：${keys.map(k=>`${esc(k.name)}（${esc(k.preview)}）`).join('、')}。已有 Key 的明文无法再次查看——确认手头有明文可直接用，否则建议新建：`:keys.length===0?'还没有生效中的业务 Key，建议新建一把专用：':''}</div>
   <form id="connect-new-key" class="connect-new-key"><input name="name" required maxlength="80" autocomplete="off" placeholder="新 Key 名称" value="agent-${tool}-local"><button class="primary">创建并填入配置</button></form>
   <p class="muted">不创建也可以：下方配置中的 <code>${KEY_PLACEHOLDER}</code> 是占位符，复制后替换成你的 Key 明文即可。配额、有效期等限制可在「API Key 管理」中随时调整。</p>`}
  </div>
  <div class="panel section-space"><h2>② 选择目标模型</h2>${modelField}</div>
  <div class="panel section-space"><h2>③ 复制客户端配置</h2>
   <div class="page-tabs connect-tabs" role="tablist">${Object.entries(TOOL_LABELS).map(([id,label])=>`<button type="button" role="tab" data-connect-tool="${id}" aria-selected="${tool===id}" class="${tool===id?'selected':''}">${esc(label)}</button>`).join('')}</div>
   ${tool==='claude'?snippet('终端环境变量（当前窗口生效）','connect-claude-env',s.env)+snippet('持久化 · ~/.claude/settings.json（合并进 env，勿覆盖其他配置）','connect-claude-settings',s.settings)+snippet('验证 · 流式 Messages 请求','connect-verify',s.verify):''}
   ${tool==='codex'?snippet('用户级 ~/.codex/config.toml','connect-codex-config',s.config)+snippet('终端环境变量','connect-codex-env',s.env)+snippet('验证 · 流式 Responses 请求','connect-verify',s.verify):''}
   ${tool==='generic'?snippet('客户端填写内容','connect-generic-client',s.client)+snippet('验证 · curl','connect-verify',s.curl):''}
   <div class="info">${TOOL_NOTES[tool]}<br>对外部署时请把 <code>${esc(origin)}</code> 换成团队可访问的 HTTPS 地址，本机 127.0.0.1 只能本机访问。Key 泄露时在「API Key 管理」停用或删除即可。更多协议与参数见「API 文档」。</div>
  </div>`;
  const select=root.querySelector('#connect-model');
  if(select)select.onchange=()=>{picked[tool]=select.value;render();};
  root.querySelectorAll('[data-connect-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.connectTool;render();});
  root.querySelectorAll('[data-connect-copy]').forEach(b=>b.onclick=async()=>{const text=root.querySelector('#'+b.dataset.connectCopy)?.textContent||'';if(!text)return;try{await navigator.clipboard.writeText(text);toast('已复制');}catch{toast('剪贴板不可用，请手动选择复制');}});
  const form=root.querySelector('#connect-new-key');
  if(form)form.onsubmit=async e=>{
   e.preventDefault();const button=form.querySelector('button');button.disabled=true;
   try{
    const name=form.elements.name.value.trim()||`agent-${tool}`;
    const result=await api('/api/keys',{name,enabled:true});
    if(!isCurrent())return;
    keyToken=result.token;keyName=result.key?.name||name;
    if(result.key)keys=[{...result.key,status:'active',enabled:true},...keys];
    render();toast('Key 已创建，完整明文只在本页展示这一次');
   }catch(error){if(isCurrent())toast(error.message);}finally{button.disabled=false;}
  };
 }
 render();
}
