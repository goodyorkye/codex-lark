import { describe, expect, it } from 'vitest';
import { modelsCard, projectsCard, taskDetailCard, tasksCard } from '../../../src/card/codex-cards';

describe('Codex navigation cards', () => {
  it('renders project and task callbacks understood by the dispatcher', () => {
    expect(JSON.stringify(projectsCard([{ cwd: '/tmp/demo', taskCount: 2 }], '/tmp/demo')))
      .toContain('project.use');
    expect(JSON.stringify(tasksCard([{ id: 'thread-1', cwd: '/tmp/demo', preview: 'Fix tests' }], 'thread-1')))
      .toContain('task.use');
  });

  it('renders model selection and readable conversation detail', () => {
    expect(JSON.stringify(modelsCard([{ id: 'm', model: 'gpt-test', displayName: 'GPT Test' }], 'gpt-test')))
      .toContain('model.use');
    const detail = taskDetailCard({
      id: 'thread-1',
      cwd: '/tmp/demo',
      turns: [{
        id: 'turn-1',
        items: [
          { type: 'userMessage', content: [{ type: 'text', text: '你好' }] },
          { type: 'agentMessage', text: '你好，我来处理。' },
        ],
      }],
    });
    expect(JSON.stringify(detail)).toContain('你好，我来处理');
  });

  it('caps large lists to stay inside Feishu card limits', () => {
    const projects = Array.from({ length: 25 }, (_, i) => ({ cwd: `/tmp/p-${i}`, taskCount: 1 }));
    const rendered = JSON.stringify(projectsCard(projects));
    expect(rendered).toContain('另有 5 项未显示');
    expect(rendered).not.toContain('/tmp/p-24');
  });
});
