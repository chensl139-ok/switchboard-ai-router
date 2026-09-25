import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const RETENTION_DAYS=90;
export class UsageStore {
 constructor(dir){
  this.db=new DatabaseSync(path.join(dir,'usage.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;
   CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, time TEXT NOT NULL, actor_id TEXT, api_key_id TEXT,
    provider_id TEXT, provider TEXT, model TEXT, status INTEGER, latency INTEGER, input_tokens INTEGER, output_tokens INTEGER,
    tokens INTEGER, usage_known INTEGER, currency TEXT, estimated_cost REAL, price_source TEXT, reason TEXT, transport TEXT);
   CREATE INDEX IF NOT EXISTS calls_time ON calls(time); CREATE INDEX IF NOT EXISTS calls_request ON calls(request_id);
   CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);`);
  this.insert=this.db.prepare(`INSERT OR IGNORE INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  this.prune=this.db.prepare('DELETE FROM calls WHERE time < ?');
  this.routeHits=this.db.prepare(`SELECT status,latency,time FROM calls WHERE (provider_id=? OR provider=?) AND model=? AND time>=? ORDER BY time DESC LIMIT 200`);
  this.routeSince=new Date(Date.now()-RETENTION_DAYS*86400000).toISOString();
  this.routeCache=new Map();this.routeQueue=Promise.resolve();
  this.sweep=setInterval(()=>{this.prune.run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString());this.routeSince=new Date(Date.now()-RETENTION_DAYS*86400000).toISOString();},6*3600000);this.sweep.unref?.();
 }
 record(log){
  this.insert.run(log.id,log.requestId||log.id,log.time,
   log.actorId||null,log.apiKeyId||null,log.providerId||null,log.provider||'',log.model||'',log.status,log.latency||0,
   log.inputTokens??null,log.outputTokens??null,log.tokens||0,log.usageKnown?1:0,log.currency||null,log.estimatedCost??null,log.priceSource||null,log.reason||'',log.transport||'http');
  this.routeQueue=this.routeQueue.then(()=>{this.prune.run(new Date(Date.now()-RETENTION_DAYS*86400000).toISOString());this.routeCache.clear();}).catch(()=>{});
 }
 migrate(logs){if(this.db.prepare("SELECT value FROM metadata WHERE key='legacy_import'").get())return;for(const log of logs)this.record({...log,usageKnown:false});this.db.prepare("INSERT INTO metadata VALUES('legacy_import','done')").run();}
 logs({page=1,limit=50,provider='',status='',apiKeyId='',q='',days='',requestId=''}={}){
  page=Math.max(1,Math.min(10000,Math.trunc(Number(page))||1));limit=Math.max(1,Math.min(100,Math.trunc(Number(limit))||50));
  const clauses=['1=1'],args=[];
  if(provider){clauses.push('provider_id = ?');args.push(provider);}
  if(apiKeyId){clauses.push('api_key_id = ?');args.push(apiKeyId);}
  if(q){const columns=['model','provider','request_id','reason'];clauses.push('('+columns.map(column=>`instr(lower(${column}), lower(?)) > 0`).join(' OR ')+')');args.push(...columns.map(()=>String(q).trim().slice(0,200)));}
  if(requestId){clauses.push('request_id = ?');args.push(String(requestId).slice(0,200));}
  if(days){const period=Math.max(1,Math.min(90,Math.trunc(Number(days))||7));clauses.push('time >= ?');args.push(new Date(Date.now()-period*86400000).toISOString());}
  if(status==='success')clauses.push('status = 200');else if(status==='error')clauses.push('status <> 200');
  const where=clauses.join(' AND ');const total=this.db.prepare(`SELECT count(*) AS total FROM calls WHERE ${where}`).get(...args).total;
  page=Math.min(page,Math.max(1,Math.ceil(total/limit)));
  const items=this.db.prepare(`SELECT * FROM calls WHERE ${where} ORDER BY time DESC, id DESC LIMIT ? OFFSET ?`).all(...args,limit,(page-1)*limit);
  return {items,total,page,limit,retentionDays:90};
 }
 summary(days=7){
  days=Math.max(1,Math.min(90,Math.trunc(Number(days))||7));const since=new Date(Date.now()-days*86400000).toISOString();
  const totals=this.db.prepare(`SELECT count(*) AS attempts,count(DISTINCT request_id) AS requests,
   sum(CASE WHEN status=200 THEN 1 ELSE 0 END) AS successes,sum(CASE WHEN status<>200 THEN 1 ELSE 0 END) AS failures,
   coalesce(sum(tokens),0) AS tokens,coalesce(sum(input_tokens),0) AS inputTokens,coalesce(sum(output_tokens),0) AS outputTokens,
   sum(CASE WHEN usage_known=0 THEN 1 ELSE 0 END) AS unknownUsage,
   coalesce(round(avg(CASE WHEN status=200 THEN latency END)),0) AS averageLatency FROM calls WHERE time>=?`).get(since);
  const requestOutcomes=`SELECT request_id,min(time) AS first_time,max(CASE WHEN status=200 THEN 1 ELSE 0 END) AS succeeded FROM calls WHERE time>=? GROUP BY request_id`;
  const final=this.db.prepare(`SELECT count(*) AS requests,coalesce(sum(succeeded),0) AS requestSuccesses FROM (${requestOutcomes})`).get(since);
  totals.requestSuccesses=final.requestSuccesses;totals.requestFailures=final.requests-final.requestSuccesses;
  const attemptDays=this.db.prepare(`SELECT substr(time,1,10) AS day,count(*) AS attempts,
   sum(CASE WHEN status=200 THEN 1 ELSE 0 END) AS successes,coalesce(sum(tokens),0) AS tokens FROM calls WHERE time>=? GROUP BY day ORDER BY day`).all(since);
  const requestDays=this.db.prepare(`SELECT substr(first_time,1,10) AS day,count(*) AS requests,coalesce(sum(succeeded),0) AS requestSuccesses FROM (${requestOutcomes}) GROUP BY day ORDER BY day`).all(since);
  const byDay=new Map();for(const row of [...attemptDays,...requestDays])byDay.set(row.day,{...byDay.get(row.day),...row});
  const daily=[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const providers=this.db.prepare(`SELECT provider_id AS providerId,provider,model,count(*) AS attempts,sum(CASE WHEN status=200 THEN 1 ELSE 0 END) AS successes,
   coalesce(sum(tokens),0) AS tokens,round(avg(latency)) AS latency FROM calls WHERE time>=? GROUP BY provider_id,provider,model ORDER BY attempts DESC`).all(since);
  const costs=this.db.prepare(`SELECT currency,sum(estimated_cost) AS amount,count(*) AS pricedAttempts FROM calls WHERE time>=? AND estimated_cost IS NOT NULL GROUP BY currency`).all(since);
  const keys=this.db.prepare(`SELECT api_key_id AS apiKeyId,count(*) AS attempts,coalesce(sum(tokens),0) AS tokens FROM calls WHERE time>=? GROUP BY api_key_id ORDER BY attempts DESC`).all(since);
  return {days,totals,daily,providers,keys,costs,retentionDays:RETENTION_DAYS,costNotice:'基于当时单价与上游用量的估算，不等同于供应商账单；图片按返回张数估算，其他未知用量或价格不估算费用。'};
 }
 audit(days=30){
  days=Math.max(1,Math.min(90,Math.trunc(Number(days))||30));const since=new Date(Date.now()-days*86400000).toISOString();
  const members=this.db.prepare(`SELECT actor_id AS actorId,count(DISTINCT request_id) AS requests,count(*) AS attempts,
   sum(CASE WHEN status=200 THEN 1 ELSE 0 END) AS successes,coalesce(sum(tokens),0) AS tokens,
   coalesce(sum(input_tokens),0) AS inputTokens,coalesce(sum(output_tokens),0) AS outputTokens,
   coalesce(round(avg(CASE WHEN status=200 THEN latency END)),0) AS averageLatency,max(time) AS lastUsedAt
   FROM calls WHERE time>=? GROUP BY actor_id ORDER BY requests DESC,lastUsedAt DESC`).all(since);
  const memberOutcomes=this.db.prepare(`SELECT actor_id AS actorId,count(*) AS requests,coalesce(sum(succeeded),0) AS requestSuccesses FROM
   (SELECT actor_id,request_id,max(CASE WHEN status=200 THEN 1 ELSE 0 END) AS succeeded FROM calls WHERE time>=? GROUP BY actor_id,request_id)
   GROUP BY actor_id`).all(since);
  const outcomesByActor=new Map(memberOutcomes.map(row=>[row.actorId,row]));
  for(const member of members){member.requestSuccesses=outcomesByActor.get(member.actorId)?.requestSuccesses||0;member.requestFailures=member.requests-member.requestSuccesses;}
  const costs=this.db.prepare(`SELECT actor_id AS actorId,currency,sum(estimated_cost) AS amount
   FROM calls WHERE time>=? AND estimated_cost IS NOT NULL GROUP BY actor_id,currency ORDER BY actor_id,currency`).all(since);
  const keys=this.db.prepare(`SELECT api_key_id AS apiKeyId,actor_id AS actorId,count(DISTINCT request_id) AS requests,coalesce(sum(tokens),0) AS tokens,max(time) AS lastUsedAt
   FROM calls WHERE time>=? AND api_key_id IS NOT NULL GROUP BY api_key_id,actor_id ORDER BY requests DESC`).all(since);
  return {days,members,costs,keys,retentionDays:RETENTION_DAYS};
 }
 routeLogs(provider,now=Date.now()){
  const key=(provider.id||'')+'|'+(provider.name||'')+'|'+(provider.model||'');
  const hit=this.routeCache.get(key);if(hit&&now-hit.at<30000)return hit.rows;
  const rows=this.routeHits.all(provider.id||'',provider.name||'',provider.model||'',this.routeSince);
  this.routeCache.set(key,{at:now,rows});return rows;
 }
 close(){if(!this.closed){clearInterval(this.sweep);this.db.close();this.closed=true;}}
}
