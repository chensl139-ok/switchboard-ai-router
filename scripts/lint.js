#!/usr/bin/env node

const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const cwd = process.cwd();

function getBinName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

function normalizeProjectFile(filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);

  if (!fs.existsSync(absolutePath)) {
    console.warn(`[lint] Skip missing file: ${filePath}`);
    return null;
  }

  const relativePath = path.relative(cwd, absolutePath);
  if (relativePath.startsWith('..')) {
    console.warn(`[lint] Skip file outside project: ${filePath}`);
    return null;
  }

  return relativePath.split(path.sep).join('/');
}

function parseFilesArg(argv) {
  const filesIndex = argv.indexOf('--files');
  if (filesIndex === -1) {
    return null;
  }

  return argv.slice(filesIndex + 1).filter(Boolean);
}

function isEslintTarget(filePath) {
  return /\.(c|m)?(j|t)sx?$/.test(filePath);
}

function isTypeCheckTarget(filePath) {
  return /\.(ts|tsx|mts|cts)$/.test(filePath);
}

function isStylelintTarget(filePath) {
  return filePath.endsWith('.css');
}

const STYLELINT_CONFIG_FILES = [
  '.stylelintrc',
  '.stylelintrc.js',
  '.stylelintrc.cjs',
  '.stylelintrc.json',
  'stylelint.config.js',
];

/**
 * 老模板（fullstack-nestjs-template 1.x 时代）的应用跑不了 stylelint，跑了就挂、把 pre-commit
 * 卡死。两种形态都实测过：
 *
 * - 缺 scripts.stylelint → `npm error Missing script: "stylelint"`
 * - 缺 .stylelintrc.*    → `ConfigurationError: No configuration provided`
 *
 * 注意光判断 stylelint 装没装拦不住：@lark-apaas/fullstack-presets 的 dependencies 里有
 * stylelint，只要 dep 了 presets 二进制就在。缺任一件就跳过这一步。
 */
function canRunStylelint() {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return false;
  }

  if (!pkg.scripts || !pkg.scripts.stylelint) return false;

  return STYLELINT_CONFIG_FILES.some(file => fs.existsSync(path.join(cwd, file)));
}

async function runDefaultLint() {
  const commands = ['npm run eslint', 'npm run type:check'];

  if (canRunStylelint()) {
    commands.push('npm run stylelint');
  } else {
    console.warn('[lint] Skip stylelint: missing scripts.stylelint or stylelint config');
  }

  const code = await runCommand(getBinName('npx'), ['concurrently', ...commands]);
  process.exit(code);
}

async function runSelectiveLint(inputFiles) {
  const normalizedFiles = Array.from(
    new Set(inputFiles.map(normalizeProjectFile).filter(Boolean)),
  );

  if (normalizedFiles.length === 0) {
    console.log('[lint] No supported project files found');
    process.exit(0);
  }

  const eslintFiles = normalizedFiles.filter(isEslintTarget);
  const stylelintFiles = normalizedFiles.filter(isStylelintTarget);
  const typeCheckFiles = normalizedFiles.filter(isTypeCheckTarget);

  const clientTypeFiles = [];
  const serverTypeFiles = [];

  for (const filePath of typeCheckFiles) {
    if (filePath.startsWith('client/')) {
      clientTypeFiles.push(filePath);
    } else if (filePath.startsWith('server/')) {
      serverTypeFiles.push(filePath);
    } else if (filePath.startsWith('shared/')) {
      clientTypeFiles.push(filePath);
      serverTypeFiles.push(filePath);
    }
  }

  const tasks = [];

  if (eslintFiles.length > 0) {
    tasks.push(runCommand(getBinName('npx'), ['eslint', '--quiet', ...eslintFiles]));
  }

  if (stylelintFiles.length > 0 && !canRunStylelint()) {
    console.warn('[lint] Skip stylelint: missing scripts.stylelint or stylelint config');
  } else if (stylelintFiles.length > 0) {
    tasks.push(runCommand(getBinName('npx'), ['stylelint', '--quiet', ...stylelintFiles]));
  }

  if (clientTypeFiles.length > 0) {
    tasks.push(runCommand(getBinName('npm'), ['run', 'type:check:client']));
  }

  if (serverTypeFiles.length > 0) {
    tasks.push(runCommand(getBinName('npm'), ['run', 'type:check:server']));
  }

  if (tasks.length === 0) {
    console.log('[lint] No supported files matched for lint');
    process.exit(0);
  }

  const results = await Promise.all(tasks);
  process.exit(results.some(code => code !== 0) ? 1 : 0);
}

async function main() {
  const files = parseFilesArg(process.argv.slice(2));
  if (files === null) {
    await runDefaultLint();
    return;
  }

  if (files.length === 0) {
    console.error('[lint] --files requires at least one file path');
    process.exit(1);
  }

  await runSelectiveLint(files);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lint] Failed to run lint: ${message}`);
  process.exit(1);
});
