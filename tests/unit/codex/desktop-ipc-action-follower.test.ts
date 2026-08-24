import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import remodexActionFollower from '../../../src/vendor/remodex-ipc/desktop-ipc-action-follower.cjs';
import remodexShared from '../../../src/vendor/remodex-ipc/desktop-ipc-shared.cjs';

describe('Desktop IPC action follower transport', () => {
  it('uses the ChatGPT Desktop v2 follower turn-start envelope', () => {
    expect(remodexShared.DESKTOP_IPC_METHOD_VERSIONS.get('thread-follower-start-turn')).toBe(2);
    expect(remodexActionFollower.desktopFollowerStartTurnParamsForIpc({
      conversationId: 'thread-desktop',
      senderRequestId: 'number:42',
      turnStartParams: {
        threadId: 'thread-desktop',
        input: [{ type: 'text', text: '继续' }],
        model: 'gpt-5.6-terra',
        effort: 'high',
      },
    })).toEqual({
      conversationId: 'thread-desktop',
      turnStart: {
        request: {
          threadId: 'thread-desktop',
          input: [{ type: 'text', text: '继续' }],
          model: 'gpt-5.6-terra',
          effort: 'high',
          clientUserMessageId: 'number:42',
        },
        context: {
          inheritThreadSettings: true,
        },
      },
    });
  });

  it('preserves the numeric Desktop request id when replying to an approval', () => {
    expect(remodexActionFollower.desktopFollowerPayloadForResponse({
      requestId: '900',
      desktopRequestId: 900,
      method: 'item/commandExecution/requestApproval',
      threadId: 'thread-desktop',
    }, {
      id: 900,
      result: { decision: 'accept' },
    })).toEqual({
      method: 'thread-follower-command-approval-decision',
      params: {
        conversationId: 'thread-desktop',
        requestId: 900,
        decision: 'accept',
      },
    });
  });

  it('routes permission approvals through the dedicated Desktop IPC response', () => {
    expect(remodexActionFollower.desktopFollowerPayloadForResponse({
      requestId: '901',
      desktopRequestId: 901,
      method: 'item/permissions/requestApproval',
      threadId: 'thread-desktop',
    }, {
      id: 901,
      result: {
        permissions: { network: { enabled: true } },
        scope: 'turn',
      },
    })).toEqual({
      method: 'thread-follower-permissions-request-approval-response',
      params: {
        conversationId: 'thread-desktop',
        requestId: 901,
        response: {
          permissions: { network: { enabled: true } },
          scope: 'turn',
        },
      },
    });
  });

  it('does not queue a follower request on a stale connecting socket', async () => {
    const socket = new FakeSocket();
    const netModule = {
      createConnection: vi.fn(() => socket),
    };
    const client = remodexActionFollower.createDesktopIpcClient({
      socketPath: () => ['/tmp/stale-codex-ipc.sock'],
      netModule,
      now: () => 1,
      requestTimeoutMs: 10_000,
      logPrefix: '[test]',
      onEnvelope: vi.fn(),
      onConnected: vi.fn(),
      onDisconnect: vi.fn(),
    });

    const request = client.sendRequest('thread-follower-start-turn', {
      conversationId: 'thread-desktop',
    });

    await expect(request).rejects.toMatchObject({
      message: 'Desktop IPC is not connected.',
      remodexDeliveryFailed: true,
    });
    expect(netModule.createConnection).toHaveBeenCalledWith('/tmp/stale-codex-ipc.sock');
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('falls back to the local app-server when a resumed task only has a stale IPC socket', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const socket = new FakeSocket();
    const forwarded: string[] = [];
    const responses: string[] = [];
    const follower = remodexActionFollower.createDesktopIpcActionFollower({
      sendApplicationResponse: (raw: string) => responses.push(raw),
      forwardToLocalCodex: (raw: string) => forwarded.push(raw),
      socketPath: () => ['/tmp/stale-codex-ipc.sock'],
      netModule: { createConnection: () => socket },
      now: () => 1,
      ownershipProbeTimeoutMs: 1,
      requestTimeoutMs: 10_000,
      logPrefix: '[test]',
    });
    const resume = JSON.stringify({
      id: 1,
      method: 'thread/resume',
      params: { threadId: 'thread-desktop' },
    });
    const startTurn = JSON.stringify({
      id: 2,
      method: 'turn/start',
      params: {
        threadId: 'thread-desktop',
        input: [{ type: 'text', text: '继续' }],
      },
    });

    expect(follower.observeInbound(resume)).toBe(false);
    expect(follower.observeInbound(startTurn)).toBe(true);
    await vi.runAllTimersAsync();

    expect(forwarded).toEqual([startTurn]);
    expect(responses).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    follower.stopAll();
    warn.mockRestore();
    vi.useRealTimers();
  });
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  write = vi.fn((_chunk: unknown, callback?: (error?: Error) => void) => {
    callback?.();
    return true;
  });

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}
