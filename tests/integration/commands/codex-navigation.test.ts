import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedMessage } from '@larksuite/channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveRuns } from '../../../src/bot/active-runs.js';
import { CompositionStore } from '../../../src/bot/composition-store.js';
import { PendingQueue } from '../../../src/bot/pending-queue.js';
import { commandSessionCatalogIdentity } from '../../../src/bot/session-catalog-identity.js';
import type { CodexThread } from '../../../src/codex/app-server/protocol.js';
import { tryHandleCommand, type CommandContext, type Controls } from '../../../src/commands/index.js';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema.js';
import { canUseDm } from '../../../src/policy/access.js';
import { SessionCatalog } from '../../../src/session/catalog.js';
import { SessionStore } from '../../../src/session/store.js';
import { WorkspaceStore } from '../../../src/workspace/store.js';
import { createFakeAgent } from '../../helpers/fake-agent.js';
import { createFakeChannel } from '../../helpers/fake-channel.js';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('Codex phone navigation commands', () => {
  it('uses Desktop project order and exposes every project through pages', async () => {
    const h = await createHarness();

    await expect(h.run('/projects')).resolves.toBe(true);

    const firstPage = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(firstPage).toContain('项目列表');
    expect(firstPage.indexOf('Desktop 项目 B')).toBeLessThan(firstPage.indexOf('Desktop 项目 A'));
    expect(firstPage).toContain('第 1/2 页');
    expect(firstPage).toContain('下一页');
    expect(firstPage).not.toContain('Desktop 项目 11');

    await expect(h.run('/projects page 2')).resolves.toBe(true);
    const secondPage = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(secondPage).toContain('Desktop 项目 11');
    expect(secondPage).toContain('上一页');
  });

  it('lists recent tasks across projects in activity order', async () => {
    const h = await createHarness();

    await expect(h.run('/tasks recent')).resolves.toBe(true);

    expect(h.agent.listThreads).toHaveBeenCalledWith({ limit: 100 });
    expect(h.channel.createCard).not.toHaveBeenCalled();
    const card = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(card.indexOf('项目 B 的任务')).toBeLessThan(card.indexOf('项目 A 的任务'));
    expect(card).toContain('workspace');
    expect(card).toContain('project');
    expect(card).toContain('task.use');
  });

  it('opens the selected project task list in the same click flow', async () => {
    const h = await createHarness();

    await expect(h.run(`/project use ${h.projectB}`)).resolves.toBe(true);

    const selected = h.workspaces.cwdFor('chat-1');
    expect(selected).toMatch(/project-b$/);
    expect(h.agent.listThreads).toHaveBeenLastCalledWith({ cwd: selected, limit: 200 });
    const card = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(card).toContain('任务');
    expect(card).toContain('项目 B 的任务');
    expect(card).not.toContain('项目 A 的任务');
  });

  it('selects a model and reasoning effort for the current task', async () => {
    const h = await createHarness();

    await expect(h.run('/model select gpt-test')).resolves.toBe(true);
    expect(JSON.stringify(h.channel.sent.at(-1)?.content)).toContain('选择推理强度');

    await expect(h.run('/model effort gpt-test high')).resolves.toBe(true);
    expect(h.sessions.getModel('chat-1')).toBe('gpt-test');
    expect(h.sessions.getReasoningEffort('chat-1')).toBe('high');
  });

  it('fetches only the latest turn from the active Desktop task on demand', async () => {
    const h = await createHarness();

    await expect(h.run('/task latest')).resolves.toBe(true);

    expect(h.agent.readThread).toHaveBeenCalledWith('thread-a');
    const card = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(card).toContain('最近一轮');
    expect(card).toContain('刚刚的问题');
    expect(card).toContain('刚刚的回答');
    expect(card).not.toContain('更早的问题');
  });

  it('fetches the selected task after switching between Desktop tasks', async () => {
    const h = await createHarness();

    await expect(h.run('/task use thread-c')).resolves.toBe(true);
    await expect(h.run('/task latest')).resolves.toBe(true);

    expect(h.agent.readThread).toHaveBeenLastCalledWith('thread-c');
    const card = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(card).toContain('另一个任务的问题');
    expect(card).toContain('另一个任务的回答');
    expect(card).not.toContain('刚刚的问题');
  });

  it('clears and exits composition input when switching tasks', async () => {
    const h = await createHarness();
    await h.run('/compose');
    h.compositions.add('chat-1', message('属于原任务的草稿'));

    await expect(h.run('/task use thread-c')).resolves.toBe(true);

    expect(h.compositions.isActive('chat-1')).toBe(false);
    expect(h.flushed).toHaveLength(0);
    expect(JSON.stringify(h.channel.sent)).toContain('已切换任务，组合输入草稿已清空');
  });

  it('clears and exits composition input when switching projects', async () => {
    const h = await createHarness();
    await h.run('/compose');
    h.compositions.add('chat-1', message('属于原项目的草稿'));

    await expect(h.run(`/project use ${h.projectB}`)).resolves.toBe(true);

    expect(h.compositions.isActive('chat-1')).toBe(false);
    expect(h.flushed).toHaveLength(0);
    expect(JSON.stringify(h.channel.sent)).toContain('已切换项目，组合输入草稿已清空');
  });

  it('clears and exits composition input when starting a new task', async () => {
    const h = await createHarness();
    await h.run('/compose');
    h.compositions.add('chat-1', message('属于原任务的草稿'));

    await expect(h.run('/new')).resolves.toBe(true);

    expect(h.compositions.isActive('chat-1')).toBe(false);
    expect(h.flushed).toHaveLength(0);
    expect(JSON.stringify(h.channel.sent)).toContain('已新建任务，组合输入草稿已清空');
  });

  it('submits collected text and images as one queued Codex turn', async () => {
    const h = await createHarness();

    await expect(h.run('/compose')).resolves.toBe(true);
    expect(h.compositions.isActive('chat-1')).toBe(true);
    h.compositions.add('chat-1', message('说明文字'));
    h.compositions.add('chat-1', {
      ...message(''),
      messageId: 'om-image',
      resources: [{ type: 'image', fileKey: 'img-1' }],
    } as unknown as NormalizedMessage);

    await expect(h.run('/compose send')).resolves.toBe(true);

    expect(h.compositions.isActive('chat-1')).toBe(false);
    expect(h.flushed).toHaveLength(1);
    expect(h.flushed[0]?.map((item) => item.messageId)).toEqual(['om-command', 'om-image']);
  });
});

