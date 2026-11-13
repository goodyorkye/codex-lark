import { request } from 'node:https';
import type { ClientRequest } from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { dotsProxyUrl } from './network';

export interface DesktopDotActivity {
  turnId: string | null; active: boolean; status: 'in_progress' | 'completed' | 'failed' | 'interrupted' | null;
}
interface ThreadState { thread_id: string; stream_state: 'attaching' | 'attached'; turn_id?: string | null; turn_status?: DesktopDotActivity['status']; is_active?: boolean | null }
interface LiveState { type: string; room_id: string; subscription_id: string; revision: number; threads: ThreadState[] }
export interface DesktopLiveAuth { token: string; accountId: string }
export function liveSocketUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 16_384) throw new Error('本机 Dots 状态通道地址无效。');
  const url = new URL(raw);
  if (url.protocol !== 'wss:' || url.hostname !== 'ws.chatgpt.com' || url.username || url.password || url.hash || url.port && url.port !== '443') throw new Error('本机 Dots 状态通道地址不受支持，请检查客户端版本。');
  return url;
}
export function liveActivity(value: LiveState): DesktopDotActivity | undefined {
  const root = value.threads[0];
  if (!root || root.stream_state !== 'attached' || value.threads.some(t => t.stream_state !== 'attached')) return undefined;
  if (root.turn_id !== undefined && root.turn_id !== null && typeof root.turn_id !== 'string' || ![undefined, null, 'in_progress', 'completed', 'failed', 'interrupted'].includes(root.turn_status)) return undefined;
  return { turnId: root.turn_id ?? null, status: root.turn_status ?? null, active: value.threads.some(t => t.is_active !== false || t.turn_status === 'in_progress') };
}
/** The client's own room-live subscription supplies turn completion. Message
 * silence is not completion: a Dot can post progress long before an attachment. */
export class DesktopDotLive {
  private socket?: WebSocket;
  private stream?: ClientRequest;
  private agent?: HttpsProxyAgent<string>;
  private state?: DesktopDotActivity;
  private opening?: Promise<void>;
  private heartbeat?: NodeJS.Timeout;
  private closed = false;
  constructor(readonly roomId: string, private readonly credentials: () => Promise<{ url: string; auth: DesktopLiveAuth }>) {}
  async activity(): Promise<DesktopDotActivity> {
    if (this.closed) throw new Error('本机 Dots 状态通道已关闭。');
    if (!this.state) {
      this.opening ??= this.connect().finally(() => { this.opening = undefined; });
      await this.opening;
    }
    if (!this.state) throw new Error('无法读取小弟的回合状态，请检查 OpenAI 网络后重试。');
    return { ...this.state };
  }
  private reset(): void {
    clearInterval(this.heartbeat); this.heartbeat = undefined;
    this.state = undefined;
    const socket = this.socket, stream = this.stream, agent = this.agent;
    this.socket = undefined; this.stream = undefined; this.agent = undefined;
    socket?.terminate(); stream?.destroy(); agent?.destroy();
  }
  private async connect(): Promise<void> {
    this.reset();
    const { url: raw, auth } = await this.credentials();
    if (this.closed) throw new Error('本机 Dots 状态通道已关闭。');
    const url = liveSocketUrl(raw), proxy = dotsProxyUrl(), agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    this.agent = agent;
    const socket = new WebSocket(url, { agent: agent ?? false, followRedirects: false, handshakeTimeout: 15_000, maxPayload: 256 * 1024, perMessageDeflate: false });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let subscription: string | undefined, revision = -1, settled = false;
      const buffered = new Map<string, LiveState>();
      const timer = setTimeout(() => fail(), 30_000);
      const fail = () => {
        clearTimeout(timer);
        if (this.socket === socket) this.reset();
        if (!settled) { settled = true; reject(new Error('本机 Dots 回合状态通道连接失败，请检查网络或客户端版本。')); }
      };
      const receive = (value: LiveState) => {
        if (this.socket !== socket || value.room_id !== this.roomId || value.subscription_id !== subscription || !Number.isSafeInteger(value.revision) || value.revision <= revision) return;
        revision = value.revision;
        if (value.type !== 'calpico-room-live-state' || !Array.isArray(value.threads) || value.threads.length > 32) { fail(); return; }
        this.state = liveActivity(value);
        if (this.state && !settled) { settled = true; clearTimeout(timer); resolve(); }
      };
      const startStream = () => {
        if (this.socket !== socket || this.stream) return;
        const stream = request(`https://chatgpt.com/backend-api/messaging/rooms/${encodeURIComponent(this.roomId)}/live`, {
          method: 'POST', agent: agent ?? false,
          headers: { Authorization: `Bearer ${auth.token}`, 'ChatGPT-Account-ID': auth.accountId, 'X-OpenAI-Product-Sku': 'chatgpt', Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        }, res => {
          if (res.statusCode !== 200 || !res.headers['content-type']?.startsWith('text/event-stream')) { res.destroy(); fail(); return; }
          const decoder = new StringDecoder('utf8'); let pending = '', data: string[] = [];
          res.on('data', (chunk: Buffer) => {
            if (this.socket !== socket) return;
            pending += decoder.write(chunk);
            if (pending.length > 64 * 1024) { fail(); return; }
            let end: number;
            while ((end = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
              if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
              else if (!line && data.length) {
                try {
                  const value = JSON.parse(data.join('\n'));
                  if (value.type !== 'calpico-room-live-ready' || value.room_id !== this.roomId || typeof value.subscription_id !== 'string' || subscription && value.subscription_id !== subscription) { fail(); return; }
                  const id: string = value.subscription_id; subscription = id;
                  const state = buffered.get(id); buffered.clear(); if (state) receive(state);
                } catch { fail(); return; }
                data = [];
              }
              if (data.join('\n').length > 64 * 1024) { fail(); return; }
            }
          });
          res.on('error', fail); res.on('end', fail);
        });
        this.stream = stream;
        stream.on('error', fail); stream.end('{}');
      };
      let alive = true;
      socket.on('pong', () => { alive = true; });
      socket.on('open', () => {
        this.heartbeat = setInterval(() => {
          if (!alive) { fail(); return; }
          alive = false; socket.ping();
        }, 30_000); this.heartbeat.unref();
        socket.send(JSON.stringify([
          { id: 1, command: { type: 'connect', presence: { type: 'presence', state: 'background' } } },
          { id: 2, command: { type: 'subscribe', topic_id: `calpico-room-live:${this.roomId}` } },
        ]));
      });
      socket.on('message', bytes => {
        if (this.socket !== socket) return;
        try {
          const frames = JSON.parse(bytes.toString());
          if (!Array.isArray(frames)) return; // Non-topic control frames are irrelevant.
          for (const frame of frames) {
            if (frame.id === 2) {
              if (frame.reply?.type !== 'subscribe' || frame.reply.topic_id !== `calpico-room-live:${this.roomId}`) { fail(); return; }
              startStream();
            }
            if (frame.topic_id !== `calpico-room-live:${this.roomId}` || frame.payload?.type !== 'calpico-room-live') continue;
            const value = frame.payload.payload as LiveState;
            if (!value || value.room_id !== this.roomId || typeof value.subscription_id !== 'string') { fail(); return; }
            if (subscription) receive(value);
            else { buffered.set(value.subscription_id, value); if (buffered.size > 4) buffered.delete(buffered.keys().next().value!); }
          }
        } catch { fail(); }
      });
      socket.on('close', fail); socket.on('error', fail);
    });
  }
  close(): void { this.closed = true; this.reset(); }
}
