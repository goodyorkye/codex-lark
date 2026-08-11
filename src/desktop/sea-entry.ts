import { runDesktopDashboard } from './dashboard';

void runDesktopDashboard({
  openBrowser: process.env.CODEX_LARK_NO_OPEN !== '1',
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
