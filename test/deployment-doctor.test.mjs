import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDeployment,deploymentsMatch} from '../scripts/doctor.mjs';

test('部署检查只访问就绪和版本接口，不传入路径、凭证或模型请求',async()=>{
 const calls=[],build={version:'2.2.0',fingerprint:'1234567890abcdef'};
 const result=await inspectDeployment('http://127.0.0.1:3100/?private=no#keys',{fetcher:async url=>{calls.push(url);return Response.json(url.endsWith('readyz')?{ok:true}:{build});}});
 assert.deepEqual(calls,['http://127.0.0.1:3100/readyz','http://127.0.0.1:3100/api/account/status']);
 assert.equal(deploymentsMatch([result,{...result,url:'http://127.0.0.1:3110'}]),true);
 assert.equal(deploymentsMatch([result,{...result,build:{...build,fingerprint:'ffffffffffffffff'}}]),false);
 await assert.rejects(inspectDeployment('http://user:secret@example.invalid'),/不含凭证/);
});

test('离线、旧版本和畸形响应不会报告更新成功',async()=>{
 for(const fetcher of [async()=>{throw Error('secret network details');},async()=>Response.json({needsSetup:false}),async()=>new Response('broken')]){
  const result=await inspectDeployment('http://127.0.0.1:3100',{fetcher});assert.equal(deploymentsMatch([result]),false);assert(result.error);assert(!result.error.includes('secret'));
 }
});
