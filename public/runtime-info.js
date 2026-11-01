export function runtimeInfoMarkup(profile,esc){
 const build=profile.build;if(!build)return '';
 return `<section class="panel section-space runtime-info" aria-label="版本与运行环境"><h2>版本与运行环境</h2><dl><div><dt>版本</dt><dd>v${esc(build.version)}</dd></div><div><dt>构建指纹</dt><dd><code>${esc(build.fingerprint)}</code></dd></div><div><dt>运行方式</dt><dd>${profile.chatgptPlan?'桌面 App':'网页部署'}</dd></div></dl><p class="muted">网页与 App 使用同一套核心代码；版本和构建指纹相同，表示核心程序与页面资源一致。各部署的账号、配置和历史独立保存，不自动同步。</p><p class="muted">个人订阅连接与个人订阅路由仅在桌面 App 中开放；组织服务商、团队路由和业务 API 在两端使用相同逻辑。</p></section>`;
}

export function desktopSubscriptionNotice(){
 return '<details class="desktop-subscription-note"><summary>个人订阅 · 桌面 App 功能</summary><p class="muted">个人订阅连接和个人路由需在 Switchboard App 中使用。此网页部署管理组织 API 服务商；不会读取或共享你电脑里的订阅凭据。这是运行方式差异，不代表版本较旧。</p></details>';
}
