import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Accounts} from '../accounts.mjs';

test('一个租户的管理员不能重置兼属另一租户的账户',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-reset-scope-'));
 try{
  const accounts=new Accounts(dir,'a'.repeat(32));
  const owner=accounts.resolve(await accounts.setup({bootstrapToken:'a'.repeat(32),name:'Owner',email:'owner@example.test',password:'owner-password-123'}));
  const adminInvite=accounts.invite(owner,{email:'admin@example.test',role:'admin'});
  const admin=accounts.resolve(await accounts.register({name:'Admin',email:'admin@example.test',password:'admin-password-123',inviteCode:adminInvite.code}));
  const invited=accounts.invite(owner,{email:'member@example.test',role:'member'});
  const member=accounts.resolve(await accounts.register({name:'Member',email:'member@example.test',password:'member-password-123',inviteCode:invited.code}));
  assert.equal(accounts.issuePasswordReset(admin,member.userId).code.length,48);
  const personal=accounts.createTenant(owner,'Personal');
  // 模拟升级前已同时加入多个租户的历史账户，验证重置码仍受全部租户权限约束。
  accounts.mutate(()=>accounts.state.members.push({tenantId:personal.id,userId:member.userId,role:'owner'}));
  assert.throws(()=>accounts.issuePasswordReset(admin,member.userId),{status:403});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('唯一所有者可通过本地脚本标准输入恢复密码并撤销旧会话与重置码',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-owner-recovery-'));
 try{
  const accounts=new Accounts(dir,'a'.repeat(32));
  const token=await accounts.setup({bootstrapToken:'a'.repeat(32),name:'Owner',email:'owner@example.test',password:'old-password-123'});
  const owner=accounts.resolve(token);
  accounts.state.passwordResets.push({userId:owner.userId,tenantId:'default',digest:'stale',expiresAt:Date.now()+100000});accounts.save();
  const run=spawnSync(process.execPath,[path.resolve('scripts/reset-admin-password.mjs'),`--data=${dir}`],{input:'new-password-123\n',encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const disk=JSON.parse(readFileSync(path.join(dir,'accounts.json'),'utf8'));
  assert.equal(disk.sessions.length,0);assert.equal(disk.passwordResets.length,0);
  const fresh=new Accounts(dir,'a'.repeat(32));
  assert.equal(typeof await fresh.login({email:'owner@example.test',password:'new-password-123'}),'string');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
