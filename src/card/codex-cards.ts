import { basename } from 'node:path';
import type { CodexModel, CodexThread } from '../codex/app-server/protocol';

export interface CodexProjectSummary {
  cwd: string;
  taskCount: number;
  updatedAt?: number;
}

export function projectsCard(projects: CodexProjectSummary[], currentCwd?: string): object {
  const visible = projects.slice(0, 20);
  return card(
    'Codex 项目',
    projects.length
      ? appendOverflow(visible.map((project) => ({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [{
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [{
              tag: 'markdown',
              content: `${project.cwd === currentCwd ? '📍 ' : ''}**${escapeMd(basename(project.cwd) || project.cwd)}**\n${escapeMd(project.cwd)} · ${project.taskCount} 个任务`,
            }],
          }, {
            tag: 'column',
            width: 'auto',
            elements: [button('打开', 'project.use', project.cwd)],
          }],
        })), projects.length, visible.length)
      : [{ tag: 'markdown', content: '还没有 Codex 项目。先在 Mac 的 Codex Desktop 中打开一个目录即可。' }],
  );
}

export function tasksCard(threads: CodexThread[], currentThreadId?: string): object {
  const visible = threads.slice(0, 20);
  return card(
    'Codex 任务',
    threads.length
      ? appendOverflow(visible.map((thread) => ({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [{
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [{
              tag: 'markdown',
              content: `${thread.id === currentThreadId ? '📍 ' : ''}**${escapeMd(threadTitle(thread))}**\n${escapeMd(shortId(thread.id))}${thread.model ? ` · ${escapeMd(thread.model)}` : ''}`,
            }],
          }, {
            tag: 'column',
            width: 'auto',
            elements: [button('继续', 'task.use', thread.id)],
          }],
        })), threads.length, visible.length)
      : [{ tag: 'markdown', content: '当前项目还没有任务。直接发送消息即可创建。' }],
  );
}

export function taskDetailCard(thread: CodexThread): object {
  const elements: object[] = [{
    tag: 'markdown',
    content: `**${escapeMd(threadTitle(thread))}**\n\n项目：${escapeMd(thread.cwd)}\n任务 ID：\`${escapeMd(thread.id)}\``,
  }];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (item.type === 'userMessage') {
        const content = Array.isArray(item.content)
          ? item.content
              .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
              .map((part) => String((part as { text?: unknown }).text ?? ''))
              .join('\n')
          : '';
        if (content) elements.push({ tag: 'markdown', content: `👤 ${truncate(content, 900)}` });
      } else if (item.type === 'agentMessage' && item.text) {
        elements.push({ tag: 'markdown', content: `🤖 ${truncate(item.text, 1600)}` });
      }
    }
  }
  return card('任务详情', elements.slice(-18));
}

export function modelsCard(models: CodexModel[], selected?: string): object {
  const visible = models.slice(0, 20);
  return card(
    '选择模型',
    appendOverflow(visible.map((model) => ({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [{
          tag: 'markdown',
          content: `${model.model === selected ? '📍 ' : ''}**${escapeMd(model.displayName)}**\n${escapeMd(model.model)}${model.isDefault ? ' · 默认' : ''}`,
        }],
      }, {
        tag: 'column',
        width: 'auto',
        elements: [button('使用', 'model.use', model.model)],
      }],
    })), models.length, visible.length),
  );
}

function appendOverflow(elements: object[], total: number, visible: number): object[] {
  if (total <= visible) return elements;
  return [
    ...elements,
    { tag: 'note', elements: [{ tag: 'plain_text', content: `另有 ${total - visible} 项未显示，请缩小项目范围后再查看。` }] },
  ];
}

function card(title: string, elements: object[]): object {
  return {
    schema: '2.0',
    config: { summary: { content: title } },
    header: {
      title: { tag: 'plain_text', content: title },
      template: 'blue',
    },
    body: { elements },
  };
}

function button(label: string, cmd: string, arg: string): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: 'primary',
    behaviors: [{ type: 'callback', value: { cmd, arg } }],
  };
}

function threadTitle(thread: CodexThread): string {
  return thread.name?.trim() || thread.preview?.trim() || '未命名任务';
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function truncate(text: string, max: number): string {
  const normalized = text.trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&');
}
