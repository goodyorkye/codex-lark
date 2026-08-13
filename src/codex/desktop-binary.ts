import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { spawnProcess } from '../platform/spawn';

export interface DesktopBinaryLocation {
  binaryPath: string;
  appPath: string;
  appName: 'ChatGPT' | 'Codex' | 'custom';
}

export interface DiscoverDesktopBinaryOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  /** Platform-specific application roots. Primarily used by tests. */
  candidates?: readonly string[];
}

/**
 * Locate the Codex executable bundled in the desktop app. codex-lark never
 * falls back to a globally installed `codex` command: the product contract is
 * that ChatGPT/Codex Desktop owns installation, updates and authentication.
 */
export async function discoverDesktopBinary(
  options: DiscoverDesktopBinaryOptions = {},
): Promise<DesktopBinaryLocation> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  const override = (env.CODEX_LARK_CODEX_BIN ?? env.LARK_CHANNEL_CODEX_BIN)?.trim();
  if (override) {
    if (!(await isRunnableFile(override, platform))) {
      throw new Error(`CODEX_LARK_CODEX_BIN is not an executable file: ${override}`);
    }
    return { binaryPath: override, appPath: '', appName: 'custom' };
  }

  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(
      'codex-lark currently requires macOS or Windows and a locally installed Codex Desktop app.',
    );
  }

  if (platform === 'darwin') {
    const candidates = options.candidates ?? desktopAppCandidates(home);
    for (const appPath of candidates) {
      const binaryPath = join(appPath, 'Contents', 'Resources', 'codex');
      if (!(await isRunnableFile(binaryPath, platform))) continue;
      const base = basename(appPath);
      return {
        binaryPath,
        appPath,
        appName: base.startsWith('ChatGPT') ? 'ChatGPT' : 'Codex',
      };
    }
  } else {
    const packageRoots = options.candidates ?? await windowsDesktopPackageRoots(env);
    for (const appPath of packageRoots) {
      const bundledBinaryPath = await findWindowsDesktopCore(appPath);
      if (!bundledBinaryPath) continue;
      const binaryPath = await materializeWindowsDesktopCore(appPath, bundledBinaryPath, {
        env,
        home,
      });
      return { binaryPath, appPath, appName: 'Codex' };
    }
  }

  const installHint = platform === 'win32'
    ? '请从 Microsoft Store 安装并登录官方 Codex Desktop'
    : '请安装并登录官方 ChatGPT 或 Codex Desktop';
  throw new Error(
    `未找到 Codex Desktop 自带的 Codex 核心。${installHint}，然后重新打开 codex-lark。`,
  );
}

export interface MaterializeWindowsDesktopCoreOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/**
 * Microsoft Store grants read access to package contents but Windows can deny
 * CreateProcess for internal executables under WindowsApps. Copy the signed
 * Desktop-owned core into a versioned per-user runtime cache before spawning
 * it. This is not a separately downloaded CLI and is refreshed whenever the
 * package path, executable size, or mtime changes.
 */
export async function materializeWindowsDesktopCore(
  appPath: string,
  bundledBinaryPath: string,
  options: MaterializeWindowsDesktopCoreOptions = {},
): Promise<string> {
  if (!isPathInside(appPath, bundledBinaryPath)) {
    throw new Error('Refusing to materialize a Codex core outside the Desktop package.');
  }

  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const source = await stat(bundledBinaryPath);
  const identity = createHash('sha256')
    .update(`${appPath}\0${bundledBinaryPath}\0${source.size}\0${source.mtimeMs}`)
    .digest('hex')
    .slice(0, 20);
  const stateRoot = env.CODEX_LARK_HOME
    ?? env.LARK_CHANNEL_HOME
    ?? join(home, '.codex-lark');
  const cacheParent = join(stateRoot, 'runtime', 'windows-desktop-core');
  const cacheRoot = join(cacheParent, identity);
  const cachedBinary = join(cacheRoot, 'bin', 'codex.exe');
  if (await sameSizeFile(cachedBinary, source.size)) return cachedBinary;

  await mkdir(cacheParent, { recursive: true });
  const stagingRoot = join(
    cacheParent,
    `.${identity}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`,
  );
  try {
    await mkdir(join(stagingRoot, 'bin'), { recursive: true });
    await copyFile(bundledBinaryPath, join(stagingRoot, 'bin', 'codex.exe'));

    const supportFiles = await findWindowsDesktopSupportFiles(appPath, bundledBinaryPath);
    for (const [name, sourcePath] of supportFiles) {
      const destinationDir = name === 'codex-code-mode-host.exe'
        ? join(stagingRoot, 'bin')
        : name === 'rg.exe'
          ? join(stagingRoot, 'codex-path')
          : join(stagingRoot, 'codex-resources');
      await mkdir(destinationDir, { recursive: true });
      await copyFile(sourcePath, join(destinationDir, name));
    }

    await writeFile(join(stagingRoot, 'codex-lark-runtime.json'), `${JSON.stringify({
      sourcePackage: appPath,
      sourceBinary: bundledBinaryPath,
      sourceSize: source.size,
      sourceMtimeMs: source.mtimeMs,
    }, null, 2)}\n`, 'utf8');
    try {
      await rename(stagingRoot, cacheRoot);
    } catch (error) {
      if (!(await sameSizeFile(cachedBinary, source.size))) throw error;
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }

  if (!(await sameSizeFile(cachedBinary, source.size))) {
    throw new Error('Failed to prepare the Codex Desktop core in the per-user runtime cache.');
  }
  return cachedBinary;
}

/** Re-resolve stale profiles created before Windows Store materialization existed. */
export async function resolveDesktopBinaryForLaunch(
  binaryPath: string,
  options: DiscoverDesktopBinaryOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' || !isWindowsStorePackagePath(binaryPath)) return binaryPath;
  return (await discoverDesktopBinary({
    env: options.env,
    home: options.home,
    platform,
    candidates: options.candidates,
  })).binaryPath;
}

export function isWindowsStorePackagePath(path: string): boolean {
  return /[\\/]WindowsApps[\\/]/iu.test(path);
}

export function desktopAppCandidates(home: string = homedir()): string[] {
  return [
    '/Applications/ChatGPT.app',
    '/Applications/Codex.app',
    join(home, 'Applications', 'ChatGPT.app'),
    join(home, 'Applications', 'Codex.app'),
  ];
}

/**
 * Resolve the install root of the official Microsoft Store package. The
 * package identity is the same one used by the upstream Codex CLI when it
 * opens Codex Desktop on Windows. We intentionally do not search PATH, so a
 * separately installed Codex CLI cannot silently replace the Desktop core.
 */
export async function windowsDesktopPackageRoots(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |',
    '  Sort-Object Version -Descending |',
    '  ForEach-Object { $_.InstallLocation }',
  ].join('\n');

  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const done = (roots: string[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(roots);
    };
    const timer = setTimeout(() => {
      child.kill();
      done([]);
    }, 5000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.once('error', () => done([]));
    child.once('close', (code) => {
      if (code !== 0) return done([]);
      done([...new Set(stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))]);
    });
  });
}

