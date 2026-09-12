const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chooseRoutes}=require('../dist/server/modules/router/router.policy');
const {defaultConfig}=require('../dist/server/modules/router/router.types');
const {publicAddress,validateBaseUrl}=require('../dist/server/modules/router/router.upstream');
const {RouterCrypto}=require('../dist/server/modules/router/router.crypto');
const {randomBytes}=require('node:crypto');
const config=()=>{const c=defaultConfig();c.providers=c.providers.slice(0,2).map((p,i)=>({...p,enabled:true,secret:'encrypted',model:'main',models:['main','code'],weight:i?3:1}));c.settings.active=c.providers[0].id;return c;};
const input={model:'auto',messages:[{role:'user',content:'write SQL please'}]};
test('固定、回退、加权轮询、最低延迟、规则与显式模型选择',()=>{
 const c=config();c.settings.mode='manual';assert.equal(chooseRoutes(c,input,[],0).length,1);
 c.settings.mode='fallback';assert.equal(chooseRoutes(c,input,[],0)[0].provider.id,'siliconflow');
 c.settings.mode='weighted';assert.deepEqual([0,1,2,3].map(n=>chooseRoutes(c,input,[],n)[0].provider.id),['deepseek','deepseek','deepseek','siliconflow']);
 c.settings.mode='latency';const logs=Array.from({length:3},()=>({providerId:'deepseek',model:'main',status:200,latency:10,time:new Date().toISOString()}));assert.equal(chooseRoutes(c,input,logs,0)[0].provider.id,'deepseek');
 c.settings.mode='rules';c.settings.rules=[{id:'code',name:'代码',keywords:['SQL'],providerId:'deepseek',model:'code'}];assert.equal(chooseRoutes(c,input,[],0)[0].model,'code');
 assert.equal(chooseRoutes(c,{...input,model:'siliconflow',upstream_model:'code'},[],0)[0].model,'code');
 assert.throws(()=>chooseRoutes(c,{...input,model:'siliconflow',upstream_model:'other'},[],0));
});
test('熔断、冷却与无路由失败关闭',()=>{
 const c=config();const logs=Array.from({length:3},()=>({providerId:'siliconflow',model:'main',status:503,time:new Date().toISOString()}));
 assert.equal(chooseRoutes(c,input,logs,0)[0].provider.id,'deepseek');
 assert.equal(chooseRoutes(c,input,logs.map(l=>({...l,time:new Date(Date.now()-61000).toISOString()})),0)[0].provider.id,'siliconflow');
 c.providers=[];assert.throws(()=>chooseRoutes(c,input,[],0));
});
test('SSRF 拒绝私网地址和非白名单域名；密钥防篡改',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fd00::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.throws(()=>validateBaseUrl('https://internal.example/v1'));assert.throws(()=>validateBaseUrl('https://api.openai.com@evil.example'));
 process.env.ROUTER_MASTER_KEY=randomBytes(32).toString('base64');const crypto=new RouterCrypto();const encrypted=crypto.encrypt('secret');assert.equal(crypto.decrypt(encrypted),'secret');
 const b=Buffer.from(encrypted,'base64');b[15]^=1;assert.throws(()=>crypto.decrypt(b.toString('base64')));
});
