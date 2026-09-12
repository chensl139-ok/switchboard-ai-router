import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
const admin='a'.repeat(32),gateway='g'.repeat(32);
test('完整网关流程：鉴权、加密、切换、回退、重启与协议适配',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-test-'));let calls=[];
 const fetcher=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body),headers:opts.headers});if(url.includes('bad.example'))return new Response('{}',{status:503});if(url.includes('claude.example'))return Response.json({id:'msg1',model:'claude-test',content:[{type:'text',text:'你好'}],stop_reason:'end_turn',usage:{input_tokens:3,output_tokens:4}});return Response.json({id:'test',choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{total_tokens:7}})};
 let app=createApp({dir,admin,gateway,fetcher});await new Promise(r=>app.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${app.address().port}`;
 const request=async(url,data,token=admin)=>{const r=await fetch(base+url,{method:data?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json(),headers:r.headers}};
 const provider=(id,baseUrl,protocol='openai')=>({id,name:id,baseUrl,protocol,model:'test-model',priority:50,enabled:true,apiKey:'secret-upstream-key'});
 try{
 assert.equal((await request('/api/state',undefined,'wrong')).status,401);
 assert.equal((await request('/api/state',undefined,gateway)).status,401);
 assert.equal((await request('/api/provider',provider('bad','https://bad.example/v1'))).status,200);
 await request('/api/provider',provider('good','https://good.example/v1'));
 await request('/api/routing',{active:'bad',strategy:'fallback'});
 const chat={model:'auto',messages:[{role:'user',content:'敏感正文'}]};
 let result=await request('/v1/chat/completions',chat,gateway);
 assert.equal(result.status,200);assert.equal(result.headers.get('x-router-provider'),'good');assert.equal(calls.length,2);
 let disk=readFileSync(path.join(dir,'state.json'),'utf8');assert.ok(!disk.includes('secret-upstream-key'));assert.ok(!disk.includes('敏感正文'));
 const state=(await request('/api/state')).data;assert.equal(state.logs.length,2);assert.ok(!JSON.stringify(state).includes('secret-upstream-key'));assert.equal(state.providers.find(p=>p.id==='good').hasKey,true);
 await request('/api/routing',{active:'good',strategy:'manual'});calls=[];assert.equal((await request('/v1/chat/completions',chat,gateway)).status,200);assert.equal(calls.length,1);
 await request('/api/routing',{active:'bad',strategy:'manual'});calls=[];assert.equal((await request('/v1/chat/completions',chat,gateway)).status,502);assert.equal(calls.length,1);
 calls=[];assert.equal((await request('/v1/chat/completions',{...chat,model:'bad'},gateway)).status,502);assert.equal(calls.length,1);
 assert.equal((await request('/v1/chat/completions',{...chat,stream:'invalid'},gateway)).status,400);
 assert.equal((await request('/api/provider',provider('unsafe','http://insecure.example/v1'))).status,400);
 await request('/api/provider',provider('claude','https://claude.example/v1','anthropic'));calls=[];
 result=await request('/v1/chat/completions',{model:'claude',messages:[{role:'system',content:'system'},{role:'user',content:'hello'}]},gateway);
 assert.equal(result.data.choices[0].message.content,'你好');assert.equal(result.data.usage.total_tokens,7);assert.equal(calls[0].body.system,'system');assert.equal(calls[0].headers['x-api-key'],'secret-upstream-key');
 await new Promise(r=>app.close(r));app=createApp({dir,admin,gateway,fetcher});await new Promise(r=>app.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.address().port}`;
 assert.equal((await request('/v1/chat/completions',{...chat,model:'good'},gateway)).status,200);
 assert.equal((await request('/v1/models',undefined,gateway)).data.data.some(m=>m.id==='good'),true);
 await request('/api/provider',{...provider('good','https://good.example/v1'),apiKey:'',models:['test-model','second/model','second/model']});
 let multi=(await request('/api/state')).data.providers.find(p=>p.id==='good');assert.deepEqual(multi.models,['test-model','second/model']);
 assert.equal((await request('/api/provider/switch-model',{id:'good',model:'second/model'},gateway)).status,401);
 assert.equal((await request('/api/provider/switch-model',{id:'good',model:'unknown'})).status,400);
 assert.equal((await request('/api/provider/switch-model',{id:'good',model:'second/model'})).status,200);
 calls=[];await request('/v1/chat/completions',{...chat,model:'good'},gateway);assert.equal(calls[0].body.model,'second/model');
 calls=[];await request('/v1/chat/completions',{...chat,model:'good',upstream_model:'test-model'},gateway);assert.equal(calls[0].body.model,'test-model');
 assert.equal((await request('/api/state')).data.providers.find(p=>p.id==='good').model,'second/model');
 assert.equal((await request('/v1/chat/completions',{...chat,model:'good',upstream_model:'unknown'},gateway)).status,400);
 assert.equal((await request('/v1/chat/completions',{...chat,upstream_model:'test-model'},gateway)).status,400);
 assert.equal(JSON.parse(readFileSync(path.join(dir,'state.json'))).providers.find(p=>p.id==='good').model,'second/model');

 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true})}
});

