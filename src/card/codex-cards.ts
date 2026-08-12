import { basename } from 'node:path';
import type { CodexModel, CodexThread, CodexThreadItem } from '../codex/app-server/protocol';
import type { CompositionSnapshot } from '../bot/composition-store';

export interface CodexProjectSummary {
  id?: string;
  name?: string;
  cwd: string;
  rootPaths?: string[];
  taskCount: number;
  updatedAt?: number;
}

export interface CodexRemoteNavigationInfo {
  cwd?: string;
  taskTitle?: string;
  hasCurrentTask?: boolean;
}

export function codexRemoteNavigationCard(info: CodexRemoteNavigationInfo = {}): object {
  return card('常用操作', codexRemoteNavigationElements(info));
}

export function codexRemoteNavigationElements(
  info: CodexRemoteNavigationInfo = {},
): object[] {
  const projectName = info.cwd ? basename(info.cwd) || info.cwd : '未选择项目';
  const current = info.taskTitle
    ? `${escapeMd(projectName)} / ${escapeMd(info.taskTitle)}`
    : escapeMd(projectName);
  return [
    { tag: 'markdown', content: `📍 **当前**：${current}`, text_size: 'notation' },
    ...remoteNavigationActions(Boolean(info.hasCurrentTask || info.taskTitle)),
  ];
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
        '- `/compose` — 开始组合输入',
        '- `/stop` — 停止当前回合',
        '- `/status` — 查看当前遥控状态',
        '- `/help` — 显示本帮助',
        '',
        '**精确操作（通常直接点卡片即可）**',
        '- `/project use <路径>`',
        '- `/task use <任务ID>` · `/task show <任务ID>`',
        '- `/task latest` — 查看当前任务最近一轮',
        '- `/model select <模型>` · `/model effort <模型> <推理强度>`',
        '',
        '需要授权时直接点击审批卡片。',
      ].join('\n'),
    },
    ...remoteNavigationActions(),
  ]);
}

export interface CodexRemoteStatusInfo {
  cwd?: string;
  threadId?: string;
  model?: string;
  reasoningEffort?: string;
  activeRun: boolean;
}

export function codexRemoteStatusCard(info: CodexRemoteStatusInfo): object {
  const project = info.cwd
    ? `**${escapeMd(basename(info.cwd) || info.cwd)}**\n${escapeMd(info.cwd)}`
    : '尚未选择，请点“项目”';
  const task = info.threadId ? `\`${escapeMd(shortId(info.threadId))}\`` : '下一条消息会新建';
  const model = info.model
    ? `\`${escapeMd(info.model)}\`${info.reasoningEffort ? ` · ${escapeMd(effortLabel(info.reasoningEffort))}` : ''}`
    : 'Codex 默认模型';
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
    ...remoteNavigationActions(Boolean(info.threadId)),
  ]);
}

export function projectsCard(
  projects: CodexProjectSummary[],
  currentCwd?: string,
  requestedPage = 1,
): object {
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(projects.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage) || 1));
  const visible = projects.slice((page - 1) * pageSize, page * pageSize);
  const rows: object[] = visible.map((project) => {
    const roots = project.rootPaths?.length ? project.rootPaths : [project.cwd];
    const selected = roots.includes(currentCwd ?? '');
    const detail = roots.length > 1
      ? `${roots.length} 个目录 · ${project.taskCount} 个任务`
      : `${escapeMd(project.cwd)} · ${project.taskCount} 个任务`;
    return {
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column',
        width: 'weighted',
        weight: 1,
        elements: [{
          tag: 'markdown',
          content: `${selected ? '📍 ' : ''}**${escapeMd(project.name || basename(project.cwd) || project.cwd)}**\n${detail}`,
        }],
      }, {
        tag: 'column',
        width: 'auto',
        elements: [button('选择', 'project.use', project.cwd)],
      }],
    };
  });
  if (projects.length && pageCount > 1) {
    rows.push({
      tag: 'markdown',
      content: `第 ${page}/${pageCount} 页 · 共 ${projects.length} 个项目`,
    });
    rows.push(buttonRow([
      ...(page > 1 ? [actionButton('上一页', 'projects.page', 'default', String(page - 1))] : []),
      ...(page < pageCount ? [actionButton('下一页', 'projects.page', 'primary', String(page + 1))] : []),
    ]));
  }
  return card(
    '项目列表',
    (projects.length
      ? rows
      : [{ tag: 'markdown', content: '还没有 Codex 项目。先在 Mac 的 Codex Desktop 中打开一个目录即可。' }])
      .concat([navigationActions('tasks.recent')]),
  );
}

