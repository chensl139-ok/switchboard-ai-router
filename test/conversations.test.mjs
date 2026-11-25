import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LabHistory,autoTitle} from '../lab-history.mjs';
import {createPlatform} from '../platform.mjs';

const alice={tenantId:'alpha',userId:'alice',role:'member'},bob={...alice,userId:'bob'},other={...alice,tenantId:'beta'};
const MiB=1024*1024;
const body={messages:[{role:'user',content:'你好'},{role:'assistant',content:'回答'}],draft:'',settings:{target:'auto'}};
const version=row=>({id:row.id,expectedRevision:row.revision});
const run=row=>({...version(row),runId:row.runId,...body});
function fixture(t,options){
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-conversations-')),history=new LabHistory(dir,options);
 t.after(()=>{history.close();rmSync(dir,{recursive:true,force:true});});return {dir,history};
}
const rejects=(fn,status,message)=>assert.throws(fn,error=>error.status===status&&(!message||message.test(error.message)));

 test('会话持久化、分页搜索、归档和归属，列表不泄漏正文或运行凭证',t=>{
 let clock=0;const {dir,history:h}=fixture(t,{now:()=>clock++});
 const first=h.createConversation(alice,{title:'100%_案例',...body,draft:'待发送'});
 assert.equal(first.revision,1);assert.equal(first.status,'idle');assert.equal(first.runId,null);assert.equal(first.sourceHistoryId,null);
 for(let i=0;i<24;i++)h.createConversation(alice,{title:'会话 '+i});
 const pinned=h.updateConversation(alice,{...version(first),pinned:true});
 const hidden=h.createConversation(alice,{title:'归档'});h.updateConversation(alice,{...version(hidden),archived:true});
 h.createConversation(bob,{title:'其他用户'});h.createConversation(other,{title:'其他租户'});
 const page=h.pageConversations(alice),next=h.pageConversations(alice,{page:2});
 assert.equal(page.total,25);assert.equal(page.pages,2);assert.equal(page.items.length,20);assert.equal(next.items.length,5);
 assert.equal(page.items[0].id,first.id);assert.equal(page.items[0].pinned,true);
 assert.equal(new Set([...page.items,...next.items].map(row=>row.id)).size,25);
 for(const field of ['messages','draft','settings','runId','tenantId','userId'])assert.equal(field in page.items[0],false);
 assert.equal(h.pageConversations(alice,{q:'%_'}).total,1);assert.equal(h.pageConversations(alice,{q:'回答'}).total,1);
 assert.equal(h.pageConversations(alice,{q:"' OR 1=1 --"}).total,0);
 assert.equal(h.pageConversations(alice,{archived:'true'}).total,1);assert.equal(h.pageConversations(alice,{archived:'all'}).total,26);
 assert.equal(h.pageConversations(alice,{page:999}).page,2);
 for(const options of [{archived:'bad'},{page:0},{page:1.5},{limit:101}])rejects(()=>h.pageConversations(alice,options),400);
 for(const caller of [bob,other]){
  rejects(()=>h.getConversation(caller,first.id),404);
  for(const method of ['updateConversation','startConversationRun','checkpointConversationRun','finishConversationRun','recoverConversationRun','deleteConversation'])rejects(()=>h[method](caller,version(first)),404);
 }
 const reopened=new LabHistory(dir);try{assert.deepEqual(reopened.getConversation(alice,first.id),pinned);assert.equal(reopened.pageConversations(alice).total,25);}finally{reopened.close();}
});

