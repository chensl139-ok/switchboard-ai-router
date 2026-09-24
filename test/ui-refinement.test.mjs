import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('媒体实验室使用通用视频名称并自动轮询异步任务',()=>{
 const source=read('public/media-lab.js');
 assert.match(source,/video:\{label:'视频生成'/);assert.doesNotMatch(source,/视频生成（硅基流动）/);
 assert.match(source,/setInterval\(poll,5000\)/);assert.match(source,/clearInterval\(pollTimer\)/);
 assert.match(source,/videoCompatible/);assert.match(source,/MEDIA STUDIO/);
});

test('侧栏收起按钮可发现、可持久化并适配中等宽度',()=>{
 const html=read('public/index.html'),app=read('public/app.js'),css=read('public/style.css');
 assert.match(html,/aria-controls="workspace-sidebar"/);assert.match(html,/data-tooltip="收起侧边栏"/);
 assert.match(app,/localStorage\.setItem\('sidebar-compact'/);assert.match(app,/max-width:1100px/);
 assert.match(css,/\.sidebar-toggle::after/);assert.match(css,/left:calc\(var\(--sidebar-width\) - 15px\)/);
});

test('模型实验室突出直接选模型、运行摘要和生成中草稿',()=>{
 const source=read('public/playground.js'),composer=read('public/lab-composer.js');
 assert.match(source,/lab-session-summary/);assert.match(source,/lab-model-quick/);
 assert.match(source,/协议自动适配/);assert.match(source,/lab-response-meta/);
 assert.match(source,/id="lab-draft-state"/);assert.match(composer,/draftState\.hidden=!value/);
});

test('模型路由展示执行阶段并使用紧凑工作区密度',()=>{
 const routing=read('public/routing.js'),css=read('public/style.css');
 assert.match(routing,/routing-flow/);assert.match(routing,/健康过滤/);assert.match(routing,/routing-guardrails/);
 assert.match(css,/Compact workspace density/);assert.match(css,/\.routing-config-grid/);
});

test('组织审计按成员展示用量且侧栏图标共用中心轴',()=>{
 const app=read('public/app.js'),audit=read('public/audit.js'),css=read('public/style.css');
 assert.match(app,/data-tab="audit"/);assert.match(audit,/成员用量/);assert.match(audit,/API Key 归属/);
 assert.match(css,/Stable sidebar icon axis/);assert.match(css,/\.sidebar \.nav-item\{padding-left:15px/);
});

test('服务商卡片使用紧凑密度且侧栏收起前后保持同一行',()=>{
 const css=read('public/style.css');
 assert.match(css,/Compact provider cards and stable collapse row/);
 assert.match(css,/\.provider-card\{min-height:242px;padding:15px;gap:9px\}/);
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-item\{min-height:40px;justify-content:flex-start;padding:8px 12px 8px 19px\}/);
 assert.match(css,/\.sidebar-toggle\{top:50%;transform:translateY\(-50%\)\}/);
});

test('侧栏开关与导航图标共用固定轴且展开收起不横跳',()=>{
 const css=read('public/style.css');
 assert.match(css,/Collapse control shares the navigation icon axis in both states/);
 assert.match(css,/\.sidebar-toggle\{position:fixed;left:16px;right:auto;top:auto;bottom:16px/);
 assert.match(css,/\.sidebar-compact \.sidebar-toggle\{left:16px;width:47px;padding-left:15px\}/);
});

test('侧栏收起只隐藏文字并保留全部导航图标坐标',()=>{
 const css=read('public/style.css');
 assert.match(css,/Preserve every navigation icon coordinate while collapsing/);
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-label\{display:block;visibility:hidden;height:14px;line-height:14px;white-space:nowrap;overflow:hidden\}/);
 assert.match(css,/\.sidebar \.nav-item,\.sidebar-compact \.sidebar \.nav-item\{min-height:40px;justify-content:flex-start;padding:8px 15px\}/);
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-group\+\.nav-group\{border-top:0;padding-top:0\}/);
 assert.match(css,/\.sidebar \.brand,\.sidebar-compact \.brand\{height:43px\}/);
});

test('模型实验室显示自动路由实际命中的服务商、模型与故障转移',()=>{
 const source=read('public/playground.js'),stream=read('public/stream-client.js'),css=read('public/style.css');
 assert.match(source,/实际路由/);assert.match(source,/lab-route-result/);assert.match(source,/故障转移 · 第/);
 assert.match(source,/x-router-model/);assert.match(stream,/x-router-provider-name/);assert.match(stream,/m\.route\|\|route/);
 assert.match(css,/Model lab route visibility/);assert.match(css,/\.lab-session-summary\{grid-template-columns:repeat\(4/);
});
