import type { NormalizedMessage } from '@larksuite/channel';
import { describe, expect, it } from 'vitest';
import { CompositionStore } from '../../../src/bot/composition-store.js';

describe('composition input store', () => {
  it('collects text, images, and files in message order and supports undo', () => {
    const store = new CompositionStore();
    store.start('chat-1');
    store.add('chat-1', message('m-1', '请分析这些内容'));
    store.add('chat-1', message('m-2', '', [{ type: 'image', fileKey: 'img-1' }]));
    store.add('chat-1', message('m-3', '', [{ type: 'file', fileKey: 'file-1' }]));

    expect(store.snapshot('chat-1')).toMatchObject({
      active: true,
      messages: 3,
      textSegments: 1,
      images: 1,
      files: 1,
    });
    expect(store.undo('chat-1')).toMatchObject({ messages: 2, files: 0 });

    const taken = store.take('chat-1');
    expect(taken.messages.map((item) => item.messageId)).toEqual(['m-1', 'm-2']);
    expect(store.isActive('chat-1')).toBe(false);
  });

  it('keeps baskets isolated by chat scope', () => {
    const store = new CompositionStore();
    store.start('chat-a');
    store.start('chat-b');
    store.add('chat-a', message('m-a', 'A'));

    expect(store.snapshot('chat-a').messages).toBe(1);
    expect(store.snapshot('chat-b').messages).toBe(0);
  });
});

function message(
  messageId: string,
  content: string,
  resources: Array<{ type: string; fileKey: string }> = [],
): NormalizedMessage {
  return {
    messageId,
    chatId: 'chat-1',
    chatType: 'p2p',
    senderId: 'ou-user',
    content,
    resources,
    mentionedBot: false,
  } as unknown as NormalizedMessage;
}
