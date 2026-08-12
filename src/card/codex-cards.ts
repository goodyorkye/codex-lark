import { basename } from 'node:path';
import type { CodexModel, CodexThread } from '../codex/app-server/protocol';

export interface CodexProjectSummary {
  cwd: string;
  taskCount: number;
  updatedAt?: number;
}

export function codexRemoteHelpCard(): object {
  return card('Codex 手机遥控', [
    {
      tag: 'markdown',
      content: [
        '直接发送文字、图片或文件，会继续当前 Codex 任务。',
        '',
        '**常用命令**',
        '- `/projects` — 选择项目',
        '- `/tasks` — 选择或继续任务',
        '- `/new` — 在当前项目新建任务',
        '- `/models` — 选择模型',
        '- `/stop` — 停止当前回合',
        '- `/status` — 查看当前遥控状态',
        '- `/help` — 显示本帮助',
        '',
        '**精确操作（通常直接点卡片即可）**',
        '- `/project use <路径>`',
        '- `/task use <任务ID>` · `/task show <任务ID>`',
        '- `/model use <模型>`',
        '',
        '需要授权时直接点击审批卡片。',
      ].join('\n'),
    },
    {
      tag: 'action',
      actions: [
        actionButton('项目', 'projects'),
        actionButton('任务', 'tasks'),
        actionButton('模型', 'models'),
        actionButton('新建', 'new', 'primary'),
      ],
    },
  ]);
}

export interface CodexRemoteStatusInfo {
  cwd?: string;
  threadId?: string;
  model?: string;
  activeRun: boolean;
}

export function codexRemoteStatusCard(info: CodexRemoteStatusInfo): object {
  const project = info.cwd
    ? `**${escapeMd(basename(info.cwd) || info.cwd)}**\n${escapeMd(info.cwd)}`
    : '尚未选择，请点“项目”';
  const task = info.threadId ? `\`${escapeMd(shortId(info.threadId))}\`` : '下一条消息会新建';
  const model = info.model ? `\`${escapeMd(info.model)}\`` : 'Codex 默认模型';
  return card('Codex 遥控状态', [
    {
      tag: 'markdown',
      content: [
        `📁 **项目**：${project}`,
        `💬 **任务**：${task}`,
        `🤖 **模型**：${model}`,
        `🏃 **运行**：${info.activeRun ? '进行中' : '空闲'}`,
      ].join('\n\n'),
    },
    {
      tag: 'action',
      actions: [
        actionButton('项目', 'projects'),
        actionButton('任务', 'tasks'),
        actionButton('模型', 'models'),
        actionButton('新建', 'new', 'primary'),
      ],
    },
  ]);
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
  return actionButton(label, cmd, 'primary', arg);
}

function actionButton(
  label: string,
  cmd: string,
  type: 'primary' | 'default' = 'default',
  arg?: string,
): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type,
    behaviors: [{ type: 'callback', value: { cmd, ...(arg ? { arg } : {}) } }],
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
