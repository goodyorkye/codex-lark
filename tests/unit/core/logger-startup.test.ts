import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.LARK_CHANNEL_HOME;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('logger startup behavior', () => {
  it('does not create the default claude profile directory before logger configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'logger-startup-'));
    roots.push(root);
    process.env.LARK_CHANNEL_HOME = root;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { flushLogger, log } = await import('../../../src/core/logger.js');
    log.warn('startup', 'before-configure', { detail: 'early warning' });
    await flushLogger();

    await expect(stat(join(root, 'profiles', 'claude'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
