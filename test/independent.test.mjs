import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setup} from '../scripts/setup.mjs';
import {selectRoutes,validateRouting,routeHealth} from '../routing.mjs';
import {thinkingOptions} from '../thinking.mjs';
import {createApp} from '../server.mjs';
const makeState=()=>({providers:[{id:'a',name:'A',model:'main',models:['main','code'],enabled:true,secret:'s',priority:10,weight:1},{id:'b',name:'B',model:'main',models:['main','code'],enabled:true,secret:'s',priority:20,weight:3}],active:'a',strategy:'fallback',logs:[],rules:[],routing:{maxAttempts:3}});
const input={model:'auto',messages:[{role:'user',content:'write SQL'}]};
test('独立策略：固定、回退、权重、延迟、规则、熔断',()=>{
 const s=makeState();assert.equal(selectRoutes(s,input)[0].id,'a');s.strategy='manual';assert.equal(selectRoutes(s,input).length,1);
 s.strategy='weighted';assert.deepEqual([0,1,2,3].map(sequence=>selectRoutes(s,input,{sequence})[0].id),['a','b','b','b']);
 s.strategy='latency';s.logs=Array.from({length:3},()=>({providerId:'b',model:'main',status:200,latency:10,time:new Date().toISOString()}));assert.equal(selectRoutes(s,input)[0].id,'b');
 s.strategy='rules';s.rules=[{name:'code',keywords:['sql'],providerId:'b',model:'code'}];assert.equal(selectRoutes(s,input)[0].model,'code');
 s.strategy='fallback';s.logs=Array.from({length:3},()=>({providerId:'a',model:'main',status:503,time:new Date().toISOString()}));assert.equal(selectRoutes(s,input)[0].id,'b');
 assert.throws(()=>validateRouting({strategy:'manual',active:''},s.providers));
});
test('合并服务商按模型选择密钥渠道，并兼容旧 Metered 路由 ID',()=>{
 const s=makeState();s.providers=[{id:'mosi',name:'moss',model:'gpt-5.4',models:['gpt-5.4','claude-haiku-4-5'],enabled:true,secret:'subscription',meteredSecret:'metered',modelChannels:{'claude-haiku-4-5':'metered'}}];
 s.providerAliases={'mosi-metered':{id:'mosi',channel:'metered'}};
 assert.equal(selectRoutes(s,{model:'mosi::claude-haiku-4-5'})[0].model,'claude-haiku-4-5');
 assert.equal(selectRoutes(s,{model:'mosi-metered::gpt-5.4'})[0].channelOverride,'metered');
 assert.equal(selectRoutes(s,{model:'mosi'})[0].model,'gpt-5.4');
});
test('故障转移把同一服务商的其他模型加入候选链',()=>{
 const s=makeState();s.providers=[{id:'mosi',name:'moss',model:'primary',models:['primary','backup','metered'],enabled:true,secret:'subscription',meteredSecret:'metered-key',modelChannels:{metered:'metered'},priority:10}];s.active='mosi';
 assert.deepEqual(selectRoutes(s,{model:'auto',messages:[]}).map(route=>route.model),['primary','backup','metered']);
 assert.deepEqual(selectRoutes(s,{model:'mosi',upstream_model:'backup',messages:[]}).map(route=>route.model),['backup','primary','metered']);
 const exact=selectRoutes(s,{model:'mosi::backup',messages:[]});assert.deepEqual(exact.map(route=>route.model),['backup','backup']);assert.deepEqual(exact.map(route=>route.channelOverride),['subscription','metered']);
 s.logs=Array.from({length:3},()=>({providerId:'mosi',model:'backup',status:503,time:new Date().toISOString()}));
 assert.deepEqual(selectRoutes(s,{model:'auto',messages:[]}).map(route=>route.model),['primary','metered','primary']);
});
test('路由健康状态只熔断可重试故障，并按时间而非数组顺序计算',()=>{
 const s=makeState(),now=Date.now(),provider=s.providers[0];
 s.logs=[503,200,503,503].map((status,index)=>({providerId:'a',model:'main',status,latency:20,time:new Date(now-(index===1?5000:index*1000)).toISOString()}));
 assert.equal(routeHealth(s,provider,'main',now).circuitOpen,true);
 s.logs=Array.from({length:3},(_,index)=>({providerId:'a',model:'main',status:422,time:new Date(now-index*1000).toISOString()}));
 assert.equal(routeHealth(s,provider,'main',now).circuitOpen,false);
});
test('初始化重复执行不改变任何已有令牌',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'setup-'));
 try{copyFileSync(new URL('../.env.example',import.meta.url),path.join(dir,'.env.example'));assert.equal(setup(dir),true);const before=readFileSync(path.join(dir,'.env'),'utf8');assert.match(before,/ADMIN_TOKEN=[a-f0-9]{64}/);assert.equal(setup(dir),false);assert.equal(readFileSync(path.join(dir,'.env'),'utf8'),before);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('思考开关按服务商映射，不假装支持未知服务商',()=>{
 assert.deepEqual(thinkingOptions({baseUrl:'https://api.siliconflow.cn/v1'},'disabled'),{enable_thinking:false});
 assert.deepEqual(thinkingOptions({baseUrl:'https://api.deepseek.com/v1'},'enabled'),{thinking:{type:'enabled'}});
 assert.deepEqual(thinkingOptions({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},'enabled'),{enable_thinking:true});
 assert.deepEqual(thinkingOptions({baseUrl:'https://unknown.example'},'auto'),{});
 assert.throws(()=>thinkingOptions({baseUrl:'https://unknown.example'},'disabled'));
});
test('含加密服务商的数据丢失主密钥时禁止静默重建',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'missing-key-'));
 try{writeFileSync(path.join(dir,'state.json'),JSON.stringify({providers:[{secret:'encrypted'}]}));assert.throws(()=>createApp({dir,admin:'a'.repeat(32),gateway:'b'.repeat(32)}),/master.key 丢失/);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('HTTP 将思考关闭参数发给上游，并保留 reasoning_content',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'thinking-api-'));let sent;
 const app=createApp({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32),fetcher:async(url,opts)=>{sent=JSON.parse(opts.body);return Response.json({model:'model',choices:[{message:{role:'assistant',content:'answer',reasoning_content:sent.enable_thinking?'provider reasoning':''}}]});}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const post=(url,data,token='a'.repeat(32))=>fetch(base+url,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(data)});
 try{await post('/api/provider',{id:'siliconflow',name:'Test',baseUrl:'https://api.siliconflow.cn/v1',protocol:'openai',model:'model',models:['model'],enabled:true,priority:1,apiKey:'fake-key'});
 const r=await post('/v1/chat/completions',{...input,thinking_mode:'disabled'},'g'.repeat(32));assert.equal(r.status,200);assert.equal(sent.enable_thinking,false);assert.equal((await r.json()).choices[0].message.reasoning_content,'');
 const on=await post('/v1/chat/completions',{...input,thinking_mode:'enabled'},'g'.repeat(32));assert.equal((await on.json()).choices[0].message.reasoning_content,'provider reasoning');
 }finally{await new Promise(r=>app.close(r));rmSync(dir,{recursive:true,force:true});}
});
