#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const binary = process.platform === 'win32'
  ? await findWindowsDesktopCore()
  : await findMacDesktopCore();
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
    clientInfo: { name: 'codex_lark_smoke', title: 'codex-lark smoke', version: '0.2.1' },
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

async function findMacDesktopCore() {
  const candidates = [
    '/Applications/ChatGPT.app',
    '/Applications/Codex.app',
    join(homedir(), 'Applications', 'ChatGPT.app'),
    join(homedir(), 'Applications', 'Codex.app'),
  ];
  for (const app of candidates) {
    const candidate = join(app, 'Contents', 'Resources', 'codex');
    if (await isRunnableFile(candidate, constants.X_OK)) return candidate;
  }
  return undefined;
}

async function findWindowsDesktopCore() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |',
    '  Sort-Object Version -Descending |',
    '  ForEach-Object { $_.InstallLocation }',
  ].join('\n');
  let stdout = '';
  try {
    ({ stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    ));
  } catch {
    return undefined;
  }

  for (const root of stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)) {
    for (const candidate of [
      join(root, 'resources', 'codex.exe'),
      join(root, 'app', 'resources', 'codex.exe'),
      join(root, 'resources', 'bin', 'codex.exe'),
      join(root, 'resources', 'app.asar.unpacked', 'codex.exe'),
    ]) {
      if (await isRunnableFile(candidate, constants.R_OK)) return candidate;
    }

    const queue = [{ path: root, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < 10_000) {
      const current = queue.shift();
      visited += 1;
      let entries = [];
      try {
        entries = await readdir(current.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = join(current.path, entry.name);
        if (entry.isDirectory() && current.depth < 8) {
          queue.push({ path, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile() || entry.name.toLowerCase() !== 'codex.exe') continue;
        const parts = relative(root, path).toLowerCase().split(sep);
        if (
          (parts.includes('resources') || parts.includes('bin') || parts.includes('app.asar.unpacked'))
          && await isRunnableFile(path, constants.R_OK)
        ) return path;
      }
    }
  }
  return undefined;
}

async function isRunnableFile(path, mode) {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
