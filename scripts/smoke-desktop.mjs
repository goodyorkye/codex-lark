#!/usr/bin/env node
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

const candidates = [
  '/Applications/ChatGPT.app',
  '/Applications/Codex.app',
  join(homedir(), 'Applications', 'ChatGPT.app'),
  join(homedir(), 'Applications', 'Codex.app'),
];

let binary;
for (const app of candidates) {
  const candidate = join(app, 'Contents', 'Resources', 'codex');
  try {
    await access(candidate, constants.X_OK);
    binary = candidate;
    break;
  } catch {
    // Keep looking only in Desktop application bundles.
  }
}
if (!binary) throw new Error('ChatGPT/Codex Desktop bundled core not found');

const child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
lines.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    if (message.id === undefined || message.method) return;
    const entry = pending.get(String(message.id));
    if (!entry) return;
    pending.delete(String(message.id));
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
    else entry.resolve(message.result);
  } catch {
    // Ignore non-protocol noise; the timeout remains authoritative.
  }
});

function request(method, params = {}) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`timeout: ${method}`));
    }, 10000);
    pending.set(String(id), { resolve, reject, timer });
  });
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return promise;
}

try {
  await request('initialize', {
    clientInfo: { name: 'codex_lark_smoke', title: 'codex-lark smoke', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  const threads = await request('thread/list', {
    cursor: null,
    limit: 1,
    sortKey: 'updated_at',
    sortDirection: 'desc',
  });
  if (!threads || !Array.isArray(threads.data)) throw new Error('thread/list returned an invalid shape');
  console.log(`Desktop App Server smoke check passed (${threads.data.length} task row inspected, content not printed).`);
} catch (error) {
  const detail = stderr.trim() ? `\nApp Server stderr: ${stderr.trim().slice(0, 500)}` : '';
  throw new Error(`${error instanceof Error ? error.message : String(error)}${detail}`);
} finally {
  lines.close();
  child.kill('SIGTERM');
}
