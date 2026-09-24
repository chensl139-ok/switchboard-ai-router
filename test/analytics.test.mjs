import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailySeries} from '../public/analytics.js';

test('用量趋势补齐无调用日期，并跨月保持日期顺序',()=>{
 const rows=[{day:'2026-10-01',requests:4,attempts:5,successes:4,tokens:120}];
 const series=dailySeries(rows,4,new Date('2026-10-02T16:00:00Z'));
 assert.deepEqual(series.map(day=>day.day),['2026-09-29','2026-09-30','2026-10-01','2026-10-02']);
 assert.deepEqual(series.map(day=>day.requests),[0,0,4,0]);
 assert.equal(series[2],rows[0]);
 assert.equal(series[0].tokens,0);
});