test('严格白名单、UTF-8 字节限制和偏好 CAS；viewer 所有写入拒绝',t=>{
 const {history:h}=fixture(t),viewer={...alice,role:'viewer'};
 for(const method of ['createConversation','updateConversation','startConversationRun','checkpointConversationRun','finishConversationRun','recoverConversationRun','deleteConversation','importConversation','updateWorkspacePreferences'])rejects(()=>h[method](viewer,{}),403);
 const item=h.createConversation(alice,{...body,title:'白名单',messages:[{role:'user',content:'缺失附件',missingAttachments:true,image_url:'https://secret.test/image.png',attachments:[{data:'secret'}]},{role:'assistant',content:'文本',reasoning_content:'理由',label:'模型',status:'完成',durationMs:25,outputTokens:10,tool_calls:[{function:{arguments:'secret'}}],stats:{tps:5,raw:'secret'},route:{model:'model',provider:'p',url:'https://secret.test'}}],settings:{target:'auto',transport:'sse',thinking:'auto',showThinking:true,maxTokens:2048,tools:'[{"type":"function"}]',apiKey:'secret'}});
 assert.equal(item.messages[0].missingAttachments,true);assert.equal(item.messages[1].tool_calls,true);
 assert.deepEqual(item.messages[1].stats,{tps:5});assert.deepEqual(item.messages[1].route,{provider:'p',model:'model'});
 assert.doesNotMatch(JSON.stringify(item),/secret|image_url|apiKey/);
 assert.equal(item.bytes,Buffer.byteLength(JSON.stringify({title:item.title,messages:item.messages,draft:item.draft,settings:item.settings})));
 for(const input of [{messages:[{role:'system',content:'x'}]},{messages:[{role:'user',content:[{type:'image_url'}]}]},{messages:[{role:'user',content:'data:image/png;base64,secret'}]},{settings:{tools:'{}'}},{settings:{maxTokens:'1'}},{settings:{showThinking:1}},{draft:null},{pinned:'yes'},{messages:[{role:'assistant',content:'',stats:{tps:{secret:true}}}]}])rejects(()=>h.createConversation(alice,input),400);
 for(const input of [{title:'x'.repeat(181)},{draft:'中'.repeat(21846)},{messages:[{role:'assistant',content:'中'.repeat(Math.ceil(MiB/3))}]},{settings:{tools:JSON.stringify(['x'.repeat(16384)])}}])rejects(()=>h.createConversation(alice,input),413);
 assert.equal(h.createConversation(alice,{draft:'x'.repeat(65536)}).draft.length,65536);
 assert.deepEqual(h.getWorkspacePreferences(alice),{revision:0,favorites:[]});
 const preferences=h.updateWorkspacePreferences(alice,{expectedRevision:0,favorites:['auto','model']});assert.deepEqual(preferences,{revision:1,favorites:['auto','model']});
 rejects(()=>h.updateWorkspacePreferences(alice,{expectedRevision:0,favorites:[]}),409);
 assert.deepEqual(h.getWorkspacePreferences(bob),{revision:0,favorites:[]});assert.deepEqual(h.getWorkspacePreferences(other),{revision:0,favorites:[]});
 for(const favorites of [Array(201).fill('x'),['x'.repeat(513)],[{}]])rejects(()=>h.updateWorkspacePreferences(alice,{expectedRevision:1,favorites}),400);
 assert.equal(h.updateWorkspacePreferences(alice,{expectedRevision:1,favorites:Array(200).fill('x'.repeat(512))}).favorites.length,200);
 assert.deepEqual(h.getConversation(viewer,item.id),item);
 const nullable=h.createConversation(alice,{messages:[{role:'assistant',content:'',route:null,outputTokens:null,stats:{ttfb:null,ttft:null,tps:null,tpot:null,blocks:0}}]});
 assert.deepEqual(nullable.messages[0].stats,{ttfb:null,ttft:null,tps:null,tpot:null,blocks:0});
 const legacy=h.put(alice,{area:'chat',status:'completed',result:JSON.stringify({version:2,messages:[{role:'assistant',content:'文本',route:null,stats:{tps:null,ttft:null,tpot:5}}]})});
 assert.deepEqual(h.importConversation(alice,{historyId:legacy.id}).messages[0].stats,{tps:null,ttft:null,tpot:5});
});

