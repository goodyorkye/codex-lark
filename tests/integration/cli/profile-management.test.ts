import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAppPaths } from '../../../src/config/app-paths';
import {
  createDefaultProfileConfig,
  type AgentKind,
  type RootConfig,
} from '../../../src/config/profile-schema';
import { runProfileList, runProfileUse } from '../../../src/cli/commands/profile';
import type { ProcessEntry } from '../../../src/runtime/registry';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bridge-profile-management-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('profile management commands', () => {
  it('lists active profile first with running pid and agent identity', async () => {
    const root = await makeRoot();
    await writeProfiles(root, 'codex-dev', ['alpha', 'claude', 'codex-dev']);
    await writeRegistry(root, [
      processEntry({
        id: 'run1',
        pid: 12345,
        profileName: 'codex-dev',
        agentKind: 'codex',
        appId: 'cli_codex',
      }),
    ]);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line);
    });

    await runProfileList({ rootDir: root });

    expect(lines).toEqual([
      'ACTIVE  PROFILE    AGENT   STATUS',
      '*       codex-dev  codex   pid=12345 agent=codex',
      '        alpha      claude  -',
      '        claude     claude  -',
    ]);
  });

  it('switches active profile atomically without rewriting running process entries', async () => {
    const root = await makeRoot();
    await writeProfiles(root, 'claude', ['claude', 'codex-dev']);
    const registryFile = resolveAppPaths({ rootDir: root }).userRegistryFile;
    const registry = {
      entries: [
        processEntry({
          id: 'run1',
          pid: 12345,
          profileName: 'claude',
          agentKind: 'claude',
          appId: 'cli_claude',
        }),
      ],
    };
    await writeJson(registryFile, registry);
    const beforeRegistry = await readFile(registryFile, 'utf8');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await runProfileUse('codex-dev', { rootDir: root });

    const rootConfig = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')) as RootConfig;
    await expect(readFile(join(root, 'active-profile'), 'utf8')).resolves.toBe('codex-dev\n');
    expect(rootConfig.activeProfile).toBe('codex-dev');
    expect(await readFile(registryFile, 'utf8')).toBe(beforeRegistry);
  });
});

async function writeProfiles(root: string, activeProfile: string, names: string[]): Promise<void> {
  const profiles: RootConfig['profiles'] = {};
  for (const name of names) {
    const agentKind: AgentKind = name.startsWith('codex') ? 'codex' : 'claude';
    profiles[name] = createDefaultProfileConfig({
      agentKind,
      accounts: {
        app: {
          id: `cli_${name.replace(/[^A-Za-z0-9]/g, '_')}`,
          secret: '${APP_SECRET}',
          tenant: 'feishu',
        },
      },
      ...(agentKind === 'codex' ? { codex: { binaryPath: 'codex' } } : {}),
    });
    await mkdir(join(root, 'profiles', name), { recursive: true });
  }
  const config: RootConfig = {
    schemaVersion: 2,
    activeProfile,
    preferences: {},
    profiles,
  };
  await writeFile(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'active-profile'), `${activeProfile}\n`, 'utf8');
}

function processEntry(overrides: Partial<ProcessEntry>): ProcessEntry {
  return {
    id: 'id',
    pid: process.pid,
    appId: 'cli_test',
    tenant: 'feishu',
    profileName: 'claude',
    agentKind: 'claude',
    configPath: '/tmp/config.json',
    startedAt: new Date().toISOString(),
    version: '0.1.32',
    ...overrides,
  };
}

async function writeRegistry(root: string, entries: ProcessEntry[]): Promise<void> {
  await writeJson(resolveAppPaths({ rootDir: root }).userRegistryFile, { entries });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
