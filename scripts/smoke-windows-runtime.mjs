import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

if(process.platform!=='win32'||process.arch!=='x64')throw Error('Run this packaged-runtime check on Windows x64');
const app=path.resolve(process.argv[2]||'dist/windows/app');
const server=path.join(app,'resources','server');
assert.equal(path.resolve(process.execPath).toLowerCase(),path.join(app,'resources','runtime','node.exe').toLowerCase(),'Test the bundled runtime, not the runner Node');
const {startDesktop}=await import(pathToFileURL(path.join(server,'desktop','runtime.mjs')).href);
const supportDir=mkdtempSync(path.join(tmpdir(),'switchboard-runtime-smoke-'));
const runtime=await startDesktop({supportDir,port:0});
try{
 const status=await (await fetch(runtime.url+'/api/account/status')).json();
 assert.equal(status.needsSetup,true,'No existing account may ship in the app');
 const assets=readdirSync(path.join(server,'public','build','assets')).filter(name=>/\.(js|css)$/.test(name));
 const routes=['/readyz','/','/app.js','/interface.css','/workspaces.css','/providers.css',...assets.map(name=>'/build/assets/'+name)];
 for(const route of routes){const response=await fetch(runtime.url+route);assert.equal(response.status,200,route);assert.ok((await response.arrayBuffer()).byteLength>0,route);}
 assert.deepEqual(readFileSync(path.join(server,'public','build','app.js')),readFileSync('public/build/app.js'),'Packaged frontend must match this checkout');
 assert.ok(existsSync(path.join(supportDir,'profiles','local','.env')),'Credentials are created only at runtime');
 assert.equal(existsSync(path.join(server,'.env')),false);
 assert.equal(existsSync(path.join(server,'data')),false);
 console.log(JSON.stringify({ok:true,packagedNode:process.version,architecture:process.arch,staticRoutes:routes.length,pristineAccount:true}));
}finally{await runtime.close();}
assert.equal(existsSync(path.join(supportDir,'desktop.lock')),false,'Graceful close must release data lock');
