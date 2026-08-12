import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';
import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexModel,
  CodexThread,
  JsonRpcId,
  JsonRpcMessage,
} from './protocol';
import { rpcIdKey } from './protocol';
import remodexLiveOwner from '../../vendor/remodex-ipc/desktop-ipc-live-owner.cjs';
import remodexActionFollower from '../../vendor/remodex-ipc/desktop-ipc-action-follower.cjs';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface AppServerClientOptions {
  binaryPath: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  spawnImpl?: typeof spawn;
}

export interface ThreadListOptions {
  cursor?: string | null;
  limit?: number;
  cwd?: string;
  archived?: boolean;
  searchTerm?: string;
}

export interface StartThreadOptions {
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  approvalPolicy?: string;
  sandbox?: string;
}

export interface StartTurnOptions {
  threadId: string;
  text: string;
  images?: readonly string[];
  audios?: readonly string[];
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  approvalPolicy?: string;
  sandboxPolicy?: Record<string, unknown>;
}

export class CodexAppServerClient extends EventEmitter {
  private readonly options: AppServerClientOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private nextId = 1;
  private startPromise: Promise<void> | undefined;
  private closed = false;
  private readonly desktopIpc: DesktopIpcLiveOwner;
  private readonly desktopFollower: DesktopIpcActionFollower;

  constructor(options: AppServerClientOptions) {
    super();
    this.options = options;
    const enabled = options.env?.CODEX_LARK_DESKTOP_IPC !== '0'
      && process.env.CODEX_LARK_DESKTOP_IPC !== '0';
    const socketOverride = options.env?.CODEX_LARK_DESKTOP_IPC_SOCKET
      ?? process.env.CODEX_LARK_DESKTOP_IPC_SOCKET;
    this.desktopIpc = remodexLiveOwner.createDesktopIpcLiveOwner({
      enabled,
      sendCodexRequest: (method: string, params: Record<string, unknown>) =>
        this.request(method, params),
      sendRawCodexMessage: (raw: string) => this.sendRaw(raw),
      ...(socketOverride ? { socketPath: () => [socketOverride] } : {}),
      logPrefix: '[codex-lark]',
    }) as DesktopIpcLiveOwner;
    this.desktopFollower = enabled
      ? remodexActionFollower.createDesktopIpcActionFollower({
          sendApplicationResponse: (raw: string) => this.handleLine(raw, false),
          forwardToLocalCodex: (raw: string) => this.sendRaw(raw),
          isLocallyOwnedThread: (threadId: string) => this.desktopIpc.isThreadOwned(threadId),
          ...(socketOverride ? { socketPath: () => [socketOverride] } : {}),
          logPrefix: '[codex-lark]',
        }) as DesktopIpcActionFollower
      : disabledDesktopFollower();
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    this.closed = false;
    const spawnImpl = this.options.spawnImpl ?? spawn;
    const child = spawnImpl(this.options.binaryPath, ['app-server', '--listen', 'stdio://'], {
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) this.emit('stderr', text);
    });
    child.once('error', (error) => this.handleClose(error));
    child.once('close', (code, signal) => {
      if (this.closed) return;
      this.handleClose(
        new Error(`Codex App Server stopped unexpectedly (code=${code}, signal=${signal ?? 'none'}).`),
      );
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });

