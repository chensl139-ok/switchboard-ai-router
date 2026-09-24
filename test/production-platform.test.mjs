import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlatform} from '../platform.mjs';

test('平台暴露就绪探针、安全响应头和可追踪请求 ID',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'production-platform-')),app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32)});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 try{
  const response=await fetch(base+'/readyz',{headers:{'x-request-id':'test-request-1'}}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.activeRequests,0);assert.equal(response.headers.get('x-request-id'),'test-request-1');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('referrer-policy'),'same-origin');
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('用量数据库损坏时就绪探针不得误报健康',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'production-corrupt-'));
 writeFileSync(path.join(dir,'usage.sqlite'),Buffer.alloc(4096,1));
 const app=createPlatform({dir,admin:'a'.repeat(32),gateway:'g'.repeat(32)});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 try{const response=await fetch(`http://127.0.0.1:${app.address().port}/readyz`);assert.equal(response.status,500);}
 finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
