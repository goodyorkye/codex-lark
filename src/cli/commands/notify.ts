import { createLarkChannel, type LarkChannel, type LarkChannelOptions } from '@larksuite/channel';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { sendHistoryResources, type HistoryMediaReport } from '../../bot/history-media';
import {
  inferHistoryResourceKind,
  projectHistoryMarkdown,
  type HistoryResource,
} from '../../card/history-content';
import { resolveAppPaths } from '../../config/app-paths';
import {
  loadRootConfig,
  readActiveProfile,
  runtimeProfileConfig,
} from '../../config/profile-store';
import { resolveAppSecret } from '../../config/secret-resolver';
import { paths } from '../../config/paths';

const DEFAULT_TITLE = 'Codex 任务完成';

export interface NotifyOptions {
  profile?: string;
  to?: string;
  title?: string;
  markdownFile?: string;
  files?: string[];
  cwd?: string;
  stdin?: boolean;
  json?: boolean;
  rootDir?: string;
}

export interface NotifyResult {
  profile: string;
  messageId: string;
  recipient: 'owner' | 'explicit';
  resources: HistoryMediaReport;
}

export interface NotifyDependencies {
  createChannel?: (options: LarkChannelOptions) => LarkChannel;
  sendResources?: typeof sendHistoryResources;
  readStdin?: () => Promise<string>;
  print?: (text: string) => void;
}

export async function runNotify(
  message: string | undefined,
  options: NotifyOptions = {},
  deps: NotifyDependencies = {},
): Promise<NotifyResult> {
  const markdown = await resolveMarkdown(message, options, deps.readStdin ?? readStdin);
  const rootDir = options.rootDir ?? paths.rootDir;
  const appPaths = resolveAppPaths({ rootDir });
  const root = await loadRootConfig(appPaths.configFile);
  if (!root) throw new Error('config not initialized; run codex-lark once before using notify');

  const profile = options.profile?.trim()
    || await readActiveProfile(rootDir)
    || root.activeProfile;
  if (!profile) throw new Error('no active profile; use --profile <name>');

  const cfg = runtimeProfileConfig(root, profile);
  const profilePaths = resolveAppPaths({ rootDir, profile });
  const appSecret = await resolveAppSecret(cfg, profilePaths);
  const createChannel = deps.createChannel ?? createLarkChannel;
  const channel = createChannel({
    appId: cfg.accounts.app.id,
    appSecret,
    domain: cfg.accounts.app.tenant === 'lark'
      ? 'https://open.larksuite.com'
      : 'https://open.feishu.cn',
    source: 'codex-lark-notify',
    httpTimeoutMs: 30_000,
    respectProxyEnv: true,
    logger: quietLogger(),
  });

  const explicitTarget = options.to?.trim();
  const recipient = explicitTarget || await resolveOwner(channel);
  const cwd = resolveNotificationCwd(options);
  const projected = projectHistoryMarkdown(markdown);
  const resources = dedupeResources([
    ...projected.resources,
    ...explicitFileResources(options.files ?? [], cwd),
  ]);
  const body = notificationMarkdown(options.title, projected.markdown, options.files ?? []);
  const sent = await channel.send(recipient, { markdown: body });
  const sendResources = deps.sendResources ?? sendHistoryResources;
  const report = await sendResources(channel, recipient, sent.messageId, cwd, resources);
  if (report.failed > 0 || report.skipped > 0) {
    throw new Error(
      `notification sent but resources incomplete: sent=${report.sent}, `
      + `skipped=${report.skipped}, failed=${report.failed}`,
    );
  }

  const result: NotifyResult = {
    profile,
    messageId: sent.messageId,
    recipient: explicitTarget ? 'explicit' : 'owner',
    resources: report,
  };
  const print = deps.print ?? console.log;
  if (options.json) {
    print(JSON.stringify(result));
  } else {
    print(`✓ 已推送到飞书（profile=${profile}, resources=${report.sent}）`);
  }
  return result;
}

async function resolveMarkdown(
  message: string | undefined,
  options: NotifyOptions,
  readInput: () => Promise<string>,
): Promise<string> {
  const sources = [Boolean(message?.trim()), Boolean(options.markdownFile), options.stdin === true]
    .filter(Boolean).length;
  if (sources > 1) {
    throw new Error('use only one of [message], --markdown-file, or --stdin');
  }
  if (message?.trim()) return message.trim();
  if (options.markdownFile) {
    return (await readFile(resolve(options.markdownFile), 'utf8')).trim();
  }
  if (options.stdin) return (await readInput()).trim();
  if ((options.files?.length ?? 0) > 0) return '任务已完成，相关文件见附件。';
  throw new Error('notification content is required');
}

function resolveNotificationCwd(options: NotifyOptions): string {
  if (options.cwd) return resolve(options.cwd);
  if (options.markdownFile) return dirname(resolve(options.markdownFile));
  return process.cwd();
}

async function resolveOwner(channel: LarkChannel): Promise<string> {
  const { ownerId } = await channel.getAppInfo({
    lang: 'zh_cn',
    userIdType: 'open_id',
  });
  const owner = ownerId?.trim();
  if (!owner) throw new Error('application owner missing; use --to <open_id|chat_id>');
  return owner;
}

function notificationMarkdown(
  title: string | undefined,
  markdown: string,
  files: readonly string[],
): string {
  const heading = (title?.trim() || DEFAULT_TITLE).replace(/[\r\n]+/g, ' ').slice(0, 120);
  const attachmentNames = files
    .map((file) => basename(file.trim()))
    .filter(Boolean);
  return [
    `## ${heading}`,
    markdown,
    attachmentNames.length > 0 ? `📎 附件：${attachmentNames.join('、')}` : '',
  ].filter(Boolean).join('\n\n');
}

function explicitFileResources(files: readonly string[], cwd: string): HistoryResource[] {
  return files
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => {
      const source = isAbsolute(file) ? file : resolve(cwd, file);
      return {
        kind: inferHistoryResourceKind(source),
        source,
        label: basename(source),
        origin: 'agent-output' as const,
      };
    });
}

function dedupeResources(resources: readonly HistoryResource[]): HistoryResource[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.kind}\u0000${resource.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function quietLogger(): LarkChannelOptions['logger'] {
  return {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
  };
}