export function tasksCard(
  threads: CodexThread[],
  currentThreadId?: string,
  cwd?: string,
  requestedPage = 1,
): object {
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(threads.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage) || 1));
  const visible = threads.slice((page - 1) * pageSize, page * pageSize);
  const rows: object[] = visible.map((thread) => ({
    tag: 'column_set',
    flex_mode: 'none',
    columns: [{
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [{
        tag: 'markdown',
        content: `${thread.id === currentThreadId ? '📍 ' : ''}**${escapeMd(threadTitle(thread))}**\n${taskListMetadata(thread)}`,
      }],
    }, {
      tag: 'column',
      width: 'auto',
      elements: [button('继续', 'task.use', thread.id)],
    }],
  }));
  if (threads.length && pageCount > 1) {
    rows.push({
      tag: 'markdown',
      content: `第 ${page}/${pageCount} 页 · 共 ${threads.length} 个任务`,
    });
    rows.push(buttonRow([
      ...(page > 1 ? [actionButton('上一页', 'tasks.page', 'default', String(page - 1))] : []),
      ...(page < pageCount ? [actionButton('下一页', 'tasks.page', 'primary', String(page + 1))] : []),
    ]));
  }
  return card(
    cwd ? `${basename(cwd) || cwd} · 任务列表` : '任务列表',
    (threads.length
      ? rows
      : [{ tag: 'markdown', content: '当前项目还没有任务。直接发送消息即可创建。' }])
      .concat([navigationActions('tasks.recent')]),
  );
}

export function recentTasksCard(threads: CodexThread[], currentThreadId?: string): object {
  const sorted = [...threads]
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  const visible = sorted.slice(0, 15);
  return card(
    '最近任务',
    (visible.length
      ? appendOverflow(visible.map((thread) => ({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [{
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [{
              tag: 'markdown',
              content: `${thread.id === currentThreadId ? '📍 ' : ''}**${escapeMd(threadTitle(thread))}**\n${escapeMd(basename(thread.cwd) || thread.cwd)} · ${relativeTime(thread.updatedAt ?? thread.createdAt)}`,
            }],
          }, {
            tag: 'column',
            width: 'auto',
            elements: [button('继续', 'task.use', thread.id)],
          }],
        })), sorted.length, visible.length)
      : [{ tag: 'markdown', content: '还没有可继续的 Codex 任务。' }])
      .concat([navigationActions('projects')]),
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

export function latestTurnCard(thread: CodexThread): object {
  const turn = [...(thread.turns ?? [])]
    .reverse()
    .find((candidate) => (candidate.items ?? []).some(isConversationItem));
  if (!turn) {
    return card('最近一轮', [{ tag: 'markdown', content: '当前任务还没有可显示的对话记录。' }]);
  }
  const elements: object[] = [{
    tag: 'markdown',
    content: `**${escapeMd(threadTitle(thread))}**`,
  }];
  for (const item of turn.items ?? []) {
    if (item.type === 'userMessage') {
      const text = userMessageText(item);
      if (text) elements.push({ tag: 'markdown', content: `**你**\n${truncate(text, 1800)}` });
    } else if (item.type === 'agentMessage' && item.text?.trim()) {
      elements.push({ tag: 'markdown', content: `**Codex**\n${truncate(item.text, 3000)}` });
    }
  }
  return card('最近一轮', elements);
}

export function compositionInputCard(
  state: CompositionSnapshot,
  terminal?: 'sent' | 'queued' | 'cancelled',
): object {
  const counts = compositionInputSummary(state);
  if (terminal === 'sent') {
    return card('组合输入', [{ tag: 'markdown', content: `✅ 已提交，将作为同一轮发送给 Codex。\n\n${counts}` }]);
  }
  if (terminal === 'queued') {
    return card('组合输入', [{ tag: 'markdown', content: `✅ 已组合完成，将在当前回复结束后作为同一轮发送。\n\n${counts}` }]);
  }
  if (terminal === 'cancelled') {
    return card('组合输入', [{ tag: 'markdown', content: `已退出组合输入，未发送已收集的内容。\n\n${counts}` }]);
  }
  return card('组合输入', [
    {
      tag: 'markdown',
      content: `继续发送文字、图片或文件，它们暂时不会交给 Codex。完成后点击“发送”，也可以直接回复“发送”。\n\n${counts}`,
    },
    buttonRow([
      actionButton('发送', 'compose.send', 'primary'),
      actionButton('撤销', 'compose.undo'),
    ]),
    buttonRow([
      actionButton('清空', 'compose.clear'),
      actionButton('退出', 'compose.cancel'),
    ]),
  ]);
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
          content: `${model.model === selected ? '📍 ' : ''}**${escapeMd(model.displayName)}**\n${escapeMd(model.model)}${model.isDefault ? ' · 默认模型' : ''}${model.supportedReasoningEfforts?.length ? ` · ${model.supportedReasoningEfforts.length} 档推理强度` : ''}`,
        }],
      }, {
        tag: 'column',
        width: 'auto',
        elements: [button('选择', 'model.select', model.model)],
      }],
    })), models.length, visible.length),
  );
}