test('跨连接 CAS、租约续期、过期显式恢复与旧 runId 隔离',t=>{
 let now=1000;const {dir,history:h}=fixture(t,{now:()=>now}),second=new LabHistory(dir,{now:()=>now});t.after(()=>second.close());
 let row=h.createConversation(alice,body),stale={...row};row=h.updateConversation(alice,{...version(row),title:'更新'});
 rejects(()=>second.updateConversation(alice,{...version(stale),title:'覆盖'}),409);rejects(()=>h.deleteConversation(alice,version(stale)),409);
 rejects(()=>h.updateConversation(alice,{id:row.id}),400);rejects(()=>h.startConversationRun(alice,version(row)),400);
 row=h.startConversationRun(alice,{...version(row),...body});assert.equal(row.leaseUntil,121000);assert.equal(row.status,'running');const oldRunId=row.runId;
 for(const method of ['updateConversation','startConversationRun','recoverConversationRun','deleteConversation'])rejects(()=>h[method](alice,{...version(row),...body}),409);
 rejects(()=>h.checkpointConversationRun(alice,{...run(row),runId:'wrong'}),409);
 stale=row;now+=60000;row=second.checkpointConversationRun(alice,run(row));assert.equal(row.leaseUntil,181000);
 rejects(()=>h.checkpointConversationRun(alice,run(stale)),409);
 now=row.leaseUntil;
 rejects(()=>h.checkpointConversationRun(alice,run(row)),409);rejects(()=>h.startConversationRun(alice,{...version(row),...body}),409);rejects(()=>h.deleteConversation(alice,version(row)),409);
 row=h.recoverConversationRun(alice,version(row));assert.equal(row.status,'interrupted');assert.equal(row.runId,null);assert.equal(row.leaseUntil,null);assert.deepEqual(row.messages,body.messages);
 rejects(()=>h.finishConversationRun(alice,{...run(row),runId:oldRunId,status:'completed'}),409);
 row=h.startConversationRun(alice,{...version(row),...body});assert.notEqual(row.runId,oldRunId);
 for(const method of ['checkpointConversationRun','finishConversationRun'])rejects(()=>h[method](alice,{...run(row),runId:oldRunId,status:'completed'}),409);
 rejects(()=>h.finishConversationRun(alice,{...run(row),status:'idle'}),400);
 row=h.finishConversationRun(alice,{...run(row),status:'completed'});assert.equal(row.runId,null);assert.equal(row.leaseUntil,null);
 for(const status of ['failed','stopped']){row=h.startConversationRun(alice,{...version(row),...body});row=h.finishConversationRun(alice,{...run(row),status});assert.equal(row.status,status);}
 row=h.updateConversation(alice,{...version(row),archived:true});rejects(()=>h.startConversationRun(alice,{...version(row),...body}),409);
 assert.deepEqual(h.deleteConversation(alice,version(row)),{ok:true});rejects(()=>h.getConversation(alice,row.id),404);
});

test('200 条限制含归档且不自动删除；原历史 100/5000 裁剪不触碰会话',t=>{
 let now=Date.now();const {history:h}=fixture(t,{now:()=>now++});let first;
 for(let i=0;i<200;i++){const row=h.createConversation(alice,{title:'保留 '+i});first??=row;if(i===0)h.updateConversation(alice,{...version(row),archived:true});}
 rejects(()=>h.createConversation(alice,{title:'超额'}),409,/200/);assert.equal(h.pageConversations(alice,{archived:'all'}).total,200);assert.equal(h.getConversation(alice,first.id).archived,true);
 const insert=h.db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
 h.db.exec('BEGIN');for(let i=0;i<5101;i++)insert.run('seed-'+i,'seed','user-'+Math.floor(i/100),'chat','','','历史','completed','','','','2020','2020');h.db.exec('COMMIT');
 for(let i=0;i<101;i++)h.put(alice,{area:'chat',status:'completed',title:'历史 '+i});
 assert.equal(h.list(alice).length,100);assert.equal(h.db.prepare('SELECT count(*) AS n FROM history').get().n,5000);assert.equal(h.pageConversations(alice,{archived:'all'}).total,200);
 const current=h.getConversation(alice,first.id);h.deleteConversation(alice,version(current));assert.equal(h.createConversation(alice,{}).revision,1);
});

test('真实个人字节配额、聚合租户/全局配额与失败回滚',t=>{
 const {history:h}=fixture(t),large={messages:[{role:'assistant',content:'x'.repeat(MiB-1024)}]};
 const first=h.createConversation(alice,large);for(let i=1;i<32;i++)h.createConversation(alice,large);
 rejects(()=>h.createConversation(alice,large),413,/32MiB/);assert.equal(h.pageConversations(alice).total,32);assert.equal(h.getConversation(alice,first.id).revision,1);
 rejects(()=>h.updateConversation(alice,{...version(first),messages:[{role:'assistant',content:'x'.repeat(MiB)}]}),413,/1MiB/);assert.equal(h.getConversation(alice,first.id).revision,1);
 h.updateConversation(alice,{...version(first),messages:[]});h.createConversation(alice,large);assert.equal(h.pageConversations(alice).total,33);
 h.deleteTenant(alice.tenantId);
 const tenantSeed=h.createConversation(bob,{});h.db.prepare('UPDATE conversations SET bytes=? WHERE id=?').run(256*MiB,tenantSeed.id);
 rejects(()=>h.createConversation(alice,{}),413,/256MiB/);assert.equal(h.getConversation(bob,tenantSeed.id).revision,1);
 const globalSeed=h.createConversation(other,{});h.db.prepare('UPDATE conversations SET bytes=? WHERE id=?').run(768*MiB,globalSeed.id);
 rejects(()=>h.createConversation({...alice,tenantId:'gamma'},{}),413,/1GiB/);
 assert.equal(h.db.prepare('SELECT count(*) AS n FROM conversations').get().n,2);
});

