let tenantHint='';
let accountStatus={sso:{feishu:{enabled:false}}};
const safeText=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export async function accountRequest(path,data){
 const res=await fetch('/api/account/'+path,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(!['status','me','login','setup','register','logout'].includes(path)&&tenantHint?{'X-Tenant-ID':tenantHint}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const body=await res.json();if(!res.ok){const id=res.headers.get('x-request-id');throw Object.assign(Error((body.error?.message||'账户请求失败')+(id?` · 请求 ID ${id}`:'')),{status:res.status});}if(body.tenantId)tenantHint=body.tenantId;return body;
}
let readyHandler=null;
export async function startAccountUI(onReady){readyHandler=onReady;accountStatus=await accountRequest('status');if(accountStatus.needsSetup)return showLogin('setup');try{await onReady(await accountRequest('me'));}catch(e){if(e.status===401)showLogin('login');else throw e;}}
export async function refreshAccountStatus(){accountStatus=await accountRequest('status');return accountStatus;}
export function showLogin(mode='login'){
 const dialog=document.querySelector('#login');
 const authError=new URLSearchParams(location.search).get('auth_error');if(authError)history.replaceState(null,'',location.pathname+location.hash);
 const feishuProviders=accountStatus.sso?.feishu?.providers||[];
 dialog.innerHTML=`<form id="account-login"><div class="eyebrow">SWITCHBOARD ACCOUNT</div><h2>${mode==='setup'?'创建首个管理员账户':mode==='register'?'受邀注册账户':mode==='recover'?'重置账户密码':'登录工作空间'}</h2><p>${mode==='setup'?'原有配置保留在默认租户，创建账户后接管。':mode==='register'?'注册需要组织管理员签发的邀请码，且仅可用于指定邮箱。':mode==='recover'?'请向组织管理员索取一次性重置码；系统不通过邮件发送。若你是唯一所有者，请联系部署管理员按 README 的恢复指引操作。':'使用邮箱和密码登录。新用户注册需要组织管理员的邀请码。'}</p>
 ${mode==='login'&&accountStatus.sso?.feishu?.enabled?`<div class="sso-options"><button type="button" class="primary sso-button" id="feishu-login" aria-expanded="false" aria-controls="feishu-choice"><span>飞</span> 使用飞书登录</button><div id="feishu-choice" class="sso-provider-list" hidden>${feishuProviders.map(provider=>`<a class="button sso-provider" href="/api/account/sso/feishu/start?provider=${encodeURIComponent(provider.key)}">${safeText(provider.label)} <span aria-hidden="true">↗</span></a>`).join('')}</div></div><div class="auth-divider"><span>或使用账号密码</span></div>`:''}
 ${mode==='setup'?'<label>初始化管理令牌<input name="bootstrapToken" type="password" autocomplete="off" required placeholder=".env 中的 ADMIN_TOKEN"></label>':''}
 ${['setup','register'].includes(mode)?'<label>姓名<input name="name" required maxlength="80" autocomplete="name"></label>':''}
 <label>邮箱<input name="email" type="email" required autocomplete="username"></label>${mode==='recover'?'<label>管理员提供的重置码<input name="code" required type="password" autocomplete="off"></label>':''}<label>${mode==='recover'?'新密码':'密码'}<input name="${mode==='recover'?'newPassword':'password'}" type="password" required minlength="12" maxlength="256" autocomplete="${mode==='login'?'current-password':'new-password'}"></label>
 ${mode==='register'?'<label>邀请码<input name="inviteCode" required type="password" autocomplete="off"></label>':''}<button type="submit" class="primary">${mode==='login'?'登录':mode==='recover'?'重置密码':'创建账户'}</button><p id="account-error" role="alert"></p>
 ${mode!=='setup'?`<button type="button" id="account-mode" class="subtle">${mode==='login'?'有邀请码？受邀注册':'返回登录'}</button>${mode==='login'?'<button type="button" id="account-recover" class="subtle">忘记密码？</button>':''}`:''}</form>`;
 if(!dialog.open)dialog.showModal();dialog.oncancel=e=>e.preventDefault();
 dialog.querySelector('#account-error').textContent=authError||'';
 dialog.querySelector('#account-mode')?.addEventListener('click',()=>showLogin(mode==='login'?'register':'login'));
 dialog.querySelector('#account-recover')?.addEventListener('click',()=>showLogin('recover'));
 dialog.querySelector('#feishu-login')?.addEventListener('click',event=>{if(feishuProviders.length===1){location.assign('/api/account/sso/feishu/start?provider='+encodeURIComponent(feishuProviders[0].key));return;}const list=dialog.querySelector('#feishu-choice'),expanded=list.hidden;list.hidden=!expanded;event.currentTarget.setAttribute('aria-expanded',String(expanded));if(expanded)list.querySelector('a')?.focus();});
 dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button[type=submit]');button.disabled=true;try{const result=await accountRequest(mode==='setup'?'setup':mode==='register'?'register':mode==='recover'?'password-reset/complete':'login',Object.fromEntries(new FormData(form)));form.reset();if(mode==='recover'){showLogin('login');dialog.querySelector('#account-error').textContent='密码已重置，请使用新密码登录。';}else{await readyHandler(result);dialog.close();}}catch(error){dialog.querySelector('#account-error').textContent=error.message;}finally{button.disabled=false;}};
}
export async function renderMembers({profile,esc,toast,prefix=''}){
 const root=document.querySelector('#content');let data;try{data=await accountRequest('members');}catch(e){root.textContent=e.message;return;}
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">MEMBERS & ROLES</div><h1>成员与角色</h1><p>当前租户的角色独立生效，移除成员后下一次请求即失效。</p></div></div>${prefix}
 <div class="panel"><h2>租户成员</h2><div class="table-wrap"><table><thead><tr><th>姓名</th><th>邮箱</th><th>角色</th><th>操作</th></tr></thead><tbody>${data.members.map(m=>`<tr><td>${esc(m.name)}${m.userId===profile.user.id?'（你）':''}</td><td>${esc(m.email)}</td><td><select data-role-user="${m.userId}" ${m.role==='owner'&&profile.role!=='owner'?'disabled':''}>${['owner','admin','member','viewer'].map(role=>`<option value="${role}" ${role===m.role?'selected':''} ${role==='owner'&&profile.role!=='owner'?'disabled':''}>${{owner:'所有者',admin:'管理员',member:'成员',viewer:'只读'}[role]}</option>`).join('')}</select></td><td><button data-reset-member="${m.userId}" ${m.userId===profile.user.id||m.role==='owner'&&profile.role!=='owner'?'disabled':''}>重置密码</button> <button data-remove-member="${m.userId}" ${m.userId===profile.user.id||m.role==='owner'&&profile.role!=='owner'?'disabled':''}>移除</button></td></tr>`).join('')}</tbody></table></div><div id="reset-result" aria-live="polite"></div><p class="muted">管理员可签发有效 30 分钟的一次性重置码。请通过安全渠道交给成员；此处仅展示一次。</p></div>
 <div class="panel section-space"><h2>邀请成员</h2><form id="invite-form"><div class="form-grid"><label>邮箱<input name="email" type="email" required></label><label>角色<select name="role">${['member','viewer','admin',...(profile.role==='owner'?['owner']:[])].map(role=>`<option value="${role}">${{owner:'所有者',admin:'管理员',member:'成员',viewer:'只读'}[role]}</option>`).join('')}</select></label></div><button class="primary">生成邀请</button></form><div id="invite-result"></div><p class="muted">邀请有效 72 小时，仅绑定邮箱可使用。通过你选择的安全渠道发送邀请码；系统不自动发送邮件。</p></div>
 <div class="panel section-space"><h2>待处理邀请</h2>${data.invites.filter(i=>i.expiresAt>Date.now()).map(i=>`<p>${esc(i.email)} · ${esc(i.role)} <button data-revoke="${i.id}" ${i.role==='owner'&&profile.role!=='owner'?'disabled':''}>撤销邀请</button></p>`).join('')||'<p class="muted">暂无有效邀请</p>'}</div><div class="info">所有者：全部权限与所有者管理。管理员：服务商、路由、Key、价格和普通成员管理。成员：查看配置和用量、调用模型。只读：查看配置、用量和日志，不可调用或修改。</div>`;
 const reload=()=>renderMembers({profile,esc,toast,prefix});
 root.querySelector('#invite-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await accountRequest('invite',Object.fromEntries(new FormData(e.target)));const box=root.querySelector('#invite-result');box.innerHTML='<label>邀请码（仅展示一次）<input readonly id="invite-code"></label>';box.querySelector('input').value=result.code;}catch(error){toast(error.message);}finally{button.disabled=false;}};
 root.querySelectorAll('[data-revoke]').forEach(el=>el.onclick=async()=>{try{await accountRequest('revoke-invite',{id:el.dataset.revoke});await reload();}catch(error){toast(error.message);}});
 root.querySelectorAll('[data-role-user]').forEach(el=>el.onchange=async()=>{try{await accountRequest('member-role',{userId:el.dataset.roleUser,role:el.value});await reload();toast('角色已更新');}catch(error){toast(error.message);await reload();}});
 root.querySelectorAll('[data-remove-member]').forEach(el=>el.onclick=async()=>{const user=data.members.find(m=>m.userId===el.dataset.removeMember);confirmAction(root,`移除 ${user.name}？`,`将撤销其当前租户访问权限，不影响其他租户。`,async()=>{await accountRequest('member-remove',{userId:user.userId});await reload();},toast);});
 root.querySelectorAll('[data-reset-member]').forEach(el=>el.onclick=async()=>{const user=data.members.find(m=>m.userId===el.dataset.resetMember);try{const result=await accountRequest('password-reset/issue',{userId:user.userId});const box=root.querySelector('#reset-result');box.innerHTML=`<label>${esc(user.name)} 的一次性重置码（30 分钟内有效）<input readonly autocomplete="off"></label>`;box.querySelector('input').value=result.code;toast('重置码已签发，仅在此展示一次');}catch(error){toast(error.message);}});
}
export function confirmAction(root,title,description,action,toast){
 const dialog=document.createElement('dialog');dialog.className='confirm-dialog';const h=document.createElement('h2');h.textContent=title;const p=document.createElement('p');p.textContent=description;const actions=document.createElement('div');actions.className='confirm-actions';const yes=document.createElement('button');yes.textContent='确认';yes.className='danger-primary';const no=document.createElement('button');no.textContent='取消';actions.append(no,yes);dialog.append(h,p,actions);root.append(dialog);dialog.showModal();no.focus();no.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();yes.onclick=async()=>{yes.disabled=true;try{await action();dialog.close();}catch(e){toast(e.message);yes.disabled=false;}};
}
export async function renderAccount({profile,esc,toast,onReady}){
 const root=document.querySelector('#content'),feishuProvider=accountStatus.sso?.feishu?.providers?.find(provider=>provider.tenantId===profile.tenantId),currentTenant=profile.tenants.find(tenant=>tenant.id===profile.tenantId),canRename=['owner','admin'].includes(profile.role);
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">ACCOUNT & WORKSPACES</div><h1>账户与租户</h1><p>${esc(profile.user.name)} · ${esc(profile.user.email)}</p></div><span class="account-auth-badge">${profile.platformAccess?'平台主账号':profile.user.feishuLinked?'飞书已连接':'邮箱账户'}</span></div>
 ${feishuProvider?`<div class="panel feishu-account-panel"><div class="feishu-account-heading"><h2>飞书账户</h2><span class="tag">当前组织 · ${esc(feishuProvider.label)}</span></div><p>${profile.user.feishuLinked?'当前账户已连接此组织的飞书身份；登录时会落入对应工作空间。':'先使用当前账户连接飞书身份；系统不会仅凭飞书邮箱自动认领账户。'}</p>${profile.user.feishuLinked?'':'<button type="button" id="link-feishu" class="primary">连接飞书账户</button>'}</div>`:''}
 ${canRename?`<div class="panel section-space"><h2>当前租户</h2><p class="muted">仅修改显示名称，不改变租户 ID、飞书绑定或现有配置。</p><form id="rename-tenant"><label>租户名称<input name="name" required maxlength="80" value="${esc(currentTenant?.name||'')}"></label><button type="submit">保存名称</button></form></div>`:''}
 ${profile.platformAccess?`<div class="panel section-space"><h2>创建新租户</h2><p>仅平台主账号可创建独立工作空间。</p><form id="new-tenant"><label>租户名称<input name="name" required maxlength="80"></label><button class="primary">创建租户</button></form></div><div class="panel section-space"><h2>接受邀请</h2><form id="accept-invite"><label>邀请码<input name="code" type="password" required autocomplete="off"></label><button>加入租户</button></form></div>`:''}
 <div class="panel section-space"><h2>${profile.user.hasPassword?'修改密码':'设置备用密码'}</h2><p>${profile.user.hasPassword?'更新后会退出此账户的其他会话。':'设置后可在飞书不可用时使用邮箱与密码登录。'}</p><form id="change-password">${profile.user.hasPassword?'<label>原密码<input name="currentPassword" type="password" required autocomplete="current-password"></label>':''}<label>新密码<input name="newPassword" type="password" minlength="12" maxlength="256" required autocomplete="new-password"></label><button>${profile.user.hasPassword?'更新密码并退出其他会话':'设置备用密码'}</button></form></div>`;
 const authError=new URLSearchParams(location.search).get('auth_error');if(authError){history.replaceState(null,'',location.pathname+location.hash);toast(authError);}
 root.querySelector('#link-feishu')?.addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;try{const result=await accountRequest('sso/feishu/link/start',{});location.assign(result.url);}catch(error){toast(error.message);button.disabled=false;}});
 if(profile.platformAccess){
  let bindings=[];try{bindings=(await accountRequest('sso/feishu/bindings')).bindings;}catch(error){toast(error.message);}
  const box=document.createElement('section');box.className='panel section-space enterprise-bindings';
  box.innerHTML=`<h2>飞书企业绑定</h2><p class="muted">仅平台主账号可绑定企业应用。启用自动加入后，飞书授权成功的企业成员可直接创建本租户普通账号，无需邀请码；已有平台账号仍须先连接飞书。App Secret 仅加密保存在服务端。</p><div class="enterprise-binding-list">${profile.tenants.map(tenant=>{const binding=bindings.find(item=>item.tenantId===tenant.id);return `<div class="enterprise-binding-row"><span><strong>${esc(tenant.name)}</strong><small>${binding?`${esc(binding.label)} · ${esc(binding.appId)} · ${binding.autoJoin?'员工可直接加入':'仅已连接账号'}`:'尚未绑定企业'}</small></span>${binding?`<button type="button" data-unbind-tenant="${esc(tenant.id)}" class="danger-text">解绑企业</button>`:''}</div>`;}).join('')}</div><form id="bind-enterprise" class="enterprise-binding-form"><label>目标租户<select name="tenantId" required>${profile.tenants.map(tenant=>`<option value="${esc(tenant.id)}">${esc(tenant.name)}</option>`).join('')}</select></label><label>企业名称<input name="label" required maxlength="40" placeholder="例如：模思智能"></label><label>飞书 App ID<input name="appId" required placeholder="cli_..."></label><label>飞书 App Secret<input name="appSecret" type="password" autocomplete="off" placeholder="首次绑定必填；修改原绑定时留空保留"></label><label>Tenant Key（可选）<input name="tenantKey" maxlength="128" placeholder="额外校验飞书企业身份"></label><label class="enterprise-auto-join"><input name="autoJoin" type="checkbox" checked> 允许本企业成员首次飞书登录时自动加入</label><div class="enterprise-binding-actions"><small class="field-help">还需在飞书应用后台登记回调地址：${esc(location.origin)}/api/account/sso/feishu/callback</small><button type="submit" class="primary">保存企业绑定</button></div></form>`;
  root.append(box);const form=box.querySelector('#bind-enterprise'),select=form.elements.tenantId;
  const updateForm=()=>{const binding=bindings.find(item=>item.tenantId===select.value);form.elements.label.value=binding?.label||'';form.elements.appId.value=binding?.appId||'';form.elements.tenantKey.value=binding?.tenantKey||'';form.elements.autoJoin.checked=binding?.autoJoin!==false;form.elements.appSecret.value='';};select.onchange=updateForm;updateForm();
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;try{await accountRequest('sso/feishu/bindings',Object.fromEntries(new FormData(form)));accountStatus=await accountRequest('status');toast('飞书企业绑定已保存');await onReady(await accountRequest('me'));}catch(error){toast(error.message);}finally{button.disabled=false;}};
  box.querySelectorAll('[data-unbind-tenant]').forEach(button=>button.onclick=()=>{const tenant=profile.tenants.find(item=>item.id===button.dataset.unbindTenant);confirmAction(box,`解绑“${tenant?.name||'此租户'}”的飞书企业？`,'解绑后该企业飞书入口将立即失效；已有的企业用户和平台数据不会删除。若解绑模思智能，请先确保邮箱密码可用。',async()=>{await accountRequest('sso/feishu/bindings/delete',{tenantId:button.dataset.unbindTenant});accountStatus=await accountRequest('status');toast('企业绑定已移除');await onReady(await accountRequest('me'));},toast);});
 }
 const owned=profile.platformAccess?profile.tenants.filter(t=>t.role==='owner'&&t.id!=='default'):[];
 if(owned.length){
  const box=document.createElement('div');box.className='panel section-space danger-zone';
  box.innerHTML=`<h2>租户管理</h2><p class="muted">已绑定飞书登录应用的租户不可删除。其他租户仅所有者可在切换离开后删除；删除会永久移除成员、密钥、配置与历史用量。</p>`;
  const list=document.createElement('div');list.className='tenant-delete-list';
  const protectedTenants=new Map((accountStatus.sso?.feishu?.providers||[]).map(provider=>[provider.tenantId,provider.label]));
  for(const t of owned){
   const row=document.createElement('div');row.className='tenant-delete-row';
   const name=document.createElement('strong');name.textContent=t.name;row.append(name);
   if(t.ssoProtected||protectedTenants.has(t.id)){
    const label=protectedTenants.get(t.id),note=document.createElement('span');note.className='muted';note.textContent=label?`已绑定 ${label} 飞书登录 · 不可删除`:'已绑定飞书登录 · 不可删除';row.append(note);
   }else if(t.id===profile.tenantId){
    const note=document.createElement('span');note.className='muted';note.textContent='当前租户 · 切换后可删除';row.append(note);
   }else{
    const btn=document.createElement('button');btn.type='button';btn.textContent='删除租户';
    btn.onclick=()=>{confirmAction(box,`删除租户“${t.name}”？`,'该租户下所有成员、服务商密钥、API Key 与历史用量将被删除，且无法恢复。',async()=>{await accountRequest('tenants/delete',{tenantId:t.id});toast('租户已删除');await onReady(await accountRequest('me'));},toast);};
    row.append(btn);
   }
   list.append(row);
  }
  box.append(list);
  root.append(box);
 }
 for(const [id,route] of [['new-tenant','tenants'],['accept-invite','accept-invite'],['change-password','password'],['rename-tenant','tenants/rename']]){
  const form=root.querySelector('#'+id);if(!form)continue;
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await accountRequest(route,Object.fromEntries(new FormData(form)));if(id!=='rename-tenant')form.reset();toast(id==='rename-tenant'?'租户名称已更新':'操作成功');await onReady(await accountRequest('me'));}catch(error){toast(error.message);}finally{button.disabled=false;}};
 }
}
