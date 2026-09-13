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
