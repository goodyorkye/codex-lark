import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { CodexAppServerClient } from '../../../src/codex/app-server/client';
import type { ApprovalRequest } from '../../../src/codex/app-server/protocol';
import { CodexAppServerAdapter } from '../../../src/agent/codex/app-server-adapter';
import type { AgentEvent } from '../../../src/agent/types';

describe.skipIf(process.platform === 'win32')('Codex App Server integration', () => {
  it('initializes, lists desktop tasks/models, and resolves approvals over JSONL', async () => {
    const binary = await fakeAppServer();
    const client = new CodexAppServerClient({
      binaryPath: binary,
      env: { ...process.env, CODEX_LARK_DESKTOP_IPC: '0' },
      requestTimeoutMs: 3_000,
    });
    await client.start();
    await expect(client.listThreads()).resolves.toMatchObject({
      data: [{ id: 'thread-1', cwd: '/tmp/project' }],
    });
    await expect(client.listModels()).resolves.toEqual([
      expect.objectContaining({ model: 'gpt-test', displayName: 'GPT Test' }),
    ]);

    const approvalPromise = once(client, 'approval') as Promise<[ApprovalRequest]>;
    await client.startTurn({ threadId: 'thread-1', text: 'hello' });
    const [approval] = await approvalPromise;
    expect(approval).toMatchObject({ threadId: 'thread-1', turnId: 'turn-1' });
    await client.resolveApproval(approval.requestId, 'acceptForSession');
    expect(client.pendingApprovals()).toHaveLength(0);
    await client.stop();
  });

  it('streams a new task and does not lose notifications sent beside turn/start', async () => {
    const binary = await fakeAppServer();
    const adapter = new CodexAppServerAdapter({
      binaryPath: binary,
      env: {
        ...process.env,
        CODEX_LARK_DESKTOP_IPC: '0',
        CODEX_LARK_DESKTOP_AUTO_FOLLOW: '0',
      },
    });
    const run = adapter.run({
      runId: 'run-1',
      prompt: 'hello',
      cwd: '/tmp/project',
    });
    const events: AgentEvent[] = [];
    for await (const event of run.events) events.push(event);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'system', threadId: 'thread-1' }),
      expect.objectContaining({ type: 'approval_request' }),
      expect.objectContaining({ type: 'text', delta: 'hello from desktop' }),
      expect.objectContaining({ type: 'done', threadId: 'thread-1' }),
    ]));
    await adapter.shutdown();
  });
});

async function fakeAppServer(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-lark-app-server-'));
  const binary = join(root, 'codex');
  const script = `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') return send({ id: message.id, result: { userAgent: 'fake' } });
  if (message.method === 'initialized') return;
  if (message.method === 'thread/list') return send({ id: message.id, result: { data: [{ id: 'thread-1', cwd: '/tmp/project', preview: 'hello' }], nextCursor: null } });
  if (message.method === 'thread/read') return send({ id: message.id, result: { thread: { id: message.params.threadId, cwd: '/tmp/project', turns: [] } } });
  if (message.method === 'model/list') return send({ id: message.id, result: { data: [{ id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test', isDefault: true }] } });
  if (message.method === 'thread/start' || message.method === 'thread/resume') return send({ id: message.id, result: { thread: { id: 'thread-1', cwd: message.params.cwd || '/tmp/project' } } });
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
    send({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'echo hello', cwd: '/tmp/project', reason: 'test' } });
    send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'answer-1', delta: 'hello from desktop' } });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    return;
  }
  if (message.method === 'turn/interrupt') return send({ id: message.id, result: {} });
});
`;
  await writeFile(binary, script);
  await chmod(binary, 0o755);
  return binary;
}
