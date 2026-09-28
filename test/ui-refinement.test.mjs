import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('导航首屏不闪出旧标签，流式消息局部更新且对比页按需加载',()=>{
 const app=read('public/app.js'),css=read('public/interface.css'),lab=read('public/playground.js'),server=read('server.mjs');
 assert.match(app,/document\.body\.classList\.remove\('app-ready'\)/);
 assert.match(app,/render\(\);document\.body\.classList\.add\('app-ready'\)/);
 assert.match(css,/body:not\(\.app-ready\) \.sidebar \.nav-item\.selected/);
 assert.match(css,/body>main>header, body\.theme-dark>main>header \{ backdrop-filter: none; \}/);
 assert.match(lab,/import\('\.\/model-compare\.js'\)/);
 assert.match(lab,/patchStreamingMessage\(list\.lastElementChild,history\.at\(-1\)\)/);
 assert.match(lab,/element\.firstChild\.appendData\(text\.slice\(previous\.length\)\)/);
 assert.match(server,/\/\(\?:build\\\/\)\?assets\\\//);
});

test('模思品牌图标使用本地 SVG，并由静态路由以 SVG 类型提供',()=>{
 const html=read('public/index.html'),logo=read('public/mosi.svg'),server=read('server.mjs'),css=read('public/workspaces.css');
 assert.match(logo,/<svg[^>]+viewBox="0 0 100 100"/);
 assert.match(html,/<img class="brand-mark" src="\/mosi\.svg"/);
 assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="\/mosi\.svg"/);
 assert.match(server,/'\/mosi\.svg':'mosi\.svg'/);
 assert.match(server,/f\.endsWith\('\.svg'\)\?'image\/svg\+xml'/);
 assert.match(css,/\.sidebar \.brand-mark \{[\s\S]*?background: #fff;/);
});

test('删除的内置服务商可从添加弹窗重新选择模板',()=>{
 const app=read('public/app.js'),server=read('server.mjs');
 assert.match(app,/id="provider-template"/);
 assert.match(app,/\.filter\(preset=>!state\.providers\.some\(item=>item\.id===preset\.id\)\)/);
 assert.match(app,/f\.elements\[key\]\.value=preset\[key\]/);
 assert.match(server,/providers:state\.providers\.map[\s\S]*?presets\}/);
});

test('媒体实验室使用通用视频名称并自动轮询异步任务',()=>{
 const source=read('public/media-lab.js');
 assert.match(source,/video:\{label:'视频生成'/);assert.doesNotMatch(source,/视频生成（硅基流动）/);
 assert.match(source,/setTimeout\(poll,nextDelay\)/);assert.match(source,/clearTimeout\(pollTimer\)/);
 assert.match(source,/videoCompatible/);assert.match(source,/MEDIA STUDIO/);
 assert.match(source,/kind==='video'\?supported\.find\(item=>\/T2V\/i\.test\(item\.model\)\)/);
 assert.match(source,/imageRequired=\$\('#media-kind'\)\.value==='video'&&\/I2V\/i/);
 assert.match(source,/data\.pendingSync\?'上游暂不可查 · 自动重试'/);
 assert.match(source,/\$\('#media-error'\)\.textContent='';[\s\S]*?setStatus\(data\.pendingSync/);
 assert.match(source,/if\(error\.status===404\|\|error\.status===409\)stopPolling\(\)/);
});

test('切换媒体任务、模型或视觉输入类型时清空旧结果并阻止迟到响应覆盖',()=>{
 const source=read('public/media-lab.js');
 assert.match(source,/if\(\$\('#media-kind'\)\.value!==kind\)clearSelection\(\)/);
 assert.match(source,/\$\('#media-model'\)\.onchange=\(\)=>\{clearSelection\(\)/);
 assert.match(source,/\$\('#media-vision-type'\)\.onchange=\(\)=>\{clearSelection\(\)/);
 assert.match(source,/selectionEpoch\+\+;controller=null;stopPolling\(\);taskId=null;recordId=null/);
 assert.match(source,/await persist\('submitted'/);
 assert.match(source,/if\(!active\(\)\|\|epoch!==selectionEpoch\|\|id!==taskId\)return/);
 assert.match(source,/current=\(\)=>active\(\)&&epoch===selectionEpoch/);
});

test('模型实验室切换页面保留任务，历史按账号租户保存；登录页仅一个飞书入口',()=>{
 const media=read('public/media-lab.js'),chat=read('public/playground.js'),account=read('public/accounts.js');
 assert.match(media,/export function stopMediaLab\(\)\{viewEpoch\+\+;controller=null/);
 assert.match(media,/await persist\('submitted'/);assert.match(media,/mountLabHistory\(root,\{area:'media'/);
 assert.match(chat,/export function stopPlayground\(\)\{stopCompare\(\);\}/);
 assert.match(chat,/mountLabHistory\(root,\{area:'chat'/);
 assert.match(account,/id="feishu-login"/);assert.match(account,/id="feishu-choice"/);
 assert.doesNotMatch(account,/使用 \$\{safeText\(provider\.label\)\} 飞书登录/);
});

test('组织审计默认聚焦近期管理变更，不在账户页重复铺开',()=>{
 const audit=read('public/audit-events.js'),account=read('public/accounts.js'),organization=read('public/audit.js');
 assert.match(audit,/最近 7 天/);assert.match(audit,/params\.set\('limit','10'\)/);
 assert.match(audit,/name="includeRoutine"/);assert.doesNotMatch(account,/renderAuditEvents/);
 assert.match(organization,/select\(0\)/);
});

test('仅主账号看到清空全部租户审计入口，危险操作要求输入确认文字',()=>{
 const audit=read('public/audit-events.js'),organization=read('public/audit.js');
 assert.match(organization,/canClear:profile\.platformAccess/);
 assert.match(audit,/canClear\?'<button type="button" class="danger-text" data-clear-audit>/);
 assert.match(audit,/input\.value!==phrase/);
 assert.match(audit,/request\('audit\/clear',\{confirm:input\.value\}\)/);
});

test('飞书企业绑定按钮使用独立紧凑操作栏，不被表单网格拉伸',()=>{
 const account=read('public/accounts.js'),css=read('public/interface.css');
 assert.match(account,/<div class="enterprise-binding-actions"><small class="field-help">/);
 assert.match(css,/\.enterprise-binding-actions\{grid-column:1\/-1;display:flex/);
 assert.match(css,/\.enterprise-binding-actions button\{flex:none;width:auto;min-width:126px/);
});

test('贴图预览放入对话输入框并保持横向排列',()=>{
 const chat=read('public/playground.js'),css=read('public/workspaces.css');
 assert.match(chat,/<form id="lab-form" class="lab-composer">[\s\S]*?<div id="lab-images" class="lab-images"/);
 assert.match(css,/\.lab-composer \.lab-images \{ display: flex;[\s\S]*?width: 100%;[\s\S]*?overflow-x: auto/);
 assert.match(css,/\.lab-composer \.lab-images>span \{ display: block; flex: 0 0 76px/);
});

test('侧栏收起按钮可发现、可持久化并适配中等宽度',()=>{
 const html=read('public/index.html'),app=read('public/app.js'),css=read('public/style.css');
 assert.match(html,/sidebar-heading.*id="sidebar-toggle"/);assert.match(html,/aria-controls="workspace-sidebar"/);assert.match(html,/data-tooltip="收起导航"/);
 assert.match(app,/localStorage\.setItem\('sidebar-compact'/);assert.match(app,/max-width:1150px/);
 assert.match(css,/\[data-tooltip\]::after/);assert.match(css,/\.sidebar-compact \.sidebar-toggle\{margin-left:0\}/);
});

test('模型实验室突出直接选模型、运行摘要和生成中草稿',()=>{
 const source=read('public/playground.js'),composer=read('public/lab-composer.js');
 assert.match(source,/lab-session-summary/);assert.match(source,/lab-model-quick/);
 assert.match(source,/协议自动适配/);assert.match(source,/lab-response-meta/);
 assert.match(source,/id="lab-draft-state"/);assert.match(composer,/draftState\.hidden=!value/);
 assert.match(source,/lab-settings-toggle/);assert.match(source,/id="lab-transport-label"/);
});

test('OpenAPI 入口在站内显示规范，不把 SPA hash 误当页面路由',()=>{
 const docs=read('public/api-docs.js'),spec=read('openapi.mjs');
 assert.match(docs,/id="view-openapi"/);
 assert.match(docs,/section\('openapi','OpenAPI 规范'/);
 assert.match(docs,/#view-openapi'\)\.onclick=.*#docs-openapi'\)\.scrollIntoView/);
 assert.doesNotMatch(docs,/href="\/v1\/openapi\.json"/);
 assert.match(spec,/version:appVersion/);
});

test('实验室历史按需读取详情，对话增量只更新末条消息',()=>{
 const history=read('public/lab-history-client.js'),chat=read('public/playground.js'),media=read('public/media-lab.js'),css=read('public/interface.css');
 assert.match(history,/labHistoryRequest\(tenantId,'\/item\?id='/);assert.match(history,/document\.visibilityState==='visible'/);
 assert.match(history,/lab-history-more/);assert.match(history,/lab-history-dialog/);
 assert.match(chat,/draw\(true\)/);assert.match(chat,/list\.lastElementChild\.outerHTML=messageHtml/);
 assert.match(chat,/if\(m\.status==='生成中'\)return esc\(text\)/);
 assert.match(media,/刷新远程任务状态/);assert.match(css,/\.lab-history-dialog-content\{overflow:auto/);
});

test('API 文档以 Cherry Studio 为最后一节，OpenAPI 原文仅展开时渲染',()=>{
 const source=read('public/api-docs.js');
 assert.ok(source.indexOf("section('admin'")<source.indexOf("section('cherry'"));
 assert.match(source,/\['admin','管理接口'\],\['cherry','Cherry Studio'\]/);
 assert.match(source,/source\.addEventListener\('toggle'/);
 assert.doesNotMatch(source,/root\.querySelector\('#api-openapi-json'\)\.textContent=JSON\.stringify/);
});

test('API 文档提供可复制的快速请求和 Codex / Claude Code 接入边界，Key 页只复制环境变量示例',()=>{
 const docs=read('public/api-docs.js'),keys=read('public/api-keys.js'),subscriptions=read('public/subscriptions.js'),spec=read('openapi.mjs');
 assert.match(docs,/section\('start','3 步完成首次调用'/);
 assert.match(docs,/section\('clients','接入 Codex 与 Claude Code'/);
 assert.match(docs,/wire_api = "responses"/);
 assert.match(docs,/ANTHROPIC_BASE_URL/);
 assert.match(docs,/claudeSettings=JSON\.stringify\(\{env:/);
 assert.match(docs,/data-copy-code="claude-settings"/);
 assert.match(docs,/完整 Key 会以明文保存在文件里/);
 assert.match(docs,/ANTHROPIC_AUTH_TOKEN.*只填写平台签发的原始 API Key/);
 assert.match(docs,/自动路由与 Claude Code 排错/);
 assert.match(docs,/claude-key-check/);
 assert.match(docs,/CLAUDE_CODE_MAX_CONTEXT_TOKENS/);
 assert.match(docs,/data-copy-code="quick-curl"/);
 assert.match(keys,/id="key-curl-example"/);
 assert.match(keys,/Authorization: Bearer \$ROUTER_API_KEY/);
 assert.match(keys,/ANTHROPIC_AUTH_TOKEN.*只填完整原始 Key/);
 assert.doesNotMatch(keys,/exampleCurl=.*result\.token/);
 assert.match(spec,/bearerAuth\.description=.*不要重复写 Bearer 前缀/);
 assert.match(spec,/Claude Code 接入建议固定原生 Anthropic Messages 协议的 Claude 模型/);
 assert.match(subscriptions,/maxApiKeys/);
 assert.match(subscriptions,/尚未生效/);
});

test('侧栏、模块内部间距和静态缓存由统一规则约束',()=>{
 const css=read('public/workspaces.css'),server=read('server.mjs');
 assert.match(css,/--space-sm: 10px; --space-md: 16px/);
 assert.match(css,/sidebar-heading \.brand-mark \{ display: block/);
 assert.match(css,/sidebar-compact \.sidebar \.nav-item \{ padding-left: 16px/);
 assert.match(css,/#content>\.heading,#content>\.dashboard-heading \{ align-items: center; min-height: 52px; margin-bottom: 12px/);
 assert.match(server,/createHash\('sha256'\)\.update\(raw\)/);
});

test('租户浮层不被折叠侧栏裁切，并支持键盘切换与明确提示',()=>{
 const app=read('public/app.js'),css=read('public/interface.css');
 assert.match(app,/document\.body\.append\(popover\)/);
 assert.match(app,/tenant-compact-icon/);
 assert.match(app,/ArrowDown','ArrowUp','Home','End/);
 assert.match(app,/bindNavigationHint\(sidebarToggle/);
 assert.match(css,/#navigation-hint \{ position: fixed/);
 assert.match(css,/\.tenant-popover\[hidden\] \{ display: none; \}/);
});

test('参考价格默认批量导入，单模型映射为可选折叠项',()=>{
 const prices=read('public/prices.js');
 assert.match(prices,/批量导入 OpenRouter 参考价/);
 assert.match(prices,/id="price-mapping"/);
 assert.match(prices,/root\.querySelector\('#price-mapping'\)\.open\?/);
 assert.match(prices,/手动设定或服务商自身价格优先/);
});

test('模型路由展示执行阶段并使用紧凑工作区密度',()=>{
 const routing=read('public/routing.js'),css=read('public/style.css');
 assert.match(routing,/routing-flow/);assert.match(routing,/健康过滤/);assert.match(routing,/routing-guardrails/);
 assert.match(css,/Compact workspace density/);assert.match(css,/\.routing-config-grid/);
});

test('组织审计按成员展示用量且侧栏图标共用中心轴',()=>{
 const app=read('public/app.js'),audit=read('public/audit.js'),css=read('public/style.css');
 assert.match(app,/members:\['members','audit'\]/);assert.match(app,/\['audit','组织审计'\]/);assert.match(audit,/成员用量/);assert.match(audit,/API Key 归属/);
 assert.match(css,/compact state keeps every navigation icon on one vertical axis/);assert.match(css,/\.sidebar \.nav-item,\.sidebar-compact \.sidebar \.nav-item\{min-height:40px;justify-content:flex-start;padding:8px 15px\}/);
});

test('异步成员页加载后仍可通过事件委托切换组织审计',()=>{
 const app=read('public/app.js'),accounts=read('public/accounts.js');
 assert.match(app,/if\(b\.dataset\.pagetab\)\{navigate\(b\.dataset\.pagetab\);return;\}/);
 assert.match(accounts,/renderMembers\(\{profile,esc,toast,prefix=''/);
});

test('服务商卡片使用紧凑密度且侧栏收起前后保持同一行',()=>{
 const css=read('public/style.css');
 assert.match(css,/\.provider-card\{min-height:242px;padding:15px;gap:9px\}/);
 assert.match(css,/\.sidebar \.nav-item,\.sidebar-compact \.sidebar \.nav-item\{min-height:40px;justify-content:flex-start;padding:8px 15px\}/);
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-label\{display:block;visibility:hidden;height:14px/);
});

test('服务商模型选择以勾选为主，单按钮切换全选与取消全选，主题图标居中',()=>{
 const html=read('public/index.html'),app=read('public/app.js'),css=read('public/interface.css');
 assert.match(html,/data-model-bulk="all"/);
 assert.match(app,/querySelectorAll\('\[data-model-bulk="invert"\], \[data-model-bulk="clear"\]'\).*button\.remove\(\)/);
 assert.match(app,/allSelected\?'取消全选当前结果':'全选当前结果'/);
 assert.match(app,/modelSection\.append\(defaultModelField,modelPicker\)/);
 assert.match(app,/manualModels\.append\(manualModelField\)/);
 assert.match(app,/modelSelected=new Set/);assert.match(app,/syncSelectedModels\(\)/);
 assert.match(app,/models\.find\(model=>modelCapabilities\(model\)\.chat\)/);
 assert.match(app,/model-results'\)\.addEventListener\('change'/);
 assert.match(app,/themeBtn\.innerHTML=dark\?themeIcon\.dark:themeIcon\.light/);
 assert.match(css,/#theme-toggle svg \{ width: 19px; height: 19px; display: block; margin: auto; \}/);
});

test('服务商序号不覆盖文案，实验室对话整合状态、媒体不重复展示摘要',()=>{
 const card=read('public/provider-ui.js'),app=read('public/app.js'),chat=read('public/playground.js'),media=read('public/media-lab.js'),compare=read('public/ModelCompare.vue'),compareMount=read('public/model-compare.js'),css=read('public/interface.css');
 assert.match(card,/class="card-top"[\s\S]*class="provider-rank"/);
 assert.match(css,/\.provider-card \.card-top \.provider-rank,[\s\S]*position: static/);
 assert.match(app,/id="lab-page-actions"/);
 assert.match(chat,/root\.querySelector\('#lab-page-actions'\)/);
 assert.match(chat,/\.lab-toolbar'\)\.append\(\$\('\.lab-session-summary'\)\)/);
 assert.doesNotMatch(media,/class="media-session-summary"/);
 assert.match(media,/id="media-status" role="status"/);
 assert.match(media,/function setStatus\(label\)/);
 assert.match(css,/\.lab-main>\.lab-session-summary/);
 assert.match(read('public/workspaces.css'),/\.sidebar-heading \.brand-mark \{ display: block;/);
 assert.match(css,/#global-search, body\.theme-dark #global-search \{ flex: 0 1 112px/);
 assert.match(css,/\.sidebar \.nav-group\+\.nav-group, \.sidebar-compact \.sidebar \.nav-group\+\.nav-group \{ margin-top: 0; padding-top: 0; border: 0; \}/);
 assert.match(compare,/compare-nav-row/);
 assert.match(compare,/>多模型对比<\/button>/);
 assert.match(chat,/onMedia:\(\)=>\{view='chat';navigate\?\.\('media'\)/);
 assert.match(compareMount,/createApp\(ModelCompare,\{choices,token,tenantId,onSwitch,onMedia\}\)/);
});

test('OpenRouter 参考价明确分开采集时间和平台复核期限',()=>{
 const prices=read('public/prices.js');
 assert.match(prices,/并非 OpenRouter 公布的价格有效期/);
 assert.match(prices,/采集于 \$\{price\.observedAt/);
 assert.match(prices,/复核截至/);
 assert.match(prices,/手动维护价格留空有效期表示长期有效/);
});

test('模型目录首次进入就渲染已配置模型，并标识鉴权失败与媒体模型',()=>{
 const source=read('public/model-catalog.js');
 assert.match(source,/list\.onclick=async[\s\S]+\n draw\(\);\n\}/);
 assert.match(source,/providerHealth\(configured,state\.logs\)/);
 assert.match(source,/媒体 \/ 非对话/);
});

test('服务商配置中的清除密钥选项同时覆盖主备密钥并停用路由',()=>{
 const html=read('public/index.html'),app=read('public/app.js');
 assert.match(html,/清除已保存的主、备双密钥（同时停用服务商）/);
 assert.match(app,/b\.clearKey=clearAll;b\.clearMeteredKey=clearAll/);
 assert.match(app,/b\.enabled=clearAll\?false:f\.elements\.enabled\.checked/);
 assert.match(app,/f\.elements\.meteredApiKey\.disabled=clearing/);
});

test('服务商配置弹窗滚动时标题与关闭按钮保持可见',()=>{
 const css=read('public/interface.css'),app=read('public/app.js');
 assert.match(app,/providerBody\.className='provider-form-body'/);
 assert.match(app,/providerActions\.before\(providerBody\)/);
 assert.match(css,/#edit \.provider-form-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
 assert.match(css,/#edit \.dialog-actions \{ position: static; flex: none;/);
});

test('API Key 页的搜索和创建入口在桌面同排、窄屏自适应',()=>{
 const keys=read('public/api-keys.js'),css=read('public/interface.css');
 assert.match(keys,/heading-actions key-heading-actions/);
 assert.match(css,/\.key-heading-actions \{ display: grid; grid-template-columns: minmax\(220px, 320px\) max-content/);
 assert.match(css,/@media \(max-width: 520px\) \{\s*\.key-heading-actions \{ grid-template-columns: 1fr; \}/);
});

test('应用密钥卡片占满列表宽度且宽屏横向展示用量',()=>{
 const css=read('public/interface.css');
 assert.match(css,/#key-list \{ grid-template-columns: minmax\(0, 1fr\); \}/);
 assert.match(css,/grid-template-areas: "identity metrics" "preview metrics" "window actions"/);
 assert.match(css,/#key-list \.key-card \.key-quota \{ grid-area: metrics; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
 assert.match(css,/@media \(max-width: 1150px\) \{\s*#key-list \.key-card/);
});

test('侧栏开关与导航图标共用固定轴且展开收起不横跳',()=>{
 const css=read('public/style.css');
 assert.match(css,/\.sidebar-compact \.sidebar-heading\{justify-content:flex-start;padding-left:8px\}/);
 assert.match(css,/\.sidebar-compact \.sidebar-heading \.brand\{display:none\}/);
 assert.match(css,/\.sidebar-compact \.sidebar-toggle\{margin-left:0\}/);
});

test('侧栏收起只隐藏文字并保留全部导航图标坐标',()=>{
 const css=read('public/style.css');
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-label\{display:block;visibility:hidden;height:14px;line-height:14px;white-space:nowrap;overflow:hidden\}/);
 assert.match(css,/\.sidebar \.nav-item,\.sidebar-compact \.sidebar \.nav-item\{min-height:40px;justify-content:flex-start;padding:8px 15px\}/);
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-group\+\.nav-group\{border-top:0;padding-top:0\}/);
 assert.match(css,/\.sidebar \.workspace-chip,\.sidebar-compact \.workspace-chip\{height:62px;min-height:62px/);
});

test('模型实验室仅在消息标题展示实际命中模型，路由细节按需展开',()=>{
 const source=read('public/playground.js'),stream=read('public/stream-client.js'),css=read('public/workspaces.css');
 assert.match(source,/response\.label=`\$\{response\.route\.provider/);assert.match(source,/lab-route-details/);assert.match(source,/故障转移 · 第/);
 assert.doesNotMatch(source,/id="lab-route-label"/);assert.doesNotMatch(source,/lab-route-result/);
 assert.match(source,/x-router-model/);assert.match(stream,/x-router-provider-name/);assert.match(stream,/m\.route\|\|route/);
 assert.match(css,/\.chat-workspace \.lab-route-details>div/);
});

test('桌面端将页面标题并入顶栏，移动端保留正文标题',()=>{
 const html=read('public/index.html'),app=read('public/app.js'),css=read('public/workspaces.css');
 assert.match(html,/class="topbar-location"/);assert.match(html,/<h1 id="breadcrumb">/);
 assert.match(app,/#page-parent/);assert.match(app,/if\(tab==='overview'\)\$\('#breadcrumb'\)/);
 assert.match(css,/#content>\.heading h1,#content>\.dashboard-heading h1,#content\.lab-page>\.heading \.eyebrow \{ display: none; \}/);
 assert.match(css,/@media \(max-width: 720px\) \{[\s\S]*?\.topbar-location \{ display: none; \}/);
});

test('全站页边距和标题统一，二级标签置于标题后，输入框聚焦不出现双层描边',()=>{
 const css=read('public/workspaces.css'),app=read('public/app.js'),accounts=read('public/accounts.js');
 assert.match(css,/#content \{ max-width: 1800px; padding: 18px var\(--page-gutter\) 24px; \}/);
 assert.match(css,/#content\.chat-workspace \.lab-composer textarea:focus-visible \{ outline: none; box-shadow: none;/);
 assert.match(css,/:root \{ --page-gutter: 12px; \}/);
 assert.match(app,/root\.querySelector\('\.heading'\)\?\.insertAdjacentHTML\('afterend',analyticsTabs\)/);
 assert.match(app,/root\.querySelector\('\.heading'\)\?\.insertAdjacentHTML\('afterend',membersTabs\)/);
 assert.match(accounts,/<\/div>\$\{prefix\}/);
});

test('API Key 编辑弹窗固定标题和操作栏，仅表单正文滚动',()=>{
 const source=read('public/api-keys.js'),css=read('public/interface.css');
 assert.match(source,/class="key-editor-body"/);
 assert.match(source,/class="key-editor-actions"/);
 assert.match(css,/#key-editor \.modal-title \{ flex: none;/);
 assert.match(css,/#key-editor \.key-editor-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
 assert.match(css,/#key-editor \.key-editor-actions \{ display: flex; flex: none;/);
});
