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