    await this.request('initialize', {
      clientInfo: { name: 'codex_lark', title: 'codex-lark', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
      },
    });
    this.notify('initialized', {});
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.child && method !== 'initialize') await this.start();
    const id = this.nextId++;
    const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(rpcIdKey(id));
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(rpcIdKey(id), {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });
    this.send({ id, method, params });
    return response;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.send({ method, params });
  }

  async listThreads(options: ThreadListOptions = {}): Promise<{
    data: CodexThread[];
    nextCursor: string | null;
  }> {
    return this.request('thread/list', {
      cursor: options.cursor ?? null,
      limit: options.limit ?? 50,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(typeof options.archived === 'boolean' ? { archived: options.archived } : {}),
      ...(options.searchTerm ? { searchTerm: options.searchTerm } : {}),
    });
  }

  async readThread(threadId: string): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>('thread/read', {
      threadId,
      includeTurns: true,
    });
    return result.thread;
  }

  async startThread(options: StartThreadOptions): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>('thread/start', {
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    });
    return result.thread;
  }

  async resumeThread(threadId: string, options: Omit<StartThreadOptions, 'cwd'> & { cwd?: string } = {}): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>('thread/resume', {
      threadId,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    });
    return result.thread;
  }

  async resumeDesktopOwnedThread(
    threadId: string,
    options: Omit<StartThreadOptions, 'cwd'> & { cwd?: string } = {},
  ): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>('thread/resume', {
      threadId,
      codexLarkDesktopHandoff: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    });
    return result.thread;
  }

  /**
   * Wait briefly for Codex Desktop to publish the live snapshot requested by a
   * preceding thread/resume. Desktop may already hold the rollout writer while
   * its IPC snapshot is still in flight; once this returns true, retrying the
   * resume is served by the Desktop follower instead of the local app-server.
   */
  async waitForDesktopThreadState(threadId: string, timeoutMs = 2_500): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() <= deadline) {
      if (this.desktopFollower.hasLiveThreadState?.(threadId)) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.request('thread/name/set', { threadId, name });
  }

  async startTurn(options: StartTurnOptions): Promise<{ id: string; status?: string }> {
    const input: Array<Record<string, unknown>> = [];
    if (options.text.trim() || (!(options.images?.length) && !(options.audios?.length))) {
      input.push({ type: 'text', text: options.text });
    }
    for (const path of options.images ?? []) input.push({ type: 'localImage', path });
    for (const path of options.audios ?? []) input.push({ type: 'localAudio', path });
    const result = await this.request<{ turn: { id: string; status?: string } }>('turn/start', {
      threadId: options.threadId,
      input,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.sandboxPolicy ? { sandboxPolicy: options.sandboxPolicy } : {}),
    });
    return result.turn;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request('turn/interrupt', { threadId, turnId });
  }

  async listModels(): Promise<CodexModel[]> {
    const result = await this.request<{ data: CodexModel[] }>('model/list', {
      limit: 100,
      includeHidden: false,
    });
    return result.data;
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()];
  }

  async resolveApproval(requestId: JsonRpcId, decision: ApprovalDecision): Promise<void> {
    const key = rpcIdKey(requestId);
    const approval = this.approvals.get(key);
    if (!approval) throw new Error('审批请求已经处理或已过期。');

    let result: Record<string, unknown>;
    if (approval.method === 'item/permissions/requestApproval') {
      const requested = approval.params.permissions as Record<string, unknown> | undefined;
      const permissions = decision === 'accept' || decision === 'acceptForSession'
        ? compactPermissions(requested)
        : {};
      result = {
        permissions,
        scope: decision === 'acceptForSession' ? 'session' : 'turn',
      };
    } else {
      result = { decision };
    }
    this.send({ id: requestId, result });
    this.approvals.delete(key);
  }

  async stop(): Promise<void> {
    this.closed = true;
    await Promise.resolve(this.desktopFollower.stopAll()).catch(() => {});
    await Promise.resolve(this.desktopIpc.stopAll()).catch(() => {});
    this.lines?.close();
    this.lines = undefined;
    const child = this.child;
    this.child = undefined;
    this.startPromise = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        resolve();
      }, 3_000);
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private send(message: JsonRpcMessage): void {
    const raw = JSON.stringify(message);
    if (this.desktopFollower.observeInbound(raw, message)) return;
    this.desktopIpc.observeInbound(raw, message);
    this.writeRaw(`${raw}\n`);
  }

  private sendRaw(raw: string): void {
    this.writeRaw(raw.endsWith('\n') ? raw : `${raw}\n`);
  }

  private writeRaw(raw: string): void {
    const child = this.child;
    if (!child?.stdin.writable || child.stdin.destroyed || child.stdin.writableEnded) {
      throw new Error('Codex App Server is not connected.');
    }
    child.stdin.write(raw);
  }

  private handleLine(line: string, localAppServer = true): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit('protocolError', new Error(`Invalid JSON from Codex App Server: ${line.slice(0, 200)}`));
      return;
    }
    if (localAppServer) this.desktopIpc.observeOutbound(line, message);

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(rpcIdKey(message.id));
      if (!pending) return;
      this.pending.delete(rpcIdKey(message.id));
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method && isApprovalMethod(message.method)) {
      const approval = toApprovalRequest(message.id, message.method, message.params ?? {});
      this.approvals.set(rpcIdKey(message.id), approval);
      this.emit('approval', approval);
      this.emit('message', message);
      return;
    }

    this.emit('message', message);
    if (message.method) this.emit('notification', message.method, message.params ?? {});
  }

  private handleClose(error: Error): void {
    this.child = undefined;
    this.startPromise = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.approvals.clear();
    this.emit('close', error);
  }
}

