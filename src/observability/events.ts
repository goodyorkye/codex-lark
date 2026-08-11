export const REQUIRED_OBSERVABILITY_EVENTS = [
  'run.started',
  'run.completed',
  'run.failed',
  'policy.denied',
  'callback.denied',
  'access.owner_refresh_failed',
  'jsonl.unknown_event',
  'attachment.decision',
  'comment.reply_failed',
] as const;

export type RequiredObservabilityEvent = (typeof REQUIRED_OBSERVABILITY_EVENTS)[number];
