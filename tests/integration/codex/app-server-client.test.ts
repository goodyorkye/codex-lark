import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../../../src/codex/app-server/client';
import type { ApprovalRequest } from '../../../src/codex/app-server/protocol';
import {
  CodexAppServerAdapter,
  resumeThreadWithDesktopHandoff,
} from '../../../src/agent/codex/app-server-adapter';
import type { AgentEvent } from '../../../src/agent/types';

describe.skipIf(process.platform === 'win32')('Codex App Server integration', () => {
  it('hands an active-writer resume back to Desktop after its IPC snapshot arrives', async () => {
    const resumeThread = vi.fn()
      .mockRejectedValueOnce(new Error('thread thread-1 already has an active writer (-32600)'));
    const resumeDesktopOwnedThread = vi.fn()
      .mockResolvedValueOnce({ id: 'thread-1', cwd: '/tmp/project' });
    const waitForDesktopThreadState = vi.fn(async () => true);

    await expect(resumeThreadWithDesktopHandoff({
      resumeThread,
      resumeDesktopOwnedThread,
      waitForDesktopThreadState,
    } as never, 'thread-1', { cwd: '/tmp/project' })).resolves.toMatchObject({
      id: 'thread-1',
    });

    expect(waitForDesktopThreadState).toHaveBeenCalledWith('thread-1');
    expect(resumeThread).toHaveBeenCalledTimes(1);
    expect(resumeDesktopOwnedThread).toHaveBeenCalledWith('thread-1', { cwd: '/tmp/project' });
  });

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
    expect(approval).toMatchObject({
      method: 'item/fileRead/requestApproval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      title: '文件读取审批',
    });
    await client.resolveApproval(approval.requestId, 'acceptForSession');
    expect(client.pendingApprovals()).toHaveLength(0);
    await client.stop();
  });

  it('sends attachment-only audio without synthetic text input', async () => {
    const requestLog = join(await mkdtemp(join(tmpdir(), 'codex-lark-audio-log-')), 'requests.jsonl');
    const client = new CodexAppServerClient({
      binaryPath: await fakeAppServer(requestLog),
      env: { ...process.env, CODEX_LARK_DESKTOP_IPC: '0' },
      requestTimeoutMs: 3_000,
    });
    await client.start();
    await client.startTurn({ threadId: 'thread-1', text: '', audios: ['/tmp/voice.opus'] });

    const requests = (await readFile(requestLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(requests.find((message) => message.method === 'turn/start')?.params.input).toEqual([
      { type: 'localAudio', path: '/tmp/voice.opus' },
    ]);
    await client.stop();
  });

  it('sends ordinary files as visible local-path references in the same turn', async () => {
    const requestLog = join(await mkdtemp(join(tmpdir(), 'codex-lark-file-log-')), 'requests.jsonl');
    const client = new CodexAppServerClient({
      binaryPath: await fakeAppServer(requestLog),
      env: { ...process.env, CODEX_LARK_DESKTOP_IPC: '0' },
      requestTimeoutMs: 3_000,
    });
    await client.start();
    await client.startTurn({
      threadId: 'thread-1',
      text: '总结这些文件',
      files: [
        { path: '/tmp/report.pdf', name: '季度报告.pdf' },
        { path: '/tmp/notes.txt', name: 'notes [final].txt' },
      ],
    });

    const requests = (await readFile(requestLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(requests.find((message) => message.method === 'turn/start')?.params.input).toEqual([
      { type: 'text', text: '总结这些文件' },
      { type: 'text', text: '[附件：季度报告.pdf](</tmp/report.pdf>)' },
      { type: 'text', text: '[附件：notes \\[final\\].txt](</tmp/notes.txt>)' },
    ]);
    await client.stop();
  });

  it('streams a new task and does not lose notifications sent beside turn/start', async () => {
    const requestLog = join(await mkdtemp(join(tmpdir(), 'codex-lark-request-log-')), 'requests.jsonl');
    const binary = await fakeAppServer(requestLog);
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
      prompt: `<bridge_context>\n{"chatId":"oc_test","chatType":"p2p","senderId":"ou_test","source":"im"}\n</bridge_context>\n\n<bridge_instructions>\n["internal"]\n</bridge_instructions>\n\n<user_input>\n{"text":"hello"}\n</user_input>`,
      cwd: '/tmp/project',
      model: 'gpt-test',
      reasoningEffort: 'high',
      images: ['/tmp/example.png'],
      audios: ['/tmp/example.ogg'],
      files: [{ path: '/tmp/example.txt', name: 'example.txt' }],
    });
    const events: AgentEvent[] = [];
    for await (const event of run.events) events.push(event);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'system', threadId: 'thread-1' }),
      expect.objectContaining({ type: 'approval_request' }),
      expect.objectContaining({ type: 'text', delta: 'hello from desktop' }),
      expect.objectContaining({ type: 'done', threadId: 'thread-1' }),
    ]));
    const requests = (await readFile(requestLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(requests.find((message) => message.method === 'thread/start')?.params).not.toHaveProperty('developerInstructions');
    expect(requests.find((message) => message.method === 'thread/start')?.params).toMatchObject({
      model: 'gpt-test',
      reasoningEffort: 'high',
    });
    expect(requests.find((message) => message.method === 'thread/name/set')?.params).toEqual({
      threadId: 'thread-1',
      name: 'hello',
    });
    expect(requests.find((message) => message.method === 'turn/start')?.params).toMatchObject({
      input: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: '[附件：example.txt](</tmp/example.txt>)' },
        { type: 'localImage', path: '/tmp/example.png' },
        { type: 'localAudio', path: '/tmp/example.ogg' },
      ],
      model: 'gpt-test',
      reasoningEffort: 'high',
    });
    expect(requests.find((message) => message.method === 'turn/start')?.params).not.toHaveProperty('additionalContext');
    await adapter.shutdown();
  });

  it('moves a legacy bridge-prefixed session to a clean new Desktop task', async () => {
    const requestLog = join(await mkdtemp(join(tmpdir(), 'codex-lark-legacy-log-')), 'requests.jsonl');
    const binary = await fakeAppServer(requestLog, true);
    const adapter = new CodexAppServerAdapter({
      binaryPath: binary,
      env: {
        ...process.env,
        CODEX_LARK_DESKTOP_IPC: '0',
        CODEX_LARK_DESKTOP_AUTO_FOLLOW: '0',
      },
    });
    const run = adapter.run({
      runId: 'run-legacy',
      threadId: 'legacy-thread',
      prompt: `<bridge_context>\n{"chatId":"oc_test","chatType":"p2p","senderId":"ou_test","source":"im"}\n</bridge_context>\n\n<user_input>\n{"text":"继续处理"}\n</user_input>`,
      cwd: '/tmp/project',
    });
    for await (const _event of run.events) {
      // Drain the run.
    }

    const requests = (await readFile(requestLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(requests.some((message) => message.method === 'thread/resume')).toBe(false);
    expect(requests.some((message) => message.method === 'thread/start')).toBe(true);
    expect(requests.filter((message) => message.method === 'thread/name/set').map((message) => message.params)).toEqual([
      { threadId: 'legacy-thread', name: '你好' },
      { threadId: 'thread-1', name: '继续处理' },
    ]);
    await adapter.shutdown();
  });
});

