import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createDefaultProfileConfig, type AgentKind, type ProfileConfig } from '../config/profile-schema';
import type { AppConfig } from '../config/schema';
import { discoverDesktopBinary } from '../codex/desktop-binary';
import { AgentPreflightError } from '../agent/preflight';
import { resolveWorkingDirectory } from '../policy/workspace';

export interface BootstrapProfileInput {
  agentKind: AgentKind;
  accounts: AppConfig['accounts'];
  preferences?: AppConfig['preferences'];
  secrets?: AppConfig['secrets'];
  workspace?: string;
  defaultWorkspace?: string;
  codexBinaryPath?: string;
  profileDir?: string;
}

export async function createBootstrapProfileConfig(
  input: BootstrapProfileInput,
): Promise<ProfileConfig> {
  const workspace = input.workspace
    ? await resolveBootstrapWorkspace(input.workspace)
    : input.defaultWorkspace
      ? await ensureManagedDefaultWorkspace(input.defaultWorkspace)
      : undefined;
  const codex =
    input.agentKind === 'codex'
      ? await createBootstrapCodexConfig(input.codexBinaryPath)
      : undefined;
  const profile = createDefaultProfileConfig({
    agentKind: input.agentKind,
    accounts: input.accounts,
    preferences: input.preferences,
    secrets: input.secrets,
    ...(codex ? { codex } : {}),
    ...(input.agentKind === 'codex'
      ? { permissions: { defaultAccess: 'workspace', maxAccess: 'full' } }
      : {}),
  });
  if (workspace) {
    profile.workspaces = {
      ...profile.workspaces,
      default: workspace,
    };
  }
  if (input.profileDir && profile.codex?.inheritCodexHome === false) {
    await mkdir(join(input.profileDir, 'codex-home'), { recursive: true });
  }
  return profile;
}

export async function resolveBootstrapWorkspace(workspace: string): Promise<string> {
  const resolved = await resolveWorkingDirectory(workspace);
  if (!resolved.ok) throw new Error(resolved.userVisible);
  return resolved.cwdRealpath;
}

async function ensureManagedDefaultWorkspace(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return realpath(path);
}

export async function createBootstrapCodexConfig(binaryPath: string | undefined) {
  const command = binaryPath
    ?? process.env.CODEX_LARK_CODEX_BIN
    ?? process.env.LARK_CHANNEL_CODEX_BIN;
  try {
    const location = await discoverDesktopBinary({
      env: command ? { ...process.env, CODEX_LARK_CODEX_BIN: command } : process.env,
    });
    return { binaryPath: location.binaryPath, inheritCodexHome: true };
  } catch (error) {
    const diagnostic = {
      code: 'agent-binary-not-found' as const,
      agentId: 'codex' as const,
      agentName: 'Codex Desktop',
      command: command ?? 'Codex Desktop bundled core',
      ...(command ? { binaryPath: command } : {}),
    };
    throw new AgentPreflightError(
      diagnostic,
      error instanceof Error ? error.message : String(error),
    );
  }
}
