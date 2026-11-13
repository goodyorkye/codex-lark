import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { dotsProxyUrl, publicAddress } from './network';

export type MediaKind = 'image' | 'file';
export interface HostFile { download_url: string; file_id: string; file_name?: string; mime_type?: string }
export type FileFetcher = (file: HostFile) => Promise<Buffer>;
export const MAX_OUTBOUND_BYTES = 20 * 1024 * 1024;
export class OutboundError extends Error {}

export function hostFileUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 8192) throw new OutboundError('Invalid host file URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new OutboundError('Invalid host file URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443'
    || !['oaiusercontent.com', 'files.openai.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new OutboundError('只接受 ChatGPT 文件交接提供的 HTTPS 文件地址，不接受任意网址或本地路径。');
  }
  return url;
}

export const fetchHostFile: FileFetcher = async file => {
  const url = hostFileUrl(file.download_url), proxy = dotsProxyUrl();
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', agent: agent ?? false,
      ...(proxy ? {} : { lookup: ((hostname, options, done) => {
        void lookup(hostname, { all: true, verbatim: true }).then(answers => {
          if (!answers.length || answers.some(a => !publicAddress(a.address))) throw new Error();
          if (options.all) done(null, answers); else done(null, answers[0]!.address, answers[0]!.family);
        }).catch(() => done(new Error('File DNS rejected'), '', 4));
      }) as NonNullable<import('node:https').RequestOptions['lookup']> }),
    }, res => {
      if (res.statusCode !== 200 || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity'
        || Number(res.headers['content-length'] ?? 0) > MAX_OUTBOUND_BYTES) {
        res.destroy(); reject(new OutboundError('ChatGPT 文件下载失败、已过期或超过 20 MiB；请重新交接文件。')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTBOUND_BYTES) { res.destroy(); reject(new OutboundError('回传文件最多 20 MiB，请缩小后重试。')); }
        else chunks.push(chunk);
      });
      res.on('error', () => reject(new OutboundError('ChatGPT 文件下载中断，请重新交接文件。')));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    const timer = setTimeout(() => req.destroy(), 30_000);
    req.on('close', () => { clearTimeout(timer); agent?.destroy(); });
    req.on('error', () => reject(new OutboundError('ChatGPT 文件下载失败，请重新交接文件；下载凭据不会写入日志或收件记录。')));
    req.end();
  });
};

export function mediaName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f/\\"]/.test(value)
    || ['.', '..'].includes(value)) throw new OutboundError('文件名须为 1–128 字符，且不能包含路径或控制字符。');
  return value;
}

export function validateOutput(type: MediaKind, bytes: Buffer): void {
  if (!bytes.length || bytes.length > MAX_OUTBOUND_BYTES) throw new OutboundError('回传文件须非空，且最多 20 MiB。');
  if (type === 'image') {
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const gif = ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
    const webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!(png || jpeg || gif || webp) || bytes.length > 10 * 1024 * 1024) throw new OutboundError('图片回传支持 PNG、JPEG、GIF、WebP，最多 10 MiB。');

  }
}
