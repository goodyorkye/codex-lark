import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('README product contract', () => {
  it('documents the no-separate-CLI Desktop architecture in both languages', async () => {
    const docs = await readDocs();
    for (const phrase of [
      'no separate Codex CLI',
      '不单独安装 Codex CLI',
      'ChatGPT.app/Contents/Resources/codex',
      'Codex App Server',
      'Desktop IPC',
      'App Secret',
      'npx -y codex-lark@latest',
    ]) expect(docs).toContain(phrase);
  });

  it('documents phone controls, files, models, and explicit approvals', async () => {
    const docs = await readDocs();
    for (const phrase of [
      '/projects',
      '/tasks',
      '/new',
      '/task show',
      '/models',
      '/model select',
      '/model effort',
      '/stop',
      'Allow once',
      '仅本次允许',
      'attachments',
      '飞书附件',
      '组合输入',
      'Compose input',
      '/compose',
    ]) expect(docs).toContain(phrase);
  });

  it('documents closed access, workspace defaults, and document-scoped comments', async () => {
    const docs = await readDocs();
    expect(docs).toContain('closed by default');
    expect(docs).toContain('其他访问名单默认关闭');
    expect(docs).toContain('"defaultAccess": "workspace"');
    expect(docs).toContain('legacy `sandbox`');
    expect(docs).toContain('旧版 `sandbox`');
    expect(docs).toContain('Cloud-doc comments are document-scoped');
    expect(docs).toContain('云文档评论按文档权限生效');
  });

  it('keeps contributor checks and destructive profile flags visible', async () => {
    const docs = await readDocs();
    for (const phrase of [
      'pnpm test',
      'pnpm typecheck',
      'pnpm build',
      '--purge --yes',
      '--include-secrets --yes',
    ]) expect(docs).toContain(phrase);
  });

  it('keeps CLI help aligned with foreground startup and workspace flags', async () => {
    const cli = await readFile(new URL('../../../src/cli/index.ts', import.meta.url), 'utf8');
    expect(cli).toContain(".name('codex-lark')");
    expect(cli).toContain('runForeground');
    expect(cli).not.toContain(".command('desktop')");
    expect(cli).not.toContain(".command('start')");
    expect(cli).toContain('--workspace <path>');
    expect(cli).toContain('profile name (default: codex)');
  });
});

async function readDocs(): Promise<string> {
  const [en, zh] = await Promise.all([
    readFile(new URL('../../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.zh-CN.md', import.meta.url), 'utf8'),
  ]);
  return `${en}\n${zh}`;
}
