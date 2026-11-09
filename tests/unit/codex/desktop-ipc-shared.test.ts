import { describe, expect, it, vi } from 'vitest';
import remodexShared from '../../../src/vendor/remodex-ipc/desktop-ipc-shared.cjs';

const { FRAME_HEADER_BYTES, MAX_FRAME_BYTES, createFrameReader, writeFrame } = remodexShared;

function encodeFrame(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

describe('Desktop IPC shared framing', () => {
  it('reads fragmented headers and bodies without concatenating accumulated chunks', () => {
    const envelope = {
      type: 'broadcast',
      method: 'thread-stream-state-changed',
      params: { text: '继续'.repeat(8_192) },
    };
    const frame = encodeFrame(envelope);
    const received: unknown[] = [];
    const reader = createFrameReader({ onFrame: (value: unknown) => received.push(value) });
    const concat = vi.spyOn(Buffer, 'concat');

    for (let offset = 0; offset < frame.length; offset += 137) {
      reader.push(frame.subarray(offset, Math.min(offset + 137, frame.length)));
    }

    expect(received).toEqual([envelope]);
    expect(concat).not.toHaveBeenCalled();
    concat.mockRestore();
  });

  it('reads multiple frames from the same stream chunk', () => {
    const received: unknown[] = [];
    const reader = createFrameReader({ onFrame: (value: unknown) => received.push(value) });
    const first = { requestId: 'first', result: { ok: true } };
    const second = { requestId: 'second', result: { ok: true } };

    reader.push(Buffer.concat([encodeFrame(first), encodeFrame(second)]));

    expect(received).toEqual([first, second]);
  });

  it('drops an oversized frame and can read a later valid frame', () => {
    const received: unknown[] = [];
    const onOverflow = vi.fn();
    const reader = createFrameReader({
      onFrame: (value: unknown) => received.push(value),
      onOverflow,
    });
    const oversizedHeader = Buffer.alloc(FRAME_HEADER_BYTES);
    oversizedHeader.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);

    reader.push(oversizedHeader);
    reader.push(encodeFrame({ type: 'response', requestId: 'recovered' }));

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{ type: 'response', requestId: 'recovered' }]);
  });

  it('discards a partial frame when reset', () => {
    const received: unknown[] = [];
    const reader = createFrameReader({ onFrame: (value: unknown) => received.push(value) });
    const abandoned = encodeFrame({ requestId: 'abandoned', body: 'x'.repeat(100) });
    const recovered = { requestId: 'recovered' };

    reader.push(abandoned.subarray(0, 20));
    reader.reset();
    reader.push(encodeFrame(recovered));

    expect(received).toEqual([recovered]);
  });

  it('writes the frame header and body without making a combined copy', () => {
    const writes: Buffer[] = [];
    const callback = vi.fn();
    const socket = {
      cork: vi.fn(),
      uncork: vi.fn(),
      write: vi.fn((chunk: Buffer, done?: (error?: Error) => void) => {
        writes.push(Buffer.from(chunk));
        done?.();
        return true;
      }),
    };

    writeFrame(socket, JSON.stringify({ hello: 'world' }), callback);

    expect(socket.cork).toHaveBeenCalledTimes(1);
    expect(socket.uncork).toHaveBeenCalledTimes(1);
    expect(socket.write).toHaveBeenCalledTimes(2);
    expect(writes[0]!.readUInt32LE(0)).toBe(writes[1]!.length);
    expect(JSON.parse(writes[1]!.toString('utf8'))).toEqual({ hello: 'world' });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
