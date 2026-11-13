import { request } from 'node:https';
import { randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { CodexAppServerClient } from '../codex/app-server/client';
import { discoverDesktopBinary } from '../codex/desktop-binary';
import { dotsProxyUrl } from './network';
import { fetchHostFile, MAX_OUTBOUND_BYTES } from './outbound';
import { DesktopDotLive, type DesktopDotActivity } from './desktop-live';

export interface DesktopDotAttachment { type: 'file'; file_id: string; name?: string; mime_type?: string; size_bytes?: number }
export interface DesktopDotFile { id: string; name: string; mimeType: string; bytes: Buffer }

export interface DesktopDotIdentity {
  principal: string; dotId: string; roomId: string; name: string; ownerMemberId: string; dotMemberId: string;
}
export interface DesktopDotMessage {
  id: string; account_user_id?: string; request_id?: string; content?: { text?: string; attachments?: DesktopDotAttachment[] }; deleted_at?: string | null;
  message_metadata?: { turn_trigger?: string };
}
export interface DesktopDotApi {
  primary(): Promise<DesktopDotIdentity>;
  send(identity: DesktopDotIdentity, text: string, requestId: string, attachmentIds?: string[]): Promise<DesktopDotMessage>;
  upload(identity: DesktopDotIdentity, file: Omit<DesktopDotFile, 'id'>): Promise<string>;
  download(identity: DesktopDotIdentity, fileId: string): Promise<DesktopDotFile>;
  messages(identity: DesktopDotIdentity, after: string): Promise<DesktopDotMessage[]>;
  activity(identity: DesktopDotIdentity): Promise<DesktopDotActivity>;
  close(): Promise<void>;
}
export class DesktopDotError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); }
}
export function desktopPrincipal(token: string): { principal: string; userId: string; accountId: string } {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
    const auth = claims['https://api.openai.com/auth'], accountId = auth?.chatgpt_account_id ?? auth?.account_id, userId = auth?.user_id ?? auth?.chatgpt_user_id;
    if (typeof accountId !== 'string' || !accountId || typeof userId !== 'string' || !userId || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error();
    return { principal: `${accountId}:${userId}`, userId, accountId };
  } catch { throw new DesktopDotError('客户端登录状态格式不受支持或已过期，请在 ChatGPT 客户端确认登录状态。'); }
}

/** Uses only the installed Desktop core's existing session. Tokens never leave
 * memory except in Authorization to this fixed, TLS-verified OpenAI origin. */
