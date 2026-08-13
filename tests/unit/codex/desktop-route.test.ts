import { describe, expect, it } from 'vitest';
import { desktopThreadLaunch } from '../../../src/codex/desktop-route';

describe('Codex Desktop thread routing', () => {
  it('uses the macOS codex protocol handler', () => {
    expect(desktopThreadLaunch('thread/one', 'darwin')).toEqual({
      command: '/usr/bin/open',
      args: ['codex://threads/thread%2Fone'],
    });
  });

  it('uses the signed OpenAI.Codex package manifest on Windows', () => {
    const launch = desktopThreadLaunch('019ff48b-6b2b-7ff2', 'win32');
    expect(launch?.command).toBe('powershell.exe');
    expect(launch?.args).toContain('codex://threads/019ff48b-6b2b-7ff2');
    expect(launch?.args.join('\n')).toContain('Get-AppxPackage -Name OpenAI.Codex');
    expect(launch?.args.join('\n')).toContain("$_.Protocol.Name -eq 'codex'");
  });

  it('does not claim Desktop routing support on Linux', () => {
    expect(desktopThreadLaunch('thread-one', 'linux')).toBeUndefined();
  });
});
