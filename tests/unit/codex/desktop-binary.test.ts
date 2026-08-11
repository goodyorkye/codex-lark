import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverDesktopBinary } from '../../../src/codex/desktop-binary';

describe('Codex Desktop binary discovery', () => {
  it('uses the executable bundled in ChatGPT.app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-desktop-'));
    const app = join(root, 'ChatGPT.app');
    const binary = join(app, 'Contents', 'Resources', 'codex');
    await mkdir(join(app, 'Contents', 'Resources'), { recursive: true });
    await writeFile(binary, '#!/bin/sh\nexit 0\n');
    await chmod(binary, 0o755);

    await expect(discoverDesktopBinary({
      platform: 'darwin',
      candidates: [app],
      env: { PATH: join(root, 'irrelevant-path') },
    })).resolves.toEqual({ binaryPath: binary, appPath: app, appName: 'ChatGPT' });
  });

  it('never falls back to a codex command found on PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-no-path-'));
    const pathBinary = join(root, 'codex');
    await writeFile(pathBinary, '#!/bin/sh\nexit 0\n');
    await chmod(pathBinary, 0o755);

    await expect(discoverDesktopBinary({
      platform: 'darwin',
      candidates: [],
      env: { PATH: root },
    })).rejects.toThrow(/Desktop|桌面/);
  });

  it('accepts an explicit test/development override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-override-'));
    const binary = join(root, 'fake-app-server');
    await writeFile(binary, '#!/bin/sh\nexit 0\n');
    await chmod(binary, 0o755);

    await expect(discoverDesktopBinary({
      platform: 'linux',
      env: { CODEX_LARK_CODEX_BIN: binary },
    })).resolves.toMatchObject({ binaryPath: binary, appName: 'custom' });
  });
});
