#!/usr/bin/env node
// ============================================================================
// 本地开发启动脚本（由 miaoda app sync 维护，请勿手改）
// Stack: nestjs-react-fullstack
//
// 流程:
//   1. env pull —— 拉沙箱身份/凭证到 .env.local
//   2. action-plugin init —— 装 user app 在 package.json.actionPlugins 里声明的插件
//   3. skills sync —— 同步当前 stack 的 agent skills
//   4. dotenv 加载 .env / .env.local 到 process.env（含 SUDA_WEBUSER 适配）
//   5. 并发起 dev:server + dev:client（子进程继承 process.env）
//
// 关键设计：本脚本在 spawn 子进程之前先把 .env / .env.local 加载到 process.env，
// 然后 spawn 的 server / client 进程通过 env 继承直接拿到——SDK（fullstack-nestjs-core
// / fullstack-vite-preset / fullstack-rspack-preset）无需自己 require('dotenv')。
//
// SUDA_WEBUSER 适配：沙箱 env pull 下发到 .env.local 的形态是
// `SUDA_WEBUSER="{\"user_id\":\"...\"}"`（shell-quoted JSON），dotenv@17 剥外层引号后
// 保留内部 `\"` 转义不还原，导致 process.env.SUDA_WEBUSER 是 `{\"user_id\":\"...\"}`
// 这种带反斜杠串，下游 JSON.parse 直接挂。这里做一次「直接 parse 失败则 unescape
// 后重 parse」兜底，把容错收敛在启动期单点，下游拿到干净 JSON 字符串。
// ============================================================================
const fs = require('node:fs');
const path = require('node:path');
const { execSync, spawn, spawnSync } = require('node:child_process');

process.chdir(path.resolve(__dirname, '..'));

function warn(msg) {
  if (process.stderr.isTTY) process.stderr.write(`\x1b[33mWARNING: ${msg}\x1b[0m\n`);
  else process.stderr.write(`WARNING: ${msg}\n`);
}

if (!process.env.MIAODA_APP_TYPE) process.env.MIAODA_APP_TYPE = '3';
process.env.MIAODA_LOCAL_DEV = '1';

// 1. env pull
console.log('[dev-local] (1/5) env pull...');
const hasLarkCli = spawnSync('command', ['-v', 'lark-cli'], { shell: true, stdio: 'ignore' }).status === 0;
if (hasLarkCli) {
  let appId = '';
  try {
    appId = JSON.parse(fs.readFileSync('.spark/meta.json', 'utf8')).app_id || '';
  } catch {
    /* meta.json 不存在或非法 JSON */
  }
  if (appId) {
    const r = spawnSync('lark-cli', ['apps', '+env-pull', '--app-id', appId, '--as', 'user'], {
      stdio: 'inherit',
    });
    if (r.status !== 0) warn('env pull 失败，继续按 .env.local 现状启动');
  } else {
    warn('.spark/meta.json 缺 app_id，请先跑 `miaoda app init --app-id <id>`');
  }
} else {
  warn('lark-cli 未安装，跳过 env pull；请确保 .env.local 已就绪');
}

// 2. action-plugin init —— 装 user app 在 package.json.actionPlugins 里声明的插件。
console.log('[dev-local] (2/5) action-plugin init...');
try {
  execSync('npx -y @lark-apaas/fullstack-cli@latest action-plugin init', { stdio: 'inherit' });
} catch {
  warn('action-plugin init 失败，继续启动');
}

// 3. skills sync —— --local 切到 flat layout (.agents/skills + .claude/skills 软链),
// 跟沙箱 nested layout 区分。不传 --version,handler 默认拉 coding-steering@latest,
// 保证每次本地 npm run dev 都把 skills 升到最新。
console.log('[dev-local] (3/5) miaoda skills sync...');
try {
  execSync('npx -y @lark-apaas/miaoda-cli@latest skills sync --local', { stdio: 'inherit' });
} catch {
  console.log('  (skills sync 失败，继续启动)');
}

// 4. 加载 .env / .env.local 到 process.env
// dotenv 默认 override:false，先到先得 → 先 .env.local 让它优先于 .env；
// shell env 已在 process.env，两次 config 都不会覆盖。
console.log('[dev-local] (4/5) loading .env / .env.local...');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// SUDA_WEBUSER 适配（详见文件头注释）
if (process.env.SUDA_WEBUSER) {
  const raw = process.env.SUDA_WEBUSER;
  try {
    JSON.parse(raw);
  } catch {
    try {
      const unescaped = raw.replace(/\\"/g, '"');
      JSON.parse(unescaped);
      process.env.SUDA_WEBUSER = unescaped;
    } catch {
      warn(`SUDA_WEBUSER 解析失败,值头部: ${raw.slice(0, 80)}...`);
    }
  }
}

// 5. 并发起前后端 dev server
console.log('[dev-local] (5/5) 并发起 dev:server + dev:client');
const child = spawn(
  'npx',
  [
    '--no-install',
    'concurrently',
    '--names',
    'server,client',
    '--prefix-colors',
    'blue,green',
    '--kill-others-on-fail',
    'npm run dev:server',
    'npm run dev:client',
  ],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
