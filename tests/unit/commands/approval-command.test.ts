import { describe, expect, it, vi } from 'vitest';
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';
import type { AgentAdapter } from '../../../src/agent/types.js';
import { sendManagedCard } from '../../../src/card/managed.js';
import { renderApprovalCard } from '../../../src/card/run-renderer.js';
import { runCommandHandler, type CommandContext, type Controls } from '../../../src/commands/index.js';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema.js';
import { createFakeChannel } from '../../helpers/fake-channel.js';

describe('approval card command', () => {
  it('returns immediately, removes the buttons, and then waits for Codex confirmation', async () => {
    const channel = createFakeChannel();
    let finishApproval!: () => void;
    const approvalFinished = new Promise<void>((resolve) => {
      finishApproval = resolve;
    });
    const resolveApproval = vi.fn(() => approvalFinished);
    const card = approvalCard();
    const sent = await sendManagedCard(channel as unknown as LarkChannel, 'oc_chat', card);

    await runCommandHandler(
      'approval',
      'accept approval-1',
      context(channel, sent.messageId, resolveApproval),
    );

    await vi.waitFor(() => expect(resolveApproval).toHaveBeenCalledWith('approval-1', 'accept'));
    const update = latestCardUpdate(channel);
    expect(JSON.stringify(update)).toContain('正在允许');
    expect(JSON.stringify(update)).not.toContain('"arg":"approval-1"');

    finishApproval();
    await approvalFinished;
  });

  it('restores the original approval controls if Codex rejects the submission', async () => {
    const channel = createFakeChannel();
    let rejectApproval!: (error: Error) => void;
    const approvalFinished = new Promise<void>((_resolve, reject) => {
      rejectApproval = reject;
    });
    const resolveApproval = vi.fn(() => approvalFinished);
    const card = approvalCard();
    const sent = await sendManagedCard(channel as unknown as LarkChannel, 'oc_chat', card);

    await runCommandHandler(
      'approval',
      'accept approval-1',
      context(channel, sent.messageId, resolveApproval),
    );
    await vi.waitFor(() => expect(resolveApproval).toHaveBeenCalledOnce());
    rejectApproval(new Error('desktop declined RPC'));

    await vi.waitFor(() => {
      expect(cardUpdates(channel)).toHaveLength(2);
    });
    expect(latestCardUpdate(channel)).toEqual(card);
  });
});

function approvalCard(): object {
  return renderApprovalCard({
    id: 'approval-1',
    title: '运行命令',
    detail: 'pnpm test',
    allowForSession: true,
    status: 'pending',
  });
}

function context(
  channel: ReturnType<typeof createFakeChannel>,
  messageId: string,
  resolveApproval: (approvalId: string, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel') => Promise<void>,
): CommandContext {
  const profileConfig = createDefaultProfileConfig({
    agentKind: 'codex',
    accounts: { app: { id: 'cli_test', secret: 'secret', tenant: 'feishu' } },
    codex: { binaryPath: '/Applications/Codex.app/Contents/Resources/codex' },
    access: { admins: ['ou_admin'] },
  });
  const msg: NormalizedMessage = {
    messageId,
    chatId: 'oc_chat',
    chatType: 'p2p',
    senderId: 'ou_admin',
    senderName: 'Admin',
    content: '',
    rawContentType: 'interactive',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: Date.now(),
  };
  const controls = {
    profile: 'test',
    profileConfig,
    ownerRefreshState: 'unknown',
    refreshOwner: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
    configPath: '/tmp/config.json',
    cfg: profileConfig,
    processId: 'proc-test',
  } as unknown as Controls;
  const agent = {
    id: 'codex',
    displayName: 'Codex',
    isAvailable: vi.fn(async () => true),
    run: vi.fn(),
    resolveApproval,
  } as unknown as AgentAdapter;

  return {
    channel: channel as unknown as LarkChannel,
    msg,
    scope: 'oc_chat',
    chatMode: 'p2p',
    sessions: {} as CommandContext['sessions'],
    workspaces: {} as CommandContext['workspaces'],
    agent,
    activeRuns: {} as CommandContext['activeRuns'],
    controls,
    fromCardAction: true,
  };
}

function cardUpdates(channel: ReturnType<typeof createFakeChannel>): unknown[] {
  return channel.rawClient.requests
    .filter((request) => request.method === 'cardkit.v1.card.update')
    .map((request) => (request.params as { cardJson?: unknown }).cardJson);
}

function latestCardUpdate(channel: ReturnType<typeof createFakeChannel>): unknown {
  return cardUpdates(channel).at(-1);
}
