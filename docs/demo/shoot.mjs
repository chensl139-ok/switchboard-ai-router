/**
 * 控制台演示截图脚本（README 素材再生成用）。
 *
 * 前提：
 *   1. 已运行 `npm ci && npm run build:web`；
 *   2. 演示实例已启动，例如：
 *        ADMIN_TOKEN=$(openssl rand -hex 24) GATEWAY_TOKEN=$(openssl rand -hex 24) \
 *        HOST=127.0.0.1 PORT=3199 DATA_DIR=/tmp/switchboard-demo-data node platform.mjs
 *   3. npm i puppeteer-core（仓库不内置此开发依赖）
 *
 * 运行：ADMIN_TOKEN=<上面的令牌> node docs/demo/shoot.mjs
 * 输出：docs/demo/frames/*.png
 *
 * ⚠️ 截图会进入公开仓库：脚本固定使用 sk-demo-… 假密钥与示例邮箱，
 *    不要在这里填入任何真实凭据。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frames');
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3199';
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN || TOKEN.length < 24) throw new Error('请通过 ADMIN_TOKEN 环境变量传入演示实例的令牌');
const WAIT = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    '--window-size=1440,900', '--no-first-run', '--disable-crash-reporter', '--disable-breakpad', '--lang=zh-CN'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

const shot = async name => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
const api = (url, data) => page.evaluate(async ([p, d]) => {
  const r = await fetch(p, { method: d ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined });
  return { status: r.status, body: (await r.text()).slice(0, 200) };
}, [url, data ?? null]);

// 1. 首次初始化界面
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('input[name="bootstrapToken"]', { timeout: 15000 });
await WAIT(700);
await shot('01-setup');

// 2. 创建演示所有者账户
await page.type('input[name="bootstrapToken"]', TOKEN, { delay: 5 });
await page.type('input[name="name"]', 'Ada Chen', { delay: 10 });
await page.type('input[name="email"]', 'ada@switchboard.dev', { delay: 10 });
await page.type('input[name="password"]', 'demo-only-not-real-password', { delay: 5 });
await page.evaluate(() => document.querySelector('#account-login').requestSubmit());
await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 20000 }).catch(() => {});
await WAIT(1800);

// 3. 通过控制台同款 API 写入演示服务商（假密钥，仅用于界面展示）
const providers = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], apiKey: 'sk-demo-not-real-0000000000000000', enabled: true, weight: 3 },
  { id: 'qwen', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', model: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-flash'], apiKey: 'sk-demo-not-real-1111111111111111', enabled: true, weight: 2 },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic', model: 'claude-sonnet-4-5', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], apiKey: 'sk-ant-demo-not-real-2222222222', enabled: true, weight: 1 },
];
for (const p of providers) {
  const r = await api('/api/provider', p);
  if (r.status !== 200) throw new Error(`服务商 ${p.id} 写入失败：${r.body}`);
}

// 4. 路由策略 + 业务 Key
await api('/api/routing', { active: 'deepseek', strategy: 'fallback', routing: { timeoutMs: 30000, maxAttempts: 3, requestsPerMinute: 60, concurrency: 5 } });
await api('/api/keys', { name: 'cherry-studio-mac', expiresAt: new Date(Date.now() + 90 * 864e5).toISOString() });
await api('/api/keys', { name: 'team-webapp-prod' });

// 5. 刷新拾取新状态后逐页截图
await page.reload({ waitUntil: 'networkidle0' });
await WAIT(1500);
const go = async (hash, name, wait = 1400) => {
  await page.evaluate(h => { location.hash = h; }, hash);
  await WAIT(wait);
  await shot(name);
};
await go('#overview', '02-overview');
await go('#providers', '03-providers', 1600);
await go('#routing', '04-routing', 1600);
await go('#playground', '05-playground');
await go('#media', '06-media');
await go('#keys', '07-keys');
await go('#analytics', '08-analytics');
await go('#api', '09-apidocs', 1600);

await browser.close();
console.log('完成，帧位于', OUT);