test('历史完整纯文本导入、停止失败恢复、源归属与联合唯一幂等',t=>{
 const {dir,history:h}=fixture(t);
 const snapshot={version:2,truncated:false,clipped:false,omittedMessages:0,target:'model-a',messages:[...body.messages,{role:'user',content:'重试问题'},{role:'assistant',content:'部分回答',status:'已停止'}]};
 const save=(value,extra={})=>h.put(alice,{area:'chat',kind:'conversation',status:'stopped',title:'历史原件',result:JSON.stringify(value),...extra});
 const old=save(snapshot),row=h.importConversation(alice,{historyId:old.id});
 assert.equal(row.sourceHistoryId,old.id);assert.deepEqual(row.messages,[body.messages[0],{...body.messages[1],status:'完成',reasoning_content:''}]);assert.equal(row.draft,'重试问题');assert.equal(row.settings.target,'model-a');assert.equal(row.revision,1);
 assert.deepEqual({...h.get(alice,old.id)},old);assert.equal(h.importConversation(alice,{historyId:old.id}).id,row.id);
 const reopened=new LabHistory(dir);try{assert.equal(reopened.importConversation(alice,{historyId:old.id}).id,row.id);}finally{reopened.close();}
 for(const caller of [bob,other])rejects(()=>h.importConversation(caller,{historyId:old.id}),404);
 h.delete(alice,old.id);assert.equal(h.importConversation(alice,{historyId:old.id}).id,row.id);
 const failed=save({...snapshot,target:undefined,messages:[{role:'user',content:'失败草稿'},{role:'assistant',content:'',status:'失败'}]},{status:'failed'});
 const resumed=h.importConversation(alice,{historyId:failed.id});assert.deepEqual(resumed.messages,[]);assert.equal(resumed.draft,'失败草稿');assert.equal(resumed.settings.target,'auto');
 for(const value of [{...snapshot,version:1},{...snapshot,truncated:true},{...snapshot,clipped:true},{...snapshot,omittedMessages:1},{...snapshot,messages:[]},{...snapshot,messages:[null]},{...snapshot,messages:[{role:'system',content:'x'}]},{...snapshot,messages:[{role:'assistant',content:'工具',tools:'[]'}]},{...snapshot,messages:[{role:'user',content:'[图片未保存在历史中]'}]},{...snapshot,messages:[{role:'assistant',content:'未完',status:'生成中'}]},{...snapshot,messages:[{role:'user',content:[]}]},{...snapshot,messages:[{role:'user',content:'素材',missingAttachments:true}]}])rejects(()=>h.importConversation(alice,{historyId:save(value).id}),400);
 for(const extra of [{area:'media'},{status:'running'},{status:'submitted'},{result:'invalid JSON'}])rejects(()=>h.importConversation(alice,{historyId:save(snapshot,extra).id}),400);
 assert.equal(h.pageConversations(alice).total,2);
});

test('原 13 列数据库增量兼容、偏好持久化和租户清理事务回滚',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-conversations-legacy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(path.join(dir,'lab-history.sqlite')),id='11111111-1111-4111-8111-111111111111';
 db.exec(`CREATE TABLE history(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,area TEXT NOT NULL,kind TEXT,model TEXT,title TEXT,status TEXT NOT NULL,request_id TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO metadata VALUES('legacy_import','done');`);
 db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'alpha','alice','chat','conversation','model','旧标题','completed','','{}','','2020','2020');db.close();
 let h=new LabHistory(dir);
 try{
  assert.equal(h.db.prepare('PRAGMA table_info(history)').all().length,13);assert.equal(h.get(alice,id).title,'旧标题');assert.equal(h.db.prepare("SELECT value FROM metadata WHERE key='workspace_schema'").get().value,'2');
  h.createConversation(alice,body);h.createConversation(other,body);h.updateWorkspacePreferences(alice,{expectedRevision:0,favorites:['a']});h.updateWorkspacePreferences(other,{expectedRevision:0,favorites:['b']});
  h.close();h=new LabHistory(dir);assert.deepEqual(h.getWorkspacePreferences(alice),{revision:1,favorites:['a']});
  h.db.exec("CREATE TRIGGER prevent_preferences_delete BEFORE DELETE ON workspace_preferences BEGIN SELECT RAISE(ABORT,'rollback test'); END;");
  assert.throws(()=>h.deleteTenant('alpha'),/rollback test/);assert.equal(h.get(alice,id).title,'旧标题');assert.equal(h.pageConversations(alice).total,1);assert.equal(h.getWorkspacePreferences(alice).revision,1);
  h.db.exec('DROP TRIGGER prevent_preferences_delete');h.deleteTenant('alpha');
  assert.equal(h.list(alice).length,0);assert.equal(h.pageConversations(alice).total,0);assert.equal(h.getWorkspacePreferences(alice).revision,0);
  assert.equal(h.pageConversations(other).total,1);assert.equal(h.getWorkspacePreferences(other).revision,1);
 }finally{h.close();}
});

