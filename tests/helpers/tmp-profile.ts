import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TmpProfile {
  root: string;
  profile: string;
  workspace: string;
  cleanup(): Promise<void>;
}

export async function createTmpProfile(prefix = 'bridge-test-'): Promise<TmpProfile> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const profile = join(root, 'profile');
  const workspace = join(root, 'workspace');

  await Promise.all([
    mkdir(profile, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(join(workspace, '.git'), { recursive: true }),
  ]);

  return {
    root,
    profile,
    workspace,
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }),
  };
}
