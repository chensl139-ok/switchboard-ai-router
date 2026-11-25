import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDashboard,renderDashboardRoutePreview,renderDashboardSummary} from '../public/dashboard.js';

const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('首页首次调用只认成功，候选链交由实际路由预览填充',()=>{
 const provider={id:'p',name:'服务商',model:'moss-transcribe-1.0',enabled:true,hasKey:true};
 const html=renderDashboard({state:{providers:[provider],active:'p',strategy:'fallback',logs:[{status:502,latency:15,time:new Date().toISOString(),provider:'服务商',model:provider.model}]},esc,ready:item=>item.enabled,isManager:true});
 assert.match(html,/完成首次成功调用/);
 assert.match(html,/setup-checklist/);
 assert.doesNotMatch(html,/progress-ring/);
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

test('概览分别呈现请求与尝试，未知费用不能显示为零',()=>{
 const nodes=Object.fromEntries(['final-rate','final-detail','requests','tokens','token-detail','average-latency','failed-attempts','costs','trend','usage-link','error-link'].map(id=>['#dashboard-'+id,{textContent:'',innerHTML:'',setAttribute(name,value){this[name]=value;}}]));
 const root={querySelector:selector=>nodes[selector]||null};
 renderDashboardSummary(root,{days:30,totals:{requests:2,requestSuccesses:2,successes:2,failures:1,averageLatency:300,tokens:90,unknownUsage:1},costs:[]},esc);
 assert.equal(nodes['#dashboard-final-rate'].textContent,'100%');
 assert.equal(nodes['#dashboard-failed-attempts'].textContent,'1');
 assert.match(nodes['#dashboard-costs'].innerHTML,/尚无可估算费用/);
 assert.match(nodes['#dashboard-token-detail'].textContent,/1 次用量未知/);
 assert.equal(nodes['#dashboard-error-link'].href,'#logs?status=error&days=30');
 renderDashboardSummary(root,{days:7,totals:{},costs:[{currency:'USD',amount:0,pricedAttempts:1},{currency:'CNY',amount:2,pricedAttempts:1}]},esc);
 assert.equal(nodes['#dashboard-final-rate'].textContent,'—');
 assert.equal(nodes['#dashboard-average-latency'].textContent,'—');
 assert.match(nodes['#dashboard-costs'].innerHTML,/USD/);
 assert.match(nodes['#dashboard-costs'].innerHTML,/CNY/);
 assert.match(nodes['#dashboard-costs'].innerHTML,/>0\.00</);
});

test('概览外部字符串转义且不把服务商配置数量当作健康探测',()=>{
 const html=renderDashboard({state:{providers:[{id:'p',name:'<script>bad</script>',model:'model',models:['model','another'],enabled:true,hasKey:true}],active:'p',strategy:'fallback',logs:[{time:'2026-11-25',provider:'<img onerror=bad>',model:'m',status:502,request_id:'id&other=value'}]},esc,ready:()=>true,isManager:true});
 assert.doesNotMatch(html,/<script>|<img onerror/);
 assert.match(html,/已配置调用入口/);
 assert.match(html,/requestId=id%26other%3Dvalue/);
 assert.match(html,/不代表最终请求结果/);
 assert.match(html,/成功上游尝试平均耗时/);
});
