import {chmodSync,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const bounded=(value,max)=>String(value??'').slice(0,max);
const detailColumns='id,area,kind,model,title,status,request_id AS requestId,result,error,created_at AS createdAt,updated_at AS updatedAt';
const listColumns='id,area,kind,model,title,status,request_id AS requestId,error,created_at AS createdAt,updated_at AS updatedAt';
export const MAX_HISTORY_RESULT_BYTES=256*1024;

const MiB=1024*1024,LEASE_MS=120000;
const conversationColumns='id,title,messages,draft,settings,pinned,archived,status,revision,run_id AS runId,lease_until AS leaseUntil,bytes,source_history_id AS sourceHistoryId,created_at AS createdAt,updated_at AS updatedAt';
const conversationListColumns='id,title,pinned,archived,status,revision,lease_until AS leaseUntil,bytes,source_history_id AS sourceHistoryId,created_at AS createdAt,updated_at AS updatedAt';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function writable(caller){if(caller.role==='viewer')throw fail('只读角色不可修改工作区',403);}
function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw fail('会话 ID 无效');return value;}
function text(value,name,max=Infinity){
 if(typeof value!=='string')throw fail(name+'必须是文本');
 if(value.length>max)throw fail(name+'过长',413);
 if(/^\s*(?:data:(?:image|video|audio)\/|blob:)/i.test(value))throw fail('请移除媒体数据，使用 missingAttachments 标记');
 return value;
}
function safeMetadata(value,keys){
 if(!object(value))throw fail('消息 metadata 无效');const result={};
 for(const key of keys)if(value[key]!==undefined){const v=value[key];if(typeof v==='string')result[key]=text(v,key,2048);else if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))result[key]=v;else throw fail('消息 metadata 无效');}
 return result;
}
function safeMessages(value){
 if(!Array.isArray(value))throw fail('messages 必须是数组');
 return value.map(item=>{
  if(!object(item)||!['user','assistant'].includes(item.role))throw fail('消息仅支持 user/assistant 文本');
  const message={role:item.role,content:text(item.content,'消息正文')};
  for(const key of ['reasoning_content','label','status'])if(item[key]!==undefined)message[key]=text(item[key],key,key==='reasoning_content'?Infinity:512);
  for(const key of ['durationMs','outputTokens'])if(item[key]!=null){if(!Number.isFinite(item[key])||item[key]<0)throw fail(key+'无效');message[key]=item[key];}
  if(item.missingAttachments!==undefined){if(typeof item.missingAttachments!=='boolean')throw fail('missingAttachments 无效');message.missingAttachments=item.missingAttachments;}
  if(item.tool_calls!==undefined){if(typeof item.tool_calls!=='boolean'&&!Array.isArray(item.tool_calls))throw fail('tool_calls 标记无效');message.tool_calls=Array.isArray(item.tool_calls)?item.tool_calls.length>0:item.tool_calls;}
  if(item.route!=null)message.route=safeMetadata(item.route,['provider','providerId','providerName','model','protocol','reason','attempt','fallback','strategy','target']);
  if(item.stats!=null)message.stats=safeMetadata(item.stats,['tps','ttft','ttfb','tpot','blocks','firstByteMs','latencyMs','durationMs','totalMs','inputTokens','outputTokens','totalTokens','tokens','elapsed','elapsedMs']);
  return message;
 });
}
function safeSettings(value){
 if(!object(value))throw fail('settings 必须是对象');const result={};
 for(const key of ['target','transport','thinking'])if(value[key]!==undefined)result[key]=text(value[key],key,512);
 if(value.showThinking!==undefined){if(typeof value.showThinking!=='boolean')throw fail('showThinking 无效');result.showThinking=value.showThinking;}
 if(value.transport!==undefined&&!['sse','ws','http'].includes(value.transport))throw fail('响应方式无效');
 if(value.thinking!==undefined&&!['auto','enabled','disabled'].includes(value.thinking))throw fail('思考设置无效');
 if(value.maxTokens!==undefined){if(!Number.isSafeInteger(value.maxTokens)||value.maxTokens<1||value.maxTokens>131072)throw fail('maxTokens 无效');result.maxTokens=value.maxTokens;}
 if(value.tools!==undefined){const tools=text(value.tools,'tools');if(Buffer.byteLength(tools)>16*1024)throw fail('tools 超过 16KiB',413);let parsed;try{parsed=JSON.parse(tools);}catch{throw fail('tools 必须是 JSON 数组字符串');}if(!Array.isArray(parsed))throw fail('tools 必须是 JSON 数组字符串');result.tools=tools;}
 return result;
}
function conversationPatch(input,required=false){
 if(!object(input))throw fail('会话参数无效');const patch={};
 if(required&&['messages','draft','settings'].some(key=>input[key]===undefined))throw fail('运行保存需要 messages、draft 和 settings');
 if(input.title!==undefined)patch.title=text(input.title,'标题',180);
 if(input.messages!==undefined)patch.messages=safeMessages(input.messages);
 if(input.draft!==undefined){patch.draft=text(input.draft,'草稿');if(Buffer.byteLength(patch.draft)>64*1024)throw fail('草稿超过 64KiB',413);}
 if(input.settings!==undefined)patch.settings=safeSettings(input.settings);
 for(const key of ['pinned','archived'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw fail(key+'必须是布尔值');patch[key]=input[key];}
 return patch;
}
function decodeConversation(row){if(!row)return row;return {...row,pinned:Boolean(row.pinned),archived:Boolean(row.archived),...('messages' in row?{messages:JSON.parse(row.messages),settings:JSON.parse(row.settings)}:{})};}
function revisionMatches(row,input){if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw fail('expectedRevision 无效');if(row.revision!==input.expectedRevision)throw fail('会话已在其他页面修改，请刷新后重试',409);}
function historyConversation(row){
 if(row.area!=='chat'||['running','submitted'].includes(row.status))throw fail('只能导入已结束的完整聊天历史');
 let snapshot;try{snapshot=JSON.parse(row.result);}catch{throw fail('历史格式不完整');}
 if(!object(snapshot)||snapshot.version!==2||snapshot.truncated||snapshot.clipped||snapshot.omittedMessages||!Array.isArray(snapshot.messages)||!snapshot.messages.length)throw fail('历史未完整保存，无法导入');
 const messages=snapshot.messages.map(item=>{
  if(!object(item)||!['user','assistant'].includes(item.role)||typeof item.content!=='string')throw fail('历史消息格式不完整');
  if(item.tools||item.tool_calls||item.missingAttachments||item.attachments?.length||item.image_url||item.video_url||/\[(?:图片|视频|附件)未保存在历史中\]/.test(item.content))throw fail('历史包含工具或缺失素材，无法导入');
  return {role:item.role,content:item.content,...(item.role==='assistant'?{status:item.status||'完成',label:item.label,route:item.route,stats:item.stats,durationMs:item.durationMs,outputTokens:item.outputTokens,reasoning_content:item.reasoning||''}:{})};
 });
 if(messages.at(-1)?.role==='assistant'&&['失败','已停止','failed','stopped'].includes(messages.at(-1).status))messages.pop();
 const draft=messages.at(-1)?.role==='user'?messages.pop().content:'';
 if(messages.some(item=>['生成中','等待工具结果','running','submitted'].includes(item.status)))throw fail('历史包含尚未完成的回复');
 return {title:row.title,messages,draft,settings:{target:typeof snapshot.target==='string'&&snapshot.target.length<=512?snapshot.target:'auto'}};
}

export class LabHistory {
 constructor(dir,{now=()=>Date.now()}={}){
  this.now=now;const databasePath=path.join(dir,'lab-history.sqlite');this.db=new DatabaseSync(databasePath);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;
   CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,
    area TEXT NOT NULL,kind TEXT,model TEXT,title TEXT,status TEXT NOT NULL,request_id TEXT,
    result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS history_owner ON history(tenant_id,user_id,updated_at DESC);
   CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   BEGIN IMMEDIATE;
   CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,
    title TEXT NOT NULL,messages TEXT NOT NULL,draft TEXT NOT NULL,settings TEXT NOT NULL,pinned INTEGER NOT NULL,archived INTEGER NOT NULL,
    status TEXT NOT NULL,revision INTEGER NOT NULL,run_id TEXT,lease_until INTEGER,bytes INTEGER NOT NULL,source_history_id TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(tenant_id,user_id,source_history_id));
   CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(tenant_id,user_id,pinned DESC,updated_at DESC);
   CREATE TABLE IF NOT EXISTS workspace_preferences(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,revision INTEGER NOT NULL,favorites TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id));
   INSERT OR IGNORE INTO metadata(key,value) VALUES('workspace_schema','1');
   COMMIT;`);
  for(const file of [databasePath,databasePath+'-wal',databasePath+'-shm'])if(existsSync(file))chmodSync(file,0o600);
  const legacy=path.join(dir,'lab-history.json');
  if(!this.db.prepare("SELECT value FROM metadata WHERE key='legacy_import'").get()){
   const rows=existsSync(legacy)?JSON.parse(readFileSync(legacy,'utf8')):[];
   if(!Array.isArray(rows))throw Error('模型实验室历史文件无效');
   this.db.exec('BEGIN IMMEDIATE');
   try{
    const insert=this.db.prepare('INSERT OR IGNORE INTO history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const row of rows)if(row?.id&&row.tenantId&&row.userId)insert.run(row.id,row.tenantId,row.userId,row.area||'chat',row.kind||'',row.model||'',row.title||'',row.status||'completed',row.requestId||'',row.result||'',row.error||'',row.createdAt||'',row.updatedAt||row.createdAt||'');
    this.db.prepare("INSERT INTO metadata VALUES('legacy_import','done')").run();this.db.exec('COMMIT');
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
 }
 list(caller,{area}={}){
  if(area!==undefined&&!['chat','media'].includes(area))throw fail('实验区域无效');
  return area?this.db.prepare(`SELECT ${listColumns} FROM history WHERE tenant_id=? AND user_id=? AND area=? ORDER BY updated_at DESC,id DESC LIMIT 100`).all(caller.tenantId,caller.userId,area):this.db.prepare(`SELECT ${listColumns} FROM history WHERE tenant_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 100`).all(caller.tenantId,caller.userId);
 }
 page(caller,{area,status,q='',page=1,limit=20,order='recent'}={}){
  if(area!==undefined&&!['chat','media'].includes(area))throw fail('实验区域无效');
  if(status&&!['running','submitted','completed','failed','stopped'].includes(status))throw fail('实验状态无效');
  if(!['recent','oldest'].includes(order))throw fail('排序方式无效');
  page=Number(page);limit=Number(limit);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)throw fail('分页参数无效');
  const clauses=['tenant_id=?','user_id=?'],values=[caller.tenantId,caller.userId];
  if(area){clauses.push('area=?');values.push(area);}if(status){clauses.push('status=?');values.push(status);}
  const term=String(q).trim().slice(0,200);
  if(term){clauses.push("(title LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' OR request_id LIKE ? ESCAPE '\\')");const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';values.push(pattern,pattern,pattern,pattern);}
  const where=clauses.join(' AND '),total=this.db.prepare(`SELECT count(*) AS total FROM history WHERE ${where}`).get(...values).total;
  const pages=Math.max(1,Math.ceil(total/limit));page=Math.min(page,pages);
  const direction=order==='recent'?'DESC':'ASC';
  const items=this.db.prepare(`SELECT ${listColumns} FROM history WHERE ${where} ORDER BY updated_at ${direction},id ${direction} LIMIT ? OFFSET ?`).all(...values,limit,(page-1)*limit);
  return {items,total,page,limit,pages};
 }
 get(caller,id){
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw fail('实验记录 ID 无效');
  const row=this.db.prepare(`SELECT ${detailColumns} FROM history WHERE id=? AND tenant_id=? AND user_id=?`).get(id,caller.tenantId,caller.userId);
  if(!row)throw fail('实验记录不存在',404);return row;
 }
 put(caller,input){
  if(!input||!['chat','media'].includes(input.area)||!['running','submitted','completed','failed','stopped'].includes(input.status))throw fail('实验记录类型或状态无效');
  if(input.id!==undefined&&(typeof input.id!=='string'||!/^[0-9a-f-]{36}$/.test(input.id)))throw fail('实验记录 ID 无效');
  const result=String(input.result??'');if(Buffer.byteLength(result)>MAX_HISTORY_RESULT_BYTES)throw fail('实验记录结果过大');
  const existing=input.id?this.get(caller,input.id):null,now=new Date(this.now()).toISOString();
  const row={id:existing?.id||randomUUID(),area:input.area,kind:bounded(input.kind,30),model:bounded(input.model,200),title:bounded(input.title,180),status:input.status,requestId:bounded(input.requestId,256),result,error:bounded(input.error,1000),createdAt:existing?.createdAt||now,updatedAt:now};
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare(`INSERT INTO history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    area=excluded.area,kind=excluded.kind,model=excluded.model,title=excluded.title,status=excluded.status,
    request_id=excluded.request_id,result=excluded.result,error=excluded.error,updated_at=excluded.updated_at`).run(row.id,caller.tenantId,caller.userId,row.area,row.kind,row.model,row.title,row.status,row.requestId,row.result,row.error,row.createdAt,row.updatedAt);
   this.db.prepare('DELETE FROM history WHERE tenant_id=? AND user_id=? AND id NOT IN (SELECT id FROM history WHERE tenant_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 100)').run(caller.tenantId,caller.userId,caller.tenantId,caller.userId);
   if(this.db.prepare('SELECT count(*) AS total FROM history').get().total>5000)this.db.exec('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY updated_at DESC,id DESC LIMIT 5000)');
   this.db.exec('COMMIT');return row;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 delete(caller,id){this.get(caller,id);this.db.prepare('DELETE FROM history WHERE id=? AND tenant_id=? AND user_id=?').run(id,caller.tenantId,caller.userId);return {ok:true};}
 #transaction(action){
  this.db.exec('BEGIN IMMEDIATE');try{const result=action();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 pageConversations(caller,{q='',archived='false',page=1,limit=20}={}){
  if(!['false','true','all'].includes(String(archived)))throw fail('归档筛选无效');
  page=Number(page);limit=Number(limit);if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('分页参数无效');
  const clauses=['tenant_id=?','user_id=?'],values=[caller.tenantId,caller.userId];
  if(String(archived)!=='all'){clauses.push('archived=?');values.push(String(archived)==='true'?1:0);}
  const term=text(q,'搜索词',200).trim();if(term){clauses.push("(title LIKE ? ESCAPE '\\' OR draft LIKE ? ESCAPE '\\' OR messages LIKE ? ESCAPE '\\')");const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';values.push(pattern,pattern,pattern);}
  const where=clauses.join(' AND '),total=this.db.prepare(`SELECT count(*) AS total FROM conversations WHERE ${where}`).get(...values).total;
  const pages=Math.max(1,Math.ceil(total/limit));page=Math.min(page,pages);
  const items=this.db.prepare(`SELECT ${conversationListColumns} FROM conversations WHERE ${where} ORDER BY pinned DESC,updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values,limit,(page-1)*limit).map(decodeConversation);
  return {items,total,page,limit,pages};
 }
 getConversation(caller,id){
  const row=this.db.prepare(`SELECT ${conversationColumns} FROM conversations WHERE id=? AND tenant_id=? AND user_id=?`).get(uuid(id),caller.tenantId,caller.userId);
  if(!row)throw fail('会话不存在',404);return decodeConversation(row);
 }
 #saveConversation(caller,row,existing=null){
  row.bytes=Buffer.byteLength(JSON.stringify({title:row.title,messages:row.messages,draft:row.draft,settings:row.settings}));
  if(row.bytes>MiB)throw fail('会话正文超过 1MiB',413);
  const owner=this.db.prepare('SELECT count(*) AS count,coalesce(sum(bytes),0) AS bytes FROM conversations WHERE tenant_id=? AND user_id=?').get(caller.tenantId,caller.userId);
  const delta=row.bytes-(existing?.bytes||0);
  if(owner.count+(existing?0:1)>200)throw fail('当前用户在此租户最多保存 200 条会话，请显式删除后重试',409);
  if(owner.bytes+delta>32*MiB)throw fail('当前用户在此租户的会话容量超过 32MiB',413);
  if(this.db.prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM conversations WHERE tenant_id=?').get(caller.tenantId).bytes+delta>256*MiB)throw fail('租户会话容量超过 256MiB',413);
  if(this.db.prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM conversations').get().bytes+delta>1024*MiB)throw fail('全局会话容量超过 1GiB',413);
  this.db.prepare(`INSERT INTO conversations(id,tenant_id,user_id,title,messages,draft,settings,pinned,archived,status,revision,run_id,lease_until,bytes,source_history_id,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,messages=excluded.messages,draft=excluded.draft,settings=excluded.settings,
   pinned=excluded.pinned,archived=excluded.archived,status=excluded.status,revision=excluded.revision,run_id=excluded.run_id,lease_until=excluded.lease_until,bytes=excluded.bytes,updated_at=excluded.updated_at`).run(
   row.id,caller.tenantId,caller.userId,row.title,JSON.stringify(row.messages),row.draft,JSON.stringify(row.settings),Number(row.pinned),Number(row.archived),row.status,row.revision,row.runId,row.leaseUntil,row.bytes,row.sourceHistoryId,row.createdAt,row.updatedAt);
  return row;
 }
 #insertConversation(caller,input,sourceHistoryId=null){
  const patch=conversationPatch(input),now=new Date(this.now()).toISOString();
  return this.#saveConversation(caller,{id:randomUUID(),title:patch.title??'',messages:patch.messages??[],draft:patch.draft??'',settings:patch.settings??{},pinned:false,archived:false,status:'idle',revision:1,runId:null,leaseUntil:null,sourceHistoryId,createdAt:now,updatedAt:now});
 }
 createConversation(caller,input={}){writable(caller);return this.#transaction(()=>this.#insertConversation(caller,input));}
 #mutateConversation(caller,input,action){
  writable(caller);if(!object(input))throw fail('会话参数无效');
  return this.#transaction(()=>{
   const existing=this.getConversation(caller,input.id);revisionMatches(existing,input);
   const row={...existing,revision:existing.revision+1,updatedAt:new Date(this.now()).toISOString()};action(row);
   return this.#saveConversation(caller,row,existing);
  });
 }
 updateConversation(caller,input){return this.#mutateConversation(caller,input,row=>{
  if(row.status==='running')throw fail('运行中的会话只能通过 checkpoint 保存，请先完成或恢复',409);
  Object.assign(row,conversationPatch(input));
 });}
 startConversationRun(caller,input){return this.#mutateConversation(caller,input,row=>{
  if(row.status==='running')throw fail('会话仍在运行，请先完成或显式恢复',409);
  if(row.archived)throw fail('请先取消归档再运行',409);
  const {messages,draft,settings}=conversationPatch(input,true);Object.assign(row,{messages,draft,settings,status:'running',runId:randomUUID(),leaseUntil:this.now()+LEASE_MS});
 });}
 #checkRun(row,input){if(row.status!=='running'||typeof input.runId!=='string'||input.runId!==row.runId)throw fail('运行凭证已失效，请刷新会话',409);}
 checkpointConversationRun(caller,input){return this.#mutateConversation(caller,input,row=>{
  this.#checkRun(row,input);if(row.leaseUntil<=this.now())throw fail('运行租约已过期，请显式恢复',409);
  const {messages,draft,settings}=conversationPatch(input,true);Object.assign(row,{messages,draft,settings,leaseUntil:this.now()+LEASE_MS});
 });}
 finishConversationRun(caller,input){return this.#mutateConversation(caller,input,row=>{
  this.#checkRun(row,input);if(!['completed','failed','stopped'].includes(input.status))throw fail('结束状态无效');
  const {messages,draft,settings}=conversationPatch(input,true);Object.assign(row,{messages,draft,settings,status:input.status,runId:null,leaseUntil:null});
 });}
 recoverConversationRun(caller,input){return this.#mutateConversation(caller,input,row=>{
  if(row.status!=='running'||row.leaseUntil>this.now())throw fail('仅可恢复租约已过期的运行中会话',409);
  Object.assign(row,{status:'interrupted',runId:null,leaseUntil:null});
 });}
 deleteConversation(caller,input){
  writable(caller);if(!object(input))throw fail('会话参数无效');
  return this.#transaction(()=>{const row=this.getConversation(caller,input.id);revisionMatches(row,input);
   if(row.status==='running')throw fail('运行中的会话不可删除，请先完成或显式恢复',409);
   this.db.prepare('DELETE FROM conversations WHERE id=? AND tenant_id=? AND user_id=?').run(row.id,caller.tenantId,caller.userId);return {ok:true};
  });
 }
 importConversation(caller,input){
  writable(caller);const historyId=uuid(input?.historyId);
  return this.#transaction(()=>{
   const existing=this.db.prepare(`SELECT ${conversationColumns} FROM conversations WHERE tenant_id=? AND user_id=? AND source_history_id=?`).get(caller.tenantId,caller.userId,historyId);
   if(existing)return decodeConversation(existing);
   return this.#insertConversation(caller,historyConversation(this.get(caller,historyId)),historyId);
  });
 }
 getWorkspacePreferences(caller){
  const row=this.db.prepare('SELECT revision,favorites FROM workspace_preferences WHERE tenant_id=? AND user_id=?').get(caller.tenantId,caller.userId);
  return row?{revision:row.revision,favorites:JSON.parse(row.favorites)}:{revision:0,favorites:[]};
 }
 updateWorkspacePreferences(caller,input){
  writable(caller);
  if(!object(input)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw fail('expectedRevision 无效');
  if(!Array.isArray(input.favorites)||input.favorites.length>200||input.favorites.some(value=>typeof value!=='string'||value.length>512))throw fail('favorites 最多 200 个、每个最长 512 字符');
  return this.#transaction(()=>{
   const current=this.getWorkspacePreferences(caller);if(current.revision!==input.expectedRevision)throw fail('偏好已在其他页面修改，请刷新后重试',409);
   const row={revision:current.revision+1,favorites:input.favorites};
   this.db.prepare('INSERT INTO workspace_preferences(tenant_id,user_id,revision,favorites) VALUES(?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET revision=excluded.revision,favorites=excluded.favorites').run(caller.tenantId,caller.userId,row.revision,JSON.stringify(row.favorites));return row;
  });
 }
 deleteTenant(tenantId){return this.#transaction(()=>{for(const table of ['history','conversations','workspace_preferences'])this.db.prepare(`DELETE FROM ${table} WHERE tenant_id=?`).run(tenantId);});}
 close(){this.db.close();}
}
