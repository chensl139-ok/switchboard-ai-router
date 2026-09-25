import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabTiming} from '../public/lab-performance.js';

test('TTFT 从请求开始到首个输出计时，忽略角色与用量帧',()=>{
 let clock=1000;const timing=createLabTiming(()=>clock);
 clock=1040;timing.markFirstByte();assert.deepEqual(timing.observe(false),{ttft:null,blocks:0});
 clock=1120;assert.deepEqual(timing.observe(true),{ttft:120,blocks:1});
 clock=1200;assert.deepEqual(timing.observe(true),{ttft:120,blocks:2});
 clock=1250;assert.deepEqual(timing.observe(true),{ttft:120,blocks:3});
 clock=1320;assert.deepEqual(timing.finish(5,{streamed:true}),{durationMs:320,ttfb:40,ttft:120,blocks:3,tpot:50,tps:15.625});
});

test('没有真实输出或用量时不伪造 TTFT、TPOT 和吞吐',()=>{
 let clock=0;const timing=createLabTiming(()=>clock);clock=20;timing.observe(false);clock=40;
 assert.deepEqual(timing.finish(undefined),{durationMs:40,ttfb:null,ttft:null,blocks:0,tpot:null,tps:null});
});

test('突发缓冲输出只显示端到端速率，不伪造解码速度',()=>{
 let clock=0;const timing=createLabTiming(()=>clock);clock=287;timing.observe(true);clock=293;timing.observe(true);clock=300;
 assert.deepEqual(timing.finish(62,{streamed:true}),{durationMs:300,ttfb:287,ttft:287,blocks:2,tpot:null,tps:62/.3});
});

test('HTTP 只报告首响应与端到端吞吐，不伪造首 Token 时间',()=>{
 let clock=0;const timing=createLabTiming(()=>clock);clock=70;timing.markFirstByte();clock=250;
 assert.deepEqual(timing.finish(20),{durationMs:250,ttfb:70,ttft:null,blocks:0,tpot:null,tps:80});
});
