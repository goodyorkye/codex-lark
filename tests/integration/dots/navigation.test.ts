import { join } from 'node:path';
import type { NormalizedMessage, CardActionEvent } from '@larksuite/channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopDotsBridge } from '../../../src/dots/desktop-bridge';
import { fakeDesktopDotApi } from '../../helpers/fake-desktop-dot';
import { privateDirectory } from '../../../src/dots/storage';
import { tryHandleCommand, type CommandContext, type Controls } from '../../../src/commands';
import { handleCardAction } from '../../../src/card/dispatcher';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema';
import { codexRemoteNavigationCard } from '../../../src/card/codex-cards';
import { ActiveRuns } from '../../../src/bot/active-runs';
import { PendingQueue } from '../../../src/bot/pending-queue';
import { CompositionStore } from '../../../src/bot/composition-store';
import { ChatModeCache } from '../../../src/bot/chat-mode-cache';
import { SessionStore } from '../../../src/session/store';
import { SessionCatalog } from '../../../src/session/catalog';
import { WorkspaceStore } from '../../../src/workspace/store';
import { createFakeChannel } from '../../helpers/fake-channel';
import { FakeAgentAdapter } from '../../helpers/fake-agent';
import { createTmpProfile } from '../../helpers/tmp-profile';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function harness(connected = true) {
  const tmp = await createTmpProfile('dots-navigation-');
  const dir = join(tmp.profile, 'dots'); await privateDirectory(dir);
  const api = fakeDesktopDotApi();
  if (!connected) api.primary.mockRejectedValue(new Error('请确认 ChatGPT 客户端已登录原 Dot 账号。'));
  const dots = await DesktopDotsBridge.open(dir, 'app-test', { api });
  const channel = Object.assign(createFakeChannel(), { getChatMode: async () => 'p2p' as const }); dots.attach(channel, () => 'ou_owner');
  const profileConfig = createDefaultProfileConfig({ agentKind: 'codex', accounts: { app: { id: 'app-test', secret: 'test', tenant: 'feishu' } }, codex: {} });
  const controls: Controls = { dots, profile: 'codex', profileConfig, botOwnerId: 'ou_owner', ownerRefreshState: 'ok',
    refreshOwner: async () => {}, restart: async () => {}, exit: async () => {}, configPath: join(tmp.profile, 'config.json'), cfg: profileConfig, processId: 'test' };
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json'));
  sessions.set('chat-1', 'thread-saved', tmp.workspace); sessions.setModel('chat-1', 'gpt-test');
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json')); workspaces.setCwd('chat-1', tmp.workspace);
  const catalog = new SessionCatalog(join(tmp.profile, 'catalog.json'));
  const identity = { scopeId: 'chat-1', agentId: 'codex' as const, cwdRealpath: tmp.workspace, policyFingerprint: 'saved-policy' };
  catalog.upsertActive({ ...identity, threadId: 'thread-saved', lastSummary: '保留的任务' });
  const activeRuns = new ActiveRuns(); const interrupt = vi.spyOn(activeRuns, 'interrupt');
  const compositions = new CompositionStore(); compositions.start('chat-1');
  const pending = new PendingQueue(60_000, () => {}); pending.push('chat-1', msg('already queued'));
  const ctx: CommandContext = { channel: channel as unknown as CommandContext['channel'], msg: msg(''), scope: 'chat-1', chatMode: 'p2p',
    controls, sessions, workspaces, sessionCatalog: catalog, sessionCatalogIdentity: identity, activeRuns, compositions, pending,
    agent: new FakeAgentAdapter({ id: 'codex', events: [] }) };
  cleanups.push(tmp.cleanup, async () => { pending.cancelAll(); await Promise.all([sessions.flush(), workspaces.flush(), catalog.flush()]); await dots.close(); });
  return { ctx, dots, api, channel, sessions, workspaces, catalog, identity, compositions, pending, interrupt,
    run: (content: string) => tryHandleCommand({ ...ctx, msg: msg(content) }) };
}
function msg(content: string): NormalizedMessage {
  return { chatId: 'chat-1', chatType: 'p2p', senderId: 'ou_owner', messageId: 'om_source', content, resources: [] } as unknown as NormalizedMessage;
}

