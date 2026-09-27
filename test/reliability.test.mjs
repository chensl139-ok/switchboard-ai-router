import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {createPlatform} from '../platform.mjs';
import {ApiKeyStore} from '../key-store.mjs';
import {Accounts} from '../accounts.mjs';
import {UsageStore} from '../usage-store.mjs';
import {selectRoutes} from '../routing.mjs';

const admin='a'.repeat(32),gateway='g'.repeat(32);

test('配置写盘失败时返回错误并恢复内存中的模型选择',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-persist-'));
 const app=createApp({dir,admin,gateway});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data)=>fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${admin}`,'content-type':'application/json'},body:JSON.stringify(data)});
 try{
  const provider={id:'test',name:'Test',baseUrl:'https://test.example/v1',protocol:'openai',model:'one',models:['one','two'],enabled:true,priority:1,apiKey:'secret'};
  assert.equal((await post('/api/provider',provider)).status,200);
  mkdirSync(path.join(dir,'state.json.tmp'));
  const response=await post('/api/provider/switch-model',{id:'test',model:'two'});
  assert.equal(response.status,500);
  const current=await (await fetch(base+'/api/state',{headers:{authorization:`Bearer ${admin}`}})).json();
  assert.equal(current.providers.find(item=>item.id==='test').model,'one');
  assert.equal(JSON.parse(readFileSync(path.join(dir,'state.json'),'utf8')).providers.find(item=>item.id==='test').model,'one');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('API Key 调用计数单独持久化，调用时不重写整份密钥配置',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-key-counter-'));let store;
 try{
  store=new ApiKeyStore(dir);const {key}=store.create({name:'app',totalLimit:2});
  const before=readFileSync(path.join(dir,'api-keys.json'),'utf8');
  store.admit(key.id);store.complete(key.id,true,7);
  assert.equal(readFileSync(path.join(dir,'api-keys.json'),'utf8'),before);
  const restored=new ApiKeyStore(dir);assert.equal(restored.list().keys[0].requests,1);assert.equal(restored.list().keys[0].knownTokens,7);restored.close();
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('一个租户的高频操作不会挤掉其他租户的审计',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-audit-retention-'));
 try{const accounts=new Accounts(dir,admin);accounts.event('other','user','member.join','first');for(let i=0;i<2001;i++)accounts.event('default','user','/api/provider',String(i));assert.equal(accounts.state.audit.filter(item=>item.tenantId==='default').length,2000);assert.equal(accounts.state.audit.filter(item=>item.tenantId==='other').length,1);}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('请求写入不逐次清理历史，重新打开数据库时再执行清理',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-prune-'));let store;
 try{
  store=new UsageStore(dir);store.record({id:'old',time:new Date(Date.now()-100*86400000).toISOString(),providerId:'a',provider:'A',model:'m',status:200});
  store.record({id:'new',time:new Date().toISOString(),providerId:'a',provider:'A',model:'m',status:200});
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM calls').get().n,2);
  store.close();store=new UsageStore(dir);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM calls').get().n,1);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('延迟优先按熔断后真正可用的候选模型评分',()=>{
 const now=Date.now(),time=new Date(now).toISOString();
 const state={providers:[
  {id:'a',name:'A',enabled:true,secret:'x',model:'broken',models:['broken','fast'],priority:1},
  {id:'b',name:'B',enabled:true,secret:'y',model:'slow',models:['slow'],priority:2}
 ],active:'a',strategy:'latency',routing:{maxAttempts:3},logs:[
  ...Array.from({length:3},()=>({providerId:'a',model:'broken',status:503,time})),
  ...Array.from({length:3},()=>({providerId:'a',model:'fast',status:200,latency:10,time})),
  ...Array.from({length:3},()=>({providerId:'b',model:'slow',status:200,latency:100,time}))
 ]};
 const routes=selectRoutes(state,{model:'auto',messages:[{role:'user',content:'hello'}]},{now});
 assert.deepEqual([routes[0].id,routes[0].model],['a','fast']);
});

test('租户数据目录删除失败时显式报告待清理且不留在可用租户目录',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-tenant-cleanup-'));
 const app=createPlatform({dir,admin,gateway,removeTenantData:()=>{throw Error('simulated cleanup failure');}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.address().port}`;
 let cookie='';
 const post=async(url,data)=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
 try{
  const setup=await post('/api/account/setup',{name:'Owner',email:'owner@example.com',password:'long-test-password-123',bootstrapToken:admin});
  cookie=setup.headers.get('set-cookie').split(';')[0];
  const tenant=await (await post('/api/account/tenants',{name:'Cleanup Test'})).json();
  await post('/api/account/switch',{tenantId:tenant.id});
  await fetch(base+'/api/state',{headers:{cookie}});
  await post('/api/account/switch',{tenantId:'default'});
  const response=await post('/api/account/tenants/delete',{tenantId:tenant.id});
  assert.equal(response.status,202);assert.equal((await response.json()).cleanupPending,true);
  assert.equal(readdirSync(path.join(dir,'tenants')).includes(tenant.id),false);
  assert.equal(readdirSync(path.join(dir,'tenant-deletion-pending')).length,1);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
