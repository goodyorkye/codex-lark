import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installForegroundShutdownInput } from '../../../src/cli/shutdown-input';

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode = vi.fn((mode: boolean) => {
    this.isRaw = mode;
  });
  resume = vi.fn();
}

describe('foreground shutdown input', () => {
  it('captures Windows Ctrl+C as raw ETX and restores the terminal', () => {
    const signals = new EventEmitter();
    const input = new FakeInput();
    const shutdown = vi.fn();
    const controller = installForegroundShutdownInput(shutdown, {
      platform: 'win32',
      signals,
      input,
    });

    expect(input.setRawMode).toHaveBeenCalledWith(true);
    expect(input.resume).toHaveBeenCalled();
    input.emit('data', Buffer.from([3]));
    signals.emit('SIGBREAK');
    expect(shutdown).toHaveBeenNthCalledWith(1, 'Ctrl+C');
    expect(shutdown).toHaveBeenNthCalledWith(2, 'SIGBREAK');

    controller.dispose();
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    input.emit('data', Buffer.from([3]));
    expect(shutdown).toHaveBeenCalledTimes(2);
  });

  it('keeps native SIGINT and SIGTERM handling on non-Windows terminals', () => {
    const signals = new EventEmitter();
    const input = new FakeInput();
    const shutdown = vi.fn();
    const controller = installForegroundShutdownInput(shutdown, {
      platform: 'darwin',
      signals,
      input,
    });

    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    expect(shutdown.mock.calls).toEqual([['SIGINT'], ['SIGTERM']]);
    expect(input.setRawMode).not.toHaveBeenCalled();
    controller.dispose();
  });
});

