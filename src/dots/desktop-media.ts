import { constants } from 'node:fs';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';
import { MAX_OUTBOUND_BYTES, validateOutput } from './outbound';

export interface DesktopSourceAttachment { type: 'image' | 'file' | 'audio'; fileKey: string; name: string; durationMs?: number; nativeFileId?: string; transcript?: string }
export type ImageDownloader = Pick<LarkChannel, 'downloadResourceToFile'>;
export class DesktopMediaError extends Error {}
export function desktopAttachments(message: NormalizedMessage): DesktopSourceAttachment[] {
  if (message.resources.length > 4) throw new DesktopMediaError('一条 Dots 消息最多 4 个附件，请分开发送。');
  return message.resources.map((r, i) => {
    if (!['image', 'file', 'audio'].includes(r.type)) throw new DesktopMediaError('本机 Dots 暂支持图片、文件和音频，视频和贴纸尚未接入。');
    if (!r.fileKey || r.fileKey.length > 1024) throw new DesktopMediaError('飞书附件标识无效，请重新发送。');
    const type = r.type === 'file' && /\.(ogg|opus|wav|mp3|m4a|aac|amr|flac|webm)$/i.test(r.fileName ?? '') ? 'audio' : r.type as 'image' | 'file' | 'audio';
    if (type === 'audio' && r.durationMs && r.durationMs > 300_000) throw new DesktopMediaError('音频最多 5 分钟，请缩短后重新发送。');
    const name = (r.fileName || (type === 'image' ? `image-${i + 1}` : type === 'audio' ? '飞书语音' : `attachment-${i + 1}`)).replace(/[\u0000-\u001f\u007f/\\"]/g, '_').slice(0, 120);
    return { type, name, fileKey: r.fileKey, ...(r.durationMs ? { durationMs: r.durationMs } : {}) };
  });
}
export function desktopMessageText(content: string, attachments: DesktopSourceAttachment[]): string {
  const visible = attachments.reduce((text, a) => text.replaceAll(`![image](${a.fileKey})`, ''), content)
    .replace(/<(?:file|audio)\s+key="([^"]+)"[^>]*\/>/g, (original: string, key: string) => attachments.some(a => a.fileKey === key) ? '' : original).trim();
  return visible || (attachments.some(a => a.type === 'audio') ? '请听取音频中的内容，并用文字回复。' : attachments.length ? '请读取附件内容，并用文字回复。' : '');
}
export async function cleanInterruptedMediaReads(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && /^image-read-[A-Za-z0-9]{6}$/.test(entry.name)) await rm(join(dir, entry.name), { recursive: true, force: true });
  }
}
export function nativeMediaMime(bytes: Buffer, name: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  if (bytes.subarray(0, 4).toString() === 'fLaC') return 'audio/flac';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  const types: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.amr': 'audio/amr', '.opus': 'audio/ogg', '.webm': 'audio/webm' };
  return types[extname(name).toLowerCase()] ?? 'application/octet-stream';
}
/** Keep original bytes; the native Dot, rather than a local parser, reads them. */
export async function readDesktopSource(dir: string, sourceId: string, attachment: DesktopSourceAttachment, channel: ImageDownloader): Promise<{ name: string; mimeType: string; bytes: Buffer }> {
  const tmp = await mkdtemp(join(dir, 'image-read-'));
  try {
    const path = join(tmp, 'resource');
    try { await channel.downloadResourceToFile(sourceId, attachment.fileKey, attachment.type === 'image' ? 'image' : 'file', path); }
    catch { throw new DesktopMediaError('飞书附件下载失败，请确认原消息仍可访问，或重新发送。'); }
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || !stat.size || stat.size > MAX_OUTBOUND_BYTES) throw new DesktopMediaError('单个附件须非空、最多 20 MiB，请缩小后重发。');
      bytes = await file.readFile();
      if (bytes.length > MAX_OUTBOUND_BYTES) throw new DesktopMediaError('单个附件最多 20 MiB。');
    } finally { await file.close(); }
    const mimeType = nativeMediaMime(bytes, attachment.name);
    if (attachment.type === 'image') validateOutput('image', bytes);
    if (attachment.type === 'audio' && !mimeType.startsWith('audio/')) throw new DesktopMediaError('音频格式无法识别，请使用 Ogg、WAV、MP3、M4A 或 FLAC。');
    const ext: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/mpeg': '.mp3' };
    const name = !extname(attachment.name) && ext[mimeType] ? attachment.name + ext[mimeType] : attachment.name;
    return { name, mimeType, bytes };
  } finally { await rm(tmp, { recursive: true, force: true }); }
}
