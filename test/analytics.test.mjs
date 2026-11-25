import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailySeries,renderUsageChart,renderAnalytics} from '../public/analytics.js';

test('用量趋势补齐无调用日期，并跨月保持日期顺序',()=>{
 const rows=[{day:'2026-10-01',requests:4,attempts:5,successes:4,tokens:120}];
 const series=dailySeries(rows,4,new Date('2026-10-02T16:00:00Z'));
 assert.deepEqual(series.map(day=>day.day),['2026-09-29','2026-09-30','2026-10-01','2026-10-02']);
 assert.deepEqual(series.map(day=>day.requests),[0,0,4,0]);
 assert.equal(series[2],rows[0]);
 assert.equal(series[0].tokens,0);
});

const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const usageSummary=days=>({days,totals:{requests:2,requestSuccesses:1,attempts:3,successes:1,failures:2,averageLatency:120,unknownUsage:1},daily:[],providers:[{providerId:'p&1',provider:'<Provider>',model:'vendor/a b&c#d"',attempts:3,successes:1,latency:130}],costs:[{currency:'USD',amount:1,pricedAttempts:1},{currency:'CNY',amount:2,pricedAttempts:1}],retentionDays:90,costNotice:'参考估算 <非账单>'});
function usageDOM(){
 const elements=new Map(['usage-days','usage-model-search','usage-model-empty','usage-reset','usage-clear'].map(id=>['#'+id,{value:'',hidden:false}]));
 const content={isConnected:true,innerHTML:'',querySelector:selector=>elements.get(selector),querySelectorAll:()=>[]};elements.set('#usage-content',content);
 const root={isConnected:true,innerHTML:'',contains:node=>node===content&&content.isConnected,querySelector:selector=>elements.get(selector)};
 return {root,content,elements};
}

test('exported usage chart retains request versus attempt columns and escapes UTC labels',()=>{
 const rows=[{day:'2026-11-01<bad>',requests:2,requestSuccesses:1,attempts:3,tokens:6}];
 const html=renderUsageChart(rows,esc);
 assert.match(html,/每日生成请求柱状图/);assert.match(html,/<th>请求<\/th><th>最终成功<\/th><th>上游尝试<\/th>/);assert.match(html,/&lt;bad&gt;/);assert.doesNotMatch(html,/<bad>/);
});

test('analytics validates initial days, labels attempts precisely and encodes observation links',async()=>{
 const previous=globalThis.document;
 try{
  for(const [days,expected] of [[undefined,'7'],['7','7'],[30,'30'],['90','90'],['1','7'],['30&status=error','7'],[['30'],'7'],[null,'7']]){
   const dom=usageDOM();globalThis.document={querySelector:()=>dom.root};const calls=[];
   await renderAnalytics({esc,initialFilters:{days},api:async url=>{calls.push(url);return usageSummary(Number(expected));}});
   assert.deepEqual(calls,['/api/analytics?days='+expected]);assert.equal(dom.elements.get('#usage-days').value,expected);
   const html=dom.content.innerHTML;assert.match(html,/成功上游尝试平均耗时/);assert.doesNotMatch(html,/成功请求平均耗时/);assert.match(html,/尝试平均耗时（含失败）/);assert.match(html,/usage-actions/);
   assert.ok(html.includes(`href="#logs?days=${expected}&amp;status=error"`));
   const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1].replaceAll('&amp;','&'));
   const model=new URLSearchParams(hrefs.find(href=>href.includes('&q=')).split('?')[1]);
   assert.equal(model.get('q'),'vendor/a b&c#d"');assert.equal(model.get('provider'),'p&1');assert.equal(model.get('days'),expected);
   assert.match(html,/USD<\/span><strong>1\.000000/);assert.match(html,/CNY<\/span><strong>2\.000000/);assert.match(html,/未知价格或用量不会被记为零费用/);assert.match(html,/&lt;Provider&gt;/);assert.doesNotMatch(html,/<非账单>/);assert.ok(!dom.root.innerHTML.includes('id="usage-clear"'));
  }
 }finally{globalThis.document=previous;}
});

test('analytics keeps owner actions behind confirmation and discards superseded or departed loads',async()=>{
 const previous=globalThis.document,dom=usageDOM(),pending=[];
 globalThis.document={querySelector:()=>dom.root};
 try{
  const first=renderAnalytics({esc,isOwner:true,api:url=>new Promise(resolve=>pending.push({url,resolve})),initialFilters:{days:30}});
  assert.match(dom.root.innerHTML,/id="usage-reset"/);assert.match(dom.root.innerHTML,/id="usage-clear"/);assert.equal(typeof dom.elements.get('#usage-clear').onclick,'function');
  dom.elements.get('#usage-days').value='90';dom.elements.get('#usage-days').onchange();
  pending[1].resolve(usageSummary(90));await new Promise(setImmediate);assert.match(dom.content.innerHTML,/#logs\?days=90/);
  pending[0].resolve(usageSummary(30));await first;assert.match(dom.content.innerHTML,/#logs\?days=90/);assert.doesNotMatch(dom.content.innerHTML,/#logs\?days=30/);
  dom.elements.get('#usage-days').onchange();dom.content.isConnected=false;dom.content.innerHTML='left-page';pending[2].resolve(usageSummary(90));await new Promise(setImmediate);assert.equal(dom.content.innerHTML,'left-page');
 }finally{globalThis.document=previous;}
});
