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
  const invited=accounts.invite(owner,{email:'member@example.test',role:'member'});
  const member=accounts.resolve(await accounts.register({name:'Member',email:'member@example.test',password:'member-password-123',inviteCode:invited.code}));
  assert.equal(accounts.issuePasswordReset(owner,member.userId).code.length,48);
  accounts.createTenant(member,'Personal');
  assert.throws(()=>accounts.issuePasswordReset(owner,member.userId),{status:403});
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
