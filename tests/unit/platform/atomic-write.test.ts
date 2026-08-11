import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../../src/platform/atomic-write.js';

const cleanups: Array<() => Promise<void>> = [];

describe('atomic write retry', () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('retries transient Windows rename failures and removes temp files', async () => {
    const root = await tmpRoot();
    const file = join(root, 'config.json');
    let attempts = 0;

    await writeFileAtomic(file, 'stable\n', {
      mode: 0o600,
      rename: async (from, to, fallbackRename) => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('busy') as NodeJS.ErrnoException;
          err.code = attempts === 1 ? 'EPERM' : 'EBUSY';
          throw err;
        }
        await fallbackRename(from, to);
      },
    });

    expect(attempts).toBe(3);
    await expect(readFile(file, 'utf8')).resolves.toBe('stable\n');
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('cleans up temp files when rename retries are exhausted', async () => {
    const root = await tmpRoot();
    const file = join(root, 'config.json');

    await expect(
      writeFileAtomic(file, 'stable\n', {
        mode: 0o600,
        rename: async () => {
          const err = new Error('busy') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        },
        maxRenameAttempts: 2,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow('busy');

    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atomic-write-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
