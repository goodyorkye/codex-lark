import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedMessage } from '@larksuite/channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveRuns } from '../../../src/bot/active-runs.js';
import type { CodexThread } from '../../../src/codex/app-server/protocol.js';
import { tryHandleCommand, type CommandContext, type Controls } from '../../../src/commands/index.js';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema.js';
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
  it('lists recent tasks across projects in activity order', async () => {
    const h = await createHarness();

    await expect(h.run('/tasks recent')).resolves.toBe(true);

    expect(h.agent.listThreads).toHaveBeenCalledWith({ limit: 100 });
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
    expect(h.agent.listThreads).toHaveBeenLastCalledWith({ cwd: selected, limit: 50 });
    const card = JSON.stringify(h.channel.sent.at(-1)?.content);
    expect(card).toContain('任务');
    expect(card).toContain('项目 B 的任务');
    expect(card).not.toContain('项目 A 的任务');
  });
});

async function createHarness(): Promise<{
  tmp: TmpProfile;
  projectB: string;
  channel: ReturnType<typeof createFakeChannel>;
  workspaces: WorkspaceStore;
  agent: ReturnType<typeof createFakeAgent> & {
    listThreads: ReturnType<typeof vi.fn>;
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
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json'));
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json'));
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
  ];
  const agent = Object.assign(createFakeAgent(), {
    listThreads: vi.fn(async (options?: { cwd?: string; limit?: number }) =>
      options?.cwd ? threads.filter((thread) => thread.cwd === options.cwd) : threads),
  });
  const profileConfig = createDefaultProfileConfig({
    agentKind: 'codex',
    accounts: { app: { id: 'app-id', secret: 'secret', tenant: 'feishu' } },
    codex: { binaryPath: '/Applications/Codex.app/Contents/Resources/codex' },
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
  const activeRuns = new ActiveRuns();
  const run = (content: string): Promise<boolean> => tryHandleCommand({
    channel: channel as unknown as CommandContext['channel'],
    msg: message(content),
    scope: 'chat-1',
    chatMode: 'p2p',
    sessions,
    workspaces,
    agent,
    activeRuns,
    controls,
  });
  cleanups.push(async () => {
    await Promise.all([sessions.flush(), workspaces.flush()]);
    await tmp.cleanup();
  });
  return { tmp, projectB, channel, workspaces, agent, run };
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
