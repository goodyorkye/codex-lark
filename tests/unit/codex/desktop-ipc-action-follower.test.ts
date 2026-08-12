import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import remodexActionFollower from '../../../src/vendor/remodex-ipc/desktop-ipc-action-follower.cjs';

describe('Desktop IPC action follower transport', () => {
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
    follower.stopAll();
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
