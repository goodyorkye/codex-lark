import { describe, expect, it } from 'vitest';
import { hostFileUrl, mediaName, validateOutput } from '../../../src/dots/outbound';

describe('Dots outbound host-file boundary', () => {
  it('accepts only HTTPS OpenAI file hosts, with no credentials, fragment, custom port or local destinations', () => {
    expect(hostFileUrl('https://files.oaiusercontent.com/file?signature=opaque').hostname).toBe('files.oaiusercontent.com');
    for (const url of ['https://example.com/file', 'https://oaiusercontent.com.evil.test/file', 'https://127.0.0.1/file',
      'file:///etc/passwd', 'http://files.oaiusercontent.com/file', 'https://user:pass@files.oaiusercontent.com/file',
      'https://files.oaiusercontent.com:8443/file', 'https://files.oaiusercontent.com/file#fragment']) expect(() => hostFileUrl(url), url).toThrow();
  });
  it('validates actual image headers and disallows bridge filesystem paths in names', () => {
    expect(() => validateOutput('image', Buffer.from('not an image'))).toThrow('图片');
    expect(() => validateOutput('file', Buffer.alloc(20 * 1024 * 1024 + 1))).toThrow('20 MiB');
    expect(mediaName('分析报告.md')).toBe('分析报告.md');
    for (const name of ['../report.md', 'C:\\report.md', 'bad\u0000.txt', '..']) expect(() => mediaName(name)).toThrow();
  });
});
