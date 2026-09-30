import {chmodSync,existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const bounded=(value,max)=>String(value??'').slice(0,max);
const detailColumns='id,area,kind,model,title,status,request_id AS requestId,result,error,created_at AS createdAt,updated_at AS updatedAt';
const listColumns='id,area,kind,model,title,status,request_id AS requestId,error,created_at AS createdAt,updated_at AS updatedAt';
export const MAX_HISTORY_RESULT_BYTES=256*1024;

export class LabHistory {
 constructor(dir,{now=()=>Date.now()}={}){
  this.now=now;const databasePath=path.join(dir,'lab-history.sqlite');this.db=new DatabaseSync(databasePath);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;
   CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,
    area TEXT NOT NULL,kind TEXT,model TEXT,title TEXT,status TEXT NOT NULL,request_id TEXT,
    result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS history_owner ON history(tenant_id,user_id,updated_at DESC);
   CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
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
 deleteTenant(tenantId){this.db.prepare('DELETE FROM history WHERE tenant_id=?').run(tenantId);}
 close(){this.db.close();}
}
