import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discoverDesktopBinary,
  findWindowsDesktopCore,
  resolveDesktopBinaryForLaunch,
} from '../../../src/codex/desktop-binary';

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

  it('uses the Codex core bundled in the official Windows package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-windows-desktop-'));
    const app = join(root, 'OpenAI.Codex_1.2.3.0_x64__test');
    const binary = join(app, 'app', 'resources', 'codex.exe');
    const helper = join(app, 'app', 'codex-resources', 'codex-command-runner.exe');
    const state = join(root, 'state');
    await mkdir(join(app, 'app', 'resources'), { recursive: true });
    await mkdir(join(app, 'app', 'codex-resources'), { recursive: true });
    await writeFile(binary, 'fake Windows executable');
    await writeFile(helper, 'fake command runner');

    const result = await discoverDesktopBinary({
      platform: 'win32',
      candidates: [app],
      env: { PATH: join(root, 'irrelevant-path'), CODEX_LARK_HOME: state },
    });
    expect(result).toMatchObject({ appPath: app, appName: 'Codex' });
    expect(result.binaryPath.startsWith(join(state, 'runtime', 'windows-desktop-core'))).toBe(true);
    await expect(readFile(result.binaryPath, 'utf8')).resolves.toBe('fake Windows executable');
    await expect(readFile(
      join(result.binaryPath, '..', '..', 'codex-resources', 'codex-command-runner.exe'),
      'utf8',
    )).resolves.toBe('fake command runner');
  });

  it('repairs an old profile path that points directly into WindowsApps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-windows-old-profile-'));
    const app = join(root, 'WindowsApps', 'OpenAI.Codex_1.2.3.0_x64__test');
    const binary = join(app, 'resources', 'codex.exe');
    const state = join(root, 'state');
    await mkdir(join(app, 'resources'), { recursive: true });
    await writeFile(binary, 'fake Windows executable');

    const resolved = await resolveDesktopBinaryForLaunch(binary, {
      platform: 'win32',
      candidates: [app],
      env: { CODEX_LARK_HOME: state },
    });
    expect(resolved.startsWith(join(state, 'runtime', 'windows-desktop-core'))).toBe(true);
    await expect(readFile(resolved, 'utf8')).resolves.toBe('fake Windows executable');
  });

  it('finds a moved Windows Desktop core under app.asar.unpacked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-windows-layout-'));
    const binary = join(root, 'app', 'resources', 'app.asar.unpacked', 'vendor', 'codex.exe');
    const desktopExe = join(root, 'Codex.exe');
    await mkdir(join(root, 'app', 'resources', 'app.asar.unpacked', 'vendor'), { recursive: true });
    await writeFile(binary, 'fake core');
    await writeFile(desktopExe, 'fake desktop shell');

    await expect(findWindowsDesktopCore(root)).resolves.toBe(binary);
  });

  it('does not mistake the Windows Desktop shell for the App Server core', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-windows-shell-'));
    await writeFile(join(root, 'Codex.exe'), 'fake desktop shell');

    await expect(findWindowsDesktopCore(root)).resolves.toBeUndefined();
  });

  it('does not fall back to a separately installed Windows codex on PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-lark-windows-no-path-'));
    await writeFile(join(root, 'codex.exe'), 'unrelated CLI');

    await expect(discoverDesktopBinary({
      platform: 'win32',
      candidates: [],
      env: { PATH: root },
    })).rejects.toThrow(/Desktop|桌面/);
  });
});
