import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readBuildInfo} from '../build-info.mjs';
import {runtimeInfoMarkup,desktopSubscriptionNotice} from '../public/runtime-info.js';
import {createPlatform} from '../platform.mjs';
import {startDesktop} from '../desktop/runtime.mjs';

test('构建指纹只比较共享程序和发布资源，不依赖原生外壳、数据或构建时间',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-build-info-'));
 try{
  const web=path.join(dir,'web'),desktop=path.join(dir,'desktop');
  mkdirSync(path.join(web,'public','build'),{recursive:true});
  writeFileSync(path.join(web,'package.json'),JSON.stringify({version:'2.2.0',dependencies:{ws:'1'}}));
  writeFileSync(path.join(web,'platform.mjs'),'core');
  writeFileSync(path.join(web,'public','build','app.js'),'compiled');
  writeFileSync(path.join(web,'public','app.js'),'source');
  writeFileSync(path.join(web,'public','interface.css'),'css');
  cpSync(web,desktop,{recursive:true});
  rmSync(path.join(desktop,'public','app.js'));
  mkdirSync(path.join(desktop,'desktop'));
  writeFileSync(path.join(desktop,'desktop','runtime.mjs'),'native');
  writeFileSync(path.join(desktop,'.env'),'SECRET=never-read');
  mkdirSync(path.join(desktop,'data'));writeFileSync(path.join(desktop,'data','accounts.json'),'private');
  assert.deepEqual(readBuildInfo(web),readBuildInfo(desktop));
  const original=readBuildInfo(desktop);
  writeFileSync(path.join(desktop,'platform.mjs'),'core-fix');
  assert.notEqual(original.fingerprint,readBuildInfo(desktop).fingerprint);
  writeFileSync(path.join(desktop,'platform.mjs'),'core');
  writeFileSync(path.join(desktop,'public','build','app.js'),'new-ui');
  assert.notEqual(original.fingerprint,readBuildInfo(desktop).fingerprint);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('网页和桌面返回相同构建身份，订阅能力仍按运行方式隔离',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-build-modes-'));
 const admin='build-test-admin-12345678901234567890',gateway='build-test-gateway-12345678901234567890';
 let server,desktop;
 try{
  server=createPlatform({dir:path.join(dir,'web'),admin,gateway,oauthConfig:[]});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  desktop=await startDesktop({supportDir:path.join(dir,'desktop'),port:0,bootstrapToken:admin});
  const urls=['http://127.0.0.1:'+server.address().port,desktop.url];
  const profiles=[];
  for(const url of urls){
   const status=await (await fetch(url+'/api/account/status')).json();
   assert.deepEqual(status.build,readBuildInfo());
   assert.equal((await fetch(url+'/api/account/me')).status,401);
   const setup=await fetch(url+'/api/account/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bootstrapToken:admin,name:'Build test',email:'build@example.invalid',password:'build-password-123456'})});
   assert.equal(setup.status,200);
   const cookie=setup.headers.get('set-cookie').split(';')[0];
   profiles.push(await (await fetch(url+'/api/account/me',{headers:{cookie}})).json());
  }
  assert.deepEqual(profiles[0].build,profiles[1].build);
  assert.equal(profiles[0].chatgptPlan,false);assert.equal(profiles[1].chatgptPlan,true);
 }finally{
  await desktop?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});

test('两端使用一致版本说明，运行能力差异明确标注',()=>{
 const esc=s=>String(s).replaceAll('<','&lt;'),build={version:'2.2.0',fingerprint:'1234abcd'};
 for(const chatgptPlan of [false,true]){
  const html=runtimeInfoMarkup({build,chatgptPlan},esc);
  assert.match(html,/1234abcd/);assert.match(html,/v2.2.0/);
  assert.match(html,/不自动同步/);
  assert(html.includes(chatgptPlan?'桌面 App':'网页部署'));
 }
 assert.equal(runtimeInfoMarkup({},esc),'');
 assert.match(desktopSubscriptionNotice(),/不会读取或共享/);
 assert(!runtimeInfoMarkup({build:{version:'<script>',fingerprint:'x'}},esc).includes('<script>'));
});
