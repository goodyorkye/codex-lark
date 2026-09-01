export type JsonRpcId = number | string;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcMessage {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: JsonRpcError;
}

export interface CodexThread {
  id: string;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: unknown;
  path?: string | null;
  cwd: string;
  name?: string | null;
  model?: string;
  reasoningEffort?: string | null;
  turns?: CodexTurn[];
  [key: string]: unknown;
}

export interface CodexProject {
  id: string;
  name: string;
  roots: Array<{ path: string }>;
  metadata?: Record<string, string>;
  position?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface CodexTurn {
  id: string;
  status?: string;
  items?: CodexThreadItem[];
  [key: string]: unknown;
}

export interface CodexThreadItem {
  id?: string;
  type: string;
  text?: string;
  phase?: 'commentary' | 'final_answer' | string;
  content?: unknown[];
  summary?: unknown;
  review?: string;
  path?: string;
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: unknown[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description?: string;
  }>;
  inputModalities?: string[];
}

export interface ApprovalRequest {
  requestId: JsonRpcId;
  method:
    | 'item/commandExecution/requestApproval'
    | 'item/fileChange/requestApproval'
    | 'item/fileRead/requestApproval'
    | 'item/permissions/requestApproval';
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  detail: string;
  params: Record<string, unknown>;
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export function rpcIdKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}
