import { describe, expect, it } from 'vitest';
import { terminalTitle } from '../../../src/cli/terminal-ui';

describe('terminal UI', () => {
  it('includes the current version in the startup title', () => {
    expect(terminalTitle('0.2.1')).toBe('Codex Lark v0.2.1');
  });
});
