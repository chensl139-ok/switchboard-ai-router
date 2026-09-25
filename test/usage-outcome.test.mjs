import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {UsageStore} from '../usage-store.mjs';
import {renderDashboardSummary} from '../public/dashboard.js';

test('故障转移后的请求按最终成功统计，失败尝试仍计入上游健康和日志',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-outcome-')),store=new UsageStore(dir);
 try{
  const day=new Date().toISOString();
  const rows=[
   ['failover','a',502,'a'],['failover','b',200,'a'],
   ['failed','b',503,'a'],['direct','b',200,'b']
  ];
  rows.forEach(([requestId,providerId,status,actorId],index)=>store.record({id:`${index}`,requestId,time:day,providerId,provider:providerId,model:'model',status,actorId,usageKnown:true,outputTokens:status===200?10:0,tokens:status===200?10:0}));
  const summary=store.summary(7);
  assert.deepEqual([summary.totals.requests,summary.totals.requestSuccesses,summary.totals.requestFailures],[3,2,1]);
  assert.deepEqual([summary.totals.attempts,summary.totals.successes,summary.totals.failures],[4,2,2]);
  assert.deepEqual([summary.daily[0].requests,summary.daily[0].requestSuccesses,summary.daily[0].attempts],[3,2,4]);
  assert.equal(store.logs({requestId:'failover'}).total,2);
  const members=store.audit(7).members;
  assert.deepEqual([members.find(row=>row.actorId==='a').requests,members.find(row=>row.actorId==='a').requestSuccesses],[2,1]);
  assert.deepEqual([members.find(row=>row.actorId==='b').requests,members.find(row=>row.actorId==='b').requestSuccesses],[1,1]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('首页按独立请求显示最终成功率，不把已挽回的失败尝试当成失败请求',()=>{
 const rate={textContent:''},detail={textContent:''};
 const root={querySelector(selector){return selector==='#dashboard-final-rate'?rate:detail;}};
 renderDashboardSummary(root,{days:7,totals:{requests:3,requestSuccesses:2,attempts:4,successes:2}});
 assert.equal(rate.textContent,'67%');assert.match(detail.textContent,/2 \/ 3 次最终成功/);
});
