import { describe, expect, it } from 'vitest';
import { projectRunContent } from '../../../src/card/run-content';
import { initialState, reduce } from '../../../src/card/run-state';

describe('projectRunContent', () => {
  it('sanitizes live markdown and deduplicates native resources across text blocks', () => {
    const first = reduce(initialState, {
      type: 'text',
      delta: '结果 ![预览](/repo/out.png) 和 [附件](/repo/report.pdf)',
    });
    const withTool = reduce(first, {
      type: 'tool_use',
      id: 'tool-1',
      name: 'Bash',
      input: { command: 'true' },
    });
    const finalState = reduce(withTool, {
      type: 'text',
      delta: '重复 ![预览](/repo/out.png) 和 <audio src="/repo/tone.ogg" />',
    });

    const projected = projectRunContent(finalState);
    const visible = projected.state.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.kind === 'text' ? block.content : '')
      .join('\n');

    expect(visible).not.toContain('![预览]');
    expect(visible).not.toContain('<audio');
    expect(visible).toContain('🖼️ 预览（out\\.png）');
    expect(projected.resources).toEqual([
      expect.objectContaining({ kind: 'image', source: '/repo/out.png' }),
      expect.objectContaining({ kind: 'file', source: '/repo/report.pdf' }),
      expect.objectContaining({ kind: 'audio', source: '/repo/tone.ogg' }),
    ]);
  });
});
