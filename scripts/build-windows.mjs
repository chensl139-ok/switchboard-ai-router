import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,copyFileSync,cpSync,rmSync,existsSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows 桌面安装包需在 Windows x64 上构建（可运行 Windows desktop 工作流）。');
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Windows 安装包需要三段式版本号');
const nodeVersion='22.23.2',nodeArchive=`node-v${nodeVersion}-win-x64.zip`;
// Pinned from the official Node distribution. Also compare with its HTTPS checksum list.
const nodeArchiveHash='1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97';
const output=path.join(root,'dist','windows'),temporary=mkdtempSync(path.join(tmpdir(),'switchboard-windows-build-'));
const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',...options});
const powershell=(code,env={})=>run('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,...env}});
const npmCli=process.env.npm_execpath;
if(!npmCli||!existsSync(npmCli))throw Error('请通过 npm run build:windows 构建');
const npm=(args,cwd=root)=>run(process.execPath,[npmCli,...args],{cwd});
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
async function download(url){const response=await fetch(url,{signal:AbortSignal.timeout(120_000)});if(!response.ok)throw Error(`下载失败 ${response.status}: ${url}`);return Buffer.from(await response.arrayBuffer());}
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('安装包不允许符号链接: '+file);return entry.isDirectory()?walk(file):[file];});}
function replaceGenerated(source,destination){if(existsSync(destination)){if(lstatSync(destination).isSymbolicLink())throw Error('生成目录不能是符号链接');rmSync(destination,{recursive:true});}cpSync(source,destination,{recursive:true});}

