import {existsSync,readdirSync,readFileSync,writeFileSync,renameSync,mkdirSync,copyFileSync,statSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const dataDir=path.resolve(process.argv[2]||'data');
const apply=process.argv.includes('--apply');
const backupRoot=path.resolve(process.argv.find(arg=>arg.startsWith('--backup-root='))?.slice(14)||path.join(process.cwd(),'.price-backups'));
if(!existsSync(dataDir)||!statSync(dataDir).isDirectory())throw Error('数据目录不存在');
if(backupRoot===dataDir||backupRoot.startsWith(dataDir+path.sep))throw Error('备份不能放在数据目录内');
const dirs=[dataDir],tenantsDir=path.join(dataDir,'tenants');
if(existsSync(tenantsDir))for(const name of readdirSync(tenantsDir)){const dir=path.join(tenantsDir,name);if(statSync(dir).isDirectory())dirs.push(dir);}
const states=dirs.map(dir=>({dir,file:path.join(dir,'state.json')})).filter(row=>existsSync(row.file));
const report=states.map(row=>{const state=JSON.parse(readFileSync(row.file,'utf8'));const prices=(state.providers||[]).flatMap(provider=>Object.values(provider.prices||{}));return {tenant:path.relative(dataDir,row.dir)||'default',prices:prices.length,expiring:prices.filter(price=>price.expiresAt!=null).length};});
console.log(JSON.stringify({action:apply?'update':'dry-run',report}));
if(!apply)process.exit(0);
mkdirSync(backupRoot,{recursive:true,mode:0o700});chmodSync(backupRoot,0o700);
const backup=path.join(backupRoot,`prices-before-indefinite-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}`);
mkdirSync(backup,{mode:0o700});
for(const row of states){const relative=path.relative(dataDir,row.dir),targetDir=path.join(backup,relative);mkdirSync(targetDir,{recursive:true,mode:0o700});const target=path.join(targetDir,'state.json');copyFileSync(row.file,target);chmodSync(target,0o600);}
for(const row of states){const state=JSON.parse(readFileSync(row.file,'utf8'));for(const provider of state.providers||[])for(const price of Object.values(provider.prices||{}))price.expiresAt=null;const temp=row.file+'.price-tmp';writeFileSync(temp,JSON.stringify(state),{mode:0o600});renameSync(temp,row.file);}
console.log(JSON.stringify({action:'complete',backup,updated:report.reduce((total,row)=>total+row.expiring,0)}));
