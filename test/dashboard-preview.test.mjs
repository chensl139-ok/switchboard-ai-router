import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDashboard,renderDashboardRoutePreview} from '../public/dashboard.js';

const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('首页首次调用只认成功，候选链交由实际路由预览填充',()=>{
 const provider={id:'p',name:'服务商',model:'moss-transcribe-1.0',enabled:true,hasKey:true};
 const html=renderDashboard({state:{providers:[provider],active:'p',strategy:'fallback',logs:[{status:502,latency:15,time:new Date().toISOString(),provider:'服务商',model:provider.model}]},esc,ready:item=>item.enabled,isManager:true});
 assert.match(html,/完成首次成功调用/);
 assert.match(html,/67%/);
 assert.match(html,/正在计算实际可用候选/);
 assert.doesNotMatch(html,/route-node[^]*moss-transcribe-1\.0/);
});

test('首页只展示尝试预算内的实际对话候选，不将媒体模型伪装为回退目标',()=>{
 const nodes={'#dashboard-route-chain':{innerHTML:''},'#dashboard-route-note':{textContent:''}};
 const root={querySelector:selector=>nodes[selector]};
 renderDashboardRoutePreview(root,{strategy:'fallback',maxAttempts:2,total:3,candidates:[
  {order:1,provider:'甲',model:'chat-primary',withinAttemptBudget:true,health:{}},
  {order:2,provider:'乙',model:'chat-backup',withinAttemptBudget:true,health:{}},
  {order:3,provider:'丙',model:'chat-budget-exceeded',withinAttemptBudget:false,health:{}}
 ]},esc);
 assert.match(nodes['#dashboard-route-chain'].innerHTML,/chat-primary/);
 assert.match(nodes['#dashboard-route-chain'].innerHTML,/chat-backup/);
 assert.doesNotMatch(nodes['#dashboard-route-chain'].innerHTML,/chat-budget-exceeded/);
 assert.match(nodes['#dashboard-route-note'].textContent,/最多 2 次尝试/);
});
