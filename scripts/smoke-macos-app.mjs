#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  console.log('Standalone macOS app smoke check skipped off macOS.');
  process.exit(0);
}

const executable = join(
  process.cwd(),
  'release',
  'Codex Lark.app',
  'Contents',
  'MacOS',
  'codex-lark',
);
const isolatedHome = await mkdtemp(join(tmpdir(), 'codex-lark-app-smoke-'));
const child = spawn(executable, [], {
  env: {
    ...process.env,
    CODEX_LARK_NO_OPEN: '1',
    CODEX_LARK_CODEX_BIN: '/private/tmp/codex-lark-intentionally-missing',
    CODEX_LARK_HOME: isolatedHome,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });

try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dashboard URL timeout')), 10000);
    child.once('exit', (code, signal) => reject(new Error(`app exited early (code=${code}, signal=${signal}): ${stderr}`)));
    lines.on('line', (line) => {
      const match = line.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[0]);
    });
  });
  const response = await fetch(url);
  const html = await response.text();
  if (!response.ok || !html.includes('codex-lark') || !html.includes('/api/status')) {
    throw new Error('dashboard HTML contract failed');
  }
  const second = spawn(executable, [], {
    env: {
      ...process.env,
      CODEX_LARK_NO_OPEN: '1',
      CODEX_LARK_CODEX_BIN: '/private/tmp/codex-lark-intentionally-missing',
      CODEX_LARK_HOME: isolatedHome,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let secondOutput = '';
  second.stdout.on('data', (chunk) => { secondOutput += chunk; });
  const secondExit = await new Promise((resolve) => second.once('exit', resolve));
  if (secondExit !== 0 || !secondOutput.includes('已在运行')) {
    throw new Error('second launch did not reopen the live dashboard');
  }
  console.log('Standalone Codex Lark.app smoke check passed.');
} finally {
  lines.close();
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(isolatedHome, { recursive: true, force: true });
}
