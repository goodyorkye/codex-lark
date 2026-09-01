import { describe, expect, it } from 'vitest';
import {
  projectHistoryMarkdown,
  projectUserMessage,
} from '../../../src/card/history-content';

describe('Codex history content projection', () => {
  it('extracts every media/file form while preserving safe Markdown and code literals', () => {
    const projected = projectHistoryMarkdown([
      '[官网](https://example.com/docs)',
      '![截图](</workspace/result (final).png>)',
      '[报告](./report.pdf)',
      '![录音](./voice.opus)',
      '<video src="./clip.mp4" title="演示片段">',
      '<source src="./voice.webm" type="audio/webm">',
      '<at id="ou_not_allowed">某人</at>',
      '`![代码示例](/not/a/resource.png)`',
      '```md',
      '![代码块示例](/not/a/resource.png)',
      '```',
    ].join('\n'));

    expect(projected.markdown).toContain('[官网](https://example.com/docs)');
    expect(projected.markdown).not.toContain('![截图]');
    expect(projected.markdown).toContain('🖼️ 截图');
    expect(projected.markdown).toContain('📎 报告');
    expect(projected.markdown).toContain('🎵 录音');
    expect(projected.markdown).toContain('🎬 演示片段');
    expect(projected.markdown).toContain('‹at id="ou_not_allowed"›');
    expect(projected.markdown).toContain('`![代码示例](/not/a/resource.png)`');
    expect(projected.markdown).toContain('![代码块示例](/not/a/resource.png)');
    expect(projected.resources.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: 'image', source: '/workspace/result (final).png' },
      { kind: 'file', source: './report.pdf' },
      { kind: 'audio', source: './voice.opus' },
      { kind: 'video', source: './clip.mp4' },
      { kind: 'audio', source: './voice.webm' },
    ]);
  });

  it('projects every documented user input kind and labels unknown future inputs', () => {
    const projected = projectUserMessage({
      type: 'userMessage',
      content: [
        { type: 'text', text: '看看这些内容' },
        { type: 'localImage', path: '/workspace/local.png' },
        { type: 'image', url: 'https://example.com/remote.jpg' },
        { type: 'futureAttachment', token: 'opaque' },
      ],
    });

    expect(projected.markdown).toContain('看看这些内容');
    expect(projected.markdown).toContain('local\\.png');
    expect(projected.markdown).toContain('https://example.com/remote.jpg');
    expect(projected.markdown).toContain('未识别的输入附件');
    expect(projected.resources).toEqual([
      {
        kind: 'image',
        source: '/workspace/local.png',
        label: '图片',
        origin: 'user-input',
      },
      {
        kind: 'image',
        source: 'https://example.com/remote.jpg',
        label: '图片',
        origin: 'user-input',
      },
    ]);
  });

  it('neutralizes non-web links and raw Feishu resource tags', () => {
    const projected = projectHistoryMarkdown([
      '[脚本](javascript:alert(1))',
      '[本地文件](file:///workspace/data.csv)',
      '<img key="img_foreign_key">',
      '<file key="file_foreign_key">',
    ].join('\n'));

    expect(projected.markdown).not.toContain('javascript:');
    expect(projected.markdown).not.toContain('<img');
    expect(projected.markdown).not.toContain('<file');
    expect(projected.resources.map((resource) => resource.source)).toEqual([
      'file:///workspace/data.csv',
    ]);
  });
});
