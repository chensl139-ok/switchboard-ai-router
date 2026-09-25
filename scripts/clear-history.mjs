import {existsSync,readdirSync,readFileSync,writeFileSync,renameSync,mkdirSync,cpSync,chmodSync,unlinkSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const dataDir=path.resolve(process.argv[2]||'data');
const apply=process.argv.includes('--apply');
const backupRoot=path.resolve(process.argv.find(arg=>arg.startsWith('--backup-root='))?.slice(14)||path.join(process.cwd(),'.history-backups'));
if(!existsSync(dataDir)||!statSync(dataDir).isDirectory())throw Error('数据目录不存在');
if(backupRoot===dataDir||backupRoot.startsWith(dataDir+path.sep))throw Error('备份不能放在数据目录内部');
const directories=[dataDir];
const tenantsDir=path.join(dataDir,'tenants');
if(existsSync(tenantsDir))for(const name of readdirSync(tenantsDir)){
 const dir=path.join(tenantsDir,name);
 if(statSync(dir).isDirectory())directories.push(dir);
}
const files=directories.map(dir=>({dir,accounts:path.join(dir,'accounts.json'),keys:path.join(dir,'api-keys.json'),state:path.join(dir,'state.json'),usage:path.join(dir,'usage.sqlite')}));
const report=files.map(({dir,accounts,keys,state,usage})=>{
 const row={tenant:path.relative(dataDir,dir)||'default',audit:0,calls:0,keys:0,legacyLogs:0};
 if(existsSync(accounts))row.audit=(JSON.parse(readFileSync(accounts,'utf8')).audit||[]).length;
 if(existsSync(keys))row.keys=(JSON.parse(readFileSync(keys,'utf8')).keys||[]).length;
 if(existsSync(state))row.legacyLogs=(JSON.parse(readFileSync(state,'utf8')).logs||[]).length;
 if(existsSync(usage)){const db=new DatabaseSync(usage,{readOnly:true});try{row.calls=db.prepare('SELECT count(*) AS n FROM calls').get().n;}finally{db.close();}}
 return row;
});
console.log(JSON.stringify({action:apply?'clear':'dry-run',report}));
if(!apply)process.exit(0);

mkdirSync(backupRoot,{recursive:true,mode:0o700});
const backup=path.join(backupRoot,`history-before-clear-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}`);
mkdirSync(backup,{mode:0o700});
cpSync(dataDir,path.join(backup,'data'),{recursive:true,force:false,errorOnExist:true});
const protect=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
 const filename=path.join(dir,entry.name);
 if(entry.isDirectory()){chmodSync(filename,0o700);protect(filename);}
 else if(entry.isFile())chmodSync(filename,0o600);
}};
protect(backup);
const atomicJson=(filename,value)=>{const temp=filename+'.history-tmp';writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,filename);};
for(const {dir,accounts,keys,state,usage} of files){
 if(existsSync(accounts)){const value=JSON.parse(readFileSync(accounts,'utf8'));value.audit=[];atomicJson(accounts,value);}
 if(existsSync(keys)){const value=JSON.parse(readFileSync(keys,'utf8'));for(const key of value.keys||[]){Object.assign(key,{requests:0,successes:0,failures:0,knownTokens:0,day:'',dailyUsed:0,minute:0,minuteUsed:0,lastUsedAt:null});}atomicJson(keys,value);}
 if(existsSync(state)){const value=JSON.parse(readFileSync(state,'utf8'));delete value.logs;atomicJson(state,value);}
 if(existsSync(usage)){const db=new DatabaseSync(usage);try{db.exec('DELETE FROM calls; PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');}finally{db.close();}}
 for(const name of readdirSync(dir))if(/^state\.json\.backup-|^usage\.sqlite\.corrupt-/.test(name)){
  const filename=path.join(dir,name);if(statSync(filename).isFile())unlinkSync(filename);
 }
}
console.log(JSON.stringify({action:'complete',backup,report}));
