import { spawnProcess } from '../platform/spawn';

export interface ProcessTerminationCommand {
  command: string;
  args: string[];
}

export function processTerminationCommand(
  pid: number,
  force: boolean,
  platform: NodeJS.Platform = process.platform,
): ProcessTerminationCommand | undefined {
  if (platform !== 'win32') return undefined;
  return {
    command: 'taskkill.exe',
    args: ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
  };
}

/** Request termination of a bridge and its App Server child process. */
export async function requestProcessTermination(
  pid: number,
  force = false,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const command = processTerminationCommand(pid, force, platform);
  if (!command) {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const child = spawnProcess(command.command, command.args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`taskkill timed out for pid ${pid}`));
    }, 5000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code === 0) return finish();
      finish(new Error(stderr.trim() || `taskkill exited with code ${code ?? 'unknown'}`));
    });
  });
}
