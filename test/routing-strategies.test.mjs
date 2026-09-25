import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRoutes,validateRouting} from '../routing.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';

const message=text=>({model:'auto',messages:[{role:'user',content:text}],max_tokens:8192});
const base=()=>({
 providers:[
  {id:'first',name:'First',enabled:true,secret:'key-a',meteredSecret:'backup-a',model:'primary',models:['primary','alternate'],priority:1,weight:1,prices:{primary:{currency:'USD',inputPerMillion:3,outputPerMillion:6,expiresAt:null},alternate:{currency:'USD',inputPerMillion:1,outputPerMillion:2,expiresAt:null}}},
  {id:'second',name:'Second',enabled:true,secret:'key-b',model:'other',models:['other'],priority:2,weight:3,prices:{other:{currency:'USD',inputPerMillion:2,outputPerMillion:3,expiresAt:null}}}
 ],active:'first',strategy:'fallback',rules:[],logs:[],routing:{maxAttempts:3,currency:'USD'}
});

test('六种策略均产生不同且可解释的路由；前三次尝试包含跨服务商容灾',()=>{
 const state=base(),input=message('write SQL');
 assert.deepEqual(selectRoutes(state,input).map(r=>[r.id,r.model]),[['first','primary'],['first','alternate'],['second','other']]);
 state.strategy='manual';assert.deepEqual(selectRoutes(state,input).map(r=>[r.id,r.model,r.channelOverride]),[['first','primary','subscription'],['first','primary','metered']]);
 state.strategy='weighted';assert.deepEqual([0,1,2,3].map(sequence=>selectRoutes(state,input,{sequence})[0].id),['first','second','second','second']);
 state.strategy='latency';state.logs=Array.from({length:3},(_,index)=>({providerId:'second',model:'other',status:200,latency:10+index,time:new Date().toISOString()}));
 assert.deepEqual(selectRoutes(state,input).map(r=>r.id),['second','first','first']);
 state.strategy='rules';state.rules=[{name:'代码',keywords:['sql'],providerId:'first',model:'alternate'}];
 assert.deepEqual(selectRoutes(state,input).map(r=>[r.id,r.model]),[['first','alternate'],['first','primary'],['second','other']]);
 assert.match(selectRoutes(state,input)[0].routeReason,/匹配规则/);
 assert.deepEqual(selectRoutes(state,message('hello')).map(r=>[r.id,r.model]),[['first','primary'],['first','alternate'],['second','other']]);
 state.strategy='economy';assert.deepEqual(selectRoutes(state,input).map(r=>[r.id,r.model]),[['first','alternate'],['second','other'],['first','primary']]);
});

test('任务规则目标熔断时可回退到健康模型；经济优先不会把备用密钥占满全部尝试预算',()=>{
 const state=base(),now=Date.now();state.strategy='rules';state.rules=[{name:'代码',keywords:['sql'],providerId:'first',model:'alternate'}];
 state.logs=Array.from({length:3},(_,index)=>({providerId:'first',model:'alternate',status:503,time:new Date(now-index*1000).toISOString()}));
 const routes=selectRoutes(state,message('SQL'),{now});assert.equal(routes[0].model,'primary');assert.equal(routes.some(r=>r.id==='second'),true);
 state.strategy='economy';assert.equal(selectRoutes(state,message('hello'),{now}).some(r=>r.id==='second'),true);
 assert.throws(()=>validateRouting({...state,strategy:'rules',rules:[{name:'bad',keywords:['sql'],providerId:'first',model:'missing'}]},state.providers),/规则引用/);
});

test('六种策略经 HTTP 真正选路，规则与故障转移不是仅在预览中生效',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-strategy-http-'));let failPrimary=false,failAlternate=false,failSecond=false,upstream=[];
 const fetcher=async(url,options)=>{const body=JSON.parse(options.body),provider=url.includes('first.example')?'first':'second';upstream.push({provider,model:body.model});if((failPrimary&&provider==='first'&&body.model==='primary')||(failAlternate&&provider==='first'&&body.model==='alternate')||(failSecond&&provider==='second'))return new Response('{}',{status:503});return Response.json({choices:[{message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}});};
 const app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const post=async(url,data,token='a'.repeat(32))=>{const response=await fetch(base+url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});return {status:response.status,body:await response.json(),provider:decodeURIComponent(response.headers.get('x-router-provider')||''),model:decodeURIComponent(response.headers.get('x-router-model')||'')};};
 const route=async(strategy,extra={})=>post('/api/routing',{active:'first',strategy,routing:{maxAttempts:3,timeoutMs:10000,requestsPerMinute:100,concurrency:5,currency:'USD'},...extra});
 const chat=text=>post('/v1/chat/completions',{model:'auto',messages:[{role:'user',content:text}]},'g'.repeat(32));
 try{
  await post('/api/provider',{id:'first',name:'First',baseUrl:'https://first.example/v1',protocol:'openai',model:'primary',models:['primary','alternate'],enabled:true,priority:1,weight:1,apiKey:'secret-a'});
  await post('/api/provider',{id:'second',name:'Second',baseUrl:'https://second.example/v1',protocol:'openai',model:'other',models:['other'],enabled:true,priority:2,weight:3,apiKey:'secret-b'});
  for(const [providerId,model,price] of [['first','primary',9],['first','alternate',3],['second','other',1]])await post('/api/prices',{providerId,model,currency:'USD',inputPerMillion:price,outputPerMillion:price});
  await route('manual');assert.equal((await chat('manual')).provider,'first');
  await route('fallback');failPrimary=true;upstream=[];const fallback=await chat('fallback');assert.equal(fallback.status,200);assert.deepEqual(upstream.map(row=>row.model),['primary','alternate']);failPrimary=false;
  await route('weighted');const weighted=[];for(let i=0;i<4;i++)weighted.push((await chat('weighted')).provider);assert.equal(weighted.filter(p=>p==='first').length,1);assert.equal(weighted.filter(p=>p==='second').length,3);
  await route('latency');assert.equal((await chat('latency')).provider,'second');
  await route('rules',{rules:[{name:'SQL',keywords:['sql'],providerId:'first',model:'alternate'}]});const rules=await chat('write SQL');assert.deepEqual([rules.provider,rules.model],['first','alternate']);
  failAlternate=true;upstream=[];assert.equal((await chat('write SQL')).status,200);assert.deepEqual(upstream.map(row=>row.model),['alternate','primary']);failAlternate=false;
  await route('economy');assert.deepEqual([(await chat('cheap')).provider,(await chat('cheap')).provider],['second','second']);
  failSecond=true;upstream=[];const recovered=await chat('cheap');assert.equal(recovered.status,200);assert.deepEqual(upstream.map(row=>row.model),['other','alternate']);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
