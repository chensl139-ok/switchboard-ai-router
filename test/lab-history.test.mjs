import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LabHistory} from '../lab-history.mjs';
import {createPlatform} from '../platform.mjs';

test('实验历史按租户和用户隔离，支持更新、查询与删除',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-lab-history-'));
 try{
  const history=new LabHistory(dir),alice={tenantId:'alpha',userId:'alice'},bob={tenantId:'alpha',userId:'bob'},other={tenantId:'beta',userId:'alice'};
  const record=history.put(alice,{area:'media',kind:'video',model:'sample',title:'生成演示视频',status:'submitted',requestId:'job-1'});
  assert.equal(history.list(alice).length,1);assert.equal(history.list(bob).length,0);assert.equal(history.list(other).length,0);
  assert.throws(()=>history.put(bob,{id:record.id,area:'media',status:'completed'}),{status:404});
  const updated=history.put(alice,{id:record.id,area:'media',kind:'video',model:'sample',title:'生成演示视频',status:'completed',requestId:'job-1',result:'{"videos":[]}'});
  assert.equal(updated.createdAt,record.createdAt);assert.equal(history.list(alice)[0].status,'completed');
  assert.equal('result' in history.list(alice)[0],false);assert.equal(history.get(alice,record.id).result,'{"videos":[]}');
  assert.throws(()=>history.get(other,record.id),{status:404});
  assert.throws(()=>history.put(alice,{area:'chat',status:'completed',result:'x'.repeat(50001)}),{status:400});
  assert.throws(()=>history.delete(bob,record.id),{status:404});
  const restored=new LabHistory(dir);assert.equal(restored.list(alice)[0].requestId,'job-1');
  assert.equal(restored.delete(alice,record.id).ok,true);assert.equal(restored.list(alice).length,0);
  restored.put(other,{area:'chat',status:'completed',title:'hello'});restored.deleteTenant('beta');assert.equal(restored.list(other).length,0);restored.close();history.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('实验历史从旧 JSON 迁移到 SQLite，保留旧文件且不会重复导入',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-lab-history-migrate-')),id='11111111-1111-4111-8111-111111111111',caller={tenantId:'alpha',userId:'alice'};
 try{writeFileSync(path.join(dir,'lab-history.json'),JSON.stringify([{id,tenantId:'alpha',userId:'alice',area:'chat',kind:'conversation',status:'completed',title:'旧对话',result:'{"messages":[]}',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}]));
  const first=new LabHistory(dir);assert.equal(first.list(caller).length,1);assert.equal(first.get(caller,id).title,'旧对话');first.close();
  const second=new LabHistory(dir);assert.equal(second.list(caller).length,1);second.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('实验历史 HTTP 接口按登录用户隔离，不允许跨用户删除',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-lab-history-http-')),admin='a'.repeat(32),password='owner-password-123',app=createPlatform({dir,admin,gateway:'g'.repeat(32)});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
 const request=async(route,data,cookie='')=>{const response=await fetch(base+'/api/account/'+route,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const root=(await request('setup',{name:'Owner',email:'owner@example.test',password,bootstrapToken:admin})).cookie;
  const invite=(await request('invite',{email:'member@example.test',role:'member'},root)).body;
  const member=(await request('register',{name:'Member',email:'member@example.test',password,inviteCode:invite.code})).cookie;
  const saved=await request('lab-history',{area:'chat',kind:'conversation',model:'auto',title:'测试',status:'completed',result:'{"messages":[]}'},root);
  assert.equal(saved.status,200);assert.equal((await request('lab-history',null,member)).body.items.length,0);
  assert.equal('result' in (await request('lab-history',null,root)).body.items[0],false);
  assert.equal((await request('lab-history/item?id='+saved.body.id,null,root)).body.result,'{"messages":[]}');
  assert.equal((await request('lab-history/item?id='+saved.body.id,null,member)).status,404);
  assert.equal((await request('lab-history/delete',{id:saved.body.id},member)).status,404);
  assert.equal((await request('lab-history/delete',{id:saved.body.id},root)).status,200);
  assert.equal((await request('lab-history',null,root)).body.items.length,0);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
