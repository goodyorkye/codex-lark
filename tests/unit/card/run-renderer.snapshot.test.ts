import { describe, expect, it } from 'vitest';
import {
  markApprovalSubmitting,
  renderApprovalCard,
  renderCard,
} from '../../../src/card/run-renderer.js';
import {
  initialState,
  markIdleTimeout,
  markInterrupted,
  reduce,
  type RunState,
} from '../../../src/card/run-state.js';
import { renderText } from '../../../src/card/text-renderer.js';
import type { AgentEvent } from '../../../src/agent/types.js';
import { normalizeCard } from '../../helpers/card-normalize.js';

describe('run card renderer snapshots', () => {
  it('renders initial running state', () => {
    expectCard(initialState).toMatchSnapshot();
  });

  it('renders active and completed thinking', () => {
    expectCard(stateFrom([{ type: 'thinking', delta: 'checking options' }])).toMatchSnapshot();
    expectCard(stateFrom([
      { type: 'thinking', delta: 'checking options' },
      { type: 'text', delta: 'final answer' },
      { type: 'done', terminationReason: 'normal' },
    ])).toMatchSnapshot();
  });

  it('renders tool running, done, and error states', () => {
    expectCard(stateFrom([
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
    ])).toMatchSnapshot();

    expectCard(stateFrom([
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', id: 'tool-1', output: '/repo', isError: false },
      { type: 'done', terminationReason: 'normal' },
    ])).toMatchSnapshot();

    expectCard(stateFrom([
      { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/missing.ts' } },
      { type: 'tool_result', id: 'tool-2', output: 'ENOENT', isError: true },
      { type: 'done', terminationReason: 'normal' },
    ])).toMatchSnapshot();
  });

  it('collapses consecutive tools while preserving the latest running tool', () => {
    expectCard(stateFrom([
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', id: 'tool-1', output: '/repo', isError: false },
      { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/repo/a.ts' } },
      { type: 'tool_result', id: 'tool-2', output: 'a', isError: false },
      { type: 'tool_use', id: 'tool-3', name: 'Edit', input: { file_path: '/repo/a.ts' } },
    ])).toMatchSnapshot();

    expectCard(stateFrom([
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', id: 'tool-1', output: '/repo', isError: false },
      { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/repo/a.ts' } },
      { type: 'tool_result', id: 'tool-2', output: 'a', isError: false },
      { type: 'tool_use', id: 'tool-3', name: 'Edit', input: { file_path: '/repo/a.ts' } },
      { type: 'tool_result', id: 'tool-3', output: 'ok', isError: false },
      { type: 'done', terminationReason: 'normal' },
    ])).toMatchSnapshot();
  });

  it('renders done, error, interrupted, and idle-timeout terminal states', () => {
    expectCard(stateFrom([{ type: 'done', terminationReason: 'normal' }])).toMatchSnapshot();
    expectCard(stateFrom([{ type: 'error', message: 'process failed', terminationReason: 'failed' }])).toMatchSnapshot();
    expectCard(markInterrupted(stateFrom([{ type: 'text', delta: 'partial' }]))).toMatchSnapshot();
    expectCard(markIdleTimeout(stateFrom([{ type: 'text', delta: 'partial' }]), 15)).toMatchSnapshot();
  });

  it('renders markdown text mode without card-only controls', () => {
    const state = stateFrom([
      { type: 'thinking', delta: 'hidden reasoning' },
      { type: 'text', delta: 'Answer' },
      { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', id: 'tool-1', output: '/repo', isError: false },
      { type: 'text', delta: 'Done' },
    ]);

    expect(renderText(state)).toMatchSnapshot();
    expect(renderText(markInterrupted(state))).toMatchSnapshot();
    expect(renderText(markIdleTimeout(state, 10))).toMatchSnapshot();
    expect(renderText(stateFrom([{ type: 'error', message: 'process failed', terminationReason: 'failed' }]))).toMatchSnapshot();
  });

  it('injects signed bridge callback values for managed run controls', () => {
    const card = renderCard(initialState, {
      signCallback: (action) => `token-for-${action}`,
    }) as {
      body?: { elements?: Array<{ tag?: string; behaviors?: Array<{ value?: Record<string, unknown> }> }> };
    };
    const button = card.body?.elements?.find((element) => element.tag === 'button');

    expect(button?.behaviors?.[0]?.value).toEqual({
      cmd: 'stop',
      __bridge_cb: true,
      bridge_token: 'token-for-stop',
    });
  });

  it('adds Codex task navigation only after a run finishes', () => {
    const running = JSON.stringify(renderCard(initialState, {
      codexNavigation: { cwd: '/tmp/project-a' },
    }));
    expect(running).not.toContain('tasks.recent');

    const done = JSON.stringify(renderCard(
      stateFrom([{ type: 'text', delta: '完成' }, { type: 'done', terminationReason: 'normal' }]),
      { codexNavigation: { cwd: '/tmp/project-a', hasCurrentTask: true } },
    ));
    expect(done).toContain('tasks.recent');
    expect(done).toContain('projects');
    expect(done).toContain('models');
    expect(done).toContain('task.latest');
  });

  it('keeps approval controls compatible with Feishu card schema V2', () => {
    const state = stateFrom([{
      type: 'approval_request',
      approvalId: 'approval-1',
      title: '运行命令',
      detail: 'pnpm test',
      allowForSession: true,
    }]);
    const approval = renderCard(state);
    expect(collectTags(approval)).not.toContain('action');
    expect(JSON.stringify(approval)).toContain('approval.accept');
    expect(JSON.stringify(approval)).toContain('approval.decline');
    const block = state.blocks.find((candidate) => candidate.kind === 'approval');
    expect(block?.kind).toBe('approval');
    if (block?.kind === 'approval') {
      expect(JSON.stringify(renderApprovalCard(block.approval))).toContain('等待审批');
      expect(JSON.stringify(renderApprovalCard(block.approval))).toContain('approval.accept');
    }
  });

  it('immediately hides only the clicked approval buttons while preserving the card', () => {
    const state = stateFrom([
      { type: 'text', delta: '已有任务输出' },
      {
        type: 'approval_request',
        approvalId: 'approval-1',
        title: '运行命令',
        detail: 'pnpm test',
        allowForSession: true,
      },
      {
        type: 'approval_request',
        approvalId: 'approval-2',
        title: '读取文件',
        detail: '/tmp/a.txt',
        allowForSession: false,
      },
    ]);

    const submitting = JSON.stringify(
      markApprovalSubmitting(renderCard(state), 'approval-1', 'accept'),
    );

    expect(submitting).toContain('已有任务输出');
    expect(submitting).toContain('正在允许');
    expect(submitting).not.toContain('"arg":"approval-1"');
    expect(submitting).toContain('"arg":"approval-2"');
  });

  it('keeps local paths in user-visible cards and text fallbacks', () => {
    const sensitivePath = '/Users/example/private/customer/repo/secret.txt';
    const state = stateFrom([
      { type: 'text', delta: `I read ${sensitivePath}` },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: sensitivePath } },
      { type: 'tool_result', id: 'tool-1', output: `content from ${sensitivePath}`, isError: false },
      { type: 'done', terminationReason: 'normal' },
    ]);

    const card = JSON.stringify(renderCard(state));
    const text = renderText(state);
    expect(card).toContain(sensitivePath);
    expect(text).toContain(sensitivePath);
  });

  it('projects live media markdown to safe placeholders in card and markdown modes', () => {
    const imagePath = '/repo/generated/test.png';
    const state = stateFrom([
      { type: 'text', delta: `完成 ![测试图片](${imagePath})` },
      { type: 'done', terminationReason: 'normal' },
    ]);

    const card = JSON.stringify(renderCard(state));
    const text = renderText(state);
    expect(card).not.toContain('![测试图片]');
    expect(text).not.toContain('![测试图片]');
    expect(card).toContain('测试图片（test\\\\.png）');
    expect(text).toContain('测试图片（test\\.png）');
  });
});

function stateFrom(events: AgentEvent[]): RunState {
  return events.reduce((state, event) => reduce(state, event), initialState);
}

function expectCard(state: RunState) {
  return expect(normalizeCard(renderCard(state)));
}

function collectTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectTags);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.tag === 'string' ? [record.tag] : []),
    ...Object.values(record).flatMap(collectTags),
  ];
}
