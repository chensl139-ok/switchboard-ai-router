import {accountRequest} from './accounts.js';

const roleName=value=>({owner:'所有者',admin:'管理员',member:'成员',viewer:'只读'}[value]||'');
const actionName=value=>({
 'account.setup':'初始化账户','account.login.feishu':'飞书登录','account.password':'修改密码','member.join':'加入组织','member.join.sso':'通过飞书加入','member.invite':'邀请成员','member.remove':'移除成员','member.role':'修改角色','invite.revoke':'撤销邀请','tenant.create':'创建租户'
}[value]||value);

export async function renderAudit({esc}){
 const root=document.querySelector('#content');
 root.innerHTML=`<div class="heading"><div><div class="eyebrow">ORGANIZATION AUDIT</div><h1>组织审计</h1><p>查看成员和 API Key 的模型调用、Token 用量与管理操作。</p></div><select id="audit-days" aria-label="审计周期"><option value="7">最近 7 天</option><option value="30" selected>最近 30 天</option><option value="90">最近 90 天</option></select></div><div id="audit-content"><div class="view-loading" role="status"><span class="loading-dot"></span>正在读取审计数据…</div></div>`;
 const content=root.querySelector('#audit-content');let version=0;
 async function load(){const current=++version;try{
  const [usage,events]=await Promise.all([accountRequest('usage-audit?days='+root.querySelector('#audit-days').value),accountRequest('audit')]);if(current!==version)return;
  const totals=usage.members.reduce((sum,row)=>({requests:sum.requests+Number(row.requests||0),tokens:sum.tokens+Number(row.tokens||0),active:sum.active+(row.requests?1:0)}),{requests:0,tokens:0,active:0});
  const costs=row=>row.costs?.length?row.costs.map(cost=>`${esc(cost.currency)} ${Number(cost.amount).toFixed(6)}`).join(' / '):'—';
  content.innerHTML=`<div class="metrics audit-metrics"><div class="metric"><label>活跃成员</label><strong>${totals.active}</strong><small>含未归属调用</small></div><div class="metric"><label>生成请求</label><strong>${totals.requests.toLocaleString()}</strong></div><div class="metric"><label>已知 Tokens</label><strong>${totals.tokens.toLocaleString()}</strong></div><div class="metric"><label>审计保留</label><strong>${usage.retentionDays} 天</strong></div></div>
  <section class="panel"><div class="panel-title"><div><span class="eyebrow">MEMBER USAGE</span><h2>成员用量</h2></div></div><div class="table-wrap"><table><thead><tr><th>成员</th><th>请求 / 尝试</th><th>成功率</th><th>Tokens</th><th>费用估算</th><th>最近使用</th></tr></thead><tbody>${usage.members.map(row=>`<tr><td><strong>${esc(row.name)}</strong><br><small>${esc(row.email||(!row.actorId?'历史调用无法确认成员':''))}${row.role?` · ${esc(roleName(row.role))}`:''}</small></td><td>${Number(row.requests).toLocaleString()} / ${Number(row.attempts).toLocaleString()}</td><td>${row.attempts?Math.round(row.successes/row.attempts*100):0}%</td><td>${Number(row.tokens).toLocaleString()}<br><small>输入 ${Number(row.inputTokens).toLocaleString()} · 输出 ${Number(row.outputTokens).toLocaleString()}</small></td><td>${costs(row)}</td><td>${row.lastUsedAt?esc(new Date(row.lastUsedAt).toLocaleString()):'—'}</td></tr>`).join('')}</tbody></table></div>${usage.members.length?'':'<p class="empty">当前周期暂无模型调用</p>'}</section>
  <section class="panel section-space"><div class="panel-title"><div><span class="eyebrow">API KEY ATTRIBUTION</span><h2>API Key 归属</h2></div></div><div class="table-wrap"><table><thead><tr><th>归属成员</th><th>Key ID</th><th>请求</th><th>Tokens</th><th>最近使用</th></tr></thead><tbody>${usage.keys.map(row=>`<tr><td>${esc(row.name)}</td><td><code>${esc(row.apiKeyId)}</code></td><td>${Number(row.requests).toLocaleString()}</td><td>${Number(row.tokens).toLocaleString()}</td><td>${row.lastUsedAt?esc(new Date(row.lastUsedAt).toLocaleString()):'—'}</td></tr>`).join('')}</tbody></table></div>${usage.keys.length?'':'<p class="empty">当前周期暂无 API Key 调用</p>'}<p class="muted audit-help">新创建的 Key 自动归属创建人。历史 Key 或旧版环境令牌无法可靠确认个人身份，会明确显示为未归属。</p></section>
  <section class="panel section-space"><div class="panel-title"><div><span class="eyebrow">ADMIN EVENTS</span><h2>管理操作</h2></div></div><div class="audit-events">${events.items.slice(0,100).map(item=>`<div><span class="audit-dot"></span><time>${esc(new Date(item.time).toLocaleString())}</time><strong>${esc(item.actorName)}</strong><span>${esc(actionName(item.action))}</span><small>${esc(item.target)}</small></div>`).join('')||'<p class="empty">暂无管理操作</p>'}</div></section>`;
 }catch(error){if(current===version)content.textContent=error.message;}}
 root.querySelector('#audit-days').onchange=load;await load();
}
