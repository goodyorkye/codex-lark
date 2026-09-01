import type { LarkChannel } from '@larksuite/channel';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema';
import { createRootConfig, saveRootConfig, writeActiveProfile } from '../../../src/config/profile-store';
import { resolveAppPaths } from '../../../src/config/app-paths';
import { runNotify } from '../../../src/cli/commands/notify';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile';
import { createFakeChannel } from '../../helpers/fake-channel';

describe('codex-lark notify', () => {
  let tmp: TmpProfile | undefined;

  afterEach(async () => {
    await tmp?.cleanup();
    tmp = undefined;
  });

  it('pushes Markdown to the active profile owner', async () => {
    tmp = await configuredProfile();
    const channel = notifyChannel('ou_owner');
    const output: string[] = [];

    const result = await runNotify('构建和测试均已通过。', {
      rootDir: tmp.root,
      title: '发布完成',
    }, {
      createChannel: () => channel as unknown as LarkChannel,
      print: (text) => output.push(text),
    });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({
      chatId: 'ou_owner',
      content: { markdown: '## 发布完成\n\n构建和测试均已通过。' },
    });
    expect(result).toMatchObject({
      profile: 'codex',
      recipient: 'owner',
      resources: { sent: 0, skipped: 0, failed: 0 },
    });
    expect(output[0]).toContain('已推送到飞书');
  });

  it('projects Markdown media and sends local resources as native messages', async () => {
    tmp = await configuredProfile();
    const channel = notifyChannel('ou_owner');
    const image = join(tmp.workspace, 'result.png');
    await writeFile(image, Buffer.from('fake-image'));

    await runNotify(`结果如下：\n\n![测试图](${image})`, {
      rootDir: tmp.root,
      cwd: tmp.workspace,
      json: true,
    }, {
      createChannel: () => channel as unknown as LarkChannel,
      print: () => {},
    });

    expect(channel.sent).toHaveLength(2);
    expect(channel.sent[0]?.content).toEqual({
      markdown: '## Codex 任务完成\n\n结果如下：\n\n🖼️ 测试图（result\\.png）',
    });
    expect(channel.sent[1]).toMatchObject({
      chatId: 'ou_owner',
      content: { image: { source: expect.any(Buffer) } },
      options: { replyTo: 'om_fake_1' },
    });
  });

  it('uses an explicit recipient and repeated file attachments', async () => {
    tmp = await configuredProfile();
    const channel = notifyChannel('ou_owner');
    const report = join(tmp.workspace, 'report.pdf');
    const data = join(tmp.workspace, 'data.csv');
    await Promise.all([
      writeFile(report, Buffer.from('pdf')),
      writeFile(data, Buffer.from('a,b\n1,2\n')),
    ]);

    const result = await runNotify(undefined, {
      rootDir: tmp.root,
      to: 'oc_team',
      cwd: tmp.workspace,
      files: [report, data],
    }, {
      createChannel: () => channel as unknown as LarkChannel,
      print: () => {},
    });

    expect(result.recipient).toBe('explicit');
    expect(result.resources.sent).toBe(2);
    expect(channel.sent.map((entry) => entry.chatId)).toEqual(['oc_team', 'oc_team', 'oc_team']);
    expect(channel.sent[0]?.content).toEqual({
      markdown: '## Codex 任务完成\n\n任务已完成，相关文件见附件。\n\n📎 附件：report.pdf、data.csv',
    });
  });

  it('rejects ambiguous content sources', async () => {
    await expect(runNotify('inline', {
      markdownFile: '/tmp/result.md',
    })).rejects.toThrow('use only one');
  });
});

async function configuredProfile(): Promise<TmpProfile> {
  const tmp = await createTmpProfile('codex-lark-notify-');
  const appPaths = resolveAppPaths({ rootDir: tmp.root, profile: 'codex' });
  await mkdir(appPaths.profileDir, { recursive: true });
  const profile = createDefaultProfileConfig({
    agentKind: 'codex',
    accounts: {
      app: {
        id: 'cli_test',
        secret: 'test-secret',
        tenant: 'feishu',
      },
    },
    codex: {},
  });
  await saveRootConfig(createRootConfig('codex', profile), appPaths.configFile);
  await writeActiveProfile(tmp.root, 'codex');
  return tmp;
}

function notifyChannel(ownerId: string) {
  return Object.assign(createFakeChannel(), {
    async getAppInfo(): Promise<{ ownerId: string }> {
      return { ownerId };
    },
  });
}
