import { describe, expect, it } from 'vitest';
import { processTerminationCommand } from '../../../src/runtime/process-control';

describe('platform process termination', () => {
  it('uses taskkill tree mode for a graceful Windows stop', () => {
    expect(processTerminationCommand(72378, false, 'win32')).toEqual({
      command: 'taskkill.exe',
      args: ['/PID', '72378', '/T'],
    });
  });

  it('adds force only for the Windows hard-stop fallback', () => {
    expect(processTerminationCommand(72378, true, 'win32')).toEqual({
      command: 'taskkill.exe',
      args: ['/PID', '72378', '/T', '/F'],
    });
  });

  it('leaves Unix signal delivery to process.kill', () => {
    expect(processTerminationCommand(72378, false, 'darwin')).toBeUndefined();
  });
});
