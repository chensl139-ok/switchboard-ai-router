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
