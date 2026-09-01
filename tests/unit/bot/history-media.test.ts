import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LarkChannel } from '@larksuite/channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendHistoryResources } from '../../../src/bot/history-media';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile';

let tmp: TmpProfile | undefined;

afterEach(async () => {
  await tmp?.cleanup();
  tmp = undefined;
});

describe('historical media delivery', () => {
  it('sends workspace files as buffers and refuses paths outside the task workspace', async () => {
    tmp = await createTmpProfile('history-media-');
    const workspaceImage = join(tmp.workspace, 'artifacts', 'result.png');
    const outsideFile = join(dirname(tmp.workspace), 'secret.png');
    await mkdir(dirname(workspaceImage), { recursive: true });
    await Promise.all([
      writeFile(workspaceImage, Buffer.from('safe-image')),
      writeFile(outsideFile, Buffer.from('outside')),
    ]);
    const send = vi.fn(async (_to: unknown, _input: unknown, _opts?: unknown) => ({ messageId: 'om-1' }));
    const channel = { send } as unknown as LarkChannel;

    const report = await sendHistoryResources(channel, 'chat-1', 'om-command', tmp.workspace, [
      { kind: 'image', source: workspaceImage, label: '结果图', origin: 'agent-output' },
      { kind: 'image', source: outsideFile, label: '越界图', origin: 'agent-output' },
    ]);

    expect(report).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0]?.[1] as { image?: { source?: unknown } };
    expect(Buffer.isBuffer(input.image?.source)).toBe(true);
  });

  it('falls back to a generic file when a native media preview is rejected', async () => {
    tmp = await createTmpProfile('history-media-fallback-');
    const video = join(tmp.workspace, 'demo.mp4');
    await writeFile(video, Buffer.from('not-a-real-mp4'));
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('duration could not be determined'))
      .mockResolvedValueOnce({ messageId: 'om-file' });
    const channel = { send } as unknown as LarkChannel;

    const report = await sendHistoryResources(channel, 'chat-1', 'om-command', tmp.workspace, [
      { kind: 'video', source: video, label: '演示', origin: 'agent-output' },
    ]);

    expect(report).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[1]).toHaveProperty('video');
    expect(send.mock.calls[1]?.[1]).toHaveProperty('file');
  });
});
