import { buildLarkChannelEnv, type LarkChannelEnvContext } from '../agent/lark-channel-env';
import { mergeProcessEnv, spawnProcess } from '../platform/spawn';
import type { LarkCliIdentityPreset } from '../config/profile-schema';

const POLICY_TIMEOUT_MS = 30_000;
const USER_OPEN_ID_KEYS = ['userOpenId', 'openId', 'user_open_id', 'open_id'];

export function hasLarkCliUserAuth(users: unknown): boolean {
  if (hasStructuredLarkCliUserAuth(users)) return true;
  if (typeof users !== 'string') return false;
  return isLarkCliUserDisplayValue(users);
}

export function hasStructuredLarkCliUserAuth(users: unknown): boolean {
  if (Array.isArray(users)) return users.some(hasStructuredLarkCliUserAuth);
  if (!users || typeof users !== 'object') return false;
  if (hasLarkCliUserRecord(users)) return true;
  return Object.values(users).some(hasStructuredLarkCliUserAuth);
}

function hasLarkCliUserRecord(value: object): boolean {
  const record = value as Record<string, unknown>;
  return USER_OPEN_ID_KEYS.some((key) => {
    const id = record[key];
    return typeof id === 'string' && id.trim().length > 0;
  });
}

function isLarkCliUserDisplayValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(null|\(none\)|none|无|\(无\))$/i.test(trimmed)) return false;
  if (/^\(?no\s+logged[-\s]?in\s+users\)?$/i.test(trimmed)) return false;
  return true;
}

export async function applyLarkCliIdentityPolicy(
  context: LarkChannelEnvContext,
  identityPreset: LarkCliIdentityPreset,
): Promise<boolean> {
  const env = buildLarkChannelEnv(context);
  const strictMode = identityPreset === 'user-default' ? 'off' : 'bot';
  const defaultAs = identityPreset === 'user-default' ? 'auto' : 'bot';
  const strictResult = await runQuiet('lark-cli', ['config', 'strict-mode', strictMode], env);
  if (!strictResult) return false;
  return runQuiet('lark-cli', ['config', 'default-as', defaultAs], env);
}

async function runQuiet(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  let timedOut = false;
  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawnProcess(cmd, args, {
      env: mergeProcessEnv(process.env, env),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, POLICY_TIMEOUT_MS);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  return !timedOut && exitCode === 0;
}
