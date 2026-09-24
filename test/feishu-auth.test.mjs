import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Accounts} from '../accounts.mjs';
import {FeishuOAuth,feishuConfig} from '../feishu-auth.mjs';

const password='correct-password-12345';
test('飞书配置仅在必要字段完整时启用',()=>{
 assert.equal(feishuConfig({FEISHU_APP_ID:'id'}).enabled,false);
 const config=feishuConfig({FEISHU_APP_ID:'id',FEISHU_APP_SECRET:'secret',FEISHU_REDIRECT_URI:'https://example.com/api/account/sso/feishu/callback',FEISHU_ALLOWED_TENANT_KEY:'tenant',FEISHU_AUTO_JOIN:'true',FEISHU_DEFAULT_ROLE:'viewer'});
 assert.deepEqual({enabled:config.enabled,autoJoin:config.autoJoin,defaultRole:config.defaultRole},{enabled:true,autoJoin:true,defaultRole:'viewer'});assert.throws(()=>feishuConfig({FEISHU_APP_ID:'id',FEISHU_APP_SECRET:'secret',FEISHU_REDIRECT_URI:'http://example.com/api/account/sso/feishu/callback'}));
});

test('飞书 OAuth 使用一次性 state 并读取企业身份',async()=>{
 const calls=[];const oauth=new FeishuOAuth({enabled:true,appId:'id',appSecret:'secret',redirectUri:'https://example.com/callback'},{fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({access_token:'token'}):Response.json({data:{open_id:'ou_1',union_id:'on_1',tenant_key:'tenant',email:'USER@example.com',name:'同事'}});}});
 const start=oauth.start();assert.match(start.url,/accounts\.feishu\.cn/);oauth.consumeState(start.state);assert.throws(()=>oauth.consumeState(start.state));
 const identity=await oauth.identity('code');assert.equal(identity.email,'user@example.com');assert.equal(identity.openId,'ou_1');assert.equal(JSON.parse(calls[0].options.body).client_secret,'secret');assert.equal(calls[1].options.headers.authorization,'Bearer token');
});

test('飞书账户可按邀请加入并设置备用密码',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-account-')),accounts=new Accounts(dir,'a'.repeat(32));
 try{
  const ownerToken=await accounts.setup({name:'Owner',email:'owner@example.com',password,bootstrapToken:'a'.repeat(32)}),owner=accounts.resolve(ownerToken);
  accounts.invite(owner,{email:'member@example.com',role:'member'});
  const token=accounts.loginWithFeishu({openId:'ou_member',unionId:'on_member',tenantKey:'tenant',email:'member@example.com',name:'Member'},{allowedTenantKey:'tenant'}),member=accounts.resolve(token);
  assert.equal(member.hasPassword,false);assert.equal(accounts.me(member).user.feishuLinked,true);
  const changed=await accounts.changePassword(member,{newPassword:password+'-new'});assert.equal(accounts.resolve(changed).hasPassword,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
