import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Hash deployed, shared application files, not Git state, timestamps, native
// shells, credentials or tenant data. Desktop and container builds can therefore
// be compared even when they have the same release number.
export function readBuildInfo(root=path.dirname(fileURLToPath(import.meta.url))){
 const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 const hash=createHash('sha256');
 hash.update(JSON.stringify({version:pkg.version,dependencies:pkg.dependencies||{}}));
 const files=readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isFile()&&/\.(mjs|ts)$/.test(entry.name)&&entry.name!=='vite.config.mjs').map(entry=>entry.name);
 const walk=relative=>{
  for(const entry of readdirSync(path.join(root,relative),{withFileTypes:true})){
   const name=relative+'/'+entry.name;
   if(entry.isDirectory())walk(name);
   else if(entry.isFile()&&/\.(js|css|html|svg)$/.test(name)&&name!=='public/app.js')files.push(name);
  }
 };
 walk('public');
 for(const file of files.sort())hash.update(file+'\0').update(readFileSync(path.join(root,file))).update('\0');
 return Object.freeze({version:pkg.version,fingerprint:hash.digest('hex').slice(0,16)});
}
