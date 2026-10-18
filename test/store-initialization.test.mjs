import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {UsageStore} from '../usage-store.mjs';
import {ApiKeyStore} from '../key-store.mjs';

const admin='a'.repeat(32),gateway='g'.repeat(32);

test('服务初始化失败立即关闭已经打开的数据库，不依赖垃圾回收',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-init-cleanup-'));
 const original=DatabaseSync.prototype.close;let closed=0,app;
 t.mock.method(DatabaseSync.prototype,'close',function(...args){closed++;return original.apply(this,args);});
 try{
  writeFileSync(path.join(dir,'state.json'),JSON.stringify({providers:[{secret:'encrypted'}]}));
  assert.throws(()=>createApp({dir,admin,gateway}),/master.key 丢失/);
  assert.equal(closed,1,'主密钥验证失败后已打开的 API Key 数据库必须关闭');
  writeFileSync(path.join(dir,'master.key'),Buffer.alloc(32));
  writeFileSync(path.join(dir,'state.json'),'{invalid json');
  assert.throws(()=>createApp({dir,admin,gateway}),SyntaxError);
  assert.equal(closed,3,'配置解析失败后两个数据库都必须关闭');
  writeFileSync(path.join(dir,'state.json'),JSON.stringify({providers:[],active:'',strategy:'fallback'}));
  app=createApp({dir,admin,gateway});app.checkReady();
 }finally{app?.closeStore();rmSync(dir,{recursive:true,force:true});}
});

for(const [name,Store] of [['usage.sqlite',UsageStore],['api-key-usage.sqlite',ApiKeyStore]]){
 test(`${name} 初始化损坏库时释放句柄，保留原文件并允许恢复`,t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'switchboard-corrupt-store-')),file=path.join(dir,name),corrupt=Buffer.alloc(4096,1);
  const original=DatabaseSync.prototype.close;let closed=0,store;
  t.mock.method(DatabaseSync.prototype,'close',function(...args){closed++;return original.apply(this,args);});
  try{
   writeFileSync(file,corrupt);
   for(let attempt=0;attempt<2;attempt++)assert.throws(()=>new Store(dir),/not a database/);
   assert.equal(closed,2,'每次失败都关闭 SQLite，不依赖平台是否允许删除已打开文件');
   assert.deepEqual(readFileSync(file),corrupt);
   renameSync(file,file+'.corrupt');
   store=new Store(dir);
   assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
 });
}
