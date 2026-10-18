import test from 'node:test';
import assert from 'node:assert/strict';
import {routingView,routingObjectives,routingOverrides,routingLabel} from '../public/routing-policy.js';

test('旧六策略展示为固定/自动模式、四个选路目标与独立任务规则',()=>{
 assert.equal(routingObjectives.length,4);
 assert.deepEqual(routingView({strategy:'rules'}),{mode:'auto',objective:'fallback',rulesEnabled:true});
 assert.deepEqual(routingView({strategy:'manual'}),{mode:'fixed',objective:'fallback',rulesEnabled:false});
 assert.equal(routingView({strategy:'weighted',routing:{rulesEnabled:true}}).rulesEnabled,true);
 for(const strategy of ['manual','fallback','rules','economy','latency','weighted'])assert.notEqual(routingLabel(strategy),undefined);
});
test('个人策略只保存差异，不固化组织配额、未修改字段与凭证',()=>{
 const shared={strategy:'fallback',active:'api',rules:[],routing:{currency:'USD',timeoutMs:30000,maxAttempts:3,requestsPerMinute:60,concurrency:5}};
 assert.deepEqual(routingOverrides(shared,{...shared,routing:{...shared.routing,rulesEnabled:false}}),{});
 const own={...shared,active:'private',routing:{...shared.routing,requestsPerMinute:999,concurrency:99,maxAttempts:4}};
 assert.deepEqual(routingOverrides(shared,own),{active:'private',routing:{maxAttempts:4}});
});