export function reasoningEffortsCard(
  model: CodexModel,
  selectedEffort?: string,
): object {
  const efforts = model.supportedReasoningEfforts ?? [];
  return card('选择推理强度', [
    {
      tag: 'markdown',
      content: `**${escapeMd(model.displayName)}**\n${escapeMd(model.model)}`,
    },
    ...(efforts.length
      ? efforts.map((entry) => ({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [{
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [{
              tag: 'markdown',
              content: `${entry.reasoningEffort === selectedEffort ? '📍 ' : ''}**${escapeMd(effortLabel(entry.reasoningEffort))}**${entry.reasoningEffort === model.defaultReasoningEffort ? ' · 默认' : ''}${entry.description ? `\n${escapeMd(entry.description)}` : ''}`,
            }],
          }, {
            tag: 'column',
            width: 'auto',
            elements: [button('选择', 'model.effort', `${model.model} ${entry.reasoningEffort}`)],
          }],
        }))
      : [{ tag: 'markdown', content: '该模型没有可选的推理强度。' }]),
    buttonRow([actionButton('返回模型', 'models')]),
  ]);
}

function appendOverflow(elements: object[], total: number, visible: number): object[] {
  if (total <= visible) return elements;
  return [
    ...elements,
    { tag: 'markdown', content: `另有 ${total - visible} 项未显示，请缩小项目范围后再查看。`, text_size: 'notation' },
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

function navigationActions(primaryCommand: 'projects' | 'tasks.recent'): object {
  return buttonRow([
    actionButton(primaryCommand === 'projects' ? '项目' : '最近任务', primaryCommand, 'primary'),
    actionButton('新建', 'new'),
    actionButton('模型', 'models'),
  ]);
}

function remoteNavigationActions(hasCurrentTask = false): object[] {
  return [
    buttonRow([
      actionButton('最近任务', 'tasks.recent', 'primary'),
      actionButton('选择项目', 'projects'),
    ]),
    buttonRow([
      actionButton('新建任务', 'new'),
      actionButton('切换模型', 'models'),
    ]),
    buttonRow([
      ...(hasCurrentTask ? [actionButton('最近一轮', 'task.latest')] : []),
      actionButton('组合输入', 'compose.start', hasCurrentTask ? 'default' : 'primary'),
    ]),
  ];
}

export function compositionInputSummary(state: CompositionSnapshot): string {
  const parts = [
    `${state.textSegments} 段文字`,
    `${state.images} 张图片`,
    `${state.files} 个文件`,
  ];
  return `**已收集**：${parts.join(' · ')}`;
}

function buttonRow(buttons: object[]): object {
  return {
    tag: 'column_set',
    flex_mode: 'none',
    columns: buttons.map((entry) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [entry],
    })),
  };
}

function threadTitle(thread: CodexThread): string {
  return thread.name?.trim() || thread.preview?.trim() || '未命名任务';
}

function isConversationItem(item: CodexThreadItem): boolean {
  return item.type === 'agentMessage'
    ? Boolean(item.text?.trim())
    : item.type === 'userMessage' && Boolean(userMessageText(item));
}

function userMessageText(item: CodexThreadItem): string {
  return Array.isArray(item.content)
    ? item.content
        .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
        .map((part) => String((part as { text?: unknown }).text ?? ''))
        .filter(Boolean)
        .join('\n')
        .trim()
    : '';
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function taskListMetadata(thread: CodexThread): string {
  const updated = `最近更新：${relativeTime(thread.updatedAt ?? thread.createdAt)}`;
  return thread.model
    ? `${updated} · 模型：${escapeMd(thread.model)}`
    : updated;
}

function effortLabel(effort: string): string {
  const labels: Record<string, string> = {
    minimal: '极简',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
  };
  return labels[effort] ?? effort;
}

function truncate(text: string, max: number): string {
  const normalized = text.trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function relativeTime(timestamp: number | undefined): string {
  if (!timestamp) return '时间未知';
  const value = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const elapsed = Math.max(0, Date.now() - value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&');
}
