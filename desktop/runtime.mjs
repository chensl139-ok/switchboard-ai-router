import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync,readdirSync,copyFileSync,chmodSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createPlatform} from '../platform.mjs';
import {feishuConfigs} from '../feishu-auth.mjs';

export const defaultSupportDir=()=>path.join(homedir(),'Library','Application Support','Switchboard');
const privateDir=dir=>{mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);};
const atomicJSON=(file,data)=>{writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});renameSync(file+'.tmp',file);};
function profileLocation(supportDir){
 const file=path.join(supportDir,'active-profile.json');
 const name=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).profile:'local';
 if(typeof name!=='string'||!/^[a-zA-Z0-9_-]+$/.test(name))throw Error('桌面数据配置无效');
 return {name,dir:path.join(supportDir,'profiles',name)};
}
function credentials(dir){
 const file=path.join(dir,'.env');
 if(!existsSync(file))writeFileSync(file,`ADMIN_TOKEN=${randomBytes(32).toString('hex')}\nGATEWAY_TOKEN=${randomBytes(32).toString('hex')}\n`,{flag:'wx',mode:0o600});
 chmodSync(file,0o600);
 const env=parseEnv(readFileSync(file,'utf8'));
 if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<24||!env.GATEWAY_TOKEN||env.GATEWAY_TOKEN.length<24)throw Error('导入的 .env 缺少有效的 ADMIN_TOKEN 或 GATEWAY_TOKEN');
 return env;
}
async function copyData(source,destination){
 privateDir(destination);
 for(const item of readdirSync(source,{withFileTypes:true})){
  const from=path.join(source,item.name),to=path.join(destination,item.name);
  if(item.isSymbolicLink())throw Error('数据目录含符号链接，请先导出完整备份后导入');
  if(item.isDirectory())await copyData(from,to);
  else if(item.isFile()){
   if(item.name.endsWith('-wal')||item.name.endsWith('-shm')||item.name.endsWith('.lock')||item.name==='.DS_Store')continue;
   if(item.name.endsWith('.sqlite')){
    const db=new DatabaseSync(from,{readOnly:true});
    try{await backup(db,to);}finally{db.close();}
   }else copyFileSync(from,to);
   chmodSync(to,0o600);
  }
 }
}
export async function importDeployment(source,supportDir){
 const sourceDir=path.resolve(source),sourceEnv=path.join(sourceDir,'.env'),sourceData=path.join(sourceDir,'data');
 if(!existsSync(sourceEnv)||!existsSync(sourceData)||!lstatSync(sourceEnv).isFile()||!lstatSync(sourceData).isDirectory())throw Error('请选择同时包含 .env 和 data 的原部署目录');
 const env=parseEnv(readFileSync(sourceEnv,'utf8'));
 if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<24||!env.GATEWAY_TOKEN||env.GATEWAY_TOKEN.length<24)throw Error('原部署的管理令牌无效，未导入');
 if(existsSync(path.join(sourceData,'accounts.json')))JSON.parse(readFileSync(path.join(sourceData,'accounts.json'),'utf8'));
 const name='import-'+randomUUID(),dir=path.join(supportDir,'profiles',name);
 privateDir(dir);copyFileSync(sourceEnv,path.join(dir,'.env'));chmodSync(path.join(dir,'.env'),0o600);
 await copyData(sourceData,path.join(dir,'data'));
 // The original instance's browser sessions must not be transferable to this copy.
 const accountsFile=path.join(dir,'data','accounts.json');
 if(existsSync(accountsFile)){const accounts=JSON.parse(readFileSync(accountsFile,'utf8'));accounts.sessions=[];atomicJSON(accountsFile,accounts);}
 return {name,dir};
}
function acquireLock(supportDir){
 const file=path.join(supportDir,'desktop.lock');
 if(existsSync(file)){
  let pid;try{pid=JSON.parse(readFileSync(file,'utf8')).pid;}catch{}
  if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);throw Object.assign(Error('此桌面工作空间已在运行'),{liveLock:true});}catch(error){if(error.liveLock||error.code==='EPERM')throw Error('此桌面工作空间已在运行');if(error.code!=='ESRCH')throw error;}}
  unlinkSync(file);
 }
 writeFileSync(file,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
 return ()=>{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);}catch{}};
}
function listen(server,port){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});}
export async function startDesktop({supportDir=defaultSupportDir(),port=3110,bootstrapToken=randomBytes(32).toString('hex'),importFrom}={}){
 privateDir(supportDir);privateDir(path.join(supportDir,'profiles'));
 const releaseLock=acquireLock(supportDir);let server;
 try{
  const profile=importFrom?await importDeployment(importFrom,supportDir):profileLocation(supportDir);
  privateDir(profile.dir);const env=credentials(profile.dir);
  // File settings override inherited shell settings. Desktop HTTP is loopback-only.
  for(const key of ['ALLOW_HTTP_UPSTREAM','UPSTREAM_PROXY_FAKE_IP','UPSTREAM_PROXY_FAKE_IP_HOSTS','UPSTREAM_ALLOWED_PRIVATE_HOSTS','GLOBAL_MAX_CONCURRENCY','WS_ALLOWED_ORIGINS']){delete process.env[key];if(env[key]!==undefined)process.env[key]=env[key];}
  process.env.COOKIE_SECURE='false';
  server=createPlatform({dir:path.join(profile.dir,'data'),admin:env.ADMIN_TOKEN,gateway:env.GATEWAY_TOKEN,bootstrapToken,desktopAuth:bootstrapToken,oauthConfig:feishuConfigs(env)});
  try{await listen(server,port);}catch(error){if(error.code!=='EADDRINUSE'||port===0)throw error;await listen(server,0);}
  const url=`http://127.0.0.1:${server.address().port}`;
  const ready=await fetch(url+'/readyz');if(!ready.ok)throw Error('桌面数据未通过就绪检查，请从菜单打开数据目录查看备份');
  const status=await (await fetch(url+'/api/account/status')).json();
  atomicJSON(path.join(supportDir,'active-profile.json'),{profile:profile.name});
  let closing;
  const close=()=>closing??=new Promise(resolve=>{server.close(()=>{releaseLock();resolve();});server.closeIdleConnections();});
  server.once('close',releaseLock);
  return {server,url,profileDir:profile.dir,needsSetup:status.needsSetup,close};
 }catch(error){if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}else server?.emit('close');releaseLock();throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let runtime,stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(0),10_000);deadline.unref();await runtime?.close();process.exit(0);};
 try{
  runtime=await startDesktop({supportDir:process.env.SWITCHBOARD_DESKTOP_SUPPORT_DIR||defaultSupportDir(),port:Number(process.env.SWITCHBOARD_DESKTOP_PORT||3110),bootstrapToken:process.env.SWITCHBOARD_DESKTOP_BOOTSTRAP||randomBytes(32).toString('hex'),importFrom:process.env.SWITCHBOARD_DESKTOP_IMPORT||undefined});
  console.log(JSON.stringify({event:'desktop-ready',url:runtime.url,profileDir:runtime.profileDir,needsSetup:runtime.needsSetup}));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,stop);
  const parent=process.ppid;
  setInterval(()=>{try{process.kill(parent,0);}catch(error){if(error.code==='ESRCH')void stop();}},2000).unref();
 }catch{console.error(JSON.stringify({event:'desktop-error',message:'无法启动桌面服务。请检查数据目录权限、.env 配置及完整的数据备份。'}));process.exit(1);}
}
