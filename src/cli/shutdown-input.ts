import type { EventEmitter } from 'node:events';

type SignalName = 'SIGINT' | 'SIGTERM' | 'SIGBREAK' | 'Ctrl+C';

interface SignalSource {
  on(event: string | symbol, listener: (...args: any[]) => void): unknown;
  off(event: string | symbol, listener: (...args: any[]) => void): unknown;
}

interface TerminalInput extends EventEmitter {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
}

export interface ForegroundShutdownInput {
  restoreInputMode(): void;
  dispose(): void;
}

/**
 * Installs foreground shutdown handling with a Windows TTY fallback.
 *
 * Node normally translates Ctrl+C into SIGINT. Some Windows terminal and
 * `.cmd` combinations do neither reliably once other interactive libraries
 * have touched stdin. Raw mode makes Ctrl+C arrive deterministically as ETX
 * (0x03), while the signal listeners remain the fallback everywhere else.
 */
export function installForegroundShutdownInput(
  onShutdown: (signal: SignalName) => void,
  options: {
    platform?: NodeJS.Platform;
    signals?: SignalSource;
    input?: TerminalInput;
  } = {},
): ForegroundShutdownInput {
  const platform = options.platform ?? process.platform;
  const signals = options.signals ?? process;
  const input = options.input ?? process.stdin;
  const onSigint = (): void => onShutdown('SIGINT');
  const onSigterm = (): void => onShutdown('SIGTERM');
  const onSigbreak = (): void => onShutdown('SIGBREAK');
  const onData = (chunk: Buffer | string): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.includes(3)) onShutdown('Ctrl+C');
  };

  signals.on('SIGINT', onSigint);
  signals.on('SIGTERM', onSigterm);
  if (platform === 'win32') signals.on('SIGBREAK', onSigbreak);

  let changedRawMode = false;
  if (platform === 'win32' && input.isTTY) {
    input.on('data', onData);
    try {
      if (typeof input.setRawMode === 'function' && !input.isRaw) {
        input.setRawMode(true);
        changedRawMode = true;
      }
    } catch {
      // SIGINT and the cooked-mode ETX listener remain available as fallbacks.
    }
    input.resume();
  }

  let restored = false;
  const restoreInputMode = (): void => {
    if (restored) return;
    restored = true;
    if (changedRawMode && typeof input.setRawMode === 'function') {
      try {
        input.setRawMode(false);
      } catch {
        // The process is exiting; terminal restoration is best effort.
      }
    }
  };

  return {
    restoreInputMode,
    dispose(): void {
      restoreInputMode();
      signals.off('SIGINT', onSigint);
      signals.off('SIGTERM', onSigterm);
      if (platform === 'win32') signals.off('SIGBREAK', onSigbreak);
      input.off('data', onData);
    },
  };
}