mkdirSync(output,{recursive:true});
try{
 npm(['run','build:web']);
 const app=path.join(temporary,'app'),resources=path.join(app,'resources'),server=path.join(resources,'server');
 for(const dir of [app,server,path.join(resources,'runtime'),path.join(server,'desktop')])mkdirSync(dir,{recursive:true});
 // An allowlist is deliberately used: no checkout .env, databases, tests, or local credentials.
 for(const name of readdirSync(root))if(/\.(mjs|ts)$/.test(name)&&name!=='vite.config.mjs')copyFileSync(path.join(root,name),path.join(server,name));
 for(const name of ['package.json','package-lock.json'])copyFileSync(path.join(root,name),path.join(server,name));
 cpSync(path.join(root,'public'),path.join(server,'public'),{recursive:true,filter:file=>!/(?:\.vue|\.d\.ts|\.map)$/.test(file)&&!['lab-request.ts','app.js'].includes(path.relative(path.join(root,'public'),file))});
 copyFileSync(path.join(root,'desktop','runtime.mjs'),path.join(server,'desktop','runtime.mjs'));
 npm(['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],server);
 for(const file of walk(path.join(server,'node_modules')))if(file.endsWith('.map'))rmSync(file);
 // npm retains empty scope directories for omitted devDependencies.
 for(const name of readdirSync(path.join(server,'node_modules')))if(name.startsWith('@')){const dir=path.join(server,'node_modules',name);if(readdirSync(dir).length===0)rmSync(dir,{recursive:true});}

 const officialBase=`https://nodejs.org/dist/v${nodeVersion}/`;
 const checksums=(await download(officialBase+'SHASUMS256.txt')).toString('utf8');
 const officialHash=checksums.split(/\r?\n/).find(line=>line.endsWith('  '+nodeArchive))?.split(/\s+/)[0];
 if(officialHash!==nodeArchiveHash)throw Error('官方 Node 校验清单与固定哈希不一致');
 const archive=path.join(temporary,nodeArchive);writeFileSync(archive,await download(officialBase+nodeArchive));
 if(sha(archive)!==nodeArchiveHash)throw Error('官方 Node 运行时 SHA256 校验失败');
 powershell("$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:SB_NODE_ARCHIVE -DestinationPath $env:SB_NODE_EXTRACT",{SB_NODE_ARCHIVE:archive,SB_NODE_EXTRACT:temporary});
 const extracted=path.join(temporary,`node-v${nodeVersion}-win-x64`),node=path.join(resources,'runtime','node.exe');
 copyFileSync(path.join(extracted,'node.exe'),node);
 copyFileSync(path.join(extracted,'LICENSE'),path.join(resources,'runtime','NODE-LICENSE'));
 run(node,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';import {parseEnv} from 'node:util';import {WebSocket} from 'ws';import {marked} from 'marked';const db=new DatabaseSync(':memory:');db.close();if(process.version!=='v${nodeVersion}'||process.arch!=='x64'||!parseEnv('CHECK=ok').CHECK||!WebSocket||!marked.parse('ok'))process.exit(1);`],{cwd:server});

 run('dotnet',['build',path.join(root,'desktop','windows','Switchboard.csproj'),'-c','Release','-o',app,`-p:Version=${version}`,'-p:DebugType=None','-p:DebugSymbols=false']);
 // Keep only x64 loader binaries and the WinForms shell, not other platform/debug artifacts.
 for(const name of ['win-arm64','win-x86']){const dir=path.join(app,'runtimes',name);if(existsSync(dir))rmSync(dir,{recursive:true});}
 for(const file of walk(app))if(/\.(pdb|xml)$/.test(file))rmSync(file);
 const csproj=readFileSync(path.join(root,'desktop','windows','Switchboard.csproj'),'utf8');
 const webviewVersion=csproj.match(/Include="Microsoft\.Web\.WebView2"\s+Version="([^"]+)"/)?.[1];
 if(!webviewVersion)throw Error('WebView2 SDK 版本必须固定');
 const nuget=path.join(process.env.NUGET_PACKAGES||path.join(process.env.USERPROFILE,'.nuget','packages'),'microsoft.web.webview2',webviewVersion);
 const notices=readdirSync(nuget).filter(name=>/license|third.?party.?notices/i.test(name)&&lstatSync(path.join(nuget,name)).isFile());
 if(!notices.length)throw Error('WebView2 SDK 许可证缺失');
 const licenses=path.join(resources,'licenses');mkdirSync(licenses,{recursive:true});
 for(const name of notices)copyFileSync(path.join(nuget,name),path.join(licenses,'WebView2-'+name));
 if(existsSync(path.join(root,'LICENSE')))copyFileSync(path.join(root,'LICENSE'),path.join(licenses,'Switchboard-LICENSE'));
 const files=walk(app);
 for(const file of files){const relative=path.relative(app,file).replaceAll('\\','/');if(/(^|\/)(\.env(?:\..*)?|master\.key|accounts\.json|active-profile\.json|desktop\.lock)$|\.sqlite(?:-wal|-shm)?$|\.pem$/i.test(relative))throw Error('安装包发现私有数据文件: '+relative);}
 for(const required of ['Switchboard.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','resources/server/public/build/app.js','resources/runtime/node.exe'])if(!existsSync(path.join(app,required)))throw Error('缺少安装文件: '+required);
 if(!files.some(file=>file.endsWith('WebView2Loader.dll')))throw Error('缺少 x64 WebView2Loader.dll');
 const productionModules=readdirSync(path.join(server,'node_modules')).filter(name=>!name.startsWith('.')).sort();
 if(JSON.stringify(productionModules)!==JSON.stringify(['marked','ws']))throw Error('安装包包含非生产 npm 依赖: '+productionModules.join(', '));
 writeFileSync(path.join(resources,'build-info.json'),JSON.stringify({version,architecture:'x64',nodeVersion,nodeArchiveHash,webviewVersion,revision:process.env.GITHUB_SHA||null,containsUserData:false},null,2)+'\n');
 replaceGenerated(app,path.join(output,'app'));
 const compiler=process.env.SWITCHBOARD_ISCC||path.join(process.env.ProgramFiles||'C:\\Program Files','Inno Setup 7','ISCC.exe');
 if(!existsSync(compiler))throw Error('未找到 Inno Setup；设置 SWITCHBOARD_ISCC 为官方 ISCC.exe 路径');
 run(compiler,[`/DAppVersion=${version}`,`/DSourceDir=${path.join(output,'app')}`,`/DOutputDir=${output}`,path.join(root,'desktop','windows','installer.iss')]);
 const installer=path.join(output,`Switchboard-${version}-Windows-x64-Setup.exe`);
 if(!existsSync(installer))throw Error('安装器未生成');
 const share=path.join(temporary,'share');mkdirSync(share);
 copyFileSync(installer,path.join(share,path.basename(installer)));
 const installerChecksum=sha(installer)+'  '+path.basename(installer)+'\n';
 writeFileSync(path.join(share,'SHA256SUMS'),installerChecksum);
 copyFileSync(path.join(root,'desktop','windows','INSTALL.txt'),path.join(share,'安装说明.txt'));
 const zip=path.join(output,`Switchboard-${version}-Windows-x64.zip`);
 powershell("$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $env:SB_SHARE_DIR '*') -DestinationPath $env:SB_SHARE_ZIP -CompressionLevel Optimal -Force",{SB_SHARE_DIR:share,SB_SHARE_ZIP:zip});
 writeFileSync(path.join(output,'SHA256SUMS'),installerChecksum+sha(zip)+'  '+path.basename(zip)+'\n');
 console.log(`\nWindows 安装分享包：${zip}\n仅含程序，不包含账号、密钥、订阅授权或历史数据。`);
}finally{rmSync(temporary,{recursive:true,force:true});}
