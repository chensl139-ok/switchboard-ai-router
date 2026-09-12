#!/usr/bin/env node
/**
 * 插件充血脚本：合并 capability JSON + manifest.json，生成调用投影。
 *
 * 内部逻辑等价于 fullstack-cli hydrateCapability + miaoda plugin list。
 *
 * 输入（命令行参数）:
 *   pluginKey   — 如 @official-plugins/ai-text-to-json
 *   instanceId  — 如 task-json-extractor
 *
 * 输出:
 *   stdout 含 actions[] 的完整 JSON
 *   exit 1 → stderr 错误信息
 *
 * 用法:
 *   node plugin-hydrate.js @official-plugins/ai-text-to-json task-json-extractor
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const [pluginKey, instanceId] = process.argv.slice(2);

if (!pluginKey || !instanceId) {
  process.stderr.write('Usage: node plugin-hydrate.js <pluginKey> <instanceId>\n');
  process.exit(1);
}

const cwd = process.cwd();

// ── ① 探测 capabilities 目录 ──
function resolveCapDir() {
  if (process.env.MIAODA_CAPABILITIES_DIR) {
    return path.isAbsolute(process.env.MIAODA_CAPABILITIES_DIR)
      ? process.env.MIAODA_CAPABILITIES_DIR
      : path.join(cwd, process.env.MIAODA_CAPABILITIES_DIR);
  }

  let appType = process.env.MIAODA_APP_TYPE;
  if (!appType) {
    try {
      const envLocal = fs.readFileSync(path.join(cwd, '.env.local'), 'utf-8');
      for (const line of envLocal.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (k === 'MIAODA_APP_TYPE') { appType = v; break; }
      }
    } catch (_) {}
  }
  if (appType === '6') return path.join(cwd, 'shared', 'capabilities');
  if (appType) return path.join(cwd, 'server', 'capabilities');

  const serverDir = path.join(cwd, 'server', 'capabilities');
  const sharedDir = path.join(cwd, 'shared', 'capabilities');
  const serverExists = fs.existsSync(serverDir);
  const sharedExists = fs.existsSync(sharedDir);
  if (serverExists) return serverDir;
  if (sharedExists) return sharedDir;
  return serverDir; // default
}

// ── 检查是否动态 schema ──
function isDynamic(schema) {
  return schema && typeof schema === 'object' && schema.dynamic === true;
}

// ── 主流程 ──
try {
  const capDir = resolveCapDir();
  const capPath = path.join(capDir, instanceId + '.json');

  // ② 读 capability JSON
  if (!fs.existsSync(capPath)) {
    process.stderr.write('Error: Instance not found: ' + instanceId + '\n');
    process.exit(1);
  }
  const cap = JSON.parse(fs.readFileSync(capPath, 'utf-8'));
  const paramsSchema = cap.paramsSchema;
  const formValue = cap.formValue || {};

  // ③ 读 manifest.json
  const manifestPath = path.join(cwd, 'node_modules', pluginKey, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    process.stderr.write('Error: Plugin not installed: ' + pluginKey + '\n');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const rawActions = manifest.actions || [];
  if (rawActions.length === 0) {
    process.stderr.write('Error: Plugin has no actions defined\n');
    process.exit(1);
  }

  // ④ 检查动态 schema
  const hasDynamic = rawActions.some(
    a => isDynamic(a.inputSchema) || isDynamic(a.outputSchema)
  );

  // ⑤ 动态解析
  let resolved = {};
  if (hasDynamic) {
    const projectRequire = createRequire(path.join(cwd, 'package.json'));
    const plugin = projectRequire(pluginKey);
    const instance = plugin.create(formValue);

    const actionKeys = rawActions.map(a => a.key).filter(Boolean);
    for (const key of actionKeys) {
      try { resolved[key + '_input'] = instance.getInputJsonSchema(key); } catch (_) {}
      try { resolved[key + '_output'] = instance.getOutputJsonSchema(key, formValue); } catch (_) {}
    }
  }

  // ⑥ 构建 actions 数组
  const hasParams = paramsSchema && typeof paramsSchema === 'object' && Object.keys(paramsSchema).length > 0;
  const actions = rawActions.map((action, i) => {
    const out = {
      key: action.key,
      outputMode: action.outputMode || '',
    };

    // inputSchema: action[0] + paramsSchema 优先
    if (i === 0 && hasParams) {
      out.inputSchema = paramsSchema;
    } else if (hasDynamic && isDynamic(action.inputSchema)) {
      out.inputSchema = resolved[action.key + '_input'];
    } else {
      out.inputSchema = action.inputSchema;
    }

    // outputSchema
    if (hasDynamic && isDynamic(action.outputSchema)) {
      out.outputSchema = resolved[action.key + '_output'];
    } else {
      out.outputSchema = action.outputSchema;
    }

    return out;
  });

  // 输出
  const result = { ...cap, actions };
  process.stdout.write(JSON.stringify(result, null, 2));

} catch (e) {
  process.stderr.write('Error: ' + (e.message || e) + '\n');
  process.exit(1);
}
