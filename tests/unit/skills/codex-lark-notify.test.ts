import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_LARK_NOTIFY_SKILL,
  ensureCodexLarkNotifySkill,
  inspectCodexLarkNotifySkill,
  MANAGED_SKILL_MARKER,
  removeCodexLarkNotifySkill,
} from '../../../src/skills/codex-lark-notify';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('codex-lark-notify managed skill', () => {
  it('invokes notify through npx without requiring a global executable', async () => {
    const skill = await readFile(join(process.cwd(), 'skills', CODEX_LARK_NOTIFY_SKILL, 'SKILL.md'), 'utf8');

    expect(skill).toContain('npx --yes codex-lark@latest notify');
    expect(skill).not.toMatch(/^codex-lark notify/m);
  });

  it('installs a missing skill and recognizes the managed copy', async () => {
    const fixture = await createFixture('first version');

    const installed = await ensureCodexLarkNotifySkill(fixture);
    expect(installed.action).toBe('installed');
    expect(installed.targetDir).toBe(join(fixture.skillsRoot, CODEX_LARK_NOTIFY_SKILL));
    expect(await readFile(join(installed.targetDir, 'SKILL.md'), 'utf8')).toBe('first version');
    expect(JSON.parse(await readFile(join(installed.targetDir, MANAGED_SKILL_MARKER), 'utf8')))
      .toMatchObject({ manager: 'codex-lark', skill: CODEX_LARK_NOTIFY_SKILL });

    const second = await ensureCodexLarkNotifySkill(fixture);
    expect(second.action).toBe('unchanged');
    expect(second.state).toBe('current');
  });

  it.skipIf(process.platform === 'win32')(
    'preserves executable permissions for bundled helper scripts',
    async () => {
    const fixture = await createFixture('skill');
    const scriptDir = join(fixture.sourceDir, 'scripts');
    const scriptPath = join(scriptDir, 'notify.sh');
    await mkdir(scriptDir);
    await writeFile(scriptPath, '#!/bin/sh\n', 'utf8');
    await chmod(scriptPath, 0o755);

    const installed = await ensureCodexLarkNotifySkill(fixture);

    expect((await stat(join(installed.targetDir, 'scripts', 'notify.sh'))).mode & 0o777).toBe(0o755);
    },
  );

  it('updates an unmodified managed copy when the bundled skill changes', async () => {
    const fixture = await createFixture('first version');
    await ensureCodexLarkNotifySkill(fixture);
    await writeFile(join(fixture.sourceDir, 'SKILL.md'), 'second version', 'utf8');

    expect((await inspectCodexLarkNotifySkill(fixture)).state).toBe('update-available');
    const updated = await ensureCodexLarkNotifySkill(fixture);

    expect(updated.action).toBe('updated');
    expect(await readFile(join(updated.targetDir, 'SKILL.md'), 'utf8')).toBe('second version');
  });

  it('preserves user changes instead of overwriting them', async () => {
    const fixture = await createFixture('bundled version');
    const installed = await ensureCodexLarkNotifySkill(fixture);
    await writeFile(join(installed.targetDir, 'SKILL.md'), 'user version', 'utf8');
    await writeFile(join(fixture.sourceDir, 'SKILL.md'), 'new bundled version', 'utf8');

    const result = await ensureCodexLarkNotifySkill(fixture);

    expect(result.action).toBe('preserved');
    expect(result.state).toBe('modified');
    expect(await readFile(join(installed.targetDir, 'SKILL.md'), 'utf8')).toBe('user version');
  });

  it('preserves a same-name skill that codex-lark does not manage', async () => {
    const fixture = await createFixture('bundled version');
    const targetDir = join(fixture.skillsRoot, CODEX_LARK_NOTIFY_SKILL);
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, 'SKILL.md'), 'independent version', 'utf8');

    const result = await ensureCodexLarkNotifySkill(fixture);

    expect(result.action).toBe('preserved');
    expect(result.state).toBe('unmanaged');
    expect(await readFile(join(targetDir, 'SKILL.md'), 'utf8')).toBe('independent version');
  });

  it('removes only an unmodified managed copy', async () => {
    const fixture = await createFixture('bundled version');
    const installed = await ensureCodexLarkNotifySkill(fixture);

    expect((await removeCodexLarkNotifySkill(fixture)).action).toBe('removed');
    expect((await inspectCodexLarkNotifySkill(fixture)).state).toBe('missing');

    await ensureCodexLarkNotifySkill(fixture);
    await writeFile(join(installed.targetDir, 'SKILL.md'), 'user version', 'utf8');
    expect((await removeCodexLarkNotifySkill(fixture)).action).toBe('preserved');
    expect(await readFile(join(installed.targetDir, 'SKILL.md'), 'utf8')).toBe('user version');
  });
});

async function createFixture(content: string): Promise<{
  sourceDir: string;
  skillsRoot: string;
  packageVersion: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'codex-lark-skill-'));
  roots.push(root);
  const sourceDir = join(root, 'source', CODEX_LARK_NOTIFY_SKILL);
  const skillsRoot = join(root, 'home', '.agents', 'skills');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, 'SKILL.md'), content, 'utf8');
  return { sourceDir, skillsRoot, packageVersion: 'test' };
}
