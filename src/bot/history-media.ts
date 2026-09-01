import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LarkChannel, SendInput } from '@larksuite/channel';
import type { HistoryResource } from '../card/history-content';
import { log } from '../core/logger';

const MAX_RESOURCES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export interface HistoryMediaReport {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Deliver resources extracted from a historical Codex turn as native Feishu
 * messages. Local paths are allowed only inside the task workspace, resolved
 * through symlinks before reading. This prevents model-authored Markdown from
 * turning `/task latest` into an arbitrary local-file exfiltration primitive.
 */
export async function sendHistoryResources(
  channel: LarkChannel,
  recipientId: string,
  replyTo: string | undefined,
  cwd: string,
  resources: readonly HistoryResource[],
): Promise<HistoryMediaReport> {
  const report: HistoryMediaReport = { sent: 0, skipped: 0, failed: 0 };
  const visible = resources.slice(0, MAX_RESOURCES);
  report.skipped += Math.max(0, resources.length - visible.length);
  let totalBytes = 0;
  let workspaceRealpath: string | undefined;
  try {
    workspaceRealpath = await realpath(cwd);
  } catch {
    // Remote URL resources can still be sent. Local paths fail closed below.
  }

  for (const resource of visible) {
    try {
      const materialized = await materializeResource(resource, workspaceRealpath);
      if (!materialized) {
        report.skipped += 1;
        continue;
      }
      if (materialized.bytes !== undefined) {
        if (materialized.bytes > MAX_FILE_BYTES || totalBytes + materialized.bytes > MAX_TOTAL_BYTES) {
          report.skipped += 1;
          continue;
        }
        totalBytes += materialized.bytes;
      }
      await sendResource(channel, recipientId, replyTo, resource, materialized.source);
      report.sent += 1;
    } catch (error) {
      report.failed += 1;
      log.warn('history-media', 'send-failed', {
        kind: resource.kind,
        origin: resource.origin,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (report.sent || report.skipped || report.failed) {
    log.info('history-media', 'complete', {
      sent: report.sent,
      skipped: report.skipped,
      failed: report.failed,
    });
  }
  return report;
}

interface MaterializedResource {
  source: string | Buffer;
  bytes?: number;
}

async function materializeResource(
  resource: HistoryResource,
  workspaceRealpath: string | undefined,
): Promise<MaterializedResource | undefined> {
  if (isHttpUrl(resource.source)) return { source: resource.source };
  if (!workspaceRealpath) return undefined;
  const localPath = localPathFor(resource.source, workspaceRealpath);
  if (!localPath) return undefined;
  let targetRealpath: string;
  try {
    targetRealpath = await realpath(localPath);
  } catch {
    return undefined;
  }
  if (!isInside(workspaceRealpath, targetRealpath)) return undefined;
  const fileStat = await stat(targetRealpath);
  if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) return undefined;
  return { source: await readFile(targetRealpath), bytes: fileStat.size };
}

async function sendResource(
  channel: LarkChannel,
  recipientId: string,
  replyTo: string | undefined,
  resource: HistoryResource,
  source: string | Buffer,
): Promise<void> {
  const fileName = resourceFileName(resource);
  const preferred = preferredSendInput(resource, source, fileName);
  const options = replyTo ? { replyTo } : undefined;
  try {
    await channel.send(recipientId, preferred, options);
  } catch (error) {
    if ('file' in preferred) throw error;
    // Preview formats are stricter than generic files (for example Feishu
    // audio expects Opus and video expects MP4). Preserve delivery by falling
    // back to a normal file message when native media upload is rejected.
    await channel.send(recipientId, { file: { source, fileName } }, options);
  }
}

function preferredSendInput(
  resource: HistoryResource,
  source: string | Buffer,
  fileName: string,
): SendInput {
  if (resource.kind === 'image') return { image: { source } };
  const extension = extname(fileName).toLowerCase();
  if (resource.kind === 'audio' && (extension === '.opus' || extension === '.ogg')) {
    return { audio: { source } };
  }
  if (resource.kind === 'video' && extension === '.mp4') {
    return { video: { source } };
  }
  return { file: { source, fileName } };
}

function localPathFor(source: string, cwd: string): string | undefined {
  const trimmed = source.trim();
  const windowsPath = /^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed);
  if (!trimmed || (!windowsPath
    && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    && !trimmed.startsWith('file:'))) {
    return undefined;
  }
  if (trimmed.startsWith('file:')) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return undefined;
    }
  }
  const decoded = decodeURIComponentSafe(trimmed);
  return isAbsolute(decoded) ? decoded : resolve(cwd, decoded);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function resourceFileName(resource: HistoryResource): string {
  if (isHttpUrl(resource.source)) {
    try {
      const name = basename(new URL(resource.source).pathname);
      if (name) return decodeURIComponentSafe(name);
    } catch {
      // Fall through to the path-like fallback.
    }
  }
  const normalized = resource.source.replace(/\\/g, '/').replace(/\/+$/, '');
  return decodeURIComponentSafe(basename(normalized) || resource.label || 'attachment.bin');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
