import { spawn } from 'node:child_process';

/**
 * Mount a newly-created bridge thread in the already-installed desktop app so
 * the private IPC follower accepts subsequent live snapshots. Failure is
 * intentionally non-fatal; App Server persistence remains the fallback.
 */
export function activateDesktopThread(threadId: string, env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== 'darwin' || env.CODEX_LARK_DESKTOP_AUTO_FOLLOW === '0') return;
  const child = spawn('/usr/bin/open', [`codex://threads/${encodeURIComponent(threadId)}`], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', () => {});
  child.unref();
}
