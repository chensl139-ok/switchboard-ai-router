import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,statSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {startDesktop,importDeployment} from '../desktop/runtime.mjs';

test('桌面首次启动生成私有配置、只监听本机、初始化不暴露持久令牌并可重新启动',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-desktop-test-'));
 let runtime;
 try{
  runtime=await startDesktop({supportDir:dir,port:0,bootstrapToken:'desktop-session-bootstrap-12345678'});
  assert.equal(runtime.server.address().address,'127.0.0.1');assert.equal(runtime.needsSetup,true);
  const env=readFileSync(path.join(runtime.profileDir,'.env'),'utf8'),admin=env.match(/^ADMIN_TOKEN=(.+)$/m)[1];
  assert.equal(statSync(path.join(runtime.profileDir,'.env')).mode&0o777,0o600);
  const status=await (await fetch(runtime.url+'/api/account/status')).text();assert(!status.includes(admin));assert(!status.includes('desktop-session-bootstrap'));
  const setup=token=>fetch(runtime.url+'/api/account/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bootstrapToken:token,name:'Desktop owner',email:'desktop@example.invalid',password:'desktop-password-12345'})});
  assert.equal((await setup(admin)).status,403);
  assert.equal((await setup('desktop-session-bootstrap-12345678')).status,200);
  await assert.rejects(startDesktop({supportDir:dir,port:0}),/已在运行/);
  await runtime.close();runtime=null;assert(!existsSync(path.join(dir,'desktop.lock')));
  runtime=await startDesktop({supportDir:dir,port:0});assert.equal(runtime.needsSetup,false);
  assert.equal(readFileSync(path.join(runtime.profileDir,'.env'),'utf8'),env);
 }finally{await runtime?.close();rmSync(dir,{recursive:true,force:true});}
});

test('桌面端口占用时分配可用端口，不接管其他服务',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-desktop-port-'));
 const occupied=http.createServer((req,res)=>res.end('other'));
 await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));let runtime;
 try{
  runtime=await startDesktop({supportDir:dir,port:occupied.address().port});
  assert.notEqual(runtime.server.address().port,occupied.address().port);
  assert.equal(await (await fetch('http://127.0.0.1:'+occupied.address().port)).text(),'other');
 }finally{await runtime?.close();await new Promise(resolve=>occupied.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('导入完整独立副本，在线 SQLite 使用备份，清除旧会话并保持原数据和前一个配置',async()=>{
 const base=mkdtempSync(path.join(tmpdir(),'switchboard-desktop-import-')),source=path.join(base,'source'),support=path.join(base,'desktop');
 mkdirSync(path.join(source,'data'),{recursive:true});mkdirSync(support);
 const env='ADMIN_TOKEN='+ 'a'.repeat(64)+'\nGATEWAY_TOKEN='+ 'b'.repeat(64)+'\nCOOKIE_SECURE=true\n';
 writeFileSync(path.join(source,'.env'),env);const accounts={users:[],tenants:[{id:'default',name:'Imported',createdAt:new Date().toISOString()}],members:[],sessions:[{hash:'old-session'}],invites:[],passwordResets:[],audit:[]};
 writeFileSync(path.join(source,'data','accounts.json'),JSON.stringify(accounts));
 const db=new DatabaseSync(path.join(source,'data','fixture.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE fixture(value); INSERT INTO fixture VALUES(42);');
 let runtime;
 try{
  runtime=await startDesktop({supportDir:support,port:0});const old=runtime.profileDir;await runtime.close();runtime=null;
  const imported=await importDeployment(source,support);
  assert.equal(readFileSync(path.join(imported.dir,'.env'),'utf8'),env);
  assert.deepEqual(JSON.parse(readFileSync(path.join(imported.dir,'data','accounts.json'),'utf8')).sessions,[]);
  assert.equal(JSON.parse(readFileSync(path.join(source,'data','accounts.json'),'utf8')).sessions.length,1);
  const copy=new DatabaseSync(path.join(imported.dir,'data','fixture.sqlite'));assert.equal(copy.prepare('SELECT value FROM fixture').get().value,42);copy.close();
  runtime=await startDesktop({supportDir:support,port:0,importFrom:source});assert.notEqual(runtime.profileDir,old);assert(existsSync(old));
  assert.equal(process.env.COOKIE_SECURE,'false');await runtime.close();runtime=null;
  const marker=readFileSync(path.join(support,'active-profile.json'),'utf8');
  await assert.rejects(startDesktop({supportDir:support,port:0,importFrom:base}),/请选择/);assert.equal(readFileSync(path.join(support,'active-profile.json'),'utf8'),marker);
  symlinkSync(path.join(source,'.env'),path.join(source,'data','unsafe-link'));
  await assert.rejects(importDeployment(source,support),/符号链接/);
 }finally{await runtime?.close();db.close();rmSync(base,{recursive:true,force:true});}
});
