import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {safeFetch,publicAddress,proxyAddressAllowed} from '../network.mjs';
test('Fake-IP 只对显式域名、HTTPS 和 198.18/15 生效',()=>{
 const oldFlag=process.env.UPSTREAM_PROXY_FAKE_IP,oldHosts=process.env.UPSTREAM_PROXY_FAKE_IP_HOSTS;
 try{
  process.env.UPSTREAM_PROXY_FAKE_IP='true';process.env.UPSTREAM_PROXY_FAKE_IP_HOSTS='aigw.sotatts.online';
  assert.equal(proxyAddressAllowed('aigw.sotatts.online','198.18.1.158'),true);
  assert.equal(proxyAddressAllowed('other.example','198.18.1.158'),false);
  assert.equal(proxyAddressAllowed('aigw.sotatts.online','127.0.0.1'),false);
  assert.equal(proxyAddressAllowed('aigw.sotatts.online','198.18.1.158','http:'),false);
  process.env.UPSTREAM_PROXY_FAKE_IP='false';assert.equal(proxyAddressAllowed('aigw.sotatts.online','198.18.1.158'),false);
 }finally{
  if(oldFlag===undefined)delete process.env.UPSTREAM_PROXY_FAKE_IP;else process.env.UPSTREAM_PROXY_FAKE_IP=oldFlag;
  if(oldHosts===undefined)delete process.env.UPSTREAM_PROXY_FAKE_IP_HOSTS;else process.env.UPSTREAM_PROXY_FAKE_IP_HOSTS=oldHosts;
 }
});
test('原生网络适配器仅允许显式授权私网，且不跟随重定向',async()=>{
 const oldHttp=process.env.ALLOW_HTTP_UPSTREAM,oldPrivate=process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS;let calls=0;
 const app=http.createServer((req,res)=>{calls++;if(req.url==='/redirect'){res.writeHead(302,{location:'/private'});res.end();}else{res.setHeader('content-type','application/json');res.end('{"ok":true}');}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 try{
  delete process.env.ALLOW_HTTP_UPSTREAM;await assert.rejects(safeFetch(base),/HTTP/);
  process.env.ALLOW_HTTP_UPSTREAM='true';delete process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS;await assert.rejects(safeFetch(base),/私网/);
  process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS='127.0.0.1';assert.deepEqual(await (await safeFetch(base)).json(),{ok:true});
  const redirect=await safeFetch(base+'/redirect');assert.equal(redirect.status,302);await redirect.text();assert.equal(calls,2);
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','198.18.0.1'])assert.equal(publicAddress(ip),false);
 }finally{if(oldHttp===undefined)delete process.env.ALLOW_HTTP_UPSTREAM;else process.env.ALLOW_HTTP_UPSTREAM=oldHttp;if(oldPrivate===undefined)delete process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS;else process.env.UPSTREAM_ALLOWED_PRIVATE_HOSTS=oldPrivate;await new Promise(r=>app.close(r));}
});