test('模型发现：完整分页、搜索数据、临时密钥、权限与安全边界',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'router-models-'));const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});const u=new URL(url);
  if(u.hostname==='unsupported.example')return new Response('secret-error',{status:404});
  if(u.hostname==='unauthorized.example')return new Response('secret-error',{status:401});
  if(u.hostname==='invalid.example')return Response.json({wrong:[]});
  if(u.hostname==='loop.example')return Response.json({data:[{id:'loop'}],has_more:true,last_id:'loop'});
  if(u.hostname==='empty.example')return Response.json({data:[]});
  if(u.hostname==='generativelanguage.googleapis.com')return Response.json(u.searchParams.has('pageToken')?{models:[{name:'models/gemini-b',displayName:'Gemini B'}]}:{models:[{name:'models/gemini-a',displayName:'Gemini A'}],nextPageToken:'page-2'});
  if(u.hostname==='claude.example')return Response.json(u.searchParams.has('after_id')?{data:[{id:'claude-b',display_name:'Claude B'}],has_more:false}:{data:[{id:'claude-a',display_name:'Claude A'}],has_more:true,last_id:'claude-a'});
  return Response.json(u.searchParams.has('after')?{data:[{id:'model-b'},{id:'model-a'}],has_more:false}:{data:[{id:'model-a'}],has_more:true,last_id:'model-a'});
 };
 const app=createApp({dir,admin,gateway,fetcher});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(data,token=admin,url='/api/provider/models')=>{const res=await fetch(base+url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(data)});return {status:res.status,data:await res.json()}};
 const draft={id:'draft',baseUrl:'https://models.example/v1',protocol:'openai',apiKey:'temporary-key'};
 try{
  assert.equal((await request(draft,gateway)).status,401);assert.equal(calls.length,0);
  assert.equal((await request({...draft,apiKey:''})).status,400);assert.equal(calls.length,0);
  let out=await request(draft);assert.equal(out.status,200);assert.deepEqual(out.data.data.map(m=>m.id),['model-a','model-b']);assert.equal(calls[0].opts.headers.authorization,'Bearer temporary-key');assert.equal(calls[0].opts.redirect,'error');
  assert.equal((await request({...draft,baseUrl:'http://models.example/v1'})).status,400);
  await request({...draft,name:'Draft',model:'',priority:50,enabled:false},admin,'/api/provider');
  out=await request({id:'draft'});assert.equal(out.status,200);assert.ok(!JSON.stringify(out.data).includes('temporary-key'));
  const before=calls.length;assert.equal((await request({id:'draft',baseUrl:'https://other.example/v1'})).status,400);assert.equal(calls.length,before);
  assert.equal((await request({id:'draft',clearKey:true})).status,400);
  assert.equal((await request({...draft,baseUrl:'https://unsupported.example/v1'})).status,502);
  out=await request({...draft,baseUrl:'https://unauthorized.example/v1'});assert.equal(out.status,502);assert.ok(!JSON.stringify(out.data).includes('secret-error'));
  assert.equal((await request({...draft,baseUrl:'https://invalid.example/v1'})).status,502);
  assert.equal((await request({...draft,baseUrl:'https://loop.example/v1'})).status,502);
  assert.deepEqual((await request({...draft,baseUrl:'https://empty.example/v1'})).data.data,[]);
  out=await request({...draft,baseUrl:'https://claude.example/v1',protocol:'anthropic'});assert.deepEqual(out.data.data.map(m=>m.id),['claude-a','claude-b']);assert.equal(calls.at(-1).opts.headers['x-api-key'],'temporary-key');assert.ok(calls.at(-1).url.includes('after_id=claude-a'));
  out=await request({...draft,baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai'});assert.deepEqual(out.data.data.map(m=>m.id),['gemini-a','gemini-b']);assert.equal(calls.at(-1).opts.headers['x-goog-api-key'],'temporary-key');assert.ok(calls.at(-1).url.includes('pageToken=page-2'));
  assert.ok(!readFileSync(path.join(dir,'state.json'),'utf8').includes('temporary-key'));
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true})}
});
