import { describe, expect, it } from 'vitest';
import {
  codexRemoteHelpCard,
  codexRemoteNavigationCard,
  codexRemoteStatusCard,
  modelsCard,
  projectsCard,
  recentTasksCard,
  taskDetailCard,
  tasksCard,
} from '../../../src/card/codex-cards';

describe('Codex navigation cards', () => {
  it('renders project and task callbacks understood by the dispatcher', () => {
    const projects = JSON.stringify(projectsCard([{ cwd: '/tmp/demo', taskCount: 2 }], '/tmp/demo'));
    expect(projects).toContain('项目列表');
    expect(projects).toContain('project.use');
    expect(projects).toContain('选择');
    expect(projects).not.toContain('打开');
    const taskCard = tasksCard([{
      id: 'thread-1',
      cwd: '/tmp/demo',
      preview: 'Fix tests',
      model: 'gpt-test',
      updatedAt: Date.now(),
    }], 'thread-1', '/tmp/demo');
    const tasks = JSON.stringify(taskCard);
    expect(tasks).toContain('demo · 任务列表');
    expect(tasks).toContain('task.use');
    expect(tasks).toContain('最近更新');
    expect(collectMarkdownContents(taskCard)).toContain('模型：gpt\\-test');
    expect(collectMarkdownContents(taskCard)).not.toContain('thread-1');
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

  it('paginates large project lists to stay inside Feishu card limits', () => {
    const projects = Array.from({ length: 25 }, (_, i) => ({ cwd: `/tmp/p-${i}`, taskCount: 1 }));
    const rendered = JSON.stringify(projectsCard(projects, undefined, 1));
    expect(rendered).toContain('第 1/3 页');
    expect(rendered).toContain('下一页');
    expect(rendered).not.toContain('/tmp/p-10');
    expect(rendered).not.toContain('/tmp/p-24');
    const lastPage = JSON.stringify(projectsCard(projects, undefined, 3));
    expect(lastPage).toContain('/tmp/p-24');
    expect(lastPage).toContain('上一页');
    expect(lastPage).not.toContain('下一页');
    expect(collectTags(projectsCard(projects))).not.toContain('note');
  });

  it('paginates project task lists without exposing internal task ids', () => {
    const tasks = Array.from({ length: 22 }, (_, index) => ({
      id: `internal-thread-${index}`,
      cwd: '/tmp/demo',
      name: `任务 ${index}`,
      updatedAt: Date.now() - index * 60_000,
    }));
    const firstCard = tasksCard(tasks, undefined, '/tmp/demo', 1);
    const firstPage = JSON.stringify(firstCard);
    expect(firstPage).toContain('第 1/3 页');
    expect(firstPage).toContain('任务 0');
    expect(firstPage).not.toContain('任务 10');
    expect(collectMarkdownContents(firstCard)).not.toContain('internal-thread-0');
    const lastPage = JSON.stringify(tasksCard(tasks, undefined, '/tmp/demo', 3));
    expect(lastPage).toContain('任务 21');
    expect(lastPage).toContain('上一页');
    expect(lastPage).not.toContain('下一页');
  });

  it('renders a cross-project recent task switcher', () => {
    const recent = JSON.stringify(recentTasksCard([
      {
        id: 'thread-a',
        cwd: '/tmp/project-a',
        name: '修复登录',
        updatedAt: Date.now() - 60_000,
      },
      {
        id: 'thread-b',
        cwd: '/tmp/project-b',
        name: '整理发布说明',
        updatedAt: Date.now(),
      },
    ], 'thread-a'));
    expect(recent.indexOf('整理发布说明')).toBeLessThan(recent.indexOf('修复登录'));
    expect(recent).toContain('project\\\\-a');
    expect(recent).toContain('project\\\\-b');
    expect(recent).toContain('task.use');
  });

  it('keeps one-tap navigation on the compact workbench card', () => {
    const card = codexRemoteNavigationCard({
      cwd: '/tmp/project-a',
      taskTitle: '修复登录',
    });
    const navigation = JSON.stringify(card);
    expect(navigation).toContain('常用操作');
    expect(navigation).not.toContain('任务导航');
    expect(navigation).toContain('project\\\\-a / 修复登录');
    expect(navigation).toContain('tasks.recent');
    expect(navigation).toContain('projects');
    expect(navigation).toContain('new');
    expect(navigation).toContain('models');
    for (const label of ['最近任务', '选择项目', '新建任务', '切换模型']) {
      expect(navigation).toContain(label);
    }
    expect(collectTags(card).filter((tag) => tag === 'column_set')).toHaveLength(2);
    expect(collectTags(card)).not.toContain('action');
  });

  it('shows only the focused Codex phone remote command surface', () => {
    const help = JSON.stringify(codexRemoteHelpCard());
    for (const command of ['/projects', '/tasks', '/new', '/models', '/stop', '/status', '/help']) {
      expect(help).toContain(command);
    }
    for (const internal of ['/account', '/config', '/ps', '/exit', '/doctor', '/invite', '/remove']) {
      expect(help).not.toContain(internal);
    }
    for (const legacy of ['/reset', '/resume', '/cd', '/ws']) {
      expect(help).not.toContain(legacy);
    }
  });

  it('renders a Codex-native status card without bridge internals', () => {
    const status = JSON.stringify(codexRemoteStatusCard({
      cwd: '/tmp/demo',
      threadId: 'thread-1234567890',
      model: 'gpt-test',
      activeRun: true,
    }));
    expect(status).toContain('Codex 遥控状态');
    expect(status).toContain('/tmp/demo');
    expect(status).toContain('gpt\\\\-test');
    expect(status).not.toContain('owner API');
    expect(status).not.toContain('lark-cli');
  });
});

function collectTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectTags);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.tag === 'string' ? [record.tag] : []),
    ...Object.values(record).flatMap(collectTags),
  ];
}

function collectMarkdownContents(value: unknown): string {
  if (Array.isArray(value)) return value.map(collectMarkdownContents).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return [
    ...(record.tag === 'markdown' && typeof record.content === 'string' ? [record.content] : []),
    ...Object.values(record).map(collectMarkdownContents),
  ].join('\n');
}