async function createHarness(): Promise<{
  tmp: TmpProfile;
  projectB: string;
  channel: ReturnType<typeof createFakeChannel>;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  catalog: SessionCatalog;
  compositions: CompositionStore;
  flushed: NormalizedMessage[][];
  agent: ReturnType<typeof createFakeAgent> & {
    listThreads: ReturnType<typeof vi.fn>;
    readThread: ReturnType<typeof vi.fn>;
  };
  run(content: string): Promise<boolean>;
}> {
  const tmp = await createTmpProfile('codex-navigation-');
  const projectB = join(tmp.root, 'project-b');
  await Promise.all([
    mkdir(projectB, { recursive: true }),
    mkdir(join(projectB, '.git'), { recursive: true }),
  ]);
  const projectBRealpath = await realpath(projectB);
  const channel = createFakeChannel();
  channel.createCard = vi.fn(channel.createCard.bind(channel));
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json'));
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json'));
  const catalog = new SessionCatalog(join(tmp.profile, 'session-catalog.json'));
  const compositions = new CompositionStore();
  const flushed: NormalizedMessage[][] = [];
  const pending = new PendingQueue(60_000, (_scope, batch) => flushed.push(batch));
  workspaces.setCwd('chat-1', tmp.workspace);
  const threads: CodexThread[] = [
    {
      id: 'thread-a',
      cwd: tmp.workspace,
      name: '项目 A 的任务',
      updatedAt: Date.now() - 60_000,
    },
    {
      id: 'thread-b',
      cwd: projectBRealpath,
      name: '项目 B 的任务',
      updatedAt: Date.now(),
    },
    {
      id: 'thread-c',
      cwd: tmp.workspace,
      name: '项目 A 的另一个任务',
      updatedAt: Date.now() - 120_000,
    },
  ];
  const agent = Object.assign(createFakeAgent(), {
    listThreads: vi.fn(async (options?: { cwd?: string; limit?: number }) =>
      options?.cwd ? threads.filter((thread) => thread.cwd === options.cwd) : threads),
    listModels: vi.fn(async () => [{
      id: 'gpt-test',
      model: 'gpt-test',
      displayName: 'GPT Test',
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium' },
        { reasoningEffort: 'high' },
      ],
    }]),
    readThread: vi.fn(async (threadId: string) => ({
      ...threads.find((thread) => thread.id === threadId)!,
      turns: [{
        id: 'turn-old',
        items: [{ type: 'userMessage' as const, content: [{ type: 'text', text: '更早的问题' }] }],
      }, {
        id: 'turn-latest',
        items: [
          {
            type: 'userMessage' as const,
            content: [{
              type: 'text',
              text: threadId === 'thread-c' ? '另一个任务的问题' : '刚刚的问题',
            }],
          },
          {
            type: 'agentMessage' as const,
            text: threadId === 'thread-c' ? '另一个任务的回答' : '刚刚的回答',
          },
        ],
      }],
    })),
  });
  const profileConfig = createDefaultProfileConfig({
    agentKind: 'codex',
    accounts: { app: { id: 'app-id', secret: 'secret', tenant: 'feishu' } },
    codex: {
      binaryPath: '/Applications/Codex.app/Contents/Resources/codex',
      codexHome: join(tmp.root, 'custom-codex-home'),
      inheritCodexHome: true,
    },
  });
  profileConfig.workspaces.default = tmp.workspace;
  const controls = {
    profile: 'codex',
    profileConfig,
    botOwnerId: 'ou-user',
    ownerRefreshState: 'ok',
    async refreshOwner() {},
    async restart() {},
    async exit() {},
    configPath: join(tmp.profile, 'config.json'),
    cfg: profileConfig,
    processId: 'proc-1',
  } satisfies Controls;
  const identity = await commandSessionCatalogIdentity({
    msg: message(''),
    scope: 'chat-1',
    mode: 'p2p',
    workspaces,
    controls,
    access: canUseDm(profileConfig, controls, 'ou-user'),
  });
  if (!identity) throw new Error('expected a Codex session catalog identity');
  catalog.upsertActive({ ...identity, threadId: 'thread-a' });
  const activeRuns = new ActiveRuns();
  const desktopProjects = [
    { id: 'project-b', name: 'Desktop 项目 B', cwd: projectBRealpath, rootPaths: [projectBRealpath], taskCount: 1 },
    { id: 'project-a', name: 'Desktop 项目 A', cwd: tmp.workspace, rootPaths: [tmp.workspace], taskCount: 1 },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `project-${index + 2}`,
      name: `Desktop 项目 ${index + 2}`,
      cwd: join(tmp.root, `desktop-project-${index + 2}`),
      rootPaths: [join(tmp.root, `desktop-project-${index + 2}`)],
      taskCount: 0,
    })),
  ];
  const run = (content: string): Promise<boolean> => tryHandleCommand({
    channel: channel as unknown as CommandContext['channel'],
    msg: message(content),
    scope: 'chat-1',
    chatMode: 'p2p',
    sessions,
    sessionCatalog: catalog,
    sessionCatalogIdentity: identity,
    workspaces,
    agent,
    activeRuns,
    compositions,
    pending,
    controls,
    desktopProjectsProvider: async () => desktopProjects,
  });
  cleanups.push(async () => {
    pending.cancelAll();
    await Promise.all([sessions.flush(), workspaces.flush(), catalog.flush()]);
    await tmp.cleanup();
  });
  return {
    tmp,
    projectB,
    channel,
    sessions,
    workspaces,
    catalog,
    compositions,
    flushed,
    agent,
    run,
  };
}

function message(content: string): NormalizedMessage {
  return {
    messageId: 'om-command',
    chatId: 'chat-1',
    chatType: 'p2p',
    senderId: 'ou-user',
    senderName: 'User',
    content,
    resources: [],
    mentionedBot: false,
  } as unknown as NormalizedMessage;
}
