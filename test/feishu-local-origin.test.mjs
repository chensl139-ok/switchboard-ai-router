import {test} from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localFeishuOriginMismatch} from '../feishu-auth.mjs';
import {createPlatform} from '../platform.mjs';

test('本地 OAuth 只使用配置中的回调域名，不信任请求中的跳转目标',()=>{
 const callback='http://127.0.0.1:3100/api/account/sso/feishu/callback';
 const request=host=>({headers:{host},socket:{}});
 assert.equal(localFeishuOriginMismatch(request('127.0.0.1:3100'),callback),null);
 for(const host of ['switchboard.orb.local','localhost:3100','127.0.0.1:3110','attacker.example'])assert.equal(localFeishuOriginMismatch(request(host),callback),'http://127.0.0.1:3100');
 assert.equal(localFeishuOriginMismatch(request('internal:3000'),'https://gateway.example/callback'),null);
});

test('单个绑定应用可直接登录；别名先回规范入口，绑定账户不能跨域丢失会话',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'feishu-local-'));
 const oauthConfig={key:'bound-default',label:'Company',tenantId:'default',appId:'cli_test12345678',appSecret:'test-secret',enabled:true,redirectUri:'http://127.0.0.1:3100/api/account/sso/feishu/callback'};
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),oauthConfig:[oauthConfig],identityFetcher:async()=>{throw Error('OAuth start must not exchange credentials');}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
 try{
  const alias=await localFetch(base+'/api/account/sso/feishu/start',{headers:{host:'switchboard.orb.local'},redirect:'manual'});
  assert.equal(alias.status,302);assert.equal(alias.headers.get('location'),'http://127.0.0.1:3100/api/account/sso/feishu/start?provider=bound-default');assert.equal(alias.headers.get('set-cookie'),null);
  const canonical=await localFetch(base+'/api/account/sso/feishu/start',{headers:{host:'127.0.0.1:3100'}});
  assert.equal(canonical.status,302);const target=new URL(canonical.headers.get('location'));
  assert.equal(target.hostname,'accounts.feishu.cn');assert.equal(target.searchParams.get('app_id'),oauthConfig.appId);assert.equal(target.searchParams.get('redirect_uri'),oauthConfig.redirectUri);assert.match(canonical.headers.get('set-cookie'),/sr_oauth_state=/);
  const setup=await fetch(base+'/api/account/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Owner',email:'owner@example.test',password:'correct-password-12345',bootstrapToken:'a'.repeat(32)})});
  assert.equal(setup.status,200);const cookie=setup.headers.get('set-cookie').split(';')[0];
  const link=host=>localFetch(base+'/api/account/sso/feishu/link/start',{method:'POST',headers:{host,cookie,'content-type':'application/json'},body:'{}'});
  const rejected=await link('switchboard.orb.local');assert.equal(rejected.status,409);assert.match(await rejected.text(),/127\.0\.0\.1:3100/);assert.equal(rejected.headers.get('set-cookie'),null);
  const accepted=await link('127.0.0.1:3100');assert.equal(accepted.status,200);assert.match(accepted.headers.get('set-cookie'),/sr_oauth_state=/);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

function localFetch(url,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=request(url,{method,headers},res=>{let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve(new Response(data,{status:res.statusCode,headers:res.headers})));});
  req.on('error',reject);req.end(body);
 });
}
