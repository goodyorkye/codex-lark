import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  legacyLarkCliSourceOverlayPaths,
  recoverLegacyLarkCliSourceOverlay,
  withLegacyLarkCliSourceOverlay,
} from '../../../src/lark-cli/legacy-source-overlay';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bridge-legacy-overlay-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('legacy lark-cli source overlay', () => {
  it('temporarily overlays the bridge root config and restores it after the callback', async () => {
    const root = await tempRoot();
    const configFile = join(root, 'config.json');
    const sourceConfigFile = join(root, 'profiles', 'codex', 'lark-cli-source', 'config.json');
    const original = `${JSON.stringify({ schemaVersion: 2, activeProfile: 'codex', profiles: {} }, null, 2)}\n`;
    const source = `${JSON.stringify({ accounts: { app: { id: 'cli_codex' } } }, null, 2)}\n`;
    await writeFile(configFile, original, { mode: 0o600 });
    await mkdir(join(root, 'profiles', 'codex', 'lark-cli-source'), { recursive: true });
    await writeFile(sourceConfigFile, source, { mode: 0o600 });

    await withLegacyLarkCliSourceOverlay(configFile, sourceConfigFile, async () => {
      expect(await readFile(configFile, 'utf8')).toBe(source);
      return undefined;
    });

    expect(await readFile(configFile, 'utf8')).toBe(original);
  });

  it('restores the bridge root config left by a crashed legacy overlay', async () => {
    const root = await tempRoot();
    const configFile = join(root, 'config.json');
    const { backupFile, markerFile } = legacyLarkCliSourceOverlayPaths(configFile);
    const original = `${JSON.stringify({ schemaVersion: 2, activeProfile: 'codex', profiles: {} }, null, 2)}\n`;
    const overlay = `${JSON.stringify({ accounts: { app: { id: 'cli_codex' } } }, null, 2)}\n`;
    await writeFile(backupFile, original, { mode: 0o600 });
    await writeFile(markerFile, `${JSON.stringify({ hadConfig: true, profile: 'codex' })}\n`, {
      mode: 0o600,
    });
    await writeFile(configFile, overlay, { mode: 0o600 });

    await recoverLegacyLarkCliSourceOverlay(configFile);

    expect(await readFile(configFile, 'utf8')).toBe(original);
    await expect(readFile(backupFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(markerFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