async function fakeAppServer(requestLog?: string, legacyPreview = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-lark-app-server-'));
  const binary = join(root, 'codex');
  const script = `#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', (line) => {
  const message = JSON.parse(line);
  ${requestLog ? `fs.appendFileSync(${JSON.stringify(requestLog)}, JSON.stringify(message) + '\\n');` : ''}
  if (message.method === 'initialize') return send({ id: message.id, result: { userAgent: 'fake' } });
  if (message.method === 'initialized') return;
  if (message.method === 'thread/list') return send({ id: message.id, result: { data: [{ id: 'thread-1', cwd: '/tmp/project', preview: 'hello' }], nextCursor: null } });
  if (message.method === 'thread/read') return send({ id: message.id, result: { thread: { id: message.params.threadId, cwd: '/tmp/project', turns: [], ${legacyPreview ? `preview: '<bridge_context>\\n{}\\n</bridge_context>\\n\\n<user_input>\\n{"text":"你好"}\\n</user_input>', name: null,` : ''} } } });
  if (message.method === 'model/list') return send({ id: message.id, result: { data: [{ id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test', isDefault: true }] } });
  if (message.method === 'thread/start' || message.method === 'thread/resume') return send({ id: message.id, result: { thread: { id: 'thread-1', cwd: message.params.cwd || '/tmp/project' } } });
  if (message.method === 'thread/name/set') return send({ id: message.id, result: {} });
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
    send({ id: 900, method: 'item/fileRead/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', grantRoot: '/tmp/voice.opus', reason: 'read audio' } });
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
