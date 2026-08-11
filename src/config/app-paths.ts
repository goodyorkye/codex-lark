import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ResolveAppPathsOptions {
  rootDir?: string;
  profile?: string;
}

export interface AppPaths {
  rootDir: string;
  profile: string;
  profileDir: string;
  defaultWorkspaceDir: string;
  configFile: string;
  activeProfileFile: string;
  sessionsFile: string;
  workspacesFile: string;
  secretsFile: string;
  keystoreSaltFile: string;
  secretsGetterScript: string;
  larkCliConfigDir: string;
  larkCliSourceDir: string;
  larkCliSourceConfigFile: string;
  larkCliTargetConfigFile: string;
  mediaDir: string;
  logsDir: string;
  registryDir: string;
  userRegistryFile: string;
  userLockDir: string;
  profileLockFile: string;
  appLockFile(appId: string): string;
}

const DEFAULT_PROFILE = 'codex';

export function resolveAppPaths(opts: ResolveAppPathsOptions = {}): AppPaths {
  const rootDir = opts.rootDir
    ?? process.env.CODEX_LARK_HOME
    ?? process.env.LARK_CHANNEL_HOME
    ?? join(homedir(), '.codex-lark');
  const profile = normalizeProfileName(opts.profile ?? DEFAULT_PROFILE);
  const profileDir = join(rootDir, 'profiles', profile);
  const registryDir = join(rootDir, 'registry');
  const userLockDir = join(registryDir, 'locks');

  return {
    rootDir,
    profile,
    profileDir,
    defaultWorkspaceDir: join(`${rootDir}-workspaces`, profile, 'default'),
    configFile: join(rootDir, 'config.json'),
    activeProfileFile: join(rootDir, 'active-profile'),
    sessionsFile: join(profileDir, 'sessions.json'),
    workspacesFile: join(profileDir, 'workspaces.json'),
    secretsFile: join(profileDir, 'secrets.enc'),
    keystoreSaltFile: join(profileDir, '.keystore.salt'),
    secretsGetterScript: join(rootDir, 'secrets-getter'),
    larkCliConfigDir: join(profileDir, 'lark-cli'),
    larkCliSourceDir: join(profileDir, 'lark-cli-source'),
    larkCliSourceConfigFile: join(profileDir, 'lark-cli-source', 'config.json'),
    larkCliTargetConfigFile: join(profileDir, 'lark-cli', 'lark-channel', 'config.json'),
    mediaDir: join(profileDir, 'media'),
    logsDir: join(profileDir, 'logs'),
    registryDir,
    userRegistryFile: join(registryDir, 'processes.json'),
    userLockDir,
    profileLockFile: join(userLockDir, 'profile', `${profile}.lock`),
    appLockFile: (appId: string) => join(userLockDir, 'app', `${lockSafeName(appId)}.lock`),
  };
}

function normalizeProfileName(profile: string): string {
  const trimmed = profile.trim();
  if (!trimmed) throw new Error('profile name is required');
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`invalid profile name: ${profile}`);
  }
  return trimmed;
}

function lockSafeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