test('3.0 的 17 列会话增量迁移保留所有旧字段、历史和偏好，二次启动幂等',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-conversations-v3-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(path.join(dir,'lab-history.sqlite'));
 db.exec(`CREATE TABLE conversations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,
  title TEXT NOT NULL,messages TEXT NOT NULL,draft TEXT NOT NULL,settings TEXT NOT NULL,pinned INTEGER NOT NULL,archived INTEGER NOT NULL,
  status TEXT NOT NULL,revision INTEGER NOT NULL,run_id TEXT,lease_until INTEGER,bytes INTEGER NOT NULL,source_history_id TEXT,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(tenant_id,user_id,source_history_id));
  CREATE TABLE history(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,area TEXT NOT NULL,kind TEXT,model TEXT,title TEXT,status TEXT NOT NULL,request_id TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  INSERT INTO metadata VALUES('workspace_schema','1'),('legacy_import','done');
  CREATE TABLE workspace_preferences(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,revision INTEGER NOT NULL,favorites TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id));
  INSERT INTO workspace_preferences VALUES('alpha','alice',7,'["model-a","auto"]');`);
 const historyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(historyId,'alpha','alice','chat','conversation','model-a','历史原件','completed','request-old','{"version":2}','','2020','2021');
 for(const [i,title] of ['原标题\n中文😀','','新对话'].entries()){
  const id=`11111111-1111-4111-8111-11111111111${i}`,messages=JSON.stringify(body.messages),draft='原草稿',settings=JSON.stringify(body.settings);
  const bytes=Buffer.byteLength(JSON.stringify({title,messages:body.messages,draft,settings:body.settings}));
  db.prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'alpha','alice',title,messages,draft,settings,i===0?1:0,i===1?1:0,i===0?'running':'completed',9+i,i===0?'old-run':null,i===0?123456:null,bytes,i===0?historyId:null,'2020','2021');
 }
 assert.equal(db.prepare('PRAGMA table_info(conversations)').all().length,17);
 const originals=db.prepare('SELECT * FROM conversations ORDER BY id').all(),oldHistory=db.prepare('SELECT * FROM history').all(),oldPreferences=db.prepare('SELECT * FROM workspace_preferences').all();db.close();
 let h=new LabHistory(dir),created;
 try{
  for(let restart=0;restart<2;restart++){
   const columns=h.db.prepare('PRAGMA table_info(conversations)').all(),mode=columns.find(column=>column.name==='title_mode');
   assert.equal(columns.length,18);assert.equal(mode.type,'TEXT');assert.equal(mode.notnull,1);assert.equal(mode.dflt_value,"'manual'");
   assert.equal(h.db.prepare("SELECT value FROM metadata WHERE key='workspace_schema'").get().value,'2');
   for(const original of originals){
    const actual=h.db.prepare('SELECT * FROM conversations WHERE id=?').get(original.id);
    assert.equal(actual.title_mode,'manual');delete actual.title_mode;assert.deepEqual(actual,original);
    const detail=h.getConversation(alice,original.id);assert.equal(detail.title,original.title);assert.equal(detail.titleMode,'manual');assert.equal(detail.revision,original.revision);
   }
   assert.deepEqual(h.db.prepare('SELECT * FROM history').all(),oldHistory);assert.deepEqual(h.db.prepare('SELECT * FROM workspace_preferences').all(),oldPreferences);
   assert.deepEqual(h.getWorkspacePreferences(alice),{revision:7,favorites:['model-a','auto']});
   if(restart===0){created=h.createConversation(alice,{...body});h.close();h=new LabHistory(dir);}else assert.deepEqual(h.getConversation(alice,created.id),created);
  }
 }finally{h.close();}
});

