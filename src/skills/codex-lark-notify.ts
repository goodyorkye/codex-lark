import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import pkg from '../../package.json';

export const CODEX_LARK_NOTIFY_SKILL = 'codex-lark-notify';
export const MANAGED_SKILL_MARKER = '.codex-lark-managed.json';

const MANAGER = 'codex-lark';
const MANIFEST_VERSION = 1;

interface ManagedSkillManifest {
  schemaVersion: number;
  manager: typeof MANAGER;
  skill: typeof CODEX_LARK_NOTIFY_SKILL;
  contentHash: string;
  packageVersion: string;
}

export type ManagedSkillState =
  | 'missing'
  | 'current'
  | 'update-available'
  | 'modified'
  | 'unmanaged';

export interface ManagedSkillStatus {
  state: ManagedSkillState;
  sourceDir: string;
  targetDir: string;
  sourceHash: string;
  installedHash?: string;
  currentHash?: string;
}

export type ManagedSkillInstallResult = ManagedSkillStatus & {
  action: 'installed' | 'updated' | 'unchanged' | 'preserved';
};

export type ManagedSkillRemoveResult = ManagedSkillStatus & {
  action: 'removed' | 'unchanged' | 'preserved';
};

export interface ManagedSkillOptions {
  sourceDir?: string;
  skillsRoot?: string;
  entryPath?: string;
  packageVersion?: string;
}

export async function inspectCodexLarkNotifySkill(
  options: ManagedSkillOptions = {},
): Promise<ManagedSkillStatus> {
  const sourceDir = options.sourceDir ?? await findBundledSkillDirectory(options.entryPath);
  const targetDir = join(options.skillsRoot ?? defaultUserSkillsRoot(), CODEX_LARK_NOTIFY_SKILL);
  const sourceHash = await hashDirectory(sourceDir);

  if (!(await pathExists(targetDir))) {
    return { state: 'missing', sourceDir, targetDir, sourceHash };
  }

  const manifest = await readManagedManifest(targetDir);
  if (!manifest) {
    return {
      state: 'unmanaged',
      sourceDir,
      targetDir,
      sourceHash,
      currentHash: await hashDirectory(targetDir),
    };
  }

  const currentHash = await hashDirectory(targetDir);
  if (currentHash !== manifest.contentHash) {
    return {
      state: 'modified',
      sourceDir,
      targetDir,
      sourceHash,
      installedHash: manifest.contentHash,
      currentHash,
    };
  }

  return {
    state: sourceHash === manifest.contentHash ? 'current' : 'update-available',
    sourceDir,
    targetDir,
    sourceHash,
    installedHash: manifest.contentHash,
    currentHash,
  };
}

export async function ensureCodexLarkNotifySkill(
  options: ManagedSkillOptions = {},
): Promise<ManagedSkillInstallResult> {
  const status = await inspectCodexLarkNotifySkill(options);
  if (status.state === 'current') return { ...status, action: 'unchanged' };
  if (status.state === 'modified' || status.state === 'unmanaged') {
    return { ...status, action: 'preserved' };
  }

  await replaceManagedSkill(status.sourceDir, status.targetDir, {
    schemaVersion: MANIFEST_VERSION,
    manager: MANAGER,
    skill: CODEX_LARK_NOTIFY_SKILL,
    contentHash: status.sourceHash,
    packageVersion: options.packageVersion ?? pkg.version,
  });
  return {
    ...status,
    state: 'current',
    installedHash: status.sourceHash,
    currentHash: status.sourceHash,
    action: status.state === 'missing' ? 'installed' : 'updated',
  };
}

export async function removeCodexLarkNotifySkill(
  options: ManagedSkillOptions = {},
): Promise<ManagedSkillRemoveResult> {
  const status = await inspectCodexLarkNotifySkill(options);
  if (status.state === 'missing') return { ...status, action: 'unchanged' };
  if (status.state === 'modified' || status.state === 'unmanaged') {
    return { ...status, action: 'preserved' };
  }

  await rm(status.targetDir, { recursive: true, force: true });
  return { ...status, action: 'removed' };
}

export function defaultUserSkillsRoot(home = homedir()): string {
  return join(home, '.agents', 'skills');
}

export async function findBundledSkillDirectory(entryPath = process.argv[1]): Promise<string> {
  if (!entryPath) throw new Error('Cannot locate the codex-lark package entry point.');
  const resolvedEntry = await realpath(entryPath).catch(() => entryPath);
  let cursor = dirname(resolvedEntry);

  for (;;) {
    const packageFile = join(cursor, 'package.json');
    try {
      const packageJson = JSON.parse(await readFile(packageFile, 'utf8')) as { name?: unknown };
      if (packageJson.name === 'codex-lark') {
        const skillDir = join(cursor, 'skills', CODEX_LARK_NOTIFY_SKILL);
        await stat(join(skillDir, 'SKILL.md'));
        return skillDir;
      }
    } catch {
      // Keep walking: packaged, global and npx entry points may be symlinked.
    }

    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  throw new Error(`Bundled skill not found: ${CODEX_LARK_NOTIFY_SKILL}`);
}

async function replaceManagedSkill(
  sourceDir: string,
  targetDir: string,
  manifest: ManagedSkillManifest,
): Promise<void> {
  const parent = dirname(targetDir);
  await mkdir(parent, { recursive: true });
  const token = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const stagingDir = join(parent, `.${CODEX_LARK_NOTIFY_SKILL}.tmp-${token}`);
  const backupDir = join(parent, `.${CODEX_LARK_NOTIFY_SKILL}.backup-${token}`);
  let movedExisting = false;
  let installed = false;

  try {
    await copyDirectory(sourceDir, stagingDir);
    await writeFile(
      join(stagingDir, MANAGED_SKILL_MARKER),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    if (await pathExists(targetDir)) {
      await rename(targetDir, backupDir);
      movedExisting = true;
    }
    try {
      await rename(stagingDir, targetDir);
      installed = true;
    } catch (error) {
      if (movedExisting) await rename(backupDir, targetDir).catch(() => {});
      throw error;
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    if (installed && movedExisting) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
      await chmod(targetPath, (await stat(sourcePath)).mode);
    } else {
      throw new Error(`Unsupported bundled skill entry: ${sourcePath}`);
    }
  }
}

async function hashDirectory(root: string): Promise<string> {
  const files = await listFiles(root);
  const hash = createHash('sha256');
  for (const file of files) {
    const path = relative(root, file).split('\\').join('/');
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === MANAGED_SKILL_MARKER) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported skill entry: ${path}`);
  }
  return result.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

async function readManagedManifest(targetDir: string): Promise<ManagedSkillManifest | undefined> {
  try {
    const value = JSON.parse(
      await readFile(join(targetDir, MANAGED_SKILL_MARKER), 'utf8'),
    ) as Partial<ManagedSkillManifest>;
    if (
      value.schemaVersion !== MANIFEST_VERSION
      || value.manager !== MANAGER
      || value.skill !== CODEX_LARK_NOTIFY_SKILL
      || typeof value.contentHash !== 'string'
      || typeof value.packageVersion !== 'string'
    ) return undefined;
    return value as ManagedSkillManifest;
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
