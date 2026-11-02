// Caller feedback is separate from gateway transport/adapter outcomes.
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
export function taskIdentifier(value,fallback){
 if(value===undefined)return fallback;
 if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw failure('X-Task-ID 需为 1–128 位字母、数字、点、冒号、下划线或短横线');
 return value;
}
export function taskScope({apiKeyId,actorId,userId,admin}={}){
 return apiKeyId?'key:'+apiKeyId:(actorId||userId)?'user:'+(actorId||userId):admin?'admin':'gateway';
}
export class TaskTracking {
 constructor(db){
  this.db=db;
  db.exec(`CREATE TABLE IF NOT EXISTS task_requests (
   request_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,scope TEXT NOT NULL,started_at INTEGER NOT NULL,
   completed_at INTEGER,status TEXT NOT NULL DEFAULT 'running',final_attempt_id TEXT,
   feedback TEXT,feedback_reason TEXT,feedback_at INTEGER);
   CREATE INDEX IF NOT EXISTS task_requests_scope ON task_requests(scope,task_id,started_at);
   CREATE INDEX IF NOT EXISTS task_requests_time ON task_requests(started_at);`);
  db.prepare("UPDATE task_requests SET status='failed',completed_at=? WHERE status='running'").run(Date.now());
 }
 start(requestId,taskId,scope,now=Date.now()){
  if(this.db.prepare('SELECT count(*) AS count FROM task_requests WHERE task_id=? AND scope=?').get(taskId,scope).count>=1000)throw failure('单个任务最多关联 1000 次请求，请创建新任务',409);
  this.db.prepare('INSERT INTO task_requests(request_id,task_id,scope,started_at) VALUES(?,?,?,?)').run(requestId,taskId,scope,now);
 }
 finish(requestId,status,attemptId,now=Date.now()){
  this.db.prepare('UPDATE task_requests SET completed_at=?,status=?,final_attempt_id=? WHERE request_id=?').run(now,status,attemptId||null,requestId);
 }
 feedback(requestId,scope,input,now=Date.now()){
  const row=this.db.prepare('SELECT * FROM task_requests WHERE request_id=? AND scope=?').get(requestId,scope);
  if(!row)throw failure('请求不存在或不属于当前调用身份',404);
  if(row.status!=='completed')throw failure('仅正常完成的请求可提交输出验收',409);
  if(!input||!['accepted','rejected'].includes(input.outcome))throw failure('outcome 需为 accepted 或 rejected');
  if(input.outcome==='accepted'&&input.reason!==undefined)throw failure('accepted 不应携带失败 reason');
  const reason=input.outcome==='accepted'?null:input.reason;
  if(input.outcome==='rejected'&&!['parse_error','schema_error','business_error','other'].includes(reason))throw failure('拒绝时需提供有效的 reason 分类');
  if(Object.keys(input).some(key=>!['outcome','reason'].includes(key)))throw failure('仅接受 outcome 与 reason，不接收提示词或回复正文');
  if(row.feedback){
   if(row.feedback!==input.outcome||row.feedback_reason!==reason)throw failure('该请求已提交不同验收结果，请为后续尝试创建新请求',409);
  }else this.db.prepare('UPDATE task_requests SET feedback=?,feedback_reason=?,feedback_at=? WHERE request_id=?').run(input.outcome,reason,now,requestId);
  return this.summary(row.task_id,scope,now);
 }
 fromRequest(requestId,scope){
  const row=scope===undefined?this.db.prepare('SELECT * FROM task_requests WHERE request_id=?').get(requestId):this.db.prepare('SELECT * FROM task_requests WHERE request_id=? AND scope=?').get(requestId,scope);
  if(!row)throw failure('任务记录不存在',404);
  return this.summary(row.task_id,row.scope);
 }
 summary(taskId,scope,now=Date.now()){
  const requests=this.db.prepare('SELECT * FROM task_requests WHERE task_id=? AND scope=? ORDER BY started_at,rowid').all(taskId,scope);
  if(!requests.length)throw failure('任务不存在或不属于当前调用身份',404);
  const attempts=this.db.prepare(`SELECT c.* FROM calls c JOIN task_requests r ON r.request_id=c.request_id WHERE r.task_id=? AND r.scope=? ORDER BY coalesce(c.started_at,0),c.time,c.rowid`).all(taskId,scope);
  const pending=requests.some(r=>r.status==='running'),last=requests.at(-1);
  const end=pending?now:Math.max(...requests.map(r=>r.feedback_at||r.completed_at||r.started_at));
  const costs=new Map();let unknownCostAttempts=0,unknownUsageAttempts=0;
  for(const a of attempts){
   if(a.estimated_cost==null||!a.currency)unknownCostAttempts++;
   else costs.set(a.currency,(costs.get(a.currency)||0)+a.estimated_cost);
   if(!a.usage_known)unknownUsageAttempts++;
  }
  return {taskId,scope,startedAt:new Date(requests[0].started_at).toISOString(),lastActivityAt:new Date(end).toISOString(),
   outcome:pending?'running':last.status==='failed'?'gateway_failed':last.feedback||'unverified',
   requestCount:requests.length,attemptCount:attempts.length,
   gatewayFailures:requests.filter(r=>r.status==='failed').length,upstreamFailures:attempts.filter(a=>a.status!==200).length,
   acceptanceFailures:requests.filter(r=>r.feedback==='rejected').length,
   elapsedMs:Math.max(0,end-requests[0].started_at),attemptLatencyMs:attempts.reduce((sum,a)=>sum+a.latency,0),
   tokens:attempts.reduce((sum,a)=>sum+a.tokens,0),unknownUsageAttempts,unknownCostAttempts,
   costs:[...costs].map(([currency,amount])=>({currency,amount})),requests,attempts,
   notice:'仅汇总保留期内、同一租户与调用身份的数据；任务耗时包含调用间隔和验收等待，尝试耗时可能重叠；费用为估算，未知部分不按零计费。'};
 }
}
