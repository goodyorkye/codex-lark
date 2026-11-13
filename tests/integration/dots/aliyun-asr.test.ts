import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ status: 200, body: '', sent: '', url: '', headers: {} as Record<string, string> }));
vi.mock('node:https', () => ({ request: vi.fn((url, options, callback) => {
  http.url = String(url); http.headers = options.headers;
  const req = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: (body: string) => {
    http.sent = body;
    queueMicrotask(() => {
      const res = Object.assign(new EventEmitter(), { statusCode: http.status, resume: vi.fn(), destroy: vi.fn() }); callback(res);
      res.emit('data', Buffer.from(http.body)); res.emit('end'); req.emit('close');
    });
  } }); return req;
}) }));
import { request } from 'node:https';
import { aliyunAsr } from '../../../src/dots/aliyun-asr';
afterEach(() => { vi.clearAllMocks(); http.status = 200; http.body = ''; });
describe('dependency-free Aliyun ASR', () => {
  it('asks for a local key before transmitting audio and never asks to paste it into chat', async () => {
    const asr = aliyunAsr({}); expect(asr.configured()).toBe(false); expect(() => asr.check()).toThrow('DASHSCOPE_API_KEY');
    await expect(asr.transcribe(Buffer.from('audio'), 'audio/ogg')).rejects.toThrow('不要把 Key 发到飞书聊天'); expect(request).not.toHaveBeenCalled();
  });
  it('sends bounded original audio as a data URI to the official Beijing API', async () => {
    http.body = JSON.stringify({ choices: [{ message: { content: '松鼠带着三颗松果回家了。' } }] });
    const asr = aliyunAsr({ DASHSCOPE_API_KEY: 'private-test-key' });
    expect(await asr.transcribe(Buffer.from('original audio'), 'audio/ogg')).toBe('松鼠带着三颗松果回家了。');
    expect(http.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(JSON.parse(http.sent)).toMatchObject({ model: 'qwen3-asr-flash', stream: false, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/ogg;base64,b3JpZ2luYWwgYXVkaW8=' } }] }] });
    expect(http.sent).not.toContain('private-test-key'); expect(http.headers.Authorization).toBe('Bearer private-test-key');
  });
  it('supports explicit Aliyun regions and workspace domains, rejects arbitrary destinations and oversized audio', async () => {
    http.body = JSON.stringify({ choices: [{ message: { content: 'test' } }] });
    await aliyunAsr({ DASHSCOPE_API_KEY: 'key', CODEX_LARK_DOTS_ASR_REGION: 'ap-southeast-1', CODEX_LARK_DOTS_ASR_WORKSPACE: 'workspace-1' }).transcribe(Buffer.from('audio'), 'audio/ogg');
    expect(http.url).toBe('https://workspace-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(() => aliyunAsr({ DASHSCOPE_API_KEY: 'key', CODEX_LARK_DOTS_ASR_REGION: 'example.com' }).check()).toThrow('配置无效');
    await expect(aliyunAsr({ DASHSCOPE_API_KEY: 'key' }).transcribe(Buffer.alloc(6 * 1024 * 1024 + 1), 'audio/ogg')).rejects.toThrow('6 MiB');
  });
  it('returns actionable failures without reflecting response bodies or credentials', async () => {
    http.status = 401; http.body = 'private provider body and key';
    await expect(aliyunAsr({ DASHSCOPE_API_KEY: 'private-test-key' }).transcribe(Buffer.from('audio'), 'audio/ogg')).rejects.toThrow('鉴权失败');
    http.status = 200; http.body = '{"choices":[]}';
    await expect(aliyunAsr({ DASHSCOPE_API_KEY: 'private-test-key' }).transcribe(Buffer.from('audio'), 'audio/ogg')).rejects.toThrow('未返回可用转写文字');
  });
});
