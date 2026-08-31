import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('README product contract', () => {
  it('leads with continuing existing Desktop work from the phone', async () => {
    const docs = await readDocs();
    for (const phrase of [
      'Continue Codex tasks from ChatGPT or Codex Desktop',
      '继续 ChatGPT / Codex Desktop 里的 Codex 任务',
      'lightweight phone remote for Codex tasks in ChatGPT / Codex Desktop',
      'ChatGPT / Codex Desktop 里 Codex 任务的轻量手机遥控器',
      'That single assistant can manage multiple Codex projects and tasks',
      '只用这一个机器人，就能管理这台电脑上 ChatGPT / Codex Desktop 里的多个 Codex 项目和任务',
      'not ordinary ChatGPT chats or ChatGPT Work conversations',
      '不是普通 ChatGPT 聊天或 ChatGPT Work 会话',
      'Card buttons, one-tap switching',
      '卡片按钮，点击即切换',
      'npx -y codex-lark@latest',
    ]) expect(docs).toContain(phrase);
  });

  it('describes user-visible phone capabilities without a slash-command manual', async () => {
    const docs = await readDocs();
    for (const phrase of [
      'Compose input',
      '组合输入',
      'reasoning effort',
      '推理强度',
      'permission requests',
      '权限请求',
    ]) expect(docs).toContain(phrase);
    expect(docs).not.toContain('| `/projects`');
    expect(docs).not.toContain('| `/tasks`');
  });

  it('keeps setup intentionally short and pressure-free', async () => {
    const docs = await readDocs();
    for (const phrase of [
      'Start in three steps',
      '三步开始使用',
      'no OpenAI API key',
      '无需填写 OpenAI API Key',
      'no Feishu developer console',
      '无需进入飞书开发者后台',
    ]) expect(docs).toContain(phrase);
    expect(docs).not.toContain('--profile');
    expect(docs).not.toContain('profile export');
  });

  it('shows the Feishu card experience near the introduction', async () => {
    const docs = await readDocs();
    expect(docs.match(/docs\/images\/feishu-card-navigation\.png/g)).toHaveLength(2);
  });

  it('credits both upstream reference projects', async () => {
    const docs = await readDocs();
    expect(docs.match(/https:\/\/github\.com\/zarazhangrui\/lark-coding-agent-bridge/g)).toHaveLength(2);
    expect(docs.match(/https:\/\/github\.com\/Emanuele-web04\/remodex/g)).toHaveLength(2);
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
    readFile(new URL('../../../README.en.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.md', import.meta.url), 'utf8'),
  ]);
  return `${en}\n${zh}`;
}
