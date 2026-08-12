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
      '127.0.0.1',
      'App Secret',
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
      '最近任务 / 选择项目 / 新建任务 / 切换模型',
      'Recent tasks / Choose project / New task / Switch model',
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
      'pnpm package:mac',
      '--purge --yes',
      '--include-secrets --yes',
    ]) expect(docs).toContain(phrase);
  });

  it('keeps CLI help aligned with profile-aware service and workspace flags', async () => {
    const cli = await readFile(new URL('../../../src/cli/index.ts', import.meta.url), 'utf8');
    expect(cli).toContain(".name('codex-lark')");
    expect(cli).toContain(".command('desktop')");
    expect(cli).toContain('--workspace <path>');
    expect(cli).toContain('profile name (defaults to active profile)');
  });
});

async function readDocs(): Promise<string> {
  const [en, zh] = await Promise.all([
    readFile(new URL('../../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.zh-CN.md', import.meta.url), 'utf8'),
  ]);
  return `${en}\n${zh}`;
}
