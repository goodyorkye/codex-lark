import { afterAll, describe, expect, it } from 'vitest';
import { CodexAppServerClient } from '../../../src/codex/app-server/client';
import { resumeThreadWithDesktopHandoff } from '../../../src/agent/codex/app-server-adapter';

const threadId = process.env.CODEX_LARK_LIVE_THREAD_ID;
const cwd = process.env.CODEX_LARK_LIVE_THREAD_CWD;
const binaryPath = process.env.CODEX_LARK_LIVE_CODEX_BINARY;
const enabled = Boolean(threadId && cwd && binaryPath);
let client: CodexAppServerClient | undefined;

describe.skipIf(!enabled)('Desktop-owned live resume smoke', () => {
  afterAll(async () => {
    await client?.stop();
  });

  it('resumes through the Desktop owner without starting a turn', async () => {
    client = new CodexAppServerClient({ binaryPath: binaryPath! });
    await client.start();
    const thread = await resumeThreadWithDesktopHandoff(client, threadId!, { cwd: cwd! });
    expect(thread.id).toBe(threadId);
  });
});