describe('same-bot Codex/Dots navigation', () => {
  it('switches both ways without clearing the project, thread, model, draft, queued messages or active run', async () => {
    const h = await harness();
    const before = h.sessions.getRaw('chat-1'); const project = h.workspaces.cwdFor('chat-1');
    await h.run('/dots use'); expect(h.dots.mode('chat-1')).toBe('dots');
    expect(JSON.stringify(h.channel.sent.at(-1)?.content)).toContain('返回 Codex');
    await h.run('/codex'); expect(h.dots.mode('chat-1')).toBe('codex');
    expect(h.sessions.getRaw('chat-1')).toEqual(before);
    expect(h.workspaces.cwdFor('chat-1')).toBe(project);
    expect(h.catalog.activeFor(h.identity)?.threadId).toBe('thread-saved');
    expect(h.compositions.isActive('chat-1')).toBe(true);
    expect(h.pending.cancel('chat-1')).toHaveLength(1);
    expect(h.interrupt).not.toHaveBeenCalled();
    expect(JSON.stringify(h.channel.sent.at(-1)?.content)).toContain('保留的任务');
  });
  it('connects the original desktop Dot without pairing codes or an event task', async () => {
    const h = await harness(false);
    await h.run('/dots use'); expect(h.dots.mode('chat-1')).toBe('codex');
    expect(JSON.stringify(h.channel.sent.at(-1)?.content)).toContain('已登录');
    h.api.primary.mockResolvedValue({ principal: 'account:owner', dotId: 'dot', roomId: 'room', name: '原 Dot', ownerMemberId: 'owner', dotMemberId: 'dot-member' });
    await h.run('/dots connect');
    expect(h.dots.mode('chat-1')).toBe('dots');
    expect(h.dots.status().connected).toBe(true);
    expect(JSON.stringify(h.channel.sent)).not.toContain('pair_dots');
  });
  it('requires a deliberate disconnect before switching to another account or Dot', async () => {
    const h = await harness(); await h.run('/dots use');
    const old = await h.api.primary(); h.api.primary.mockResolvedValue({ ...old, principal: 'other-account:owner' });
    await h.run('/dots connect'); expect(JSON.stringify(h.channel.sent.at(-1)?.content)).toContain('已变化');
    expect(h.dots.status().connected).toBe(false);
  });
  it('guards stale Codex buttons and commands while Dots is selected', async () => {
    const h = await harness(); await h.run('/dots use');
    await h.run('/new'); await h.run('/project use /tmp');
    expect(h.sessions.getRaw('chat-1')?.sessionId).toBe('thread-saved');
    expect(h.interrupt).not.toHaveBeenCalled();
    expect(JSON.stringify(h.channel.sent.at(-1)?.content)).toContain('返回 Codex');
  });
  it('dispatches the actual navigation buttons through the shared card dispatcher', async () => {
    const h = await harness();
    const card = JSON.stringify(codexRemoteNavigationCard()); expect(card).toContain('dots.use');
    for (const cmd of ['dots.use', 'codex']) {
      await handleCardAction({
        ...h.ctx, evt: { operator: { openId: 'ou_owner' }, chatId: 'chat-1', messageId: 'om_card', action: { value: { cmd } } } as CardActionEvent,
        chatModeCache: new ChatModeCache(), pending: h.pending,
      });
      expect(h.dots.mode('chat-1')).toBe(cmd === 'codex' ? 'codex' : 'dots');
    }
    expect(h.sessions.getRaw('chat-1')?.sessionId).toBe('thread-saved');
  });
  it('denies Dots switching from a group or another allowed user', async () => {
    const h = await harness();
    await tryHandleCommand({ ...h.ctx, chatMode: 'group', msg: msg('/dots use') });
    expect(h.dots.mode('chat-1')).toBe('codex');
    await tryHandleCommand({ ...h.ctx, msg: { ...msg('/dots use'), senderId: 'ou_other' } });
    expect(h.dots.mode('chat-1')).toBe('codex');
  });
});