export async function findWindowsDesktopCore(appPath: string): Promise<string | undefined> {
  const preferred = [
    join(appPath, 'resources', 'codex.exe'),
    join(appPath, 'app', 'resources', 'codex.exe'),
    join(appPath, 'resources', 'bin', 'codex.exe'),
    join(appPath, 'resources', 'app.asar.unpacked', 'codex.exe'),
    join(appPath, 'resources', 'app.asar.unpacked', 'resources', 'codex.exe'),
  ];
  for (const candidate of preferred) {
    if (await isRunnableFile(candidate, 'win32')) return candidate;
  }

  // Package layout can move between Desktop releases. Search only within the
  // verified OpenAI.Codex package root and prefer resource/bin copies over the
  // Electron application executable.
  const found: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: appPath, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 10_000 && found.length < 32) {
    const current = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'codex.exe') {
        // The package root can also contain the Electron GUI executable named
        // Codex.exe. Only accept binaries in the resource/core subtree so the
        // bridge never mistakes the Desktop shell for the App Server core.
        if (isWindowsCoreSubtree(appPath, path) && await isRunnableFile(path, 'win32')) {
          found.push(path);
        }
      } else if (entry.isDirectory() && current.depth < 8) {
        queue.push({ path, depth: current.depth + 1 });
      }
    }
  }
  return found.sort((a, b) => windowsCoreRank(appPath, a) - windowsCoreRank(appPath, b))[0];
}

function isWindowsCoreSubtree(root: string, path: string): boolean {
  const parts = relative(root, path).toLowerCase().split(sep);
  return parts.includes('resources') || parts.includes('bin') || parts.includes('app.asar.unpacked');
}

function windowsCoreRank(root: string, path: string): number {
  const parts = relative(root, path).toLowerCase().split(sep);
  const depth = parts.length;
  if (parts.includes('app.asar.unpacked')) return depth;
  if (parts.includes('resources')) return 20 + depth;
  if (parts.includes('bin')) return 40 + depth;
  return 100 + depth;
}

const WINDOWS_SUPPORT_FILE_NAMES = new Set([
  'codex-code-mode-host.exe',
  'codex-command-runner.exe',
  'codex-windows-sandbox-setup.exe',
  'rg.exe',
]);

async function findWindowsDesktopSupportFiles(
  appPath: string,
  binaryPath: string,
): Promise<Map<string, string>> {
  const candidates = new Map<string, string[]>();
  const queue: Array<{ path: string; depth: number }> = [{ path: appPath, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 10_000 && candidates.size < WINDOWS_SUPPORT_FILE_NAMES.size) {
    const current = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isDirectory() && current.depth < 8) {
        queue.push({ path, depth: current.depth + 1 });
        continue;
      }
      const name = entry.name.toLowerCase();
      if (!entry.isFile() || !WINDOWS_SUPPORT_FILE_NAMES.has(name)) continue;
      const paths = candidates.get(name) ?? [];
      paths.push(path);
      candidates.set(name, paths);
    }
  }

  const binaryDir = dirname(binaryPath);
  return new Map([...candidates].map(([name, paths]) => [
    name,
    paths.sort((a, b) => pathDistance(binaryDir, a) - pathDistance(binaryDir, b))[0]!,
  ]));
}

function pathDistance(fromDir: string, path: string): number {
  return relative(fromDir, path).split(sep).length;
}

function isPathInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('../') && !rel.startsWith('..\\');
}

async function sameSizeFile(path: string, size: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === size;
  } catch {
    return false;
  }
}

async function isRunnableFile(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, platform === 'win32' ? constants.R_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
