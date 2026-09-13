import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function setup(directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 const file=path.join(directory,'.env');
 if(existsSync(file)){console.log('.env 已存在，保留现有令牌和设置。');return false;}
 const template=readFileSync(path.join(directory,'.env.example'),'utf8');
 const env=template.replace(/^ADMIN_TOKEN=.*$/m,'ADMIN_TOKEN='+randomBytes(32).toString('hex'))
  .replace(/^GATEWAY_TOKEN=.*$/m,'GATEWAY_TOKEN='+randomBytes(32).toString('hex'));
 writeFileSync(file,env,{flag:'wx',mode:0o600});
 console.log('已生成 .env。请在本机打开该文件，使用 ADMIN_TOKEN 登录；令牌不会打印到日志。');return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))setup();
