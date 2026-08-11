import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { AgentPreflightError, type AgentAvailability } from '../preflight';
import { CodexAppServerClient } from '../../codex/app-server/client';
import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexModel,
  CodexThread,
  CodexThreadItem,
  JsonRpcId,
  JsonRpcMessage,
} from '../../codex/app-server/protocol';
import { rpcIdKey } from '../../codex/app-server/protocol';
import { discoverDesktopBinary, type DesktopBinaryLocation } from '../../codex/desktop-binary';
import { activateDesktopThread } from '../../codex/desktop-route';

export interface CodexAppServerAdapterOptions {
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  client?: CodexAppServerClient;
  discoverBinary?: () => Promise<DesktopBinaryLocation>;
}

interface ActiveTurn {
  threadId: string;
  turnId: string;
}

/** App Server backed adapter that reuses the executable and login owned by Codex Desktop. */
export class CodexAppServerAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex Desktop';

  private readonly options: CodexAppServerAdapterOptions;
  private client: CodexAppServerClient | undefined;
  private binary: DesktopBinaryLocation | undefined;
  private readonly approvalIds = new Map<string, JsonRpcId>();
  private readonly approvalTokensByRequest = new Map<string, string>();

  constructor(options: CodexAppServerAdapterOptions = {}) {
    this.options = options;
    this.client = options.client;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).ok;
  }

  async checkAvailability(): Promise<AgentAvailability> {
    try {
      await this.ensureClient();
      return { ok: true };
    } catch (error) {
      const diagnostic = {
        code: 'agent-binary-not-found' as const,
        agentId: 'codex' as const,
        agentName: 'Codex Desktop',
        command: 'ChatGPT.app/Contents/Resources/codex app-server',
        ...(this.options.binaryPath ? { binaryPath: this.options.binaryPath } : {}),
      };
      return {
        ok: false,
        error: new AgentPreflightError(
          diagnostic,
          error instanceof Error ? error.message : String(error),
        ),
        diagnostic,
      };
    }
  }

  async prepareRun(): Promise<void> {
    const client = await this.ensureClient();
    await client.start();
  }

  run(options: AgentRunOptions): AgentRun {
    const queue = new AsyncEventQueue<AgentEvent>();
    let active: ActiveTurn | undefined;
    let stopped = false;

    const execute = async (): Promise<void> => {
      try {
        const client = await this.ensureClient();
        await client.start();
        if (stopped) return;

        const isNewThread = !options.threadId;
        const thread = options.threadId
          ? await client.resumeThread(options.threadId, {
              cwd: options.cwd,
              model: options.model,
              approvalPolicy: approvalPolicyFor(options),
              sandbox: options.sandbox,
            })
          : await client.startThread({
              cwd: requiredCwd(options),
              model: options.model,
              approvalPolicy: approvalPolicyFor(options),
              sandbox: options.sandbox,
            });
        if (isNewThread) activateDesktopThread(thread.id, this.options.env);
        queue.push({
          type: 'system',
          threadId: thread.id,
          cwd: thread.cwd || options.cwd,
          model: options.model,
        });

        const streamedAgentItems = new Set<string>();
        const bufferedMessages: JsonRpcMessage[] = [];
        const bufferedApprovals: ApprovalRequest[] = [];
        const onMessage = (message: JsonRpcMessage): void => {
          if (!active) {
            bufferedMessages.push(message);
            return;
          }
          if (!message.method || !message.params) return;
          if (message.method === 'serverRequest/resolved') {
            const requestId = message.params.requestId;
            if (typeof requestId === 'string' || typeof requestId === 'number') {
              const key = rpcIdKey(requestId);
              const approvalId = this.approvalTokensByRequest.get(key);
              if (approvalId) {
                queue.push({ type: 'approval_resolved', approvalId });
                this.approvalIds.delete(approvalId);
                this.approvalTokensByRequest.delete(key);
              }
            }
          }
          if (!belongsToTurn(message.params, active)) return;
          for (const event of translateMessage(message, streamedAgentItems)) queue.push(event);
          if (message.method === 'turn/completed') {
            client.off('message', onMessage);
            client.off('approval', onApproval);
            queue.end();
          }
        };
        const onApproval = (approval: ApprovalRequest): void => {
          if (!active) {
            bufferedApprovals.push(approval);
            return;
          }
          if (approval.threadId !== active.threadId || approval.turnId !== active.turnId) return;
          const approvalId = randomUUID();
          this.approvalIds.set(approvalId, approval.requestId);
          this.approvalTokensByRequest.set(rpcIdKey(approval.requestId), approvalId);
          queue.push({
            type: 'approval_request',
            approvalId,
            title: approval.title,
            detail: approval.detail,
            allowForSession: approval.method !== 'item/permissions/requestApproval',
          });
        };
        client.on('message', onMessage);
        client.on('approval', onApproval);

        const turn = await client.startTurn({
          threadId: thread.id,
          text: options.prompt,
          images: options.images,
          cwd: options.cwd,
          model: options.model,
          approvalPolicy: approvalPolicyFor(options),
        });
        active = { threadId: thread.id, turnId: turn.id };
        for (const approval of bufferedApprovals.splice(0)) onApproval(approval);
        for (const message of bufferedMessages.splice(0)) onMessage(message);
        if (stopped && !queue.isEnded()) {
          await client.interruptTurn(active.threadId, active.turnId).catch(() => {});
          client.off('message', onMessage);
          client.off('approval', onApproval);
          queue.push({ type: 'done', threadId: active.threadId, terminationReason: 'interrupted' });
          queue.end();
        }
      } catch (error) {
        queue.push({
          type: 'error',
          message: friendlyError(error),
          terminationReason: stopped ? 'interrupted' : 'failed',
        });
        queue.end();
      }
    };
    void execute();

    return {
      runId: options.runId,
      events: queue,
      stop: async () => {
        stopped = true;
        if (active) {
          await (await this.ensureClient()).interruptTurn(active.threadId, active.turnId).catch(() => {});
        } else {
          queue.push({ type: 'done', terminationReason: 'interrupted' });
          queue.end();
        }
      },
      waitForExit: async (timeoutMs: number) => {
        if (queue.isEnded()) return true;
        return Promise.race([
          queue.finished().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ]);
      },
    };
  }

  async listThreads(options: { cwd?: string; limit?: number } = {}): Promise<CodexThread[]> {
    const client = await this.ensureClient();
    await client.start();
    return (await client.listThreads(options)).data;
  }

  async readThread(threadId: string): Promise<CodexThread> {
    const client = await this.ensureClient();
    await client.start();
    return client.readThread(threadId);
  }

  async listModels(): Promise<CodexModel[]> {
    const client = await this.ensureClient();
    await client.start();
    return client.listModels();
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const requestId = this.approvalIds.get(approvalId);
    if (requestId === undefined) throw new Error('审批请求已过期或已处理。');
    await (await this.ensureClient()).resolveApproval(requestId, decision);
  }

  async shutdown(): Promise<void> {
    await this.client?.stop();
  }

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.client) return this.client;
    this.binary = this.options.binaryPath
      ? { binaryPath: this.options.binaryPath, appPath: '', appName: 'custom' }
      : await (this.options.discoverBinary ?? discoverDesktopBinary)();
    this.client = new CodexAppServerClient({
      binaryPath: this.binary.binaryPath,
      env: this.options.env,
    });
    return this.client;
  }
}

