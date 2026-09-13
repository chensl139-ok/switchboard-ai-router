import {spawnSync} from 'node:child_process';
import {setup} from './setup.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const publicMode=process.argv.includes('--public');
setup();
const check=spawnSync('docker',['compose','version'],{stdio:'ignore'});
if(check.status!==0){console.error('请先安装并启动 Docker Desktop 或 Docker Engine + Compose。');process.exit(1);}
const args=['compose','-f',publicMode?'compose.public.yaml':'compose.yaml','up','-d','--build','--wait','--wait-timeout','120'];
const result=spawnSync('docker',args,{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log(publicMode?'HTTPS 网关已启动，请访问 .env 中 GATEWAY_DOMAIN 对应域名。':'已启动： http://127.0.0.1:3000 （若修改 LOCAL_PORT，请使用对应端口）');
