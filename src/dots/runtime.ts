import { loadDotsConfig } from './storage';
import { DesktopDotsBridge, DesktopDotsRuntime } from './desktop-bridge';

export async function loadDotsRuntime(dir: string, appId: string): Promise<DesktopDotsRuntime | undefined> {
  if (!await loadDotsConfig(dir, appId)) return undefined;
  return new DesktopDotsRuntime(await DesktopDotsBridge.open(dir, appId));
}
