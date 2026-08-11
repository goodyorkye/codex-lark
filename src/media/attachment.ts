import type { AgentAttachment as PolicyAttachment } from '../policy/run-policy';
import type { BridgePromptAttachment } from '../agent/prompt';

export type AttachmentKind = 'image' | 'file' | 'audio' | 'video' | 'sticker';
export type AttachmentDecision = 'accepted' | 'rejected' | 'skipped';

export interface AttachmentCandidate {
  absPath: string;
  kind: AttachmentKind;
  size: number;
  mime: string;
  hash: string;
  source: 'lark';
  sourceMessageId: string;
  sourceFileKey: string;
  originalName?: string;
}

export interface NormalizedAttachment extends AttachmentCandidate {
  path: string;
  requiredness: 'required' | 'optional';
  decision: AttachmentDecision;
  rejectionReason?: string;
}

export interface AttachmentPolicyOptions {
  maxCount: number;
  maxBytes: number;
  maxFileBytes: number;
  imageMaxBytes: number;
}

const DEFAULT_POLICY: AttachmentPolicyOptions = {
  maxCount: 10,
  maxBytes: 100 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  imageMaxBytes: 25 * 1024 * 1024,
};

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MIME_EXT: Record<string, string> = {
  ...IMAGE_MIME_EXT,
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/json': 'json',
};

export function normalizeAttachments(
  candidates: readonly AttachmentCandidate[],
  options: Partial<AttachmentPolicyOptions> = {},
): NormalizedAttachment[] {
  const policy = { ...DEFAULT_POLICY, ...options };
  let acceptedCount = 0;
  let acceptedBytes = 0;

  return candidates.map((candidate) => {
    const base = {
      ...candidate,
      path: candidate.absPath,
      requiredness: 'optional' as const,
    };
    const early = earlyDecision(candidate);
    if (early) return { ...base, ...early };

    if (acceptedCount >= policy.maxCount) {
      return reject(base, 'too-many-attachments');
    }
    if (candidate.size > policy.maxFileBytes) {
      return reject(base, 'file-too-large');
    }
    if (candidate.kind === 'image' && candidate.size > policy.imageMaxBytes) {
      return reject(base, 'image-too-large');
    }
    if (acceptedBytes + candidate.size > policy.maxBytes) {
      return reject(base, 'run-too-large');
    }

    acceptedCount++;
    acceptedBytes += candidate.size;
    return { ...base, decision: 'accepted' as const };
  });
}

export function safeExtensionForMime(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? 'bin';
}

export function toPolicyAttachment(attachment: NormalizedAttachment): PolicyAttachment {
  return {
    kind: attachment.kind,
    path: attachment.absPath,
    hash: attachment.hash,
    size: attachment.size,
    originalName: attachment.originalName,
    requiredness: attachment.requiredness,
    decision: attachment.decision,
    ...(attachment.rejectionReason ? { rejectionReason: attachment.rejectionReason } : {}),
  };
}

export function toPromptAttachment(attachment: NormalizedAttachment): BridgePromptAttachment {
  return {
    path: attachment.absPath,
    kind: attachment.kind,
    hash: attachment.hash,
    size: attachment.size,
    mime: attachment.mime,
    sourceMessageId: attachment.sourceMessageId,
    requiredness: attachment.requiredness,
    decision: attachment.decision,
    ...(attachment.rejectionReason ? { rejectionReason: attachment.rejectionReason } : {}),
  };
}

function earlyDecision(
  candidate: AttachmentCandidate,
): Pick<NormalizedAttachment, 'decision' | 'rejectionReason'> | undefined {
  if (candidate.kind === 'sticker') {
    return { decision: 'skipped', rejectionReason: 'sticker' };
  }
  if (candidate.kind === 'audio' || candidate.kind === 'video') {
    return { decision: 'skipped', rejectionReason: 'unsupported-kind' };
  }
  if (candidate.kind === 'image' && !IMAGE_MIME_EXT[candidate.mime.toLowerCase()]) {
    return { decision: 'rejected', rejectionReason: 'unsupported-image-mime' };
  }
  return undefined;
}

function reject(
  base: Omit<NormalizedAttachment, 'decision' | 'rejectionReason'>,
  reason: string,
): NormalizedAttachment {
  return { ...base, decision: 'rejected', rejectionReason: reason };
}
