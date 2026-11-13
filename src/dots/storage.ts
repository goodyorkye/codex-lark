import { constants } from 'node:fs';
import { mkdir, open, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../platform/atomic-write';

export interface DotsConfig { version: 1; appId: string; backend: 'desktop' }

export async function privateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))) {
    throw new Error('Dots state directory must be private to the current user');
  }
}

export async function readPrivate(path: string, maxBytes = 32 * 1024 * 1024): Promise<string> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes
      || (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))) {
      throw new Error('Dots file permissions are unsafe');
    }
    return await file.readFile('utf8');
  } finally { await file.close(); }
}

export async function loadDotsConfig(dir: string, appId: string): Promise<DotsConfig | undefined> {
  let raw: string;
  try { raw = await readPrivate(join(dir, 'config.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  await privateDirectory(dir);
  const config = JSON.parse(raw) as { version?: number; appId?: string; backend?: string };
  if (config.version !== 1 || config.appId !== appId) throw new Error('Dots configuration is invalid or belongs to another Feishu app');
  // The unpublished event experiment is retired. Enabling the native backend
  // explicitly with dots init preserves its old files but never starts a port.
  if (config.backend !== 'desktop') return undefined;
  return { version: 1, appId, backend: 'desktop' };
}

export async function initializeDots(dir: string, appId: string): Promise<DotsConfig> {
  await privateDirectory(dir);
  try {
    const previous = JSON.parse(await readPrivate(join(dir, 'config.json'))) as { appId?: string; version?: number };
    if (previous.appId !== appId || previous.version !== 1) throw new Error('Dots configuration belongs to another Feishu app');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const config: DotsConfig = { version: 1, appId, backend: 'desktop' };
  await writeFileAtomic(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