function requiredCwd(options: AgentRunOptions): string {
  if (!options.cwd) throw new Error('Codex task requires a project directory.');
  return options.cwd;
}

function approvalPolicyFor(options: AgentRunOptions): string {
  return options.sandbox === 'danger-full-access' ? 'never' : 'on-request';
}

function belongsToTurn(params: Record<string, unknown>, active: ActiveTurn): boolean {
  const threadId = String(params.threadId ?? '');
  const turn = params.turn as Record<string, unknown> | undefined;
  const turnId = String(params.turnId ?? turn?.id ?? '');
  return threadId === active.threadId && (!turnId || turnId === active.turnId);
}

function translateMessage(message: JsonRpcMessage, streamed: Set<string>): AgentEvent[] {
  const params = message.params ?? {};
  if (message.method === 'item/agentMessage/delta') {
    if (params.itemId) streamed.add(String(params.itemId));
    return [{ type: 'text', delta: String(params.delta ?? '') }];
  }
  if (message.method === 'item/reasoning/summaryTextDelta' || message.method === 'item/reasoning/textDelta') {
    return [{ type: 'thinking', delta: String(params.delta ?? '') }];
  }
  if (message.method === 'item/started') {
    const item = params.item as CodexThreadItem | undefined;
    const tool = item && toolStart(item);
    return tool ? [tool] : [];
  }
  if (message.method === 'item/completed') {
    const item = params.item as CodexThreadItem | undefined;
    if (!item) return [];
    if (item.type === 'agentMessage' && item.id && !streamed.has(item.id) && item.text) {
      return [{ type: 'text', delta: item.text }];
    }
    const result = toolResult(item);
    return result ? [result] : [];
  }
  if (message.method === 'thread/tokenUsage/updated') {
    const usage = (params.tokenUsage ?? params.usage ?? {}) as Record<string, unknown>;
    return [{
      type: 'usage',
      inputTokens: numberValue(usage.inputTokens ?? usage.input_tokens),
      outputTokens: numberValue(usage.outputTokens ?? usage.output_tokens),
      cachedInputTokens: numberValue(usage.cachedInputTokens ?? usage.cached_input_tokens),
      reasoningOutputTokens: numberValue(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens),
    }];
  }
  if (message.method === 'turn/completed') {
    const turn = params.turn as Record<string, unknown> | undefined;
    const status = String(turn?.status ?? 'completed');
    if (status === 'failed') {
      const error = turn?.error as Record<string, unknown> | undefined;
      return [{
        type: 'error',
        message: String(error?.message ?? 'Codex task failed.'),
        terminationReason: 'failed',
      }];
    }
    return [{
      type: 'done',
      threadId: String(params.threadId ?? ''),
      terminationReason: status === 'interrupted' ? 'interrupted' : 'normal',
    }];
  }
  if (message.method === 'error') {
    const error = params.error as Record<string, unknown> | undefined;
    return [{
      type: 'error',
      message: String(error?.message ?? params.message ?? 'Codex App Server error.'),
      terminationReason: 'failed',
    }];
  }
  return [];
}

