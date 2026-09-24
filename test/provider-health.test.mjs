import test from 'node:test';
import assert from 'node:assert/strict';
import {providerCards,providerHealth,refreshProviderHealth} from '../public/provider-ui.js';

test('服务商卡片识别 SQLite 日志字段，不把已调用服务商标为待验证',()=>{
 const provider={id:'demo',name:'Demo',model:'chat',models:['chat'],enabled:true,hasKey:true};
 const html=providerCards({state:{providers:[provider],active:'demo',logs:[{provider_id:'demo',model:'chat',status:200,latency:120}]},esc:String,isManager:false});
 assert.match(html,/健康/);assert.match(html,/近 1 次成功率 100%/);assert.doesNotMatch(html,/待验证/);
 assert.match(html,/data-provider-health="demo"/);
});

test('轮询日志时仅更新卡片健康区域，保留搜索与模型选择状态',()=>{
 const provider={id:'demo',name:'Demo'};let markup='';
 const root={querySelectorAll:()=>[{dataset:{providerHealth:'demo'},set innerHTML(value){markup=value;}}]};
 refreshProviderHealth(root,[provider],[{provider_id:'demo',status:200,latency:80}]);
 assert.match(markup,/健康/);assert.match(markup,/近 1 次成功率 100%/);
 assert.equal(providerHealth(provider,[]).label,'待验证');
});
