import { access, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withConfigFileLock } from '../config/profile-store';
import { writeFileAtomic } from '../platform/atomic-write';

interface OverlayMarker {
  hadConfig: boolean;
  profile?: string;
}

export function legacyLarkCliSourceOverlayPaths(configFile: string): {
  backupFile: string;
  markerFile: string;
} {
  const dir = dirname(configFile);
  return {
    backupFile: join(dir, '.config.json.lark-cli-bind-backup'),
    markerFile: join(dir, '.config.json.lark-cli-bind-marker'),
  };
}

export async function recoverLegacyLarkCliSourceOverlay(configFile: string): Promise<void> {
  await withConfigFileLock(configFile, async () => {
    await recoverLegacyLarkCliSourceOverlayUnlocked(configFile);
  });
}

export async function hasLegacyLarkCliSourceOverlay(configFile: string): Promise<boolean> {
  const { markerFile } = legacyLarkCliSourceOverlayPaths(configFile);
  try {
    await access(markerFile);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export async function withLegacyLarkCliSourceOverlay<T>(
  configFile: string,
  sourceConfigFile: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withConfigFileLock(configFile, async () => {
    await recoverLegacyLarkCliSourceOverlayUnlocked(configFile);
    const { backupFile, markerFile } = legacyLarkCliSourceOverlayPaths(configFile);
    const original = await readOptional(configFile);
    if (original !== undefined) {
      await writeFileAtomic(backupFile, original, { mode: 0o600 });
    } else {
      await rm(backupFile, { force: true }).catch(() => {});
    }
    const marker: OverlayMarker = { hadConfig: original !== undefined };
    await writeFileAtomic(markerFile, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });

    const source = await readFile(sourceConfigFile);
    await writeFileAtomic(configFile, source, { mode: 0o600 });
    try {
      return await fn();
    } finally {
      await restoreLegacyLarkCliSourceOverlayUnlocked(configFile);
    }
  });
}

async function recoverLegacyLarkCliSourceOverlayUnlocked(configFile: string): Promise<void> {
  const marker = await readMarker(configFile);
  if (!marker) return;
  await restoreLegacyLarkCliSourceOverlayUnlocked(configFile, marker);
}

async function restoreLegacyLarkCliSourceOverlayUnlocked(
  configFile: string,
  markerArg?: OverlayMarker,
): Promise<void> {
  const marker = markerArg ?? await readMarker(configFile);
  if (!marker) return;
  const { backupFile, markerFile } = legacyLarkCliSourceOverlayPaths(configFile);
  if (marker.hadConfig) {
    const backup = await readFile(backupFile);
    await writeFileAtomic(configFile, backup, { mode: 0o600 });
  } else {
    await rm(configFile, { force: true }).catch(() => {});
  }
  await rm(backupFile, { force: true }).catch(() => {});
  await rm(markerFile, { force: true }).catch(() => {});
}

async function readMarker(configFile: string): Promise<OverlayMarker | undefined> {
  const { markerFile } = legacyLarkCliSourceOverlayPaths(configFile);
  try {
    const parsed = JSON.parse(await readFile(markerFile, 'utf8')) as Partial<OverlayMarker>;
    return { hadConfig: parsed.hadConfig === true, ...(parsed.profile ? { profile: parsed.profile } : {}) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
