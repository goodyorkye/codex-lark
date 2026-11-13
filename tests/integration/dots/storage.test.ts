import { join } from 'node:path';
import { readdir, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeDots, loadDotsConfig } from '../../../src/dots/storage';
import { loadDotsRuntime } from '../../../src/dots/runtime';
import { createTmpProfile } from '../../helpers/tmp-profile';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
describe('native Dots opt-in configuration', () => {
  it('enables the native backend without service credentials, HTTP listeners or subscription setup', async () => {
    const tmp = await createTmpProfile('dots-config-'); cleanups.push(tmp.cleanup); const dir = join(tmp.profile, 'dots');
    expect(await loadDotsRuntime(dir, 'app-test')).toBeUndefined();
    expect(await initializeDots(dir, 'app-test')).toEqual({ version: 1, appId: 'app-test', backend: 'desktop' });
    expect(await readdir(dir)).toEqual(['config.json']);
    const runtime = await loadDotsRuntime(dir, 'app-test'); cleanups.push(() => runtime!.close());
    expect(runtime?.bridge.kind).toBe('desktop'); expect(runtime?.bridge.status().connected).toBe(false);
    await expect(loadDotsConfig(dir, 'other-app')).rejects.toThrow('another Feishu app');
    await expect(initializeDots(dir, 'other-app')).rejects.toThrow('another Feishu app');
  });
  it('retires the old event configuration only on explicit init and preserves unrelated private files', async () => {
    const tmp = await createTmpProfile('dots-config-'); cleanups.push(tmp.cleanup); const dir = join(tmp.profile, 'dots');
    await initializeDots(dir, 'app-test');
    await writeFile(join(dir, 'config.json'), JSON.stringify({ version: 1, appId: 'app-test', port: 8790, backend: 'events' }), { mode: 0o600 });
    await writeFile(join(dir, 'old-state.json'), 'preserved', { mode: 0o600 });
    expect(await loadDotsRuntime(dir, 'app-test')).toBeUndefined();
    await initializeDots(dir, 'app-test'); expect((await loadDotsConfig(dir, 'app-test'))?.backend).toBe('desktop');
    expect(await readdir(dir)).toEqual(['config.json', 'old-state.json']);
  });
});
