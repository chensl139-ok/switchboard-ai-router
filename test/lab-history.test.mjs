import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LabHistory,MAX_HISTORY_RESULT_BYTES} from '../lab-history.mjs';
import {conversationSnapshot,historyText} from '../public/lab-history-format.js';
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
  assert.throws(()=>history.put(alice,{area:'chat',status:'completed',result:'x'.repeat(MAX_HISTORY_RESULT_BYTES+1)}),{status:400});
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
  const result=conversationSnapshot([{role:'assistant',content:'长回复中文🙂'.repeat(5000)}]);
  const saved=await request('lab-history',{area:'chat',kind:'conversation',model:'auto',title:'测试',status:'completed',result},root);
  assert.equal(saved.status,200);assert.equal((await request('lab-history',null,member)).body.items.length,0);
  assert.equal('result' in (await request('lab-history',null,root)).body.items[0],false);
  assert.equal((await request('lab-history/item?id='+saved.body.id,null,root)).body.result,result);
  assert.equal((await request('lab-history?area=chat&q=测试&status=completed&limit=1',null,root)).body.total,1);
  assert.equal((await request('lab-history?status=invalid',null,root)).status,400);
  assert.equal((await request('lab-history/item?id='+saved.body.id,null,member)).status,404);
  assert.equal((await request('lab-history/delete',{id:saved.body.id},member)).status,404);
  assert.equal((await request('lab-history/delete',{id:saved.body.id},root)).status,200);
  assert.equal((await request('lab-history',null,root)).body.items.length,0);
 }finally{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('历史搜索、分页和排序在服务端执行，并隔离其他账号与租户',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-lab-history-page-')),caller={tenantId:'alpha',userId:'alice'};let clock=0;
 const history=new LabHistory(dir,{now:()=>clock++});
 try{
  for(let i=0;i<25;i++)history.put(caller,{area:'chat',status:i%2?'failed':'completed',title:'演示 '+i,model:'claude',requestId:'task_'+i,result:'秘密内容'});
  history.put({...caller,userId:'bob'},{area:'chat',status:'completed',title:'演示 他人'});
  history.put({...caller,tenantId:'beta'},{area:'chat',status:'completed',title:'演示 其他租户'});
  history.put(caller,{area:'media',status:'submitted',title:'视频 100%'});
  const first=history.page(caller,{area:'chat'}),second=history.page(caller,{area:'chat',page:2});
  assert.equal(first.total,25);assert.equal(first.items.length,20);assert.equal(first.pages,2);assert.equal(second.items.length,5);
  assert.equal(first.items[0].title,'演示 24');assert.equal(history.page(caller,{area:'chat',order:'oldest'}).items[0].title,'演示 0');
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,25);
  assert.equal('result' in first.items[0],false);
  assert.equal(history.page(caller,{q:'claude',status:'failed'}).total,12);
  assert.equal(history.page(caller,{q:'task_13'}).total,1);
  assert.equal(history.page(caller,{q:'%'}).total,1);assert.equal(history.page(caller,{q:"' OR 1=1 --"}).total,0);
  assert.equal(history.page(caller,{area:'chat',page:999}).page,2);
  for(const input of [{page:0},{page:1.5},{limit:101},{order:'desc'},{status:'unknown'},{area:'all'}])assert.throws(()=>history.page(caller,input),{status:400});
 }finally{history.close();rmSync(dir,{recursive:true,force:true});}
});

test('历史保存完整长文本和思考内容，不静默截断，不包含缓存或原始图片',()=>{
 const content='中文🙂代码\n'.repeat(1500),reasoning='思考'.repeat(1000),image='data:image/png;base64,secret';
 const conversation=[{role:'user',content:[{type:'text',text:'看看图片'},{type:'image_url',image_url:{url:image}}]},{role:'assistant',content,reasoning_content:reasoning,cacheMetrics:{rate:0},stats:{tps:10},tool_calls:[{function:{name:'demo',arguments:'{}'}}]}];
 const encoded=conversationSnapshot(conversation),snapshot=JSON.parse(encoded);
 assert.equal(snapshot.truncated,false);assert.equal(snapshot.messages[1].content,content);assert.equal(snapshot.messages[1].reasoning,reasoning);
 assert.equal(snapshot.messages[1].stats.tps,10);assert.match(snapshot.messages[1].tools,/demo/);
 assert.doesNotMatch(encoded,/cacheMetrics|base64|secret/);
 assert.ok(historyText({result:encoded}).includes(content));assert.ok(historyText({result:encoded}).includes(reasoning));
 assert.equal(historyText({result:'{"text":"文本结果"}'}),'文本结果');
});

test('达到总容量上限时明确标记消息丢弃或部分截断，并遵守 UTF-8 字节预算',()=>{
 const large='复杂字符🙂\\\n'.repeat(30000);
 for(const conversation of [[{role:'assistant',content:large,reasoning_content:large,tool_calls:[{function:{arguments:large}}]}],[{role:'user',content:'最初的消息'},{role:'assistant',content:large}]]){
  const encoded=conversationSnapshot(conversation),snapshot=JSON.parse(encoded);
  assert.ok(Buffer.byteLength(encoded)<=MAX_HISTORY_RESULT_BYTES);assert.equal(snapshot.truncated,true);assert.equal(snapshot.clipped,true);assert.ok(snapshot.messages[0].content.length>1200);
  assert.equal(snapshot.omittedMessages,conversation.length-1);
 }
 const snapshot=JSON.parse(conversationSnapshot(Array.from({length:40},()=>({role:'assistant',content:'长回复'.repeat(500)}))));
 assert.equal(snapshot.messages.length,40);assert.equal(snapshot.truncated,false);
});
