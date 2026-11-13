import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({ socket: undefined as any, response: undefined as any, request: undefined as any }));
vi.mock('ws', () => ({ default: class extends EventEmitter {
  sent: unknown[] = []; options: unknown;
  constructor(_url: unknown, options: unknown) { super(); this.options = options; network.socket = this; }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  ping() { this.emit('pong'); }
  terminate() { this.emit('close'); }
} }));
vi.mock('node:https', () => ({ request: vi.fn((_url, _options, callback) => {
  const req = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: () => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/event-stream' }, destroy: vi.fn() }); network.response = res; callback(res);
  } }); network.request = req; return req;
}) }));
import { DesktopDotLive, liveActivity, liveSocketUrl } from '../../../src/dots/desktop-live';
const watchers: DesktopDotLive[] = [];
afterEach(() => { for (const watcher of watchers.splice(0)) watcher.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function state(subscription = 'sub-1', room = 'room-1', revision = 1, stream = 'attached') { return { type: 'calpico-room-live-state', room_id: room, subscription_id: subscription, revision, threads: [{ thread_id: 'thread', stream_state: stream, turn_id: 'turn-2', turn_status: 'completed', is_active: false }] }; }
function frame(payload: unknown) { network.socket.emit('message', Buffer.from(JSON.stringify([{ type: 'message', topic_id: 'calpico-room-live:room-1', payload: { type: 'calpico-room-live', payload } }]))); }
describe('native Dot turn lifecycle', () => {
  it('requires an attached, terminal root and does not treat an active child as complete', () => {
    expect(liveActivity(state() as any)).toEqual({ turnId: 'turn-2', active: false, status: 'completed' });
    expect(liveActivity(state('sub-1', 'room-1', 1, 'attaching') as any)).toBeUndefined();
    const value = state(); value.threads.push({ ...value.threads[0]!, is_active: true, turn_status: 'in_progress' });
    expect(liveActivity(value as any)?.active).toBe(true);
    expect(() => liveSocketUrl('wss://example.com/?token=secret')).toThrow('不受支持');
    expect(() => liveSocketUrl('wss://ws.chatgpt.com.evil.test')).toThrow('不受支持');
    expect(liveSocketUrl('wss://ws.chatgpt.com/ws?token=memory-only').hostname).toBe('ws.chatgpt.com');
  });
  it('binds websocket state to the room and SSE subscription, then follows completion and reconnects after loss', async () => {
    vi.stubEnv('CODEX_LARK_DOTS_PROXY', '');
    const credentials = vi.fn(async () => ({ url: 'wss://ws.chatgpt.com/ws?token=memory-only', auth: { token: 'private-test-token', accountId: 'account' } }));
    const watcher = new DesktopDotLive('room-1', credentials); watchers.push(watcher);
    const pending = watcher.activity(); await vi.waitFor(() => expect(network.socket).toBeDefined());
    network.socket.emit('open');
    expect(network.socket.sent[0]).toEqual([{ id: 1, command: { type: 'connect', presence: { type: 'presence', state: 'background' } } }, { id: 2, command: { type: 'subscribe', topic_id: 'calpico-room-live:room-1' } }]);
    network.socket.emit('message', Buffer.from(JSON.stringify([{ id: 2, reply: { type: 'subscribe', topic_id: 'calpico-room-live:room-1' } }])));
    // A frame can precede SSE readiness. A different subscription cannot resolve the watch.
    frame(state('wrong-sub'));
    network.response.emit('data', Buffer.from('data: {"type":"calpico-room-live-ready","room_id":"room-1","subscription_id":"sub-1"}\r\n\r\n'));
    frame(state('sub-1', 'room-1', 2, 'attaching'));
    frame(state('sub-1', 'room-1', 3));
    expect(await pending).toEqual({ turnId: 'turn-2', active: false, status: 'completed' });
    const active = state('sub-1', 'room-1', 4); active.threads[0]!.turn_status = 'in_progress'; active.threads[0]!.is_active = true;
    frame(active); expect((await watcher.activity()).active).toBe(true);
    frame(state('sub-1', 'room-1', 3)); expect((await watcher.activity()).active).toBe(true); // old revision ignored
    network.socket.emit('close'); expect(network.request.destroy).toHaveBeenCalled();
    const reconnect = watcher.activity(); const rejected = expect(reconnect).rejects.toThrow('状态通道');
    await vi.waitFor(() => expect(credentials).toHaveBeenCalledTimes(2));
    watcher.close(); await rejected;
  });
});