export class DesktopDotClient implements DesktopDotApi {
  private core?: CodexAppServerClient;
  private starting?: Promise<CodexAppServerClient>;
  private closed = false;
  private readonly abort = new AbortController();
  private live?: { principal: string; watcher: DesktopDotLive };
  private async auth(): Promise<{ token: string; principal: string; userId: string; accountId: string }> {
    if (this.closed) throw new DesktopDotError('本地 Dots 连接已关闭。');
    this.starting ??= (async () => {
      const location = await discoverDesktopBinary();
      const core = new CodexAppServerClient({ binaryPath: location.binaryPath, env: { CODEX_LARK_DESKTOP_IPC: '0' }, requestTimeoutMs: 15_000 });
      this.core = core;
      try { await core.start(); return core; } catch { await core.stop(); this.starting = undefined; throw new DesktopDotError('无法启动 ChatGPT 客户端自带的 core，请更新客户端并重启 codex-lark。'); }
    })();
    const core = await this.starting;
    let auth: { authMethod?: string; authToken?: string };
    try { auth = await core.request('getAuthStatus', { includeToken: true, refreshToken: false }); }
    catch { throw new DesktopDotError('无法读取客户端的 ChatGPT 登录态，请确认客户端已登录并重启 codex-lark。'); }
    if (!['chatgpt', 'chatgptAuthTokens'].includes(auth.authMethod ?? '') || !auth.authToken) throw new DesktopDotError('请先在本机 ChatGPT 客户端登录拥有原 Dot 的账号；API Key 登录不能连接原 Dot。');
    try { desktopPrincipal(auth.authToken); }
    catch {
      // The bridge may run longer than one access-token lifetime. Let the
      // official core refresh its own existing login rather than storing keys
      // or requiring a new user login for an ordinary token expiry.
      try { auth = await core.request('getAuthStatus', { includeToken: true, refreshToken: true }); }
      catch { throw new DesktopDotError('客户端登录态无法刷新，请在 ChatGPT 客户端确认登录后重试。'); }
      if (!['chatgpt', 'chatgptAuthTokens'].includes(auth.authMethod ?? '') || !auth.authToken) throw new DesktopDotError('请在 ChatGPT 客户端确认原 Dot 账号仍处于登录状态。');
    }
    return { token: auth.authToken, ...desktopPrincipal(auth.authToken) };
  }
  private async call(path: string, expectedPrincipal?: string, body?: unknown, multipart?: { bytes: Buffer; contentType: string }): Promise<{ data: unknown; principal: string; userId: string }> {
    if (path !== '/cloud-aeons/primary' && path !== '/celsius/ws/user' && !path.startsWith('/messaging/rooms/')) throw new DesktopDotError('不支持的 Dots 请求。');
    const auth = await this.auth();
    if (expectedPrincipal && expectedPrincipal !== auth.principal) throw new DesktopDotError('ChatGPT 登录账号已变化，请返回 Codex 并重新连接 Dots；旧消息不会转发给新账号。');
    const proxy = dotsProxyUrl(), agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const data = await new Promise<unknown>((resolve, reject) => {
      const req = request(`https://chatgpt.com/backend-api${path}`, { method: body === undefined && !multipart ? 'GET' : 'POST', agent: agent ?? false, signal: this.abort.signal,
        headers: { Authorization: `Bearer ${auth.token}`, 'ChatGPT-Account-ID': auth.accountId, Accept: 'application/json', 'X-OpenAI-Product-Sku': 'chatgpt', 'User-Agent': 'codex-lark-dots-desktop', ...(multipart ? { 'Content-Type': multipart.contentType, 'Content-Length': multipart.bytes.length } : body === undefined ? {} : { 'Content-Type': 'application/json' }) } }, res => {
        const parts: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) { res.destroy(); reject(new DesktopDotError('Dots 回复超过读取上限，请在客户端查看。', body !== undefined)); } else parts.push(chunk); });
        res.on('error', () => reject(new DesktopDotError('Dots 连接中断，请检查网络。', body !== undefined)));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new DesktopDotError(`本机 Dots 请求失败（HTTP ${res.statusCode ?? 0}），请检查登录、网络或客户端版本。`, body !== undefined && ![400, 401, 403, 404, 409, 422, 429].includes(res.statusCode ?? 0))); return;
          }
          try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
          catch { reject(new DesktopDotError('客户端 Dots 返回了无法识别的数据，请检查客户端版本。', body !== undefined)); }
        });
      });
      const timer = setTimeout(() => req.destroy(), multipart ? 90_000 : 20_000);
      req.on('close', () => { clearTimeout(timer); agent?.destroy(); });
      req.on('error', () => reject(new DesktopDotError('无法连接 Dots，请检查 OpenAI 网络或代理。', body !== undefined)));
      req.end(multipart?.bytes ?? (body === undefined ? undefined : JSON.stringify(body)));
    });
    return { data, principal: auth.principal, userId: auth.userId };
  }
  async primary(): Promise<DesktopDotIdentity> {
    const primary = await this.call('/cloud-aeons/primary');
    const profile = (primary.data as { profile?: { id?: string; display_name?: string; messaging_room_id?: string; is_paused?: boolean } }).profile;
    if (!profile?.id || !profile.messaging_room_id || profile.is_paused) throw new DesktopDotError('请在 ChatGPT 客户端确认原 Dot 已开通、未暂停，并能正常聊天。');
    const room = (await this.call(`/messaging/rooms/${encodeURIComponent(profile.messaging_room_id)}`, primary.principal)).data as { id?: string; type?: string; app_source?: string; members?: Array<{ account_user_id: string; aeon_id?: string }> };
    const dot = room.members?.find(member => member.aeon_id === profile.id), owner = room.members?.find(member => member.account_user_id === primary.userId);
    if (room.id !== profile.messaging_room_id || room.type !== 'DM' || room.app_source !== 'chatgpt:messaging' || room.members?.length !== 2 || !dot || !owner) throw new DesktopDotError('无法核对原 Dot 私聊的双方身份，已停止连接。');
    return { principal: primary.principal, dotId: profile.id, roomId: room.id, name: (profile.display_name || '原 Dot').slice(0, 80), ownerMemberId: owner.account_user_id, dotMemberId: dot.account_user_id };
  }
  async upload(identity: DesktopDotIdentity, file: Omit<DesktopDotFile, 'id'>): Promise<string> {
    if (!file.bytes.length || file.bytes.length > MAX_OUTBOUND_BYTES || !file.name || file.name.length > 128 || /[\r\n"/\\\u0000]/.test(file.name) || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mimeType)) throw new DesktopDotError('附件须非空、最多 20 MiB，且使用有效文件名和格式。');
    const boundary = `codex-lark-${randomUUID()}`;
    const bytes = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const result = (await this.call(`/messaging/rooms/${encodeURIComponent(identity.roomId)}/files`, identity.principal, undefined, { bytes, contentType: `multipart/form-data; boundary=${boundary}` })).data as { id?: string; status?: string };
    if (!result.id || !['UPLOADED', 'ready'].includes(result.status ?? '')) throw new DesktopDotError('原会话附件上传尚未就绪，请稍后重发；此消息尚未发送。');
    return result.id;
  }
  async download(identity: DesktopDotIdentity, fileId: string): Promise<DesktopDotFile> {
    const result = (await this.call(`/messaging/rooms/${encodeURIComponent(identity.roomId)}/files/${encodeURIComponent(fileId)}`, identity.principal)).data as { id?: string; name?: string; mime_type?: string; download_url?: string };
    if (result.id !== fileId || !result.name || !result.download_url) throw new DesktopDotError('原会话附件尚不可读取，请在客户端查看。');
    const bytes = await fetchHostFile({ file_id: fileId, download_url: result.download_url });
    return { id: fileId, name: result.name, mimeType: result.mime_type ?? 'application/octet-stream', bytes };
  }
  async send(identity: DesktopDotIdentity, text: string, requestId: string, attachmentIds: string[] = []): Promise<DesktopDotMessage> {
    return (await this.call(`/messaging/rooms/${encodeURIComponent(identity.roomId)}/messages`, identity.principal,
      { content: { text, attachments: attachmentIds.map(file_id => ({ type: 'file', file_id })) }, request_id: requestId, idempotency_token: requestId, timezone_offset_min: new Date().getTimezoneOffset() })).data as DesktopDotMessage;
  }
  async messages(identity: DesktopDotIdentity, after: string): Promise<DesktopDotMessage[]> {
    const result = (await this.call(`/messaging/rooms/${encodeURIComponent(identity.roomId)}/messages?${new URLSearchParams({ after, limit: '20' })}`, identity.principal)).data as { items?: DesktopDotMessage[]; next_cursor?: string | null };
    if (!Array.isArray(result.items) || result.items.some(message => !message || typeof message.id !== 'string' || message.content?.text !== undefined && typeof message.content.text !== 'string')
      || result.next_cursor && !result.items.some(message => !message.deleted_at && message.account_user_id === identity.ownerMemberId)) throw new DesktopDotError('原会话消息过多或格式已变化，请在客户端核对，避免关联错误。');
    return result.items;
  }
  async activity(identity: DesktopDotIdentity): Promise<DesktopDotActivity> {
    const auth = await this.auth();
    if (identity.principal !== auth.principal) throw new DesktopDotError('ChatGPT 登录账号已变化，请重新连接 Dots。');
    if (this.live && (this.live.principal !== identity.principal || this.live.watcher.roomId !== identity.roomId)) { this.live.watcher.close(); this.live = undefined; }
    this.live ??= { principal: identity.principal, watcher: new DesktopDotLive(identity.roomId, async () => {
      const auth = await this.auth();
      if (auth.principal !== identity.principal) throw new DesktopDotError('ChatGPT 登录账号已变化，请重新连接 Dots。');
      const credentials = (await this.call('/celsius/ws/user', identity.principal)).data as { websocket_url?: string };
      if (typeof credentials.websocket_url !== 'string') throw new DesktopDotError('原生回合状态通道格式已变化。');
      return { url: credentials.websocket_url, auth };
    }) };
    return this.live.watcher.activity();
  }
  async close(): Promise<void> { this.closed = true; this.abort.abort(); this.live?.watcher.close(); await this.core?.stop(); }
}
