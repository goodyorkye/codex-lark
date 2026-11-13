import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ status: 200, body: {} as unknown, requests: [] as Array<{ url: string; options: any; bytes: Buffer }> }));
vi.mock('node:https', () => ({ request: vi.fn((url, options, callback) => {
  const req = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: (raw?: string | Buffer) => {
    http.requests.push({ url: String(url), options, bytes: Buffer.from(raw ?? '') });
    queueMicrotask(() => { const res = Object.assign(new EventEmitter(), { statusCode: http.status, destroy: vi.fn() }); callback(res); res.emit('data', Buffer.from(JSON.stringify(http.body))); res.emit('end'); req.emit('close'); });
  } }); return req;
}) }));
import { DesktopDotClient, DesktopDotError, type DesktopDotIdentity } from '../../../src/dots/desktop-client';
const identity: DesktopDotIdentity = { principal: 'account:owner', dotId: 'dot', roomId: 'original-room', name: 'Dot', ownerMemberId: 'owner', dotMemberId: 'dot-member' };
const clients: DesktopDotClient[] = [];
function client() {
  vi.stubEnv('CODEX_LARK_DOTS_PROXY', '');
  const client = new DesktopDotClient(); clients.push(client);
  vi.spyOn(client as unknown as { auth: () => Promise<unknown> }, 'auth').mockResolvedValue({ token: 'memory-only-token', principal: 'account:owner', accountId: 'account', userId: 'owner' });
  return client;
}
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); http.status = 200; http.requests = []; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('native Dot attachment wire format', () => {
  it('refreshes an expired access token through the official core without persisting credentials', async () => {
    const token = (exp: number) => `header.${Buffer.from(JSON.stringify({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: 'account', user_id: 'owner' } })).toString('base64url')}.signature`;
    const expired = token(1), fresh = token(Date.now() / 1000 + 600), request = vi.fn().mockResolvedValueOnce({ authMethod: 'chatgpt', authToken: expired }).mockResolvedValueOnce({ authMethod: 'chatgpt', authToken: fresh });
    const api = new DesktopDotClient(); clients.push(api);
    const internal = api as unknown as { starting: Promise<unknown>; auth: () => Promise<{ token: string; principal: string }> };
    internal.starting = Promise.resolve({ request });
    expect(await internal.auth()).toMatchObject({ token: fresh, principal: 'account:owner' });
    expect(request).toHaveBeenLastCalledWith('getAuthStatus', { includeToken: true, refreshToken: true });
    expect(http.requests).toHaveLength(0);
  });
  it('uploads the unchanged original bytes into the bound room and accepts the native UPLOADED status', async () => {
    http.body = { id: 'CalpicoFile_original', status: 'UPLOADED' };
    const api = client(), bytes = Buffer.from([0, 255, 13, 10, 42]);
    expect(await api.upload(identity, { name: '原文件.bin', mimeType: 'application/octet-stream', bytes })).toBe('CalpicoFile_original');
    const sent = http.requests[0]!; expect(sent.url).toBe('https://chatgpt.com/backend-api/messaging/rooms/original-room/files');
    expect(sent.options.headers.Authorization).toBe('Bearer memory-only-token'); expect(sent.options.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.bytes.includes(bytes)).toBe(true); expect(sent.bytes.toString()).not.toContain('memory-only-token');
    http.body = { id: 'message', request_id: 'stable', account_user_id: 'owner' };
    await api.send(identity, 'read it', 'stable', ['CalpicoFile_original']);
    expect(JSON.parse(http.requests[1]!.bytes.toString())).toMatchObject({ content: { text: 'read it', attachments: [{ type: 'file', file_id: 'CalpicoFile_original' }] }, request_id: 'stable', idempotency_token: 'stable' });
  });
  it('rejects an unready upload and unsafe filenames before any native message is posted', async () => {
    http.body = { id: 'file', status: 'PROCESSING' }; const api = client();
    await expect(api.upload(identity, { name: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') })).rejects.toThrow('尚未就绪');
    await expect(api.upload(identity, { name: '../a.txt', mimeType: 'text/plain', bytes: Buffer.from('test') })).rejects.toThrow('有效文件名');
    expect(http.requests).toHaveLength(1); expect(http.requests[0]!.url).toContain('/files');
  });
  it('keeps account checks and pagination boundaries and sanitizes ambiguous message-send failures', async () => {
    const api = client();
    await expect(api.send({ ...identity, principal: 'other:owner' }, 'text', 'request')).rejects.toThrow('账号已变化');
    http.body = { items: [], next_cursor: 'more' }; await expect(api.messages(identity, 'input')).rejects.toThrow('消息过多');
    expect(http.requests[0]!.url).toContain('limit=20');
    http.body = { items: [{ id: 'next-human-input', account_user_id: 'owner' }], next_cursor: 'later-history' };
    expect(await api.messages(identity, 'input')).toEqual([{ id: 'next-human-input', account_user_id: 'owner' }]);
    http.status = 500; http.body = { detail: 'do not expose provider body or credentials' };
    try { await api.send(identity, 'text', 'request'); throw new Error('expected failure'); }
    catch (error) { expect(error).toBeInstanceOf(DesktopDotError); expect((error as DesktopDotError).uncertain).toBe(true); expect((error as Error).message).not.toContain('provider body'); }
  });
});
