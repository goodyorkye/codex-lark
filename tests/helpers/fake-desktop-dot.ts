import { vi } from 'vitest';
import type { DesktopDotIdentity, DesktopDotMessage } from '../../src/dots/desktop-client';
export function fakeDesktopDotApi() {
  const identity: DesktopDotIdentity = { principal: 'account:owner', dotId: 'dot', roomId: 'room', name: '原 Dot', ownerMemberId: 'owner', dotMemberId: 'dot-member' };
  return {
    primary: vi.fn(async () => identity),
    activity: vi.fn(async () => ({ turnId: 'turn', status: 'completed' as const, active: false })),
    send: vi.fn(async (_identity: DesktopDotIdentity, _text: string, requestId: string): Promise<DesktopDotMessage> => ({ id: 'message', request_id: requestId, account_user_id: 'owner' })),
    messages: vi.fn(async (): Promise<DesktopDotMessage[]> => []),
    upload: vi.fn(async () => 'file'),
    download: vi.fn(async () => ({ id: 'file', name: 'test.txt', mimeType: 'text/plain', bytes: Buffer.from('test') })),
    close: vi.fn(async () => {}),
  };
}
