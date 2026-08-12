import { readFile } from 'node:fs/promises';
import { paths } from '../config/paths';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';

export interface SessionEntry {
  /** May be absent if the entry was created by /timeout before any run
   * recorded a session id. Treat absence as "no resumable session". */
  sessionId?: string;
  /** Pinned cwd for the resumable session. Absent for the same reason. */
  cwd?: string;
  updatedAt: number;
  /** Per-scope idle-timeout override (minutes). 0 = explicitly off for this
   * scope, undefined = follow global default. Session resets preserve this
   * scope preference while removing the resumable session id/cwd. */
  idleTimeoutMinutes?: number;
  /** Optional per-scope model selected from Codex App Server's model catalog. */
  model?: string;
  /** Optional reasoning effort selected for the active Codex model. */
  reasoningEffort?: string;
  /** Thread receiving the explicit override. Absent means defaults for the next new task. */
  modelThreadId?: string;
}

type SessionMap = Record<string, SessionEntry>;

export class SessionStore {
  private data: SessionMap = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = paths.sessionsFile) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const raw = JSON.parse(text) as Record<string, Partial<SessionEntry>>;
      this.data = {};
      for (const [chatId, entry] of Object.entries(raw)) {
        if (!entry || typeof entry.updatedAt !== 'number') continue;
        // Drop entries without a `cwd`/`sessionId` pair *unless* there's
        // some other persisted state worth keeping (e.g. an idle-timeout
        // override). Resuming a session whose cwd we don't know about
        // would hang claude on a missing jsonl, so resume keys still need
        // the full pair; but a bare timeout override is fine on its own.
        const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : undefined;
        const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined;
        const idleTimeoutMinutes =
          typeof entry.idleTimeoutMinutes === 'number' ? entry.idleTimeoutMinutes : undefined;
        const model = typeof entry.model === 'string' && entry.model.trim() ? entry.model : undefined;
        const reasoningEffort = typeof entry.reasoningEffort === 'string' && entry.reasoningEffort.trim()
          ? entry.reasoningEffort
          : undefined;
        const modelThreadId = typeof entry.modelThreadId === 'string' && entry.modelThreadId.trim()
          ? entry.modelThreadId
          : undefined;
        const hasSession = sessionId !== undefined && cwd !== undefined;
        if (!hasSession && idleTimeoutMinutes === undefined && model === undefined && reasoningEffort === undefined) continue;
        this.data[chatId] = {
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
          updatedAt: entry.updatedAt,
          ...(idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          ...(modelThreadId !== undefined ? { modelThreadId } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Return the session id for this chat if it was created in the given cwd.
   * Sessions recorded in a different cwd are stale — claude can't resume
   * them from a different working directory.
   */
  resumeFor(chatId: string, cwd: string): string | undefined {
    const entry = this.data[chatId];
    if (!entry) return undefined;
    if (entry.cwd !== cwd) return undefined;
    return entry.sessionId;
  }

  getRaw(chatId: string): SessionEntry | undefined {
    return this.data[chatId];
  }

  set(chatId: string, sessionId: string, cwd: string): void {
    // Preserve idleTimeoutMinutes across run starts — it's a per-scope
    // preference, not per-run-instance state. /new (clear) wipes it.
    const prev = this.data[chatId];
    this.data[chatId] = {
      sessionId,
      cwd,
      updatedAt: Date.now(),
      ...(prev?.idleTimeoutMinutes !== undefined
        ? { idleTimeoutMinutes: prev.idleTimeoutMinutes }
        : {}),
      ...(prev?.model ? { model: prev.model } : {}),
      ...(prev?.reasoningEffort ? { reasoningEffort: prev.reasoningEffort } : {}),
      ...(prev?.modelThreadId ? { modelThreadId: prev.modelThreadId } : {}),
    };
    this.schedulePersist();
  }

  clear(chatId: string): void {
    const prev = this.data[chatId];
    if (!prev) return;
    if (prev.idleTimeoutMinutes !== undefined || prev.model !== undefined || prev.reasoningEffort !== undefined) {
      this.data[chatId] = {
        updatedAt: Date.now(),
        ...(prev.idleTimeoutMinutes !== undefined
          ? { idleTimeoutMinutes: prev.idleTimeoutMinutes }
          : {}),
        ...(prev.model ? { model: prev.model } : {}),
        ...(prev.reasoningEffort ? { reasoningEffort: prev.reasoningEffort } : {}),
      };
    } else {
      delete this.data[chatId];
    }
    this.schedulePersist();
  }

  /** Per-scope idle-timeout override. `undefined` means no override set. */
  getIdleTimeoutMinutes(chatId: string): number | undefined {
    return this.data[chatId]?.idleTimeoutMinutes;
  }

  setIdleTimeoutMinutes(chatId: string, minutes: number): void {
    const clamped = Math.min(Math.max(Math.floor(minutes), 0), 120);
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? { updatedAt: Date.now() }),
      idleTimeoutMinutes: clamped,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  /** Remove the override so this scope falls back to the global default.
   * Returns true if something was actually removed. */
  clearIdleTimeoutOverride(chatId: string): boolean {
    const prev = this.data[chatId];
    if (!prev || prev.idleTimeoutMinutes === undefined) return false;
    const { idleTimeoutMinutes: _, ...rest } = prev;
    this.data[chatId] = { ...rest, updatedAt: Date.now() };
    this.schedulePersist();
    return true;
  }

  getModel(chatId: string): string | undefined {
    return this.data[chatId]?.model;
  }

  setModel(chatId: string, model: string | undefined): void {
    const prev = this.data[chatId];
    const trimmed = model?.trim();
    if (!prev && !trimmed) return;
    const next: SessionEntry = {
      ...(prev ?? {}),
      updatedAt: Date.now(),
    };
    if (trimmed) next.model = trimmed;
    else delete next.model;
    if (next.model !== prev?.model) {
      delete next.reasoningEffort;
      delete next.modelThreadId;
    }
    this.data[chatId] = next;
    this.schedulePersist();
  }

  getReasoningEffort(chatId: string): string | undefined {
    return this.data[chatId]?.reasoningEffort;
  }

  getModelForThread(chatId: string, threadId?: string): string | undefined {
    const entry = this.data[chatId];
    if (!entry?.model) return undefined;
    if (!threadId) return entry.model;
    return entry.modelThreadId === threadId ? entry.model : undefined;
  }

  getReasoningEffortForThread(chatId: string, threadId?: string): string | undefined {
    const entry = this.data[chatId];
    if (!entry?.reasoningEffort) return undefined;
    if (!threadId) return entry.reasoningEffort;
    return entry.modelThreadId === threadId ? entry.reasoningEffort : undefined;
  }

  setModelSelection(
    chatId: string,
    model: string,
    reasoningEffort: string,
    threadId?: string,
  ): void {
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? {}),
      model: model.trim(),
      reasoningEffort: reasoningEffort.trim(),
      ...(threadId ? { modelThreadId: threadId } : {}),
      updatedAt: Date.now(),
    };
    if (!threadId) delete this.data[chatId]?.modelThreadId;
    this.schedulePersist();
  }

  setModelOnlySelection(chatId: string, model: string, threadId?: string): void {
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? {}),
      model: model.trim(),
      ...(threadId ? { modelThreadId: threadId } : {}),
      updatedAt: Date.now(),
    };
    delete this.data[chatId]?.reasoningEffort;
    if (!threadId) delete this.data[chatId]?.modelThreadId;
    this.schedulePersist();
  }

  bindModelSelectionToThread(chatId: string, threadId: string): void {
    const entry = this.data[chatId];
    if (!entry?.model || entry.modelThreadId) return;
    this.data[chatId] = { ...entry, modelThreadId: threadId, updatedAt: Date.now() };
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((err: unknown) => {
        log.fail('session', err, { step: 'persist' });
      });
  }
}
