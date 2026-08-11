import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexHistoryError,
  listCodexThreadHistory,
} from '../../../src/session/codex-history.js';
import { buildAgentPrompt } from '../../../src/agent/prompt.js';

interface FakeCodex {
  dir: string;
  path: string;
  recordPath: string;
}

describe('Codex thread history provider', () => {
  const cleanup: string[] = [];
  const oldCodexHome = process.env.CODEX_HOME;

  afterEach(async () => {
    if (oldCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = oldCodexHome;
    }
    await Promise.all(
      cleanup.splice(0).map((dir) =>
        rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }),
      ),
    );
  });

  it('lists cwd-filtered Codex threads through app-server without exposing sub-agent sources', async () => {
    process.env.CODEX_HOME = '/outer/codex-home';
    const fake = await createFakeCodex();
    cleanup.push(fake.dir);

    const entries = await listCodexThreadHistory({
      binary: fake.path,
      cwd: '/repo',
      limit: 2,
      profileStateDir: fake.dir,
      timeoutMs: 5000,
    });

    expect(entries).toEqual([
      {
        threadId: 'thread-new',
        sessionId: 'session-new',
        preview: 'new thread prompt',
        cwd: '/repo',
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_050_000,
        source: 'exec',
        name: 'New work',
      },
      {
        threadId: 'thread-old',
        sessionId: 'session-old',
        preview: '(空会话)',
        cwd: '/repo',
        createdAtMs: 1_699_999_000_000,
        updatedAtMs: 1_699_999_500_000,
        source: 'cli',
        name: undefined,
      },
    ]);

    const record = JSON.parse(await readFile(fake.recordPath, 'utf8')) as {
      argv: string[];
      env: Record<string, string | undefined>;
      requests: Array<{ method: string; params?: unknown }>;
    };
    expect(record.argv).toEqual(['app-server', '--listen', 'stdio://']);
    expect(record.env.CODEX_HOME).toBe('/outer/codex-home');
    expect(record.requests).toMatchObject([
      { method: 'initialize' },
      {
        method: 'thread/list',
        params: {
          cwd: '/repo',
          limit: 2,
          archived: false,
          sortKey: 'updated_at',
          sortDirection: 'desc',
          useStateDbOnly: true,
          sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'],
        },
      },
    ]);
  });

  it('uses the profile-local Codex home when inheritance is disabled', async () => {
    process.env.CODEX_HOME = '/outer/codex-home';
    const fake = await createFakeCodex();
    cleanup.push(fake.dir);

    await listCodexThreadHistory({
      binary: fake.path,
      cwd: '/repo',
      limit: 1,
      profileStateDir: fake.dir,
      inheritCodexHome: false,
      timeoutMs: 5000,
    });

    const record = JSON.parse(await readFile(fake.recordPath, 'utf8')) as {
      env: Record<string, string | undefined>;
    };
    expect(record.env.CODEX_HOME).toBe(join(fake.dir, 'codex-home'));
  });

  it('throws a typed error when app-server rejects the history request', async () => {
    const fake = await createFakeCodex({ failList: true });
    cleanup.push(fake.dir);

    await expect(
      listCodexThreadHistory({
        binary: fake.path,
        cwd: '/repo',
        limit: 1,
        profileStateDir: fake.dir,
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      name: 'CodexHistoryError',
      code: 'app-server-error',
    } satisfies Partial<CodexHistoryError>);
  });

  it('summarizes bridge-prefixed Codex previews using the real user input section', async () => {
    const fake = await createFakeCodex({
      firstPreview: `# codex-lark 运行约定\n\n## user_message\n\n${buildAgentPrompt({
        context: {
          chatId: 'oc_secret',
          chatType: 'p2p',
          senderId: 'ou_secret',
          source: 'im',
        },
        instructions: ['internal bridge instruction'],
        userInput: 'Codex 真实用户问题\n\n第二行',
      })}`,
    });
    cleanup.push(fake.dir);

    const entries = await listCodexThreadHistory({
      binary: fake.path,
      cwd: '/repo',
      limit: 1,
      profileStateDir: fake.dir,
      timeoutMs: 5000,
    });

    expect(entries[0]?.preview).toBe('Codex 真实用户问题 第二行');
  });
});

async function createFakeCodex(options: { failList?: boolean; firstPreview?: string } = {}): Promise<FakeCodex> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-history-test-'));
  const scriptPath = process.platform === 'win32' ? join(dir, 'codex-app-server.mjs') : join(dir, 'codex');
  const path = process.platform === 'win32' ? join(dir, 'codex.cmd') : scriptPath;
  const recordPath = join(dir, 'record.json');
  const firstPreview = options.firstPreview ?? 'new thread prompt';
  const script = `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const requests = [];
const recordPath = ${JSON.stringify(recordPath)};
const failList = ${JSON.stringify(options.failList === true)};
let stdinEnded = false;
let persisted = false;

function persist() {
  if (persisted) return;
  persisted = true;
  writeFileSync(recordPath, JSON.stringify({
    argv: process.argv.slice(2),
    env: { CODEX_HOME: process.env.CODEX_HOME },
    requests
  }, null, 2));
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdin.on('end', () => {
  stdinEnded = true;
});
process.on('SIGTERM', () => {
  persist();
  process.exit(0);
});
process.on('exit', persist);

rl.on('line', (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  requests.push({ method: req.method, params: req.params });
  if (req.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      id: req.id,
      result: {
        userAgent: 'fake-codex',
        codexHome: process.env.CODEX_HOME ?? '',
        platformFamily: 'unix',
        platformOs: 'macos'
      }
    }) + '\\n');
  } else if (req.method === 'thread/list') {
    setTimeout(() => {
      if (stdinEnded) {
        persist();
        process.exit(0);
      }
      persist();
      if (failList) {
        process.stdout.write(JSON.stringify({
          id: req.id,
          error: { code: -32000, message: 'history unavailable' }
        }) + '\\n');
      } else {
        process.stdout.write(JSON.stringify({
          id: req.id,
          result: {
            data: [
              {
                id: 'thread-new',
                sessionId: 'session-new',
                preview: ${JSON.stringify(firstPreview)},
                ephemeral: false,
                modelProvider: 'openai',
                createdAt: 1700000000,
                updatedAt: 1700000050,
                status: { type: 'notLoaded' },
                path: '/tmp/thread-new.jsonl',
                cwd: '/repo',
                cliVersion: '0.130.0',
                source: 'exec',
                threadSource: null,
                forkedFromId: null,
                agentNickname: null,
                agentRole: null,
                gitInfo: null,
                name: 'New work',
                turns: []
              },
              {
                id: 'thread-old',
                sessionId: 'session-old',
                preview: '',
                ephemeral: false,
                modelProvider: 'openai',
                createdAt: 1699999000,
                updatedAt: 1699999500,
                status: { type: 'notLoaded' },
                path: '/tmp/thread-old.jsonl',
                cwd: '/repo',
                cliVersion: '0.130.0',
                source: 'cli',
                threadSource: null,
                forkedFromId: null,
                agentNickname: null,
                agentRole: null,
                gitInfo: null,
                name: null,
                turns: []
              }
            ],
            nextCursor: null,
            backwardsCursor: null
          }
        }) + '\\n');
      }
    }, 25);
  }
});
`;
  await writeFile(scriptPath, script, 'utf8');
  if (process.platform === 'win32') {
    await writeFile(path, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
  } else {
    await chmod(path, 0o755);
  }
  return { dir, path, recordPath };
}
