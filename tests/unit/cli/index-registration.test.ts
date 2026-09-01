import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI command registration', () => {
  it('runs the foreground bridge from the root command', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).toContain('.action(async (opts: ForegroundOptions)');
    expect(source).toContain('await runForeground(opts)');
    expect(source).toContain('skipCheckLarkCli: true');
    expect(source).not.toContain(".command('desktop')");
    expect(source).not.toContain(".command('start')");
  });

  it('registers the documented migrate command', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).toMatch(/\.command\(['"]migrate['"]\)/);
    expect(source).toContain('runMigrate');
  });

  it('registers app-secret options for non-interactive app bootstrap commands', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    const appSecretOptions = source.match(/--app-secret <secret>/g) ?? [];
    expect(appSecretOptions.length).toBeGreaterThanOrEqual(3);
  });

  it('registers the notify command', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).toMatch(/\.command\(['"]notify \[message\]['"]\)/);
    expect(source).toContain('runNotify');
    expect(source).toContain('--markdown-file <path>');
    expect(source).toContain('--file <path>');
    expect(source).toContain('--thread <id>');
    expect(source).toContain('--task-title <title>');
    expect(source).toContain('--plain');
    expect(source).toContain('optsWithGlobals');
  });

  it('installs and manages the bundled Codex notification skill', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).toContain('installCodexLarkNotifySkillOnStartup');
    expect(source).toMatch(/\.command\(['"]skill['"]\)/);
    expect(source).toMatch(/\.command\(['"]install['"]\)/);
    expect(source).toMatch(/\.command\(['"]status['"]\)/);
    expect(source).toMatch(/\.command\(['"]remove['"]\)/);
  });
});
