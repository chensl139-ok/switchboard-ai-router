import {confirmAction} from './accounts.js';
export async function renderApiKeys({api,esc,toast}){
 const container=document.querySelector('#content');
 let data;
 try{data=await api('/api/keys');}catch(error){container.textContent=error.message;return;}
 if(document.querySelector('#breadcrumb').textContent!=='API Key 管理')return;
 const labels={active:'生效中',scheduled:'未生效',expired:'已过期',disabled:'已停用'};
 const tone={active:'green',scheduled:'',expired:'',disabled:''};
 const formatDate=value=>value?new Date(value).toLocaleString():'不限';
 const quota=(used,limit)=>`${used.toLocaleString()} / ${limit===null?'不限':limit.toLocaleString()}`;
 container.innerHTML=`<div class="heading"><div><div class="eyebrow">ACCESS & USAGE</div><h1>对外 API Key 管理</h1><p>为每个应用单独签发密钥，控制调用次数与有效期；新 Key 自动归属创建人。</p></div><div class="heading-actions"><input type="search" id="key-search" placeholder="搜索名称 / 预览 / ID" aria-label="搜索密钥"><button id="new-key" class="primary">＋ 创建 API Key</button></div></div>
 ${data.legacyAvailable===false?'':`<div class="panel"><h2>旧版环境令牌</h2><p>环境变量 GATEWAY_TOKEN 当前${data.legacyEnabled?'仍可调用，不受下方各 Key 配额限制':'已停止对外调用'}。该令牌仅属于默认租户；建议给业务方创建受限 Key。</p><button id="legacy-key">${data.legacyEnabled?'关闭旧版调用令牌':'启用旧版调用令牌'}</button></div>`}
 <div class="section-title"><h2>应用密钥 · <span id="key-count">${data.keys.length}</span></h2><button id="refresh-keys" class="subtle">↻ 刷新</button></div>
 <div class="cards key-grid" id="key-list">${data.keys.map(key=>`<article class="card key-card" data-search="${esc((key.name+' '+key.preview+' '+key.id).toLowerCase())}"><div class="card-top"><h3>${esc(key.name)}</h3><span class="tag ${tone[key.status]}">${labels[key.status]}</span></div><p class="model key-preview">${esc(key.preview)}</p><div class="key-quota"><div><small>总调用</small><strong>${quota(key.requests,key.totalLimit)}</strong></div><div><small>今日</small><strong>${quota(key.dailyUsed,key.dailyLimit)}</strong></div><div><small>每分钟</small><strong>${key.rpmLimit??'不限'}</strong></div><div><small>成功 / 失败</small><strong>${key.successes} / ${key.failures}</strong></div></div><p class="key-window muted">生效 ${formatDate(key.startsAt)}<br>到期 ${formatDate(key.expiresAt)} · 最近使用 ${key.lastUsedAt?formatDate(key.lastUsedAt):'尚未调用'}</p><div class="card-actions"><button data-edit-key="${key.id}">修改限制</button><button data-toggle-key="${key.id}" class="subtle">${key.enabled?'停用':'启用'}</button><button data-delete-key="${key.id}" class="subtle danger-text">删除</button></div></article>`).join('')||'<div class="panel empty">尚无应用密钥。点击右上角创建。</div>'}</div>
 <div class="info">HTTP、SSE、WebSocket 共用每个 Key 的配额。每日配额按 UTC 零点（北京时间 08:00）重置。通过参数与路由校验、开始执行的生成请求计为一次；上游失败或取消也计次，路由内部回退不重复计次。模型列表查询不占生成配额。Token 仅统计上游返回的用量，未返回用量时不估算、不作为配额限额。</div>
 <dialog id="key-editor"><form id="key-form"><div class="modal-title"><h2 id="key-title">创建 API Key</h2><button type="button" id="close-key" class="subtle">✕</button></div><label>名称<input name="name" required maxlength="80" placeholder="例如：业务系统 / 测试环境"></label><div class="form-grid"><label>开始生效（本地时间）<input name="startsAt" type="datetime-local"></label><label>过期时间（本地时间）<input name="expiresAt" type="datetime-local"></label></div><label>总调用次数上限<input name="totalLimit" type="number" min="1" max="1000000000" placeholder="留空不限"></label><label>每日调用次数上限<input name="dailyLimit" type="number" min="1" max="1000000000" placeholder="留空不限"></label><label>每分钟调用次数上限<input name="rpmLimit" type="number" min="1" max="1000000000" placeholder="留空不限"></label><label class="check"><input name="enabled" type="checkbox" checked> 启用</label><p class="muted">留空生效时间表示立即生效；留空过期时间表示不过期。修改配额不会重置已用次数。停用/到期阻止新请求，已开始的请求允许完成。</p><button class="primary" id="save-key">创建</button><p id="key-error" role="alert"></p></form></dialog>
 <dialog id="key-created"><h2>请立即保存 API Key</h2><p>完整密钥仅在创建时展示这一次，关闭后无法再次查看。</p><label>API Key<input id="created-token" readonly></label><button id="copy-key" class="primary">复制密钥</button><button id="finish-key">我已保存</button><p class="muted">HTTP/SSE 使用 Authorization: Bearer &lt;API Key&gt;；WebSocket 在 auth 消息中传 token。</p></dialog>`;
 const editor=container.querySelector('#key-editor'),form=container.querySelector('#key-form');let editing=null;
 const localDate=iso=>{if(!iso)return '';const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
 const reload=()=>renderApiKeys({api,esc,toast});
 const open=key=>{editing=key;form.reset();container.querySelector('#key-error').textContent='';container.querySelector('#key-title').textContent=key?'修改 Key 限制':'创建 API Key';container.querySelector('#save-key').textContent=key?'保存修改':'创建';if(key){form.elements.name.value=key.name;form.elements.enabled.checked=key.enabled;for(const f of ['totalLimit','dailyLimit','rpmLimit'])form.elements[f].value=key[f]??'';for(const f of ['startsAt','expiresAt'])form.elements[f].value=localDate(key[f]);}editor.showModal()};
 container.querySelector('#new-key').onclick=()=>open(null);
 container.querySelector('#close-key').onclick=()=>editor.close();
 container.querySelector('#refresh-keys').onclick=reload;
 container.querySelector('#key-search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();let n=0;container.querySelectorAll('[data-search]').forEach(card=>{const show=!q||card.dataset.search.includes(q);card.hidden=!show;if(show)n++;});container.querySelector('#key-count').textContent=String(n);});
 if(container.querySelector('#legacy-key'))container.querySelector('#legacy-key').onclick=async e=>{e.target.disabled=true;try{await api('/api/keys/legacy',{enabled:!data.legacyEnabled});await reload()}catch(error){toast(error.message);e.target.disabled=false}};
 container.querySelectorAll('[data-delete-key]').forEach(button=>button.onclick=()=>{const key=data.keys.find(k=>k.id===button.dataset.deleteKey);confirmAction(container,'删除 '+key.name+'？','删除后不能恢复或重新启用。已有调用日志和计数保留，已开始的请求允许完成。',async()=>{await api('/api/keys/delete',{id:key.id});await reload();},toast);});
 container.querySelectorAll('[data-edit-key]').forEach(button=>button.onclick=()=>open(data.keys.find(k=>k.id===button.dataset.editKey)));
 container.querySelectorAll('[data-toggle-key]').forEach(button=>button.onclick=async()=>{button.disabled=true;const key=data.keys.find(k=>k.id===button.dataset.toggleKey);try{await api('/api/keys/toggle',{id:key.id,enabled:!key.enabled});await reload()}catch(error){toast(error.message);button.disabled=false}});
 form.onsubmit=async e=>{
  e.preventDefault();const button=container.querySelector('#save-key');button.disabled=true;
  try{
   const value={name:form.elements.name.value,enabled:form.elements.enabled.checked};
   for(const f of ['totalLimit','dailyLimit','rpmLimit'])value[f]=form.elements[f].value===''?null:Number(form.elements[f].value);
   for(const f of ['startsAt','expiresAt'])value[f]=form.elements[f].value?new Date(form.elements[f].value).toISOString():null;
   const result=await api(editing?'/api/keys/update':'/api/keys',{...value,...(editing?{id:editing.id}:{})});
   editor.close();
   if(editing){await reload();toast('Key 限制已更新');}
   else {container.querySelector('#created-token').value=result.token;container.querySelector('#key-created').showModal();}
  }catch(error){container.querySelector('#key-error').textContent=error.message}finally{button.disabled=false}
 };
 container.querySelector('#copy-key').onclick=async()=>{try{await navigator.clipboard.writeText(container.querySelector('#created-token').value);toast('已复制，请保存到安全位置')}catch{toast('无法自动复制，请手动选择密钥复制')}};
 container.querySelector('#finish-key').onclick=()=>container.querySelector('#key-created').close();
 container.querySelector('#key-created').addEventListener('close',()=>{container.querySelector('#created-token').value='';void reload()});
}
