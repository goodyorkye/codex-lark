import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultChatName } from '../../../src/bot/group.js';

describe('group chat helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the current agent display name in generated chat names', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 25, 16, 52, 0));

    expect(defaultChatName('Codex')).toBe('Codex · 5-25 16:52');
  });
});
