import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { NormalizedMessage } from '@larksuite/channel';
import { writeFileAtomic } from '../platform/atomic-write';
import { log } from '../core/logger';
import type { DotsBackend, DotsChannel, DotsStatus } from './backend';
import { privateDirectory, readPrivate } from './storage';
import { DesktopDotClient, DesktopDotError, type DesktopDotApi, type DesktopDotIdentity } from './desktop-client';
import { cleanInterruptedMediaReads, desktopAttachments, desktopMessageText, readDesktopSource, nativeMediaMime, type DesktopSourceAttachment } from './desktop-media';
import { mediaName, validateOutput } from './outbound';
import { aliyunAsr, type NativeAudioTranscriber } from './aliyun-asr';

type Channel = DotsChannel;
type Phase = 'queued' | 'preparing' | 'sending' | 'waiting' | 'ready' | 'replying' | 'sent' | 'uncertain' | 'failed' | 'cancelled';
interface Binding { id: string; ownerId: string; chatId: string; identity: DesktopDotIdentity }
interface Job {
  id: string; bindingId: string; sourceId: string; text: string; requestId: string; phase: Phase; expires: number;
  nativeMessageId?: string; answer?: string; settleAt?: number; error?: string; notice?: 'sending' | 'sent' | 'uncertain';
  attachments?: DesktopSourceAttachment[]; answerFiles?: string[];
  previousTurnId?: string | null;
}
interface State { version: 1; appId: string; routes: Record<string, 'codex' | 'dots'>; binding?: Binding; jobs: Job[] }

