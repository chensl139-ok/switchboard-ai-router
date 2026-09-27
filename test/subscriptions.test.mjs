import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Subscriptions} from '../subscriptions.mjs';
import {createPlatform} from '../platform.mjs';

test('BYOK 订阅默认不启用收款或付费墙；草案与手动分配持久化、到期可见',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-subscriptions-'));let now=Date.UTC(2026,8,27);
 try{
  const store=new Subscriptions(dir,{now:()=>now});
  assert.equal(store.view('default').status,'included');assert.equal(store.view('default').paymentEnabled,false);
  assert.equal(store.view('default').plan.id,'byok');
  assert.equal(store.view('default').entitlementsEnforced,false);
  assert.deepEqual(store.view('default').plan.entitlements,{maxApiKeys:null,maxMembers:null,labChat:true,labMedia:true,labCompare:true});
  assert.throws(()=>store.upsertPlan({id:'bad',name:'Bad',monthlyCents:-1},'root'));
  assert.throws(()=>store.upsertPlan({id:'bad-flag',name:'Bad',entitlements:{labChat:'yes'}},'root'),/模型实验室权限/);
  assert.throws(()=>store.upsertPlan({id:'bad-count',name:'Bad',entitlements:{maxApiKeys:0}},'root'),/数量限制/);
  assert.throws(()=>store.upsertPlan({id:'bad-compare',name:'Bad',entitlements:{labChat:false,labCompare:true}},'root'),/模型对比/);
  const plan=store.upsertPlan({id:'team',name:'团队版',description:'套餐草案',monthlyCents:9900,yearlyCents:null,entitlements:{maxApiKeys:20,maxMembers:30,labChat:true,labMedia:true,labCompare:true}},'root');
  assert.equal(plan.monthlyCents,9900);
  assert.equal(plan.entitlements.maxApiKeys,20);
  const end=new Date(now+86400000).toISOString();
  assert.throws(()=>store.assign({tenantId:'other',planId:'team'},'root',id=>id==='default'),{status:404});
  assert.equal(store.assign({tenantId:'default',planId:'team',endsAt:end},'root',id=>id==='default').status,'active');
  const restored=new Subscriptions(dir,{now:()=>now});assert.equal(restored.view('default').plan.id,'team');
  assert.equal(restored.view('default').plan.entitlements.maxMembers,30);
  now+=86400000;assert.equal(restored.view('default').status,'expired');
  restored.deleteTenant('default');assert.equal(restored.view('default').status,'included');
  assert.equal(restored.state.events.some(item=>item.tenantId==='default'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('订阅接口按租户隔离；仅平台主账号可改草案与分配，不影响模型调用',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-subscription-api-'));
 const admin='a'.repeat(32),gateway='g'.repeat(32),password='a-strong-password-123';
 const app=createPlatform({dir,admin,gateway,fetcher:async()=>Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,cookie='')=>{const response=await fetch(base+'/api/account/'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const setup=await request('setup',{name:'Owner',email:'owner@example.com',password,bootstrapToken:admin});const root=setup.cookie;
  const company=(await request('tenants',{name:'Company'},root)).body;
  assert.equal((await request('subscription',null,root)).body.plan.id,'byok');
  assert.equal((await request('subscription/plan',{id:'team',name:'团队版',monthlyCents:9900},root)).status,200);
  assert.equal((await request('subscription/assign',{tenantId:company.id,planId:'team'},root)).status,200);
  assert.equal((await request('switch',{tenantId:company.id},root)).status,200);
  const provider=await fetch(base+'/api/provider',{method:'POST',headers:{'content-type':'application/json',cookie:root},body:JSON.stringify({id:'demo',name:'Demo',baseUrl:'https://api.deepseek.com/v1',protocol:'openai',model:'demo-model',models:['demo-model'],enabled:true,apiKey:'test-secret'})});
  assert.equal(provider.status,200);
  const invite=(await request('invite',{email:'company@example.com',role:'owner'},root)).body;
  const scoped=(await request('register',{name:'Company Owner',email:'company@example.com',password,inviteCode:invite.code})).cookie;
  assert.equal((await request('subscription',null,scoped)).body.plan.id,'team');
  assert.equal((await request('subscription?tenantId=default',null,scoped)).body.tenantId,company.id,'查询参数不能跨租户读取订阅');
  const call=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json',cookie:scoped},body:JSON.stringify({model:'demo',messages:[{role:'user',content:'ping'}]})});
  assert.equal(call.status,200,'订阅草案与手动分配不能形成付费墙');
  assert.equal((await request('subscription/plan',{id:'evil',name:'越权'},scoped)).status,403);
  assert.equal((await request('subscription/assign',{tenantId:'default',planId:'team'},scoped)).status,403);
  assert.equal((await request('switch',{tenantId:'default'},root)).status,200);
  assert.equal((await request('subscription',null,root)).body.plan.id,'byok','主租户不继承其他租户的订阅');
  assert.equal((await request('subscription/assign',{tenantId:'missing',planId:'team'},root)).status,404);
  assert.equal((await request('subscription',null,scoped)).body.paymentEnabled,false);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
