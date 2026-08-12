import { describe, expect, it } from 'vitest';
import {
  attachmentOmissionNotice,
  normalizeAttachments,
  safeExtensionForMime,
  type AttachmentCandidate,
} from '../../../src/media/attachment.js';

describe('attachment policy normalization', () => {
  it('accepts allowed images and ordinary files with hash paths', () => {
    const out = normalizeAttachments([
      candidate({ kind: 'image', mime: 'image/png', hash: 'abc', absPath: '/media/abc.png' }),
      candidate({ kind: 'file', mime: 'application/zip', hash: 'def', absPath: '/media/def.zip' }),
    ]);

    expect(out).toMatchObject([
      {
        kind: 'image',
        absPath: '/media/abc.png',
        path: '/media/abc.png',
        mime: 'image/png',
        hash: 'abc',
        decision: 'accepted',
        requiredness: 'optional',
      },
      {
        kind: 'file',
        absPath: '/media/def.zip',
        decision: 'accepted',
      },
    ]);
  });

  it('accepts audio while rejecting unsupported images and skipping sticker/video', () => {
    const out = normalizeAttachments([
      candidate({ kind: 'image', mime: 'image/svg+xml', hash: 'svg' }),
      candidate({ kind: 'image', mime: 'application/octet-stream', hash: 'unknown' }),
      candidate({ kind: 'sticker', mime: 'image/webp', hash: 'sticker' }),
      candidate({ kind: 'audio', mime: 'audio/ogg', hash: 'audio' }),
      candidate({ kind: 'video', mime: 'video/mp4', hash: 'video' }),
    ]);

    expect(out.map((item) => [item.kind, item.decision, item.rejectionReason])).toEqual([
      ['image', 'rejected', 'unsupported-image-mime'],
      ['image', 'rejected', 'unsupported-image-mime'],
      ['sticker', 'skipped', 'sticker'],
      ['audio', 'accepted', undefined],
      ['video', 'skipped', 'unsupported-kind'],
    ]);
  });

  it('enforces max count, per-file bytes, run bytes, and image bytes', () => {
    const out = normalizeAttachments(
      [
        candidate({ hash: '1', size: 5 }),
        candidate({ kind: 'file', mime: 'text/plain', hash: '2', size: 5 }),
        candidate({ kind: 'file', mime: 'text/plain', hash: '3', size: 5 }),
        candidate({ kind: 'file', mime: 'text/plain', hash: '4', size: 1 }),
        candidate({ kind: 'file', mime: 'text/plain', hash: '5', size: 1 }),
      ],
      {
        maxCount: 3,
        maxBytes: 12,
        maxFileBytes: 10,
        imageMaxBytes: 4,
      },
    );

    expect(out.map((item) => item.decision)).toEqual([
      'rejected',
      'accepted',
      'accepted',
      'accepted',
      'rejected',
    ]);
    expect(out.map((item) => item.rejectionReason ?? '')).toEqual([
      'image-too-large',
      '',
      '',
      '',
      'too-many-attachments',
    ]);
  });

  it('uses MIME-derived safe extensions and never original names', () => {
    expect(safeExtensionForMime('image/jpeg')).toBe('jpg');
    expect(safeExtensionForMime('image/png')).toBe('png');
    expect(safeExtensionForMime('image/webp')).toBe('webp');
    expect(safeExtensionForMime('image/gif')).toBe('gif');
    expect(safeExtensionForMime('audio/ogg')).toBe('ogg');
    expect(safeExtensionForMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(safeExtensionForMime('audio/mpeg')).toBe('mp3');
    expect(safeExtensionForMime('application/zip')).toBe('zip');
    expect(safeExtensionForMime('application/x-sh')).toBe('bin');
  });

  it('warns when an agent cannot receive an attachment instead of dropping it silently', () => {
    const attachments = normalizeAttachments([
      candidate({ kind: 'audio', mime: 'audio/ogg', hash: 'audio' }),
      candidate({ kind: 'file', mime: 'text/plain', hash: 'file' }),
      candidate({ kind: 'video', mime: 'video/mp4', hash: 'video' }),
    ]);

    expect(attachmentOmissionNotice(attachments, 'codex')).toBe(
      '⚠️ 1 个视频未能提交给 Codex，其他内容仍会正常发送。',
    );
    expect(attachmentOmissionNotice(attachments.slice(0, 2), 'claude')).toBeUndefined();
  });
});

function candidate(overrides: Partial<AttachmentCandidate> = {}): AttachmentCandidate {
  return {
    absPath: overrides.absPath ?? `/media/${overrides.hash ?? 'hash'}.png`,
    kind: overrides.kind ?? 'image',
    size: overrides.size ?? 100,
    mime: overrides.mime ?? 'image/png',
    hash: overrides.hash ?? 'hash',
    source: 'lark',
    sourceMessageId: 'om_1',
    sourceFileKey: 'file_key',
    originalName: overrides.originalName ?? 'secret original name.png',
  };
}
