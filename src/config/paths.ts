import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveAppPaths } from './app-paths';

const appPaths = resolveAppPaths();

export const paths = {
  ...appPaths,
  appDir: appPaths.rootDir,
  cacheDir: appPaths.rootDir,
  processesFile: appPaths.userRegistryFile,
  /**
   * Thin shell wrapper that lark-cli and other exec-provider consumers invoke
   * to resolve secrets from the bridge's encrypted store.
   * Written user-owned and non-symlinked so it passes lark-cli's
   * AssertSecurePath audit on machines where `node` is a Homebrew/Volta
   * symlink or root-owned (`/usr/bin/node`). Wrapper internals do the
   * `node ... secrets get` invocation; lark-cli only audits the wrapper.
   */
};

/**
 * Pre-0.1.11 paths (XDG-style). Kept here only so the `migrate` command
 * can detect and move data out of the old location. Don't reference these
 * anywhere in the runtime.
 */
export const legacyPaths = {
  appDir: join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'lark-channel-bridge',
  ),
  cacheDir: join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'lark-channel-bridge',
  ),
};
