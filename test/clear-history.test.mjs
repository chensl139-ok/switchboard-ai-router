import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

test('历史清理保留身份、API Key 和路由配置，并先备份',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'switchboard-clear-test-'));
 const data=path.join(root,'data'),backupRoot=path.join(root,'backup');mkdirSync(data);
 const accounts={users:[{id:'u',email:'user@example.test',password:'hashed'}],tenants:[{id:'default'}],members:[{userId:'u',tenantId:'default'}],sessions:[{hash:'session'}],audit:[{id:'old'}]};
 const keys={legacyEnabled:false,keys:[{id:'k',digest:'key-digest',totalLimit:5,requests:3,successes:2,failures:1,knownTokens:20,day:'2026-09-25',dailyUsed:3,minute:7,minuteUsed:3,lastUsedAt:'past'}]};
 const state={providers:[{id:'p',secret:'encrypted'}],active:'p',logs:[{id:'legacy'}]};
 writeFileSync(path.join(data,'accounts.json'),JSON.stringify(accounts));writeFileSync(path.join(data,'api-keys.json'),JSON.stringify(keys));writeFileSync(path.join(data,'state.json'),JSON.stringify(state));writeFileSync(path.join(data,'state.json.backup-old'),JSON.stringify(state));
 const db=new DatabaseSync(path.join(data,'usage.sqlite'));db.exec("CREATE TABLE calls(id TEXT);CREATE TABLE metadata(key TEXT);INSERT INTO calls VALUES('old');INSERT INTO metadata VALUES('legacy_import');");db.close();
 try{
  const script=path.resolve('scripts/clear-history.mjs');
  let run=spawnSync(process.execPath,[script,data,`--backup-root=${backupRoot}`],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).report[0].calls,1);
  run=spawnSync(process.execPath,[script,data,'--apply',`--backup-root=${backupRoot}`],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout.trim().split('\n').at(-1));assert.ok(existsSync(path.join(result.backup,'data','state.json.backup-old')));
  const a=JSON.parse(readFileSync(path.join(data,'accounts.json'))),k=JSON.parse(readFileSync(path.join(data,'api-keys.json'))),s=JSON.parse(readFileSync(path.join(data,'state.json')));
  assert.deepEqual(a.audit,[]);assert.deepEqual(a.users,accounts.users);assert.deepEqual(a.sessions,accounts.sessions);
  assert.equal(k.keys[0].digest,'key-digest');assert.equal(k.keys[0].totalLimit,5);assert.equal(k.keys[0].requests,0);assert.equal(k.keys[0].lastUsedAt,null);
  assert.deepEqual(s.providers,state.providers);assert.equal('logs' in s,false);assert.equal(existsSync(path.join(data,'state.json.backup-old')),false);
  const cleaned=new DatabaseSync(path.join(data,'usage.sqlite'),{readOnly:true});assert.equal(cleaned.prepare('SELECT count(*) n FROM calls').get().n,0);assert.equal(cleaned.prepare('SELECT count(*) n FROM metadata').get().n,1);cleaned.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});
