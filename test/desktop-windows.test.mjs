import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultSupportDir} from '../desktop/runtime.mjs';

test('桌面数据使用各平台的用户数据目录，不放入安装目录',()=>{
 assert.equal(defaultSupportDir('win32',{LOCALAPPDATA:'C:\\Users\\Alice\\AppData\\Local'},'C:\\Users\\Alice'),'C:\\Users\\Alice\\AppData\\Local\\Switchboard');
 assert.equal(defaultSupportDir('win32',{},'C:\\Users\\Alice'),'C:\\Users\\Alice\\AppData\\Local\\Switchboard');
 assert.equal(defaultSupportDir('darwin',{},'/Users/Alice'),path.join('/Users/Alice','Library','Application Support','Switchboard'));
 assert.equal(defaultSupportDir('linux',{XDG_DATA_HOME:'/custom/data'},'/home/alice'),path.join('/custom/data','Switchboard'));
});

async function childRuntime(run){
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-win-control-'));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../desktop/runtime.mjs',import.meta.url))],{
  env:{...process.env,SWITCHBOARD_DESKTOP_SUPPORT_DIR:dir,SWITCHBOARD_DESKTOP_PORT:'0',SWITCHBOARD_DESKTOP_CONTROL:'stdio'},stdio:['pipe','pipe','pipe']
 });
 const exit=once(child,'exit');let buffer='';child.stderr.resume();
 const ready=new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('exit',()=>reject(Error('Desktop exited before ready')));
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
   buffer+=chunk;let index;
   while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const event=JSON.parse(line);if(event.event==='desktop-ready')resolve(event);}catch{}}
  });
 });
 try{await run({child,exit,ready:await ready,dir});}
 finally{
  if(child.exitCode===null&&child.signalCode===null){child.stdin.end('{"command":"shutdown"}\n');await exit;}
  rmSync(dir,{recursive:true,force:true});
 }
}

test('Windows 父进程通过私有 stdin 请求正常退出并释放数据锁',{timeout:15000},async()=>{
 await childRuntime(async({child,exit,ready,dir})=>{
  assert.equal((await fetch(ready.url+'/readyz')).status,200);
  assert.equal(existsSync(path.join(dir,'desktop.lock')),true);
  child.stdin.write('{"command":"not-a-command"}\n');
  assert.equal((await fetch(ready.url+'/readyz')).status,200);
  child.stdin.write('{"command":"shutdown"}\n');
  const [code,signal]=await exit;assert.equal(code,0);assert.equal(signal,null);
  assert.equal(existsSync(path.join(dir,'desktop.lock')),false);
  assert.equal(existsSync(path.join(dir,'profiles','local','.env')),true);
 });
});

test('父进程关闭控制管道时子服务退出但保留用户数据',{timeout:15000},async()=>{
 await childRuntime(async({child,exit,dir})=>{
  child.stdin.end();const [code]=await exit;assert.equal(code,0);
  assert.equal(existsSync(path.join(dir,'desktop.lock')),false);
  assert.equal(existsSync(path.join(dir,'active-profile.json')),true);
 });
});