interface DesktopIpcLiveOwner {
  observeInbound(raw: string, parsed?: JsonRpcMessage): void;
  observeOutbound(raw: string, parsed?: JsonRpcMessage): void;
  stopAll(): void | Promise<void>;
  isThreadOwned(threadId: string): boolean;
}

interface DesktopIpcActionFollower {
  observeInbound(raw: string, parsed?: JsonRpcMessage): boolean;
  stopAll(): void | Promise<void>;
  hasLiveThreadState?(threadId: string): boolean;
}

function disabledDesktopFollower(): DesktopIpcActionFollower {
  return {
    observeInbound: () => false,
    stopAll: () => {},
    hasLiveThreadState: () => false,
  };
}

function isApprovalMethod(method: string): method is ApprovalRequest['method'] {
  return method === 'item/commandExecution/requestApproval'
    || method === 'item/fileChange/requestApproval'
    || method === 'item/fileRead/requestApproval'
    || method === 'item/permissions/requestApproval';
}

function toApprovalRequest(
  requestId: JsonRpcId,
  method: ApprovalRequest['method'],
  params: Record<string, unknown>,
): ApprovalRequest {
  const threadId = String(params.threadId ?? '');
  const turnId = String(params.turnId ?? '');
  const itemId = String(params.itemId ?? '');
  if (method === 'item/commandExecution/requestApproval') {
    const network = params.networkApprovalContext as Record<string, unknown> | undefined;
    const title = network ? '网络访问审批' : '命令执行审批';
    const detail = network
      ? `${String(network.protocol ?? 'network')}://${String(network.host ?? 'unknown')}`
      : [params.command, params.cwd, params.reason].filter(Boolean).map(String).join('\n');
    return { requestId, method, threadId, turnId, itemId, title, detail, params };
  }
  if (method === 'item/fileChange/requestApproval' || method === 'item/fileRead/requestApproval') {
    const detail = [params.reason, params.grantRoot].filter(Boolean).map(String).join('\n');
    return {
      requestId,
      method,
      threadId,
      turnId,
      itemId,
      title: method === 'item/fileRead/requestApproval' ? '文件读取审批' : '文件修改审批',
      detail,
      params,
    };
  }
  const detail = [params.reason, params.cwd, JSON.stringify(params.permissions ?? {})]
    .filter(Boolean)
    .map(String)
    .join('\n');
  return { requestId, method, threadId, turnId, itemId, title: '权限申请', detail, params };
}

function compactPermissions(requested: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!requested) return {};
  const granted: Record<string, unknown> = {};
  if (requested.network) granted.network = requested.network;
  if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
  return granted;
}
