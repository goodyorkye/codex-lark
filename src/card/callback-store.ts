import { readFile } from 'node:fs/promises';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';

type NonceState = 'used' | 'revoked';

export class CallbackNonceStore {
  private readonly path: string;
  private readonly nonces = new Map<string, NonceState>();
  private saving: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object') return;
      this.nonces.clear();
      for (const [nonce, state] of Object.entries(raw as Record<string, unknown>)) {
        if (state === 'used' || state === 'revoked') this.nonces.set(nonce, state);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      log.fail('callback-nonce', err, { step: 'load' });
    }
  }

  state(nonce: string): NonceState | undefined {
    return this.nonces.get(nonce);
  }

  consume(nonce: string): boolean {
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, 'used');
    this.schedulePersist();
    return true;
  }

  revoke(nonce: string): void {
    this.nonces.set(nonce, 'revoked');
    this.schedulePersist();
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(
          this.path,
          `${JSON.stringify(Object.fromEntries(this.nonces), null, 2)}\n`,
          { mode: 0o600 },
        );
      })
      .catch((err: unknown) => {
        log.fail('callback-nonce', err, { step: 'persist' });
      });
  }
}
