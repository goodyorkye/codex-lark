import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import gracefulFs from 'graceful-fs';

const gracefulRename = promisify(gracefulFs.rename);

export interface AtomicWriteOptions {
  mode?: number;
  maxRenameAttempts?: number;
  retryDelayMs?: number;
  rename?: (
    from: string,
    to: string,
    fallbackRename: (from: string, to: string) => Promise<void>,
  ) => Promise<void>;
}

const DEFAULT_RENAME_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 25;

export async function writeFileAtomic(
  path: string,
  data: string | Buffer,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(
    dirname(path),
    `.${basename(path)}.tmp-${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`,
  );
  try {
    const handle = await open(tmp, 'w', opts.mode ?? 0o600);
    try {
      await handle.writeFile(data);
      try {
        await handle.sync();
      } catch (err) {
        if (!isIgnorableWindowsFsyncError(err)) throw err;
      }
    } finally {
      await handle.close();
    }
    await chmod(tmp, opts.mode ?? 0o600);
    await renameWithRetry(tmp, path, opts);
    await fsyncDir(dirname(path));
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function renameWithRetry(
  from: string,
  to: string,
  opts: AtomicWriteOptions,
): Promise<void> {
  const maxAttempts = opts.maxRenameAttempts ?? DEFAULT_RENAME_ATTEMPTS;
  const delayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const rename = opts.rename ?? ((src, dest, fallback) => fallback(src, dest));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rename(from, to, gracefulRename);
      return;
    } catch (err) {
      lastErr = err;
      if (!isTransientRenameError(err) || attempt === maxAttempts) break;
      await sleep(delayMs * attempt);
    }
  }
  throw lastErr;
}

export function isTransientRenameError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY';
}

function isIgnorableWindowsFsyncError(err: unknown): boolean {
  return process.platform === 'win32' && (err as NodeJS.ErrnoException | undefined)?.code === 'EPERM';
}

async function fsyncDir(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is best-effort across platforms.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