function toolStart(item: CodexThreadItem): AgentEvent | undefined {
  const id = item.id ?? randomUUID();
  if (item.type === 'commandExecution') {
    return { type: 'tool_use', id, name: 'shell', input: { command: item.command, cwd: item.cwd } };
  }
  if (item.type === 'fileChange') {
    return { type: 'tool_use', id, name: 'apply_patch', input: { changes: item.changes } };
  }
  if (item.type === 'mcpToolCall') {
    return {
      type: 'tool_use',
      id,
      name: `mcp__${item.server ?? 'server'}__${item.tool ?? 'tool'}`,
      input: item.arguments,
    };
  }
  if (item.type === 'dynamicToolCall' || item.type === 'collabAgentToolCall') {
    return { type: 'tool_use', id, name: String(item.tool ?? item.type), input: item.arguments ?? item };
  }
  if (item.type === 'webSearch') return { type: 'tool_use', id, name: 'web_search', input: item };
  if (item.type === 'imageGeneration') return { type: 'tool_use', id, name: 'image_generation', input: item };
  return undefined;
}

function toolResult(item: CodexThreadItem): AgentEvent | undefined {
  if (!item.id) return undefined;
  if (item.type === 'commandExecution') {
    return {
      type: 'tool_result',
      id: item.id,
      output: item.aggregatedOutput ?? '',
      isError: item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0),
    };
  }
  if (item.type === 'fileChange') {
    return {
      type: 'tool_result',
      id: item.id,
      output: JSON.stringify(item.changes ?? []),
      isError: item.status === 'failed' || item.status === 'declined',
    };
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall' || item.type === 'collabAgentToolCall') {
    return {
      type: 'tool_result',
      id: item.id,
      output: stringifyResult(item.result ?? item.error ?? item),
      isError: Boolean(item.error) || item.status === 'failed',
    };
  }
  if (item.type === 'webSearch' || item.type === 'imageGeneration') {
    return { type: 'tool_result', id: item.id, output: stringifyResult(item), isError: false };
  }
  return undefined;
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|login|unauthorized|401/i.test(message)) {
    return 'ChatGPT/Codex Desktop 尚未登录或登录已失效。请在 Mac 桌面应用中完成登录后重试。';
  }
  return message;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private readonly endCallbacks: Array<() => void> = [];
  private ended = false;
  private finishedPromise: Promise<void>;
  private finish!: () => void;

  constructor() {
    this.finishedPromise = new Promise<void>((resolve) => {
      this.finish = resolve;
    });
  }

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
    for (const callback of this.endCallbacks.splice(0)) callback();
    this.finish();
  }

  onEnd(callback: () => void): void {
    if (this.ended) callback();
    else this.endCallbacks.push(callback);
  }

  isEnded(): boolean {
    return this.ended;
  }

  finished(): Promise<void> {
    return this.finishedPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.ended) return { done: true, value: undefined };
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
