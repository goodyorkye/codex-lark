import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';

export type DotsChannel = Pick<LarkChannel, 'send'> & Partial<Pick<LarkChannel, 'downloadResourceToFile'>>;
export interface DotsStatus {
  paired: boolean; connected: boolean; name: string; pending: number; uncertain: number; failed: number;
  speechTranscription: 'aliyun' | 'unconfigured'; lastError?: string;
}
export interface DotsBackend {
  readonly kind: 'desktop';
  status(): DotsStatus;
  mode(scope: string): 'codex' | 'dots';
  ownerMode(): 'codex' | 'dots';
  select(scope: string, mode: 'codex' | 'dots', ownerId: string, chatId: string): Promise<void>;
  disconnect(ownerId: string): Promise<void>;
  enqueue(message: NormalizedMessage, scope: string): Promise<boolean>;
  attach(channel: DotsChannel, owner: () => string | undefined): () => void;
}