test('autoTitle 只取首条非空 user 正文，折叠空白并按码点限制为 48 字符',()=>{
 assert.equal(autoTitle([{role:'assistant',content:'忽略'},{role:'user',content:' \n\t ',attachments:[{data:'secret'}]},{role:'user',content:' \n中文😀\t\t问题\r\n第二行　 好 '},{role:'user',content:'不取后续'}]),'中文😀 问题 第二行 好');
 assert.equal(autoTitle([]),'');assert.equal(autoTitle([{role:'assistant',content:'回答'},{role:'user',content:'',missingAttachments:true,attachments:[{data:'secret'}]}]),'');
 for(const point of ['中','😀','a']){
  assert.equal(autoTitle([{role:'user',content:point.repeat(48)}]),point.repeat(48));
  const truncated=autoTitle([{role:'user',content:point.repeat(49)}]);assert.equal(truncated,point.repeat(47)+'…');assert.equal(Array.from(truncated).length,48);
 }
 assert.equal(autoTitle([{role:'user',content:'中'.repeat(46)+'😀后续'}]),'中'.repeat(46)+'😀…');
});

test('auto 标题仅在首次有效 run 原子保存，附件不入标题且后续运行不覆盖',t=>{
 const {history:h}=fixture(t,{now:()=>1000});
 const submitted={messages:[{role:'assistant',content:'不是标题'},{role:'user',content:' \n ',attachments:[{data:'secret'}]},{role:'user',content:'  中文😀\n 首次问题  ',missingAttachments:true,attachments:[{data:'secret'}]},{role:'user',content:'后续问题'}],draft:'',settings:{target:'auto'}};
 for(const input of [{},{title:''},{title:'新对话'}]){
  let row=h.createConversation(alice,{...body,...input,titleMode:'manual'});assert.equal(row.titleMode,'auto');assert.equal(row.title,input.title??'');
  row=h.updateConversation(alice,{...version(row),draft:'不应成为标题',titleMode:'manual'});assert.equal(row.titleMode,'auto');
  const before={...row};rejects(()=>h.startConversationRun(alice,{...version(row),...submitted,messages:[{role:'user',content:'中'.repeat(MiB)}]}),413);
  assert.deepEqual(h.getConversation(alice,row.id),before);
  row=h.startConversationRun(alice,{...version(row),...submitted,title:'不得写入',titleMode:'manual'});
  assert.equal(row.title,'中文😀 首次问题');assert.equal(row.titleMode,'auto');assert.equal(row.revision,before.revision+1);assert.equal(row.leaseUntil,121000);assert.ok(row.runId);assert.equal(row.status,'running');
  assert.doesNotMatch(JSON.stringify(row),/secret/);assert.deepEqual(h.getConversation(alice,row.id),row);
  const listed=h.pageConversations(alice).items.find(item=>item.id===row.id);assert.equal(listed.titleMode,'auto');assert.equal(listed.title,row.title);
  row=h.checkpointConversationRun(alice,run(row));assert.equal(row.title,'中文😀 首次问题');
  row=h.finishConversationRun(alice,{...run(row),status:'completed'});assert.equal(row.title,'中文😀 首次问题');
  row=h.startConversationRun(alice,{...version(row),...body});assert.equal(row.title,'中文😀 首次问题');
 }
 let empty=h.createConversation(alice,{title:'新对话'});
 empty=h.startConversationRun(alice,{...version(empty),...body,messages:[{role:'user',content:' \n ',missingAttachments:true}]});assert.equal(empty.title,'新对话');
 empty=h.finishConversationRun(alice,{...run(empty),status:'completed'});
 empty=h.startConversationRun(alice,{...version(empty),...body});assert.equal(empty.title,'你好');
});

