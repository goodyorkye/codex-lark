import type { NormalizedMessage } from '@larksuite/channel';

export interface CompositionCounts {
  messages: number;
  textSegments: number;
  images: number;
  files: number;
}

export interface CompositionSnapshot extends CompositionCounts {
  active: boolean;
  cardMessageId?: string;
}

interface CompositionEntry {
  messages: NormalizedMessage[];
  cardMessageId?: string;
}

/** In-memory, per-chat basket used to combine several Feishu messages into one agent turn. */
export class CompositionStore {
  private readonly entries = new Map<string, CompositionEntry>();

  start(scope: string): CompositionSnapshot {
    if (!this.entries.has(scope)) this.entries.set(scope, { messages: [] });
    return this.snapshot(scope);
  }

  isActive(scope: string): boolean {
    return this.entries.has(scope);
  }

  add(scope: string, message: NormalizedMessage): CompositionSnapshot {
    const entry = this.entries.get(scope);
    if (!entry) throw new Error(`composition is not active for scope ${scope}`);
    entry.messages.push(message);
    return this.snapshot(scope);
  }

  undo(scope: string): CompositionSnapshot {
    this.entries.get(scope)?.messages.pop();
    return this.snapshot(scope);
  }

  clear(scope: string): CompositionSnapshot {
    const entry = this.entries.get(scope);
    if (entry) entry.messages = [];
    return this.snapshot(scope);
  }

  bindCard(scope: string, cardMessageId: string): CompositionSnapshot {
    const entry = this.entries.get(scope);
    if (!entry) throw new Error(`composition is not active for scope ${scope}`);
    entry.cardMessageId = cardMessageId;
    return this.snapshot(scope);
  }

  take(scope: string): { messages: NormalizedMessage[]; snapshot: CompositionSnapshot } {
    const snapshot = this.snapshot(scope);
    const messages = [...(this.entries.get(scope)?.messages ?? [])];
    this.entries.delete(scope);
    return { messages, snapshot };
  }

  cancel(scope: string): CompositionSnapshot {
    const snapshot = this.snapshot(scope);
    this.entries.delete(scope);
    return snapshot;
  }

  snapshot(scope: string): CompositionSnapshot {
    const entry = this.entries.get(scope);
    if (!entry) return emptySnapshot();
    const counts = countMessages(entry.messages);
    return {
      active: true,
      ...counts,
      ...(entry.cardMessageId ? { cardMessageId: entry.cardMessageId } : {}),
    };
  }
}

function countMessages(messages: NormalizedMessage[]): CompositionCounts {
  let textSegments = 0;
  let images = 0;
  let files = 0;
  for (const message of messages) {
    const resources = message.resources ?? [];
    for (const resource of resources) {
      if ((resource as { type?: string }).type === 'image') images += 1;
      else files += 1;
    }
    if (resources.length === 0 && message.content.trim()) textSegments += 1;
  }
  return { messages: messages.length, textSegments, images, files };
}

function emptySnapshot(): CompositionSnapshot {
  return { active: false, messages: 0, textSegments: 0, images: 0, files: 0 };
}