/** Native-room transport; switching never changes Codex session state. */
export class DesktopDotsBridge implements DotsBackend {
  readonly kind = 'desktop' as const;
  private state: State;
  private identity?: DesktopDotIdentity;
  private error?: string;
  private transport?: { channel: Channel; owner: () => string | undefined };
  private tail: Promise<unknown> = Promise.resolve();
  private flight?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private closed = false;
  private readonly abort = new AbortController();
  private constructor(readonly dir: string, readonly appId: string, private readonly api: DesktopDotApi, private readonly clock: () => number, private readonly asr: NativeAudioTranscriber) {
    this.state = { version: 1, appId, routes: {}, jobs: [] };
  }
  static async open(dir: string, appId: string, options: { api?: DesktopDotApi; clock?: () => number; asr?: NativeAudioTranscriber } = {}): Promise<DesktopDotsBridge> {
    await privateDirectory(dir);
    await cleanInterruptedMediaReads(dir);
    const bridge = new DesktopDotsBridge(dir, appId, options.api ?? new DesktopDotClient(), options.clock ?? Date.now, options.asr ?? aliyunAsr());
    try {
      const state = JSON.parse(await readPrivate(join(dir, 'desktop-state.json'), 128 * 1024 * 1024)) as State;
      if (state.version !== 1 || state.appId !== appId || !state.routes || !Array.isArray(state.jobs) || state.jobs.length > 1000) throw new Error('Invalid Dots desktop state');
      bridge.state = state;
      await bridge.change(next => { for (const job of next.jobs) {
        if (job.phase === 'preparing') job.phase = 'queued'; // No native message submitted yet.
        if (job.phase === 'sending' || job.phase === 'replying') { job.phase = 'uncertain'; job.error = '上次发送中断，结果需要在客户端和飞书核对；不会自动重发。'; }
        if (job.notice === 'sending') job.notice = 'uncertain';
      } });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return bridge;
  }
  private change<T>(mutate: (next: State) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.state), result = mutate(next);
      await writeFileAtomic(join(this.dir, 'desktop-state.json'), JSON.stringify(next)); this.state = next; return result;
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  attach(channel: Channel, owner: () => string | undefined): () => void {
    const transport = { channel, owner }; this.transport = transport;
    return () => { if (this.transport === transport) this.transport = undefined; };
  }
  private owner(id: string): void { if (!id || id !== this.transport?.owner()) throw new Error('本机 Dots 仅供机器人主人在私聊使用。'); }
  mode(scope: string): 'codex' | 'dots' { return this.state.routes[scope] ?? 'codex'; }
  ownerMode(): 'codex' | 'dots' { return this.state.binding ? this.mode(this.state.binding.chatId) : 'codex'; }
  status(): DotsStatus {
    const validOwner = Boolean(this.transport?.owner() && (!this.state.binding || this.transport.owner() === this.state.binding.ownerId));
    const jobs = validOwner ? this.state.jobs.filter(job => job.bindingId === this.state.binding?.id) : [];
    return { paired: Boolean(this.identity && validOwner), connected: Boolean(this.identity && !this.error && validOwner), name: validOwner ? this.identity?.name ?? this.state.binding?.identity.name ?? '原 Dot' : 'Dots',
      speechTranscription: this.asr.configured() ? 'aliyun' : 'unconfigured', pending: jobs.filter(job => ['queued', 'preparing', 'sending', 'waiting', 'ready', 'replying'].includes(job.phase)).length,
      uncertain: jobs.filter(job => job.phase === 'uncertain').length, failed: jobs.filter(job => job.phase === 'failed').length, ...(this.error ? { lastError: this.error } : {}) };
  }
  async prepare(): Promise<void> {
    try {
      const identity = await this.api.primary(), previous = this.state.binding?.identity;
      if (previous && (previous.principal !== identity.principal || previous.dotId !== identity.dotId || previous.roomId !== identity.roomId)) throw new Error('ChatGPT 账号或主 Dot 已变化，请先断开 Dots，再连接当前账号；旧消息不会转发到新会话。');
      this.identity = identity; this.error = undefined;
    } catch (error) { this.identity = undefined; this.error = error instanceof Error ? error.message : '本机 Dots 暂不可用。'; throw error; }
  }
  start(): void { this.timer ??= setInterval(() => { void this.tick().catch(() => {}); }, 2000); this.timer.unref(); }
  async select(scope: string, mode: 'codex' | 'dots', ownerId: string, chatId: string): Promise<void> {
    this.owner(ownerId);
    if (scope !== chatId) throw new Error('本机 Dots 仅支持主人私聊。');
    if (mode === 'dots') await this.prepare();
    await this.change(next => {
      if (mode === 'dots') {
        if (next.binding && (next.binding.ownerId !== ownerId || next.binding.chatId !== chatId)) throw new Error('Dots 已绑定另一个主人私聊。');
        next.binding ??= { id: randomUUID(), ownerId, chatId, identity: this.identity! };
      }
      next.routes[scope] = mode;
    });
  }
  async disconnect(ownerId: string): Promise<void> {
    this.owner(ownerId);
    await this.change(next => { delete next.binding; next.routes = {}; for (const job of next.jobs) if (!['sent', 'uncertain', 'failed'].includes(job.phase)) job.phase = job.phase === 'sending' || job.phase === 'replying' ? 'uncertain' : 'cancelled'; });
    this.identity = undefined;
  }
  async enqueue(message: NormalizedMessage, scope: string): Promise<boolean> {
    this.owner(message.senderId);
    const binding = this.state.binding;
    if (!binding || binding.ownerId !== message.senderId || binding.chatId !== message.chatId || scope !== message.chatId || message.chatType !== 'p2p') throw new Error('请先在本人私聊连接本机 Dots。');
    const attachments = desktopAttachments(message), text = desktopMessageText(message.content, attachments);
    if (attachments.some(a => a.type === 'audio')) this.asr.check();
    if (!text || text.length > 20_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Dots 文字须非空，且不超过 20,000 字符。');
    const accepted = await this.change(next => {
      if (next.binding?.id !== binding.id || this.closed) throw new Error('Dots 绑定已变化，请重新发送。');
      if (next.jobs.some(job => job.sourceId === message.messageId)) return false;
      next.jobs = next.jobs.filter(job => job.expires > this.clock() || job.phase === 'uncertain');
      if (next.jobs.length >= 1000) throw new Error('Dots 收件已满，请处理待核对记录后再试。');
      next.jobs.push({ id: randomUUID(), bindingId: binding.id, sourceId: message.messageId, text, ...(attachments.length ? { attachments } : {}), requestId: randomUUID(), phase: 'queued', expires: this.clock() + 86_400_000 }); return true;
    });
    if (accepted) log.info('dots-desktop', 'queued', { sourceId: message.messageId });
    return accepted;
  }
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.flight) return this.flight;
    const flight = this.pump(); this.flight = flight;
    void flight.finally(() => { if (this.flight === flight) this.flight = undefined; }).catch(() => {}); return flight;
  }
  private async update(id: string, values: Partial<Job>): Promise<void> { await this.change(next => { const job = next.jobs.find(job => job.id === id); if (job) Object.assign(job, values); }); }
  private async pump(): Promise<void> {
    const binding = this.state.binding, transport = this.transport;
    if (!binding || !transport || transport.owner() !== binding.ownerId) return;
    const allowed = () => !this.closed && this.state.binding?.id === binding.id && this.transport === transport && transport.owner() === binding.ownerId;
    const jobs = this.state.jobs.filter(job => job.bindingId === binding.id);
    const notice = jobs.find(job => ['uncertain', 'failed'].includes(job.phase) && !job.notice);
    if (notice) {
      await this.update(notice.id, { notice: 'sending' });
      if (!allowed()) return;
      try { await transport.channel.send(binding.chatId, { text: `Dots 原会话直连：${notice.error ?? '此消息需要人工核对，请在客户端查看。'}` }, { replyTo: notice.sourceId }); await this.update(notice.id, { notice: 'sent' }); }
      catch { await this.update(notice.id, { notice: 'uncertain' }); }
      return;
    }
    if (jobs.some(job => job.phase === 'uncertain')) return;
    const job = jobs.find(job => ['queued', 'waiting', 'ready'].includes(job.phase));
    if (!job) return;
    if (job.expires <= this.clock()) { await this.update(job.id, { phase: 'failed', error: '超过 24 小时处理窗口，请重新发送；旧消息不会自动重发。' }); return; }
    if (job.phase === 'queued') {
      const attachmentIds: string[] = [];
      let nativeText = job.text;
      // Observe before sending, so the preceding completed turn cannot be
      // mistaken for this input's completion. Reconnect failures leave it queued.
      let activity;
      try { activity = await this.api.activity(binding.identity); }
      catch (error) { this.error = error instanceof Error ? error.message : '正在等待原会话状态恢复。'; return; }
      if (activity.active) { this.error = undefined; return; }
      await this.update(job.id, { previousTurnId: activity.turnId });
      if (job.attachments?.length) {
        await this.update(job.id, { phase: 'preparing' });
        try {
          const attachments = structuredClone(job.attachments);
          if (!transport.channel.downloadResourceToFile) throw new DesktopDotError('飞书附件下载通道不可用，请重启后重试。');
          for (const attachment of attachments) {
            if (!allowed()) return;
            if (!attachment.nativeFileId || attachment.type === 'audio' && !attachment.transcript) {
              const file = await readDesktopSource(this.dir, job.sourceId, attachment, { downloadResourceToFile: transport.channel.downloadResourceToFile.bind(transport.channel) });
              if (!allowed()) return;
              if (attachment.type === 'audio' && !attachment.transcript) attachment.transcript = await this.asr.transcribe(file.bytes, file.mimeType, this.abort.signal);
              if (!allowed()) return;
              attachment.nativeFileId ??= await this.api.upload(binding.identity, file);
              if (!allowed()) return;
              await this.update(job.id, { attachments });
            }
            attachmentIds.push(attachment.nativeFileId);
          }
          for (const attachment of attachments) if (attachment.transcript) nativeText += `\n\n[飞书语音转写（阿里云，可能有识别误差）；原音频附后]\n${attachment.transcript}`;
          if (nativeText.length > 20_000) throw new DesktopDotError('文字与语音转写合计超过 20,000 字符，请拆分后重发。');
        } catch (error) {
          // Uploads do not create messages; failure here cannot cause duplicate chat input.
          this.error = error instanceof Error ? error.message : '附件准备失败，请重新发送。';
          await this.update(job.id, { phase: 'failed', error: `附件未送入原会话：${this.error}` }); return;
        }
      }
      await this.update(job.id, { phase: 'sending' });
      if (!allowed()) return;
      try {
        const sent = await this.api.send(binding.identity, nativeText, job.requestId, ...(attachmentIds.length ? [attachmentIds] : []));
        if (!sent.id || sent.account_user_id !== binding.identity.ownerMemberId || sent.request_id !== job.requestId) throw new DesktopDotError('无法核对已发送消息，请在原会话查看；不会自动重发。', true);
        if (attachmentIds.length && JSON.stringify(sent.content?.attachments?.map(a => a.file_id)) !== JSON.stringify(attachmentIds)) throw new DesktopDotError('原会话附件发送结果无法核对，请在客户端查看；不会自动重发。', true);
        if (!allowed()) return;
        await this.update(job.id, { phase: 'waiting', nativeMessageId: sent.id }); this.error = undefined;
        log.info('dots-desktop', 'native-sent', { jobId: job.id, sourceId: job.sourceId });
      } catch (error) {
        this.error = error instanceof Error ? error.message : '本机 Dots 发送失败。';
        await this.update(job.id, { phase: error instanceof DesktopDotError && !error.uncertain ? 'failed' : 'uncertain', error: `${this.error}${error instanceof DesktopDotError && !error.uncertain ? '' : ' 发送结果需要在客户端核对，不会自动重发。'}` });
      }
      return;
    }
    if (job.phase === 'waiting') {
      try {
        const activity = await this.api.activity(binding.identity);
        const messages = await this.api.messages(binding.identity, job.nativeMessageId!);
        if (!allowed()) return;
        if (messages.some(message => message.account_user_id && message.account_user_id !== binding.identity.dotMemberId && !message.deleted_at)) {
          await this.update(job.id, { phase: 'uncertain', error: '等待答复时原会话出现了其他人的新输入，无法可靠关联本条飞书答复，请在客户端查看。' }); return;
        }
        const replies = messages.filter(message => message.account_user_id === binding.identity.dotMemberId && !message.deleted_at && message.message_metadata?.turn_trigger === 'chatgpt_messaging');
        const answer = replies.map(message => message.content?.text ?? '').filter(Boolean).join('\n\n').slice(0, 20_000);
        const attachments = replies.flatMap(message => message.content?.attachments ?? []);
        if (attachments.some(a => a.type !== 'file' || typeof a.file_id !== 'string' || !a.file_id) || attachments.length > 4) {
          await this.update(job.id, { phase: 'failed', error: '原 Dot 答复包含不支持的附件或超过 4 个附件，请在客户端查看。' }); return;
        }
        const answerFiles = [...new Set(attachments.map(a => a.file_id))];
        if ((answer || answerFiles.length) && (answer !== job.answer || JSON.stringify(answerFiles) !== JSON.stringify(job.answerFiles ?? []))) await this.update(job.id, { answer, answerFiles, settleAt: this.clock() + 4000 });
        else if ((answer || answerFiles.length) && job.settleAt !== undefined && this.clock() >= job.settleAt
          && !activity.active && activity.turnId && activity.turnId !== job.previousTurnId && ['completed', 'failed', 'interrupted'].includes(activity.status ?? '')) await this.update(job.id, { phase: 'ready' });
        this.error = undefined;
      } catch (error) { this.error = error instanceof Error ? error.message : '本机 Dots 读取失败，正在等待恢复。'; }
      return;
    }
    // Fetch before any Feishu send. Cloud download URLs and bytes are never persisted.
    const files = [];
    try {
      for (const id of job.answerFiles ?? []) {
        const file = await this.api.download(binding.identity, id);
        if (!allowed()) return;
        mediaName(file.name); validateOutput('file', file.bytes);
        const image = nativeMediaMime(file.bytes, file.name).startsWith('image/');
        if (image) validateOutput('image', file.bytes);
        files.push({ ...file, image });
      }
    } catch (error) {
      await this.update(job.id, { phase: 'failed', error: `Dot 已在原会话答复，但附件读取失败：${error instanceof Error ? error.message : '请在客户端查看。'}` }); return;
    }
    await this.update(job.id, { phase: 'replying' });
    if (!allowed()) return;
    const answer = job.answer || '附件已由原 Dot 生成。', text = answer.length > 3800 ? `${answer.slice(0, 3750)}\n\n（答复较长，完整内容请在 ChatGPT 原会话查看。）` : answer;
    try {
      await transport.channel.send(binding.chatId, { text: `🤖 Dots · ${binding.identity.name}（原会话）\n\n${text}` }, { replyTo: job.sourceId });
      for (const file of files) {
        if (!allowed()) return;
        await transport.channel.send(binding.chatId, file.image ? { image: { source: file.bytes } } : { file: { source: file.bytes, fileName: file.name } }, { replyTo: job.sourceId });
      }
      await this.update(job.id, { phase: 'sent' }); log.info('dots-desktop', 'reply-sent', { jobId: job.id, sourceId: job.sourceId, files: files.length });
    }
    catch { await this.update(job.id, { phase: 'uncertain', error: '飞书发送结果不确定，请核对原消息；不会自动重发。' }); }
  }
  async close(): Promise<void> { this.closed = true; this.abort.abort(); clearInterval(this.timer); await this.api.close(); await this.flight; await this.tail; this.transport = undefined; }
}

export class DesktopDotsRuntime {
  constructor(readonly bridge: DesktopDotsBridge) {}
  async listen(): Promise<void> { await this.bridge.prepare().catch(() => {}); this.bridge.start(); }
  async close(): Promise<void> { await this.bridge.close(); }
}
