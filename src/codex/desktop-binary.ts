import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DesktopBinaryLocation {
  binaryPath: string;
  appPath: string;
  appName: 'ChatGPT' | 'Codex' | 'custom';
}

export interface DiscoverDesktopBinaryOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
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
    if (!(await isExecutableFile(override))) {
      throw new Error(`CODEX_LARK_CODEX_BIN is not an executable file: ${override}`);
    }
    return { binaryPath: override, appPath: '', appName: 'custom' };
  }

  if (platform !== 'darwin') {
    throw new Error(
      'codex-lark currently requires macOS and a locally installed ChatGPT or Codex Desktop app.',
    );
  }

  const candidates = options.candidates ?? desktopAppCandidates(home);
  for (const appPath of candidates) {
    const binaryPath = join(appPath, 'Contents', 'Resources', 'codex');
    if (!(await isExecutableFile(binaryPath))) continue;
    const base = appPath.split('/').pop() ?? '';
    return {
      binaryPath,
      appPath,
      appName: base.startsWith('ChatGPT') ? 'ChatGPT' : 'Codex',
    };
  }

  throw new Error(
    '未找到 ChatGPT/Codex Desktop 自带的 Codex 核心。请先安装并登录桌面应用，然后重新打开 codex-lark。',
  );
}

export function desktopAppCandidates(home: string = homedir()): string[] {
  return [
    '/Applications/ChatGPT.app',
    '/Applications/Codex.app',
    join(home, 'Applications', 'ChatGPT.app'),
    join(home, 'Applications', 'Codex.app'),
  ];
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
