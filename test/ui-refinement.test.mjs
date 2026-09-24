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
 assert.match(css,/\.sidebar-compact \.sidebar \.nav-item\{min-height:40px;padding-top:8px;padding-bottom:8px\}/);
 assert.match(css,/\.sidebar-toggle\{top:50%;transform:translateY\(-50%\)\}/);
});
