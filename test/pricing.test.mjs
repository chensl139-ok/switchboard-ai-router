import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openRouterPrice,validatePrice,usageCost} from '../pricing.mjs';
import {selectRoutes} from '../routing.mjs';
test('价格来源、币种、过期、未知价格与经济路由',()=>{
 const price=openRouterPrice({pricing:{prompt:'0.000001',completion:'0.000002',request:'0'}});assert.equal(price.inputPerMillion,1);assert.equal(price.outputPerMillion,2);assert.equal(price.currency,'USD');
 assert.equal(openRouterPrice({pricing:{prompt:'-1',completion:'0'}}),null);
 const free=validatePrice({currency:'USD',inputPerMillion:0,outputPerMillion:0});
 const providers=[{id:'a',name:'A',enabled:true,secret:'s',model:'unknown',models:['unknown','cheap','free','expired','cny'],priority:1,prices:{cheap:price,free,expired:{...free,expiresAt:'2000-01-01'},cny:{...free,currency:'CNY'}}}];
 const state={providers,strategy:'economy',active:'a',logs:[],rules:[],routing:{maxAttempts:3,currency:'USD'}};
 const selected=selectRoutes(state,{model:'auto',messages:[{role:'user',content:'hello'}],max_tokens:100});assert.deepEqual(selected.map(p=>p.model),['free','cheap']);
 state.routing.currency='CNY';assert.equal(selectRoutes(state,{messages:[]})[0].model,'cny');
 providers[0].prices={};assert.throws(()=>selectRoutes(state,{messages:[]}),/没有同币种/);
 assert.equal(usageCost({prices:{m:price}},'m',{known:false}).estimatedCost,null);
 assert.equal(usageCost({prices:{m:price}},'m',{known:true,inputTokens:1000000,outputTokens:1000000}).estimatedCost,3);
});

test('缓存命中价格区分未知和免费，按实际命中量扣除普通输入费用',async()=>{
 const {normalizeUsage}=await import('../pricing.mjs');
 const price=validatePrice({currency:'CNY',inputPerMillion:2,outputPerMillion:8,cachedInputPerMillion:0.5});
 const usage=normalizeUsage({prompt_tokens:1000000,completion_tokens:100000,prompt_tokens_details:{cached_tokens:800000}});
 assert.equal(usageCost({prices:{m:price}},'m',usage).estimatedCost,1.6);
 assert.equal(usageCost({prices:{m:{...price,cachedInputPerMillion:0}}},'m',usage).estimatedCost,1.2);
 assert.equal(usageCost({prices:{m:{...price,cachedInputPerMillion:undefined}}},'m',usage).estimatedCost,null);
 assert.equal(normalizeUsage({prompt_tokens:10,completion_tokens:1,prompt_cache_hit_tokens:5}).cachedInputTokens,5);
 assert.equal(usageCost({prices:{m:price}},'m',normalizeUsage({prompt_tokens:10,completion_tokens:1,prompt_tokens_details:{cached_tokens:11}})).estimatedCost,null);
 assert.throws(()=>validatePrice({...price,cachedInputPerMillion:-1}),/非负/);
 assert.throws(()=>validatePrice({...price,cachedInputPerMillion:null}),/非负/);
 assert.equal(openRouterPrice({pricing:{prompt:'0.000002',completion:'0.000008',input_cache_read:'0'}}).cachedInputPerMillion,0);
 assert.equal(openRouterPrice({pricing:{prompt:'0.000002',completion:'0.000008'}}).cachedInputPerMillion,undefined);
});

test('HTTP 与 SSE 三种上游协议保留缓存命中用量',async()=>{
 const {normalizeUsage}=await import('../pricing.mjs');const {toChatResponse}=await import('../protocols.mjs');const {consumeSSE}=await import('../realtime.mjs');
 const anthropic={id:'m',content:[],usage:{input_tokens:20,cache_read_input_tokens:80,output_tokens:10}};
 const responses={id:'r',output:[],usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:80}}};
 for(const [protocol,raw] of [['anthropic',anthropic],['responses',responses]])assert.equal(normalizeUsage(toChatResponse(raw,protocol,'m').usage).cachedInputTokens,80);
 for(const [protocol,events] of [
  ['openai',[{choices:[],usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:80}}},'[DONE]']],
  ['responses',[{type:'response.completed',response:responses}]],
  ['anthropic',[{type:'message_start',message:anthropic},{type:'message_delta',usage:{output_tokens:10},delta:{stop_reason:'end_turn'}},{type:'message_stop'}]]
 ]){let usage;await consumeSSE(new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}),protocol,'m',async()=>{},null,u=>usage=u);assert.equal(usage.cachedInputTokens,80);assert.equal(usage.inputTokens,100);}
});

