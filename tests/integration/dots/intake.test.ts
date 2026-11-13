import { join } from 'node:path';
import type { NormalizedMessage } from '@larksuite/channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeChannel } from '../../helpers/fake-channel';
import { createTmpProfile } from '../../helpers/tmp-profile';
import { FakeAgentAdapter } from '../../helpers/fake-agent';
import { DesktopDotsBridge } from '../../../src/dots/desktop-bridge';
import { fakeDesktopDotApi } from '../../helpers/fake-desktop-dot';
import { aliyunAsr } from '../../../src/dots/aliyun-asr';
import { privateDirectory } from '../../../src/dots/storage';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema';
import { SessionStore } from '../../../src/session/store';
import { WorkspaceStore } from '../../../src/workspace/store';
import type { Controls } from '../../../src/commands';

const mock = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock('@larksuite/channel', async importOriginal => ({ ...await importOriginal<typeof import('@larksuite/channel')>(), createLarkChannel: mock.factory }));
import { startChannel } from '../../../src/bot/channel';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); mock.factory.mockReset(); });

async function harness() {
  const tmp = await createTmpProfile('dots-intake-');
  const dir = join(tmp.profile, 'dots'); await privateDirectory(dir);
  const dots = await DesktopDotsBridge.open(dir, 'app-test', { api: fakeDesktopDotApi(), asr: aliyunAsr({}) });
  const handlers: { message?: (msg: NormalizedMessage) => Promise<void> } = {};
  const channel = Object.assign(createFakeChannel(), {
    botIdentity: { openId: 'ou_bot', name: '共用机器人' },
    getAppInfo: async () => ({ ownerId: 'ou_owner' }), getChatMode: async () => 'p2p' as const,
    getConnectionStatus: () => ({ state: 'connected', reconnectAttempts: 0 }),
    on: (next: object) => Object.assign(handlers, next), connect: async () => {}, disconnect: async () => {},
  });
  mock.factory.mockReturnValue(channel);
  const config = createDefaultProfileConfig({ agentKind: 'codex', accounts: { app: { id: 'app-test', secret: 'test', tenant: 'feishu' } }, codex: {} });
  config.workspaces.default = tmp.workspace;
  const controls: Controls = { dots, profile: 'codex', profileConfig: config, cfg: config, botOwnerId: 'ou_owner', ownerRefreshState: 'ok',
    refreshOwner: async () => {}, restart: async () => {}, exit: async () => {}, configPath: join(tmp.profile, 'config.json'), processId: 'test' };
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json')); sessions.set('chat-1', 'saved-thread', tmp.workspace);
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json')); workspaces.setCwd('chat-1', tmp.workspace);
  const agent = new FakeAgentAdapter({ id: 'codex', events: [{ type: 'done', terminationReason: 'normal' }] });
  const runtime = await startChannel({ cfg: config, controls, agent, sessions, workspaces });
  cleanups.push(tmp.cleanup, async () => { await runtime.disconnect(); await dots.close(); });
  return { dots, channel, agent, sessions, workspaces, tmp,
    receive: (content: string, id: string, resources: NormalizedMessage['resources'] = []) => handlers.message!({ chatId: 'chat-1', chatType: 'p2p', senderId: 'ou_owner', messageId: id, content, resources } as unknown as NormalizedMessage) };
}

describe('one Feishu connection with two destinations', () => {
  it('replies to the original voice message with repair steps immediately when ASR is missing', async () => {
    const h = await harness(); await h.receive('/dots use', 'switch-dots');
    await h.receive('', 'voice-missing-asr', [{ type: 'audio', fileKey: 'voice-key' }]);
    expect(h.channel.sent.at(-1)).toMatchObject({ chatId: 'chat-1', content: { text: expect.stringContaining('DASHSCOPE_API_KEY') }, options: { replyTo: 'voice-missing-asr' } });
    expect(h.agent.runOptions).toHaveLength(0);
    expect(h.dots.status().pending).toBe(0);
  });
  it('routes selected Dots text including unknown slash input away from Codex, then resumes Codex routing', async () => {
    const h = await harness(); const before = h.sessions.getRaw('chat-1');
    await h.receive('/dots use', 'switch-dots');
    await h.receive('给原 Dot 的问题', 'dots-text');
    await h.receive('/这也是给 Dot 的文字', 'dots-slash');
    expect(h.agent.runOptions).toHaveLength(0);
    expect(h.dots.status().pending).toBe(2);
    await h.receive('/codex', 'switch-codex');
    expect(h.sessions.getRaw('chat-1')).toEqual(before);
    expect(h.workspaces.cwdFor('chat-1')).toBe(h.tmp.workspace);
    await h.receive('继续处理 Codex 项目', 'codex-text');
    await vi.waitFor(() => expect(h.agent.runOptions).toHaveLength(1), { timeout: 3000 });
    expect(h.agent.runOptions[0]?.prompt).toContain('继续处理 Codex 项目');
    expect(h.agent.runOptions[0]?.prompt).not.toContain('给原 Dot');
    expect(mock.factory).toHaveBeenCalledTimes(1);
  });
  it('preserves already queued Codex input while switching to Dots', async () => {
    const h = await harness();
    await h.receive('切换前已发给 Codex', 'codex-before-switch');
    await h.receive('/dots use', 'switch-dots');
    await h.receive('切换后发给 Dots', 'dots-after-switch');
    await vi.waitFor(() => expect(h.agent.runOptions).toHaveLength(1), { timeout: 3000 });
    expect(h.agent.runOptions[0]?.prompt).toContain('切换前已发给 Codex');
    expect(h.agent.runOptions[0]?.prompt).not.toContain('切换后发给 Dots');
  });
});
