import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('媒体实验室使用通用视频名称并自动轮询异步任务',()=>{
 const source=read('public/media-lab.js');
 assert.match(source,/video:\{label:'视频生成'/);assert.doesNotMatch(source,/视频生成（硅基流动）/);
 assert.match(source,/setInterval\(poll,5000\)/);assert.match(source,/clearInterval\(pollTimer\)/);
 assert.match(source,/videoCompatible/);assert.match(source,/MEDIA STUDIO/);
 assert.match(source,/kind==='video'\?supported\.find\(item=>\/T2V\/i\.test\(item\.model\)\)/);
 assert.match(source,/imageRequired=\$\('#media-kind'\)\.value==='video'&&\/I2V\/i/);
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
 assert.match(source,/lab-settings-toggle/);assert.match(source,/本次路由选择中/);
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
 assert.match(chat,/\.lab-toolbar'\)\.after\(\$\('\.lab-session-summary'\)\)/);
 assert.doesNotMatch(media,/class="media-session-summary"/);
 assert.match(media,/id="media-status" role="status"/);
 assert.match(media,/function setStatus\(label\)/);
 assert.match(css,/\.lab-main>\.lab-session-summary/);
 assert.match(css,/body:not\(\.sidebar-compact\) \.sidebar \.sidebar-heading \.brand-mark \{ display: none; \}/);
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

test('模型实验室显示自动路由实际命中的服务商、模型与故障转移',()=>{
 const source=read('public/playground.js'),stream=read('public/stream-client.js'),css=read('public/style.css');
 assert.match(source,/实际路由/);assert.match(source,/lab-route-result/);assert.match(source,/故障转移 · 第/);
 assert.match(source,/x-router-model/);assert.match(stream,/x-router-provider-name/);assert.match(stream,/m\.route\|\|route/);
 assert.match(css,/Model lab route visibility/);assert.match(css,/\.lab-session-summary\{grid-template-columns:repeat\(4/);
});
