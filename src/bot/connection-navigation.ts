import type { LarkChannel } from '@larksuite/channel';
import type { AgentAdapter } from '../agent/types';
import { codexRemoteNavigationCard } from '../card/codex-cards';
import { log } from '../core/logger';
import type { SessionCatalog } from '../session/catalog';

export interface ConnectionNavigationControls {
  botOwnerId?: string;
}

export interface SendConnectionNavigationOptions {
  channel: LarkChannel;
  agent: AgentAdapter;
  sessionCatalog?: Pick<SessionCatalog, 'entries'>;
  controls: ConnectionNavigationControls;
}

/**
 * Push the Codex workbench to the app owner after the Feishu connection is
 * ready. `LarkChannel.send()` accepts an open_id directly, so this also works
 * before the owner has ever opened a p2p chat with the bot.
 */
export async function sendConnectionNavigation(
  options: SendConnectionNavigationOptions,
): Promise<boolean> {
  if (options.agent.id !== 'codex') return false;
  const ownerOpenId = options.controls.botOwnerId?.trim();
  if (!ownerOpenId) {
    log.warn('navigation', 'connection-push-skipped', { reason: 'owner-unavailable' });
    return false;
  }

  const latest = options.sessionCatalog?.entries()
    .filter((entry) => entry.agentId === 'codex' && entry.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  let taskTitle = latest?.lastSummary;
  if (latest?.threadId && options.agent.readThread) {
    try {
      const thread = await options.agent.readThread(latest.threadId);
      taskTitle = thread.name?.trim() || thread.preview?.trim() || taskTitle;
    } catch (error) {
      log.warn('navigation', 'connection-task-title-unavailable', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await options.channel.send(ownerOpenId, {
    card: codexRemoteNavigationCard({
      ...(latest?.cwdRealpath ? { cwd: latest.cwdRealpath } : {}),
      ...(taskTitle ? { taskTitle } : {}),
      hasCurrentTask: Boolean(latest?.threadId),
    }),
  });
  log.info('navigation', 'connection-pushed', {
    target: ownerOpenId,
    hasCurrentTask: Boolean(latest?.threadId),
    hasTaskTitle: Boolean(taskTitle),
  });
  return true;
}
