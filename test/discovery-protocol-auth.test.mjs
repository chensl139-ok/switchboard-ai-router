import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlatform} from '../platform.mjs';
test('跨协议 x-api-key 鉴权、统一配额及模型批量发现隔离',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'model-discovery-'));let generated=0;
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,opts)=>{
  if(opts.method==='GET'){if(url.includes('broken.example'))return new Response('{}',{status:401});return Response.json({data:[{id:'configured'},{id:'new-model'}]});}
  generated++;return Response.json({id:'reply',model:'configured',choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}});
 }});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(p,b,headers={})=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json',...headers},...(b?{body:JSON.stringify(b)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const setup=await request('/api/account/setup',{bootstrapToken:'a'.repeat(32),name:'Owner',email:'owner@example.test',password:'fixture-password-123'});const headers={cookie:setup.cookie};
  for(const [id,host] of [['first','first.example'],['broken','broken.example']])await request('/api/provider',{id,name:id,baseUrl:`https://${host}/v1`,protocol:'openai',model:'configured',models:['configured'],enabled:true,priority:1,apiKey:'fake'},headers);
  const key=(await request('/api/keys',{name:'SDK key',totalLimit:1},headers)).data.token;
  const external={'x-api-key':key,'anthropic-version':'2023-06-01'};
  const list=await request('/v1/models',null,external);assert.equal(list.status,200);assert.equal(list.data.has_more,false);assert.ok(list.data.data.some(m=>m.id==='first::configured'));
  const discovery=await request('/v1/models/discover',null,external);assert.equal(discovery.status,200);assert.equal(discovery.data.errors,1);assert.equal(discovery.data.total,2);assert.equal(generated,0);
  const register=await request('/api/models/register',{providerId:'first',model:'new-model'},headers);assert.equal(register.status,200);
  assert.equal((await request('/v1/models/'+encodeURIComponent('first::new-model'),null,external)).status,200);
  const response=await request('/v1/messages',{model:'first::new-model',max_tokens:10,messages:[{role:'user',content:'hi'}]},external);assert.equal(response.status,200);assert.equal(response.data.type,'message');
  const quota=await request('/v1/responses',{model:'first::configured',input:'hi'},{authorization:'Bearer '+key});assert.equal(quota.status,429);assert.equal(generated,1);
  const tenant=(await request('/api/account/tenants',{name:'Other'},headers)).data;await request('/api/account/switch',{tenantId:tenant.id},headers);
  assert.ok(!(await request('/api/state',null,headers)).data.providers.some(p=>p.id==='first'));
  const unauthorized=await request('/v1/messages',{model:'auto',max_tokens:10,messages:[{role:'user',content:'hi'}]},{'x-api-key':'wrong'});assert.equal(unauthorized.status,401);assert.equal(unauthorized.data.type,'error');
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
