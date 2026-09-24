import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../accounts.mjs';
import {UsageStore} from '../usage-store.mjs';

test('审计先按租户隔离，再组合筛选和分页；可检索前 200 条之外的历史操作',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-audit-'));
 const now=Date.now(),account=new Accounts(dir,'x'.repeat(32),{now:()=>now});
 try{
  account.state.users=[{id:'a',name:'管理员甲',email:'alpha@example.com'},{id:'b',name:'成员乙',email:'beta@example.com'},{id:'c',name:'私有租户用户',email:'private@example.com'}];
  for(let i=0;i<240;i++)account.event('default',i%2?'a':'b','/api/provider',`服务商 ${i}`);
  account.event('other','c','/api/provider','不可见对象');
  account.event('default','a','member.role','b');
  const caller={role:'owner',tenantId:'default'};
  assert.equal(account.auditPage(caller).total,241);
  assert.equal(account.auditPage(caller,{q:'服务商 0'}).items[0].target,'服务商 0');
  assert.equal(account.auditPage(caller,{q:'ALPHA@EXAMPLE.COM',category:'provider',actor:'a'}).total,120);
  const roles=account.auditPage(caller,{category:'member',q:'成员乙'});assert.equal(roles.total,1);assert.equal(roles.items[0].targetName,'成员乙');
  const first=account.auditPage(caller,{limit:20}),second=account.auditPage(caller,{limit:20,page:2});
  assert.equal(first.items.length,20);assert.equal(second.items.length,20);assert.ok(!first.items.some(a=>second.items.some(b=>a.id===b.id)));
  assert.equal(account.auditPage(caller,{limit:20,page:999}).page,13);
  assert.ok(!first.actors.some(actor=>actor.id==='c'));assert.equal(account.auditPage(caller,{q:'不可见'}).total,0);
  account.state.audit.find(item=>item.target==='服务商 0').time=new Date(now-40*86400000).toISOString();
  assert.equal(account.auditPage(caller,{days:30,q:'服务商 0'}).total,0);
  assert.equal(account.auditPage(caller,{days:90,q:'服务商 0'}).total,1);
  assert.throws(()=>account.auditPage({role:'member',tenantId:'default'}),{status:403});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('请求日志支持时间、模型、服务商、状态、Key 组合过滤和精确请求追踪',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-log-')),store=new UsageStore(dir);
 try{
  const now=Date.now();
  const rows=[
   {id:'1',requestId:'trace-123',providerId:'a',provider:'Alpha',model:'gpt-4o',status:502,reason:'上游超时',apiKeyId:'key-a'},
   {id:'2',requestId:'trace-123',providerId:'b',provider:'Beta',model:'GLM-5',status:200,reason:'故障转移',apiKeyId:'key-a'},
   {id:'3',requestId:'trace-123-other',providerId:'a',provider:'Alpha',model:'GLM-5',status:200,apiKeyId:'key-b'},
   {id:'4',requestId:'old',providerId:'a',provider:'Alpha',model:'gpt-4o',status:200,time:new Date(now-15*86400000).toISOString()}
  ];
  rows.forEach(row=>store.record({time:new Date(now).toISOString(),...row}));
  assert.equal(store.logs({days:7}).total,3);
  assert.equal(store.logs({q:'ALPHA',days:7,status:'error',apiKeyId:'key-a'}).total,1);
  assert.equal(store.logs({q:'故障转移',provider:'b'}).total,1);
  assert.equal(store.logs({q:'trace-123'}).total,3);
  assert.equal(store.logs({requestId:'trace-123'}).total,2);
  assert.equal(store.logs({q:'%'}).total,0);
  assert.equal(store.logs({requestId:'trace-123',status:'success'}).items[0].id,'2');
  const page=store.logs({requestId:'trace-123',limit:1,page:50});assert.equal(page.page,2);assert.equal(page.items.length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
