import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkingDirectory } from '../../../src/policy/workspace';

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('working directory resolver', () => {
  it('accepts an existing non-git directory and returns its realpath', async () => {
    const base = await makeTmp();
    const project = join(base, 'plain-directory');
    await mkdir(project, { recursive: true });

    const result = await resolveWorkingDirectory(project);

    expect(result).toMatchObject({
      ok: true,
      cwdRealpath: await realpath(project),
    });
  });

  it('rejects missing paths and files', async () => {
    const base = await makeTmp();
    const file = join(base, 'file.txt');
    await writeFile(file, 'not a directory', 'utf8');

    await expect(resolveWorkingDirectory(join(base, 'missing'))).resolves.toMatchObject({
      ok: false,
      reason: 'path-inaccessible',
    });
    await expect(resolveWorkingDirectory(file)).resolves.toMatchObject({
      ok: false,
      reason: 'not-directory',
    });
  });

  it('rejects broad or high-risk working directories', async () => {
    await expect(resolveWorkingDirectory('/')).resolves.toMatchObject({
      ok: false,
      reason: 'filesystem-root',
    });
    await expect(resolveWorkingDirectory(homedir())).resolves.toMatchObject({
      ok: false,
      reason: 'home-root',
    });
    await expect(resolveWorkingDirectory(tmpdir())).resolves.toMatchObject({
      ok: false,
      reason: 'temp-root',
    });
  });
});

async function makeTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-workdir-'));
  cleanups.push(dir);
  return dir;
}
