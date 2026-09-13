#!/usr/bin/env node
// 用法：node scripts/reset-admin-password.mjs <新密码> [--data=DIR]
//
// 说明：本脚本直接改 data/accounts.json 中 owner 账户的密码字段。
//       它使用与 accounts.mjs 完全一致的 scrypt(N=16384,r=8,p=1) 默认参数，
//       并保留原数据文件其它字段、租户、会话、审计日志。
//
// 重置流程：
//   1. 停掉运行中的 3100 端口服务（platform.mjs 持有了 accounts.json 的内存副本，
//      不停服务就会重置失败）。
//   2. 执行本脚本。
//   3. 重启平台服务。
//   4. 用新密码在 UI 登录。
//
// 约束：
//   - 密码长度 12–256，否则拒绝。
//   - 脚本只修改 owner 角色账户的第一个匹配；如果你的租户里有多个管理员，
//     编辑本脚本里的 user 过滤逻辑。
//   - 密码来源优先级：argv[0] > env SWITCHBOARD_NEW_PASSWORD > stdin（仅取第一行）。
import {randomBytes,scrypt} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {promisify} from 'node:util';
import path from 'node:path';

const derive=promisify(scrypt);

function parseArgs(argv){
  const out={positional:[],flags:{}};
  for(const a of argv){
    if(a.startsWith('--')){
      const [k,v] = a.slice(2).split('=',2);
      out.flags[k]=v===undefined?true:v;
    } else out.positional.push(a);
    }
  return out;
}

async function hashPassword(password){
  if(typeof password!=='string'||password.length<12||password.length>256){
    throw new Error('密码长度需为 12–256 个字符');
  }
  const salt=randomBytes(16).toString('hex');
  const buf=await derive(password,salt,64);
  return `${salt}:${buf.toString('hex')}`;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  let password=args.positional[0];
  if(!password && process.env.SWITCHBOARD_NEW_PASSWORD){
    password=process.env.SWITCHBOARD_NEW_PASSWORD;
  }
  if(!password && !process.stdin.isTTY){
    password=(await import('node:fs/promises')).readFileSync(0,'utf8').split(/\r?\n/)[0];
  }
  if(!password){
    console.error('用法：node scripts/reset-admin-password.mjs <新密码> [--data=DIR]');
    console.error('  也可通过 SWITCHBOARD_NEW_PASSWORD 环境变量或 stdin 传入。');
    process.exit(2);
  }
  const dataDir=args.flags.data || path.resolve(process.cwd(),'data');
  const file=path.join(dataDir,'accounts.json');
  if(!existsSync(file)){
    console.error(`未找到账户文件：${file}`);
    process.exit(1);
  }

  // 保存原始权限以便恢复
  const original=JSON.parse(readFileSync(file,'utf8'));
  if(!Array.isArray(original.users)||original.users.length===0){
    console.error('accounts.json 中没有任何用户，无法重置。');
    process.exit(1);
  }
  // 优先重置 owner；若没有 owner，取第一个用户
  const member=(tenantId,userId)=>Array.isArray(original.members)&&
   original.members.some(m=>m.tenantId===tenantId&&m.userId===userId&&m.role==='owner');
  const ownerUser=original.users.find(u=>member('default',u.id))||original.users[0];

  const newHash=await hashPassword(password);
  const now=new Date().toISOString();
  const updated={...original};
  updated.users=original.users.map(u=>u.id===ownerUser.id
   ?{...u,password:newHash,passwordResetAt:now}
   :u);
  // 失效该用户的所有会话，重置后必须重新登录
  updated.sessions=(original.sessions||[]).filter(s=>s.userId!==ownerUser.id);
  updated.audit=[
   {id:`reset-${Date.now()}`,tenantId:'default',actorId:ownerUser.id,
    action:'account.password.reset',target:'通过本地脚本重置',time:now},
    ...(original.audit||[])
  ].slice(0,2000);

  const tmp=file+'.tmp';
  writeFileSync(tmp,JSON.stringify(updated,null,2),{mode:0o600});
  renameSync(tmp,file);
  console.log(`✓ 已重置账户 ${ownerUser.email}（${ownerUser.name}）的密码`);
  console.log(`  文件：${file}`);
  console.log(`  角色：${member('default',ownerUser.id)?'owner':'(非 owner)'}`);
  console.log(`  其它账户、租户、会话、审计、API key 不受影响。`);
  console.log(`\n下一步：在 UI 用新密码登录即可。`);
}

main().catch(err=>{console.error('重置失败：'+err.message);process.exit(1);});