test('分时价格：时区、跨午夜、边界、重叠及经济路由',async()=>{
 const {priceAt,priceEstimate}=await import('../pricing.mjs');
 const base={currency:'USD',inputPerMillion:5,outputPerMillion:5,cachedInputPerMillion:1,expiresAt:'2099-01-01T00:00:00Z'};
 const peak={kind:'peak',start:'09:00',end:'18:00',inputPerMillion:10,outputPerMillion:10,cachedInputPerMillion:2};
 const offpeak={kind:'offpeak',start:'23:00',end:'07:00',inputPerMillion:1,outputPerMillion:1,cachedInputPerMillion:0};
 const price=validatePrice({...base,timeZone:'Asia/Shanghai',periods:[peak,offpeak]});
 for(const [utc,label,rate] of [['2026-09-13T01:00:00Z','高峰',10],['2026-09-13T10:00:00Z','基础',5],['2026-09-13T15:00:00Z','空闲',1],['2026-09-13T22:59:59Z','空闲',1],['2026-09-13T23:00:00Z','基础',5]]){const now=Date.parse(utc);assert.equal(priceAt(price,now).periodLabel,label);assert.equal(priceEstimate(price,1000000,0,0,now),rate);}
 assert.throws(()=>validatePrice({...base,periods:[peak,{...offpeak,start:'17:00'}]}),/重叠/);
 assert.throws(()=>validatePrice({...base,periods:[{...peak,start:'24:00'}]}),/HH:mm/);
 assert.throws(()=>validatePrice({...base,periods:[{...peak,end:'09:00'}]}),/不能相同/);
 assert.throws(()=>validatePrice({...base,timeZone:'invalid-zone'}),/时区/);
 assert.throws(()=>validatePrice({...base,periods:[{...peak,inputPerMillion:-1}]}),/非负/);
 const unknownCache=validatePrice({...base,periods:[{...peak,cachedInputPerMillion:undefined}]});
 assert.equal(usageCost({prices:{m:unknownCache}},'m',{known:true,inputTokens:100,outputTokens:10,cachedInputTokens:50},Date.parse('2026-09-13T01:00:00Z')).estimatedCost,null);
 const providers=[{id:'a',name:'A',enabled:true,secret:'s',model:'m',models:['m'],prices:{m:price}},{id:'b',name:'B',enabled:true,secret:'s',model:'m',models:['m'],prices:{m:validatePrice({...base,inputPerMillion:3,outputPerMillion:3})}}];
 const state={providers,strategy:'economy',active:'a',logs:[],rules:[],routing:{maxAttempts:3,currency:'USD'}};
 assert.equal(selectRoutes(state,{messages:[],max_tokens:100},{now:Date.parse('2026-09-13T01:00:00Z')})[0].id,'b');
 assert.equal(selectRoutes(state,{messages:[],max_tokens:100},{now:Date.parse('2026-09-13T15:00:00Z')})[0].id,'a');
 assert.equal(priceAt(validatePrice({...base,timeZone:'America/New_York',periods:[{...peak,start:'01:00',end:'02:00'}]}),Date.parse('2026-11-01T06:30:00Z')).periodLabel,'高峰');
});

test('工作日价格和跨午夜星期归属',async()=>{
 const {priceAt}=await import('../pricing.mjs');
 const base={currency:'CNY',inputPerMillion:1,outputPerMillion:4};
 const peak={kind:'peak',start:'09:00',end:'12:00',weekdays:[1,2,3,4,5],inputPerMillion:2,outputPerMillion:8};
 const price=validatePrice({...base,periods:[peak]});
 assert.equal(priceAt(price,Date.parse('2026-09-14T01:00:00Z')).inputPerMillion,2);
 assert.equal(priceAt(price,Date.parse('2026-09-13T01:00:00Z')).inputPerMillion,1);
 assert.equal(priceAt(price,Date.parse('2026-09-14T04:00:00Z')).inputPerMillion,1);
 const night={...peak,weekdays:[7],start:'23:00',end:'02:00'};
 assert.equal(priceAt(validatePrice({...base,periods:[night]}),Date.parse('2026-09-13T17:00:00Z')).inputPerMillion,2);
 assert.throws(()=>validatePrice({...base,periods:[night,{...peak,weekdays:[1],start:'01:00',end:'03:00'}]}),/重叠/);
 assert.throws(()=>validatePrice({...base,periods:[{...peak,weekdays:[]}]}),/星期/);
 assert.equal(validatePrice({...base,periods:[peak,{...peak,weekdays:[6,7]}]}).periods.length,2);
});

test('按张价格不会被作为免费文本价格参与经济路由',async()=>{
 const {usablePrice}=await import('../pricing.mjs');const price=validatePrice({billingUnit:'image',currency:'CNY',perImage:0});
 assert.equal(price.perImage,0);assert.equal(price.inputPerMillion,undefined);assert.equal(usablePrice(price,'CNY'),false);
 assert.equal(usageCost({prices:{m:price}},'m',{known:true,inputTokens:5,outputTokens:5}).estimatedCost,null);
 assert.throws(()=>validatePrice({billingUnit:'image',currency:'CNY'}),/每张图片/);
});
