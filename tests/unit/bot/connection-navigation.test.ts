import { describe, expect, it, vi } from 'vitest';
import { sendConnectionNavigation } from '../../../src/bot/connection-navigation';
import type { AgentAdapter } from '../../../src/agent/types';

describe('connection navigation push', () => {
  it('sends to the app owner open_id even before any p2p chat history exists', async () => {
    const send = vi.fn(async (_to: string, _input: unknown) => ({ messageId: 'om-nav' }));

    await expect(sendConnectionNavigation({
      channel: { send } as never,
      agent: { id: 'codex' } as AgentAdapter,
      controls: { botOwnerId: 'ou_owner' },
    })).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      'ou_owner',
      expect.objectContaining({ card: expect.any(Object) }),
    );
    expect(JSON.stringify(send.mock.calls[0]?.[1])).toContain('tasks.recent');
  });

  it('shows the latest active Codex project and skips non-Codex bridges', async () => {
    const send = vi.fn(async (_to: string, _input: unknown) => ({ messageId: 'om-nav' }));
    const readThread = vi.fn(async () => ({
      id: 'thread-current',
      cwd: '/tmp/current-project',
      name: '当前任务',
    }));
    const entries = () => [{
      key: 'latest',
      scopeId: 'oc_chat',
      agentId: 'codex' as const,
      cwdRealpath: '/tmp/current-project',
      policyFingerprint: 'fp',
      status: 'active' as const,
      updatedAt: 2,
      threadId: 'thread-current',
    }];

    await sendConnectionNavigation({
      channel: { send } as never,
      agent: { id: 'codex', readThread } as never,
      sessionCatalog: { entries },
      controls: { botOwnerId: 'ou_owner' },
    });
    expect(JSON.stringify(send.mock.calls[0]?.[1])).toContain('current\\\\-project / 当前任务');
    expect(readThread).toHaveBeenCalledWith('thread-current');

    send.mockClear();
    await expect(sendConnectionNavigation({
      channel: { send } as never,
      agent: { id: 'claude' } as AgentAdapter,
      controls: { botOwnerId: 'ou_owner' },
    })).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
