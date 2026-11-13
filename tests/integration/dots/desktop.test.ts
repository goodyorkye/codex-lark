import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import type { NormalizedMessage } from '@larksuite/channel';
import { DesktopDotsBridge } from '../../../src/dots/desktop-bridge';
import { DesktopDotError, desktopPrincipal, type DesktopDotIdentity, type DesktopDotMessage } from '../../../src/dots/desktop-client';
import { writeFileAtomic } from '../../../src/platform/atomic-write';
import { createTmpProfile } from '../../helpers/tmp-profile';
import { createFakeChannel } from '../../helpers/fake-channel';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const identity: DesktopDotIdentity = { principal: 'account:user', dotId: 'original-dot', roomId: 'original-room', name: '原小弟', ownerMemberId: 'native-owner', dotMemberId: 'native-dot' };
function message(id = 'om_source', content = '原会话测试'): NormalizedMessage { return { senderId: 'ou_owner', chatId: 'chat-1', chatType: 'p2p', messageId: id, content, resources: [] } as unknown as NormalizedMessage; }
async function harness() {
  const tmp = await createTmpProfile('dots-desktop-'); let now = 1_800_000_000_000, owner: string | undefined = 'ou_owner';
  let reads = 0;
  const asr = { configured: () => true, check: vi.fn(() => {}), transcribe: vi.fn(async () => '松鼠带着三颗松果回家了。') };
  const api = { primary: vi.fn(async () => identity), send: vi.fn(async (_identity: DesktopDotIdentity, _text: string, requestId: string, attachmentIds?: string[]) => ({ id: 'native-input', account_user_id: identity.ownerMemberId, request_id: requestId, content: { attachments: attachmentIds?.map(file_id => ({ type: 'file' as const, file_id })) } })),
    activity: vi.fn(async () => ({ turnId: reads++ ? 'reply-turn' : 'previous-turn', active: false, status: 'completed' as 'completed' | 'in_progress' })),
    upload: vi.fn(async () => 'native-file'), download: vi.fn(async () => ({ id: 'generated-file', name: 'summary.txt', mimeType: 'text/plain', bytes: Buffer.from('summary') })),
    messages: vi.fn(async (): Promise<DesktopDotMessage[]> => [{ id: 'native-answer', account_user_id: identity.dotMemberId, content: { text: '原会话的答复' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]), close: vi.fn(async () => {}) };
  const dir = join(tmp.profile, 'dots'), bridge = await DesktopDotsBridge.open(dir, 'app-test', { api, clock: () => now, asr });
  const channel = Object.assign(createFakeChannel(), { downloadResourceToFile: vi.fn(async (_source: string, _key: string, _type: string, path: string) => { const bytes = Buffer.from('sample document'); await writeFile(path, bytes); return { bytesWritten: bytes.length }; }) }); bridge.attach(channel, () => owner);
  cleanups.push(tmp.cleanup, () => bridge.close());
  return { tmp, dir, api, bridge, channel, asr, clock: () => now, advance: (ms: number) => { now += ms; }, setOwner: (id?: string) => { owner = id; } };
}

describe('desktop original-Dot text transport', () => {
  it('uses the desktop account/user claims instead of the OAuth subject for messaging membership', () => {
    const token = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
    expect(desktopPrincipal(token({ sub: 'oauth-subject-is-not-the-messaging-member', exp: Date.now() / 1000 + 600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'account', user_id: 'native-owner' } }))).toEqual({ principal: 'account:native-owner', accountId: 'account', userId: 'native-owner' });
    expect(() => desktopPrincipal(token({ sub: 'owner', exp: Date.now() / 1000 + 600 }))).toThrow('登录状态');
    expect(() => desktopPrincipal(token({ exp: 1, 'https://api.openai.com/auth': { account_id: 'account', user_id: 'owner' } }))).toThrow('过期');
  });
  it('sends once to the original room and replies to the source after returning to Codex', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    expect(await h.bridge.enqueue(message(), 'chat-1')).toBe(true);
    expect(await h.bridge.enqueue(message(), 'chat-1')).toBe(false);
    await h.bridge.tick(); expect(h.api.send).toHaveBeenCalledWith(identity, '原会话测试', expect.any(String));
    await h.bridge.select('chat-1', 'codex', 'ou_owner', 'chat-1');
    await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    expect(h.api.send).toHaveBeenCalledTimes(1); expect(h.api.messages).toHaveBeenCalledWith(identity, 'native-input');
    expect(h.channel.sent).toEqual([{ chatId: 'chat-1', content: { text: '🤖 Dots · 原小弟（原会话）\n\n原会话的答复' }, options: { replyTo: 'om_source' } }]);
    expect(h.bridge.mode('chat-1')).toBe('codex'); expect(h.bridge.status().pending).toBe(0);
  });
  it('does not confuse another native human message with a response or continue sending into ambiguous history', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.enqueue(message('om_second'), 'chat-1');
    h.api.messages.mockResolvedValue([{ id: 'human-interleaved', account_user_id: identity.ownerMemberId, content: { text: '客户端里的另一个问题' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    await h.bridge.tick(); await h.bridge.tick(); await h.bridge.tick(); await h.bridge.tick();
    expect(h.bridge.status().uncertain).toBe(1); expect(h.api.send).toHaveBeenCalledTimes(1);
    expect(h.channel.sent).toHaveLength(1); expect(JSON.stringify(h.channel.sent)).toContain('无法可靠关联'); expect(JSON.stringify(h.channel.sent)).not.toContain('客户端里的另一个问题');
  });
  it('preserves waiting jobs across restart and never resends interrupted native or Feishu sends', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1'); await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick(); await h.bridge.close();
    const reopened = await DesktopDotsBridge.open(h.dir, 'app-test', { api: h.api, clock: h.clock }); cleanups.push(() => reopened.close()); reopened.attach(h.channel, () => 'ou_owner'); await reopened.prepare();
    await reopened.tick(); h.advance(5000); await reopened.tick(); await reopened.tick(); expect(h.api.send).toHaveBeenCalledTimes(1);
    await reopened.close();
    const path = join(h.dir, 'desktop-state.json'), state = JSON.parse(await readFile(path, 'utf8')); state.jobs[0].phase = 'sending'; await writeFileAtomic(path, JSON.stringify(state));
    const interrupted = await DesktopDotsBridge.open(h.dir, 'app-test', { api: h.api, clock: h.clock }); cleanups.push(() => interrupted.close()); interrupted.attach(h.channel, () => 'ou_owner');
    await interrupted.tick(); await interrupted.tick(); expect(interrupted.status().uncertain).toBe(1); expect(h.api.send).toHaveBeenCalledTimes(1);
  });
  it('does not forward a proactive Dot update as the answer to the pending Feishu input', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1'); await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick();
    h.api.messages.mockResolvedValue([{ id: 'proactive', account_user_id: identity.dotMemberId, content: { text: '其他后台任务的进展' }, message_metadata: { turn_trigger: 'automation' } }]);
    await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    expect(h.channel.sent).toHaveLength(0); expect(h.bridge.status().pending).toBe(1);
  });
  it('stops on ambiguous native send failures and rejects owner, account and media mismatches', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await expect(h.bridge.enqueue({ ...message(), senderId: 'ou_other' }, 'chat-1')).rejects.toThrow('主人');
    await expect(h.bridge.enqueue({ ...message(), resources: [{ type: 'sticker', fileKey: 'sticker' }] } as NormalizedMessage, 'chat-1')).rejects.toThrow('贴纸');
    h.api.primary.mockResolvedValue({ ...identity, principal: 'other-account:user' }); await expect(h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1')).rejects.toThrow('已变化');
    h.api.send.mockRejectedValue(new DesktopDotError('连接中断', true)); await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick(); await h.bridge.tick();
    expect(h.bridge.status().uncertain).toBe(1); expect(h.api.send).toHaveBeenCalledTimes(1);
    h.setOwner('ou_other'); await h.bridge.tick(); expect(h.channel.sent).toHaveLength(1);
  });
  it('uploads original source-bound bytes, removes Feishu markup and attaches native file IDs to the original room', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await h.bridge.enqueue({ ...message('om_file', '<file key="source-key" name="report.txt"/>'), resources: [{ type: 'file', fileKey: 'source-key', fileName: 'report.txt' }] } as NormalizedMessage, 'chat-1');
    await h.bridge.tick();
    expect(h.channel.downloadResourceToFile).toHaveBeenCalledWith('om_file', 'source-key', 'file', expect.stringContaining(h.dir));
    expect(h.api.upload).toHaveBeenCalledWith(identity, { name: 'report.txt', mimeType: 'text/plain', bytes: Buffer.from('sample document') });
    expect(h.api.send).toHaveBeenCalledWith(identity, '请读取附件内容，并用文字回复。', expect.any(String), ['native-file']);
    expect((await readdir(h.dir)).filter(n => n.startsWith('image-read-'))).toEqual([]);
  });
  it('forwards original audio together with Aliyun transcription without local speech dependencies', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    const bytes = Buffer.from('OggS original audio OpusHead');
    h.channel.downloadResourceToFile.mockImplementation(async (_source, _key, _type, path) => { await writeFile(path, bytes); return { bytesWritten: bytes.length }; });
    await h.bridge.enqueue({ ...message('om_voice', '<audio key="voice"/>'), resources: [{ type: 'audio', fileKey: 'voice', durationMs: 3000 }] } as NormalizedMessage, 'chat-1'); await h.bridge.tick();
    expect(h.api.upload).toHaveBeenCalledWith(identity, { name: '飞书语音.ogg', mimeType: 'audio/ogg', bytes });
    expect(h.asr.transcribe).toHaveBeenCalledWith(bytes, 'audio/ogg', expect.any(AbortSignal));
    expect(h.api.send).toHaveBeenCalledWith(identity, expect.stringContaining('[飞书语音转写（阿里云，可能有识别误差）；原音频附后]\n松鼠带着三颗松果回家了。'), expect.any(String), ['native-file']);
  });
  it('checks speech configuration before downloading or queueing audio', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    h.asr.check.mockImplementation(() => { throw new Error('请配置 DASHSCOPE_API_KEY'); });
    await expect(h.bridge.enqueue({ ...message(), resources: [{ type: 'audio', fileKey: 'voice' }] } as NormalizedMessage, 'chat-1')).rejects.toThrow('DASHSCOPE_API_KEY');
    expect(h.channel.downloadResourceToFile).not.toHaveBeenCalled(); expect(h.bridge.status().pending).toBe(0); expect(h.api.send).not.toHaveBeenCalled();
  });
  it('does not send a partial native message if any attachment fails; interrupted preparation can safely resume', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await h.bridge.enqueue({ ...message(), resources: [{ type: 'file', fileKey: 'doc', fileName: 'a.txt' }] } as NormalizedMessage, 'chat-1');
    h.api.upload.mockRejectedValueOnce(new Error('upload failed')); await h.bridge.tick(); await h.bridge.tick();
    expect(h.api.send).not.toHaveBeenCalled(); expect(h.bridge.status().failed).toBe(1); expect(JSON.stringify(h.channel.sent)).toContain('附件未送入原会话');
    await h.bridge.close();
    const path = join(h.dir, 'desktop-state.json'), state = JSON.parse(await readFile(path, 'utf8')); state.jobs[0].phase = 'preparing'; delete state.jobs[0].notice; await writeFileAtomic(path, JSON.stringify(state));
    const restarted = await DesktopDotsBridge.open(h.dir, 'app-test', { api: h.api, clock: h.clock }); cleanups.push(() => restarted.close()); restarted.attach(h.channel, () => 'ou_owner'); await restarted.tick(); expect(h.api.send).toHaveBeenCalledTimes(1);
  });
  it('returns generated native attachments to the original Feishu input after switching back', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1'); await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick();
    h.api.messages.mockResolvedValue([{ id: 'native-file-answer', account_user_id: identity.dotMemberId, content: { text: '文件已生成', attachments: [{ type: 'file', file_id: 'generated-file' }] }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    await h.bridge.select('chat-1', 'codex', 'ou_owner', 'chat-1'); await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    expect(h.api.download).toHaveBeenCalledWith(identity, 'generated-file');
    expect(h.channel.sent[1]).toEqual({ chatId: 'chat-1', content: { file: { source: Buffer.from('summary'), fileName: 'summary.txt' } }, options: { replyTo: 'om_source' } });
    expect(h.bridge.status().pending).toBe(0);
  });
  it('waits for the actual native turn completion instead of treating stable progress as the final reply', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1'); await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick();
    h.api.activity.mockResolvedValue({ turnId: 'reply-turn', active: true, status: 'in_progress' });
    h.api.messages.mockResolvedValue([{ id: 'progress', account_user_id: identity.dotMemberId, content: { text: '我会生成文件。' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    await h.bridge.tick(); h.advance(60_000); await h.bridge.tick(); await h.bridge.tick(); expect(h.channel.sent).toHaveLength(0);
    h.api.messages.mockResolvedValue([{ id: 'finished', account_user_id: identity.dotMemberId, content: { text: '生成完毕。', attachments: [{ type: 'file', file_id: 'generated-file' }] }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    h.api.activity.mockResolvedValue({ turnId: 'reply-turn', active: false, status: 'completed' });
    await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    expect(h.channel.sent).toHaveLength(2); expect(JSON.stringify(h.channel.sent)).toContain('生成完毕'); expect(h.api.download).toHaveBeenCalledTimes(1);
  });
  it('recovers a delegated late result before the next native input without copying the next answer or proactive notifications', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick(); await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    const first = (await h.api.messages())[0]!;
    h.api.messages.mockResolvedValue([first,
      { id: 'automation', account_user_id: identity.dotMemberId, content: { text: '无关的定时通知' }, message_metadata: { turn_trigger: 'automation' } },
      { id: 'late-result', account_user_id: identity.dotMemberId, content: { text: '委派查询已完成，没有失败项目。' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } },
      { id: 'next-input', account_user_id: identity.ownerMemberId, content: { text: '下一条问题' } },
      { id: 'next-answer', account_user_id: identity.dotMemberId, content: { text: '下一条问题的答复' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } },
    ]);
    await h.bridge.select('chat-1', 'codex', 'ou_owner', 'chat-1');
    await h.bridge.tick(); h.advance(5000); await h.bridge.tick();
    expect(h.channel.sent).toHaveLength(2);
    expect(h.channel.sent[1]).toEqual({ chatId: 'chat-1', content: { text: '🤖 Dots · 原小弟（原会话）\n\n委派查询已完成，没有失败项目。' }, options: { replyTo: 'om_source' } });
    const state = JSON.parse(await readFile(join(h.dir, 'desktop-state.json'), 'utf8'));
    expect(state.jobs[0]).toMatchObject({ phase: 'sent', followupClosed: true, deliveredMessageIds: ['native-answer', 'late-result'] });
    await h.bridge.tick(); await h.bridge.tick(); expect(h.channel.sent).toHaveLength(2);
  });
  it('migrates saved 0.3.0 replies and deduplicates delayed attachments across restarts', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick(); await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    const first = (await h.api.messages())[0]!;
    await h.bridge.close();
    const path = join(h.dir, 'desktop-state.json'), state = JSON.parse(await readFile(path, 'utf8'));
    delete state.jobs[0].answerMessageIds; delete state.jobs[0].deliveredMessageIds; await writeFileAtomic(path, JSON.stringify(state));
    h.api.messages.mockResolvedValue([first, { id: 'late-file', account_user_id: identity.dotMemberId, content: { text: '这是稍后完成的文件', attachments: [{ type: 'file', file_id: 'generated-file' }] }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    const reopened = await DesktopDotsBridge.open(h.dir, 'app-test', { api: h.api, clock: h.clock }); cleanups.push(() => reopened.close()); reopened.attach(h.channel, () => 'ou_owner');
    await reopened.tick(); h.advance(5000); await reopened.tick();
    expect(h.channel.sent).toHaveLength(3); expect(h.api.download).toHaveBeenCalledTimes(1);
    await reopened.close();
    const again = await DesktopDotsBridge.open(h.dir, 'app-test', { api: h.api, clock: h.clock }); cleanups.push(() => again.close()); again.attach(h.channel, () => 'ou_owner');
    await again.tick(); h.advance(5000); await again.tick(); expect(h.channel.sent).toHaveLength(3);
    h.api.messages.mockResolvedValue([...await h.api.messages(), { id: 'another-result', account_user_id: identity.dotMemberId, content: { text: '另一条续答' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    await again.tick(); h.advance(5000); await again.tick(); expect(h.channel.sent).toHaveLength(4);
    expect(JSON.stringify(h.channel.sent[3])).toContain('另一条续答');
  });
  it('does not retry an uncertain Feishu continuation delivery or attach a later native conversation to it', async () => {
    const h = await harness(); await h.bridge.select('chat-1', 'dots', 'ou_owner', 'chat-1');
    await h.bridge.enqueue(message(), 'chat-1'); await h.bridge.tick(); await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); await h.bridge.tick();
    const first = (await h.api.messages())[0]!;
    h.api.messages.mockResolvedValue([first, { id: 'late', account_user_id: identity.dotMemberId, content: { text: '晚到结果' }, message_metadata: { turn_trigger: 'chatgpt_messaging' } }]);
    const send = vi.spyOn(h.channel, 'send').mockRejectedValueOnce(new Error('connection lost after send'));
    await h.bridge.tick(); h.advance(5000); await h.bridge.tick(); expect(h.bridge.status().uncertain).toBe(1);
    await h.bridge.tick(); await h.bridge.tick(); expect(send).toHaveBeenCalledTimes(2); // One attempt plus the explicit review notice.
    expect(h.channel.sent).toHaveLength(2); expect(JSON.stringify(h.channel.sent[1])).toContain('结果不确定');
  });
});
