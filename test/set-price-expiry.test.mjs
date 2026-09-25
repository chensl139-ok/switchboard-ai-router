import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('已配置价格改为无限期前先备份，保持来源、采集时间和其他配置',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'switchboard-prices-')),data=path.join(root,'data'),backup=path.join(root,'backup');
 try{
  mkdirSync(data);const file=path.join(data,'state.json');
  const before={providers:[{id:'a',secret:'encrypted',prices:{m:{source:'openrouter-reference',observedAt:'2026-01-01',expiresAt:'2026-01-08',inputPerMillion:1}}}]};
  writeFileSync(file,JSON.stringify(before));
  const args=[new URL('../scripts/set-price-expiry.mjs',import.meta.url).pathname,data,`--backup-root=${backup}`];
  const preview=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));assert.equal(preview.report[0].expiring,1);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),before);
  const output=execFileSync(process.execPath,[...args,'--apply'],{encoding:'utf8'}).trim().split('\n').map(JSON.parse);
  assert.equal(output[1].updated,1);assert.equal(existsSync(output[1].backup),true);
  const after=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(after.providers[0].prices.m.expiresAt,null);
  assert.equal(after.providers[0].prices.m.source,'openrouter-reference');
  assert.equal(after.providers[0].prices.m.observedAt,'2026-01-01');
  assert.equal(after.providers[0].secret,'encrypted');
  assert.deepEqual(JSON.parse(readFileSync(path.join(backup,readdirSync(backup)[0],'state.json'),'utf8')),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