test('自定标题、分支标题、手工空标题及旧历史导入均为 manual，不接受客户端 titleMode',t=>{
 const {history:h}=fixture(t);
 for(const title of ['自定标题','原会话 · 分支']){
  let row=h.createConversation(alice,{title,titleMode:'auto'});assert.equal(row.titleMode,'manual');
  row=h.startConversationRun(alice,{...version(row),...body});assert.equal(row.title,title);assert.equal(row.titleMode,'manual');
 }
 for(const title of ['', '新对话','手工修改']){
  let row=h.createConversation(alice,{});row=h.updateConversation(alice,{...version(row),title,titleMode:'auto'});assert.equal(row.titleMode,'manual');
  row=h.startConversationRun(alice,{...version(row),...body});assert.equal(row.title,title);assert.equal(row.titleMode,'manual');
  row=h.finishConversationRun(alice,{...run(row),status:'completed'});row=h.startConversationRun(alice,{...version(row),...body});assert.equal(row.title,title);
 }
 for(const title of ['', '新对话','历史自定标题']){
  const old=h.put(alice,{area:'chat',status:'completed',title,result:JSON.stringify({version:2,messages:body.messages})});
  let row=h.importConversation(alice,{historyId:old.id,titleMode:'auto'});assert.equal(row.title,title);assert.equal(row.titleMode,'manual');
  row=h.startConversationRun(alice,{...version(row),...body});assert.equal(row.title,title);assert.equal(row.titleMode,'manual');
 }
});

test('跨连接 rename CAS 先获胜时，旧 run/start 不能覆盖手工标题或取得 runId',t=>{
 const {dir,history:h}=fixture(t),second=new LabHistory(dir);t.after(()=>second.close());
 for(const title of ['新对话','并发自定标题']){
  const stale=h.createConversation(alice,{}),renamed=second.updateConversation(alice,{...version(stale),title});
  rejects(()=>h.startConversationRun(alice,{...version(stale),...body}),409);assert.deepEqual(h.getConversation(alice,stale.id),renamed);assert.equal(renamed.runId,null);
  const started=h.startConversationRun(alice,{...version(renamed),...body});assert.equal(started.title,title);assert.equal(started.titleMode,'manual');assert.equal(started.revision,renamed.revision+1);
  rejects(()=>second.updateConversation(alice,{...version(renamed),title:'旧页面'}),409);assert.deepEqual(second.getConversation(alice,started.id),started);
 }
});

test('usage 含归档、隔离用户租户，不随搜索分页筛选变化，删除后下降至零',t=>{
 const {history:h}=fixture(t),limits={count:200,bytes:33554432,conversationBytes:1048576,draftBytes:65536};
 assert.deepEqual(h.pageConversations(alice).usage,{count:0,bytes:0,limits});
 const visible=h.createConversation(alice,{title:'可见',...body}),second=h.createConversation(alice,{title:'第二条'});
 let archived=h.createConversation(alice,{title:'归档',draft:'归档正文'});archived=h.updateConversation(alice,{...version(archived),archived:true});
 const foreignUser=h.createConversation(bob,{title:'其他用户',draft:'用户'.repeat(100)}),foreignTenant=h.createConversation(other,{title:'其他租户',draft:'租户'.repeat(200)});
 const usage={count:3,bytes:visible.bytes+second.bytes+archived.bytes,limits};
 for(const options of [{},{q:'可见'},{q:'不存在'},{archived:'true'},{archived:'all'},{page:2,limit:1},{q:'不存在',archived:'false',page:999,limit:1}])assert.deepEqual(h.pageConversations(alice,options).usage,usage);
 assert.equal(h.pageConversations(alice).total,2);assert.equal(h.pageConversations(alice,{archived:'true'}).total,1);assert.equal(h.pageConversations(alice,{q:'不存在'}).total,0);
 assert.deepEqual(h.pageConversations(bob).usage,{count:1,bytes:foreignUser.bytes,limits});assert.deepEqual(h.pageConversations(other).usage,{count:1,bytes:foreignTenant.bytes,limits});
 assert.deepEqual(h.pageConversations({...bob,tenantId:other.tenantId}).usage,{count:0,bytes:0,limits});
 const response=h.pageConversations(alice);response.usage.limits.count=999;assert.deepEqual(h.pageConversations(alice).usage,usage);
 h.deleteConversation(alice,version(archived));assert.deepEqual(h.pageConversations(alice).usage,{count:2,bytes:visible.bytes+second.bytes,limits});
 h.deleteConversation(alice,version(visible));h.deleteConversation(alice,version(second));assert.deepEqual(h.pageConversations(alice).usage,{count:0,bytes:0,limits});
 assert.deepEqual(h.pageConversations(bob).usage,{count:1,bytes:foreignUser.bytes,limits});assert.deepEqual(h.pageConversations(other).usage,{count:1,bytes:foreignTenant.bytes,limits});
});

