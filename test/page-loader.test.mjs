import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPageLoader} from '../public/page-loader.js';

test('页面模块按需加载，同一模块并发只加载一次，已加载模块复用',async()=>{
 let calls=0,finish;
 const module={render:()=>{}},loader=createPageLoader({lab:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 assert.equal(calls,0);assert.equal(loader.peek('lab'),undefined);
 const first=loader.load('lab'),second=loader.load('lab');assert.equal(first,second);
 await Promise.resolve();assert.equal(calls,1);finish(module);
 assert.equal(await first,module);assert.equal(loader.peek('lab'),module);
 assert.equal(await loader.load('lab'),module);assert.equal(calls,1);
});

test('模块下载失败不锁死页面，可重试；未知模块不会触发导入',async()=>{
 let calls=0;
 const module={render:()=>{}},loader=createPageLoader({logs:()=>{if(++calls===1)throw Error('network');return module;}});
 await assert.rejects(loader.load('logs'),/network/);assert.equal(loader.peek('logs'),undefined);
 assert.equal(await loader.load('logs'),module);assert.equal(calls,2);
 await assert.rejects(loader.load('constructor'),/未知页面/);assert.equal(calls,2);
});

test('非首页功能均为动态导入，加载完成后检查当前页面、账户与租户上下文',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 for(const name of ['playground','media-lab','analytics','prices','api-docs','api-keys','audit','subscriptions','connect','routing','model-catalog']){
  assert(source.includes(`import('./${name}.js')`));
  assert(!new RegExp(`^import .* from './${name}\\.js';`,'m').test(source));
 }
 assert.match(source,/root\.isConnected&&tab===requestedTab&&profile===requestedProfile/);
 assert.match(source,/await pageLoader\.load\(lazyTab\)/);
 assert.match(source,/if\(!isCurrent\(\)\)return;/);
 assert.match(source,/pageLoader\.peek\('playground'\)\?\.resetPlayground\(\)/);
 assert.match(source,/pageLoader\.peek\('media'\)\?\.resetMediaLab\(\)/);
 assert.match(source,/id="retry-page-load"/);
});

test('桌面轻量化仅裁剪打包的运行时副本，重新签名后验证依赖',()=>{
 const source=readFileSync(new URL('../scripts/build-desktop.mjs',import.meta.url),'utf8');
 assert.match(source,/const bundledNode=path\.join\(resources,'runtime','node'\)/);
 assert.match(source,/run\('strip',\['-S','-x',bundledNode\]\)/);
 assert.match(source,/run\('codesign',\['--force','--sign','-',bundledNode\]\)/);
 assert.match(source,/cwd:server/);
 assert.match(source,/CREATE TABLE check_runtime/);
});