test('HTTP 新接口沿用 session 与 X-Tenant-ID，viewer 禁写，body 限制不扩散',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'switchboard-conversations-http-')),admin='a'.repeat(32),password='owner-password-123';
 const app=createPlatform({dir,admin,gateway:'g'.repeat(32),oauthConfig:[]});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>app.close(resolve));rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.address().port}/api/account/`;
 const request=async(route,data,cookie='',headers={})=>{
  const response=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 assert.equal((await request('conversations')).status,401);
 const root=(await request('setup',{name:'Owner',email:'owner@example.test',password,bootstrapToken:admin})).cookie;
 const invite=async(role,email)=>{const invitation=await request('invite',{email,role},root);assert.equal(invitation.status,201);return (await request('register',{name:role,email,password,inviteCode:invitation.body.code})).cookie;};
 const member=await invite('member','member@example.test'),viewer=await invite('viewer','viewer@example.test');
 for(const route of ['conversations','conversations/update','conversations/delete','conversations/import','conversations/run/start','conversations/run/checkpoint','conversations/run/finish','conversations/run/recover','workspace/preferences'])assert.equal((await request(route,{},viewer)).status,403,route);
 assert.equal((await request('conversations',{},root,{'X-Tenant-ID':'wrong'})).status,409);
 let response=await request('conversations',{title:'HTTP',...body,tenantId:'evil',userId:'evil'},root);assert.equal(response.status,200);let row=response.body;
 assert.equal((await request('conversations/item?id='+row.id,undefined,root)).status,200);
 assert.equal((await request('conversations/item?id='+row.id,undefined,member)).status,404);
 assert.equal((await request('conversations/update',version(row),member)).status,404);
 const listing=(await request('conversations?archived=all&q=HTTP&page=1&limit=1',undefined,root)).body;
 assert.equal(listing.total,1);assert.equal(row.titleMode,'manual');assert.equal(listing.items[0].titleMode,'manual');
 assert.deepEqual(listing.usage,{count:1,bytes:row.bytes,limits:{count:200,bytes:33554432,conversationBytes:1048576,draftBytes:65536}});
 const viewerPage=await request('conversations',undefined,viewer);assert.equal(viewerPage.status,200);assert.deepEqual(viewerPage.body.usage,{...listing.usage,count:0,bytes:0});
 response=await request('conversations/update',{...version(row),title:'新标题'},root);assert.equal(response.status,200);row=response.body;
 assert.equal((await request('conversations/update',{id:row.id,expectedRevision:1},root)).status,409);
 response=await request('conversations/run/start',{...version(row),...body},root);assert.equal(response.status,200);row=response.body;
 assert.equal((await request('conversations/run/recover',version(row),root)).status,409);
 response=await request('conversations/run/checkpoint',run(row),root);assert.equal(response.status,200);row=response.body;
 response=await request('conversations/run/finish',{...run(row),status:'completed'},root);assert.equal(response.status,200);row=response.body;
 assert.deepEqual((await request('conversations/delete',version(row),root)).body,{ok:true});
 const old=await request('lab-history',{area:'chat',status:'completed',result:JSON.stringify({version:2,truncated:false,messages:body.messages})},root);
 const imported=await request('conversations/import',{historyId:old.body.id},root);assert.equal(imported.status,200);assert.equal((await request('conversations/import',{historyId:old.body.id},root)).body.id,imported.body.id);
 assert.deepEqual((await request('workspace/preferences',undefined,root)).body,{revision:0,favorites:[]});
 assert.equal((await request('workspace/preferences',{expectedRevision:0,favorites:['auto']},root)).body.revision,1);
 assert.equal((await request('workspace/preferences',{expectedRevision:0,favorites:[]},root)).status,409);
 const favorites=Array(200).fill(String.fromCharCode(0).repeat(512));
 assert.equal((await request('workspace/preferences',{expectedRevision:1,favorites},root)).status,200);
 assert.deepEqual((await request('workspace/preferences',undefined,root)).body,{revision:2,favorites});
 assert.equal((await request('conversations',{messages:[{role:'assistant',content:'x'.repeat(100000)}]},root)).status,200);
 const tooBig=await request('conversations',{messages:[{role:'assistant',content:'x'.repeat(MiB+65536)}]},root);assert.equal(tooBig.status,413);assert.ok(tooBig.body.error.message);
 assert.equal((await request('me',{extra:'x'.repeat(66000)},root)).status,413);
});
