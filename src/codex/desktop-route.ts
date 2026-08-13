import { spawn } from 'node:child_process';

export interface DesktopThreadLaunch {
  command: string;
  args: string[];
}

/**
 * Mount a newly-created bridge thread in the already-installed desktop app so
 * the private IPC follower accepts subsequent live snapshots. Failure is
 * intentionally non-fatal; App Server persistence remains the fallback.
 */
export function activateDesktopThread(
  threadId: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (env.CODEX_LARK_DESKTOP_AUTO_FOLLOW === '0') return;
  const launch = desktopThreadLaunch(threadId, platform);
  if (!launch) return;
  const child = spawn(launch.command, launch.args, {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}

export function desktopThreadLaunch(
  threadId: string,
  platform: NodeJS.Platform = process.platform,
): DesktopThreadLaunch | undefined {
  const url = `codex://threads/${encodeURIComponent(threadId)}`;
  if (platform === 'darwin') {
    return { command: '/usr/bin/open', args: [url] };
  }
  if (platform !== 'win32') return undefined;

  // Match the upstream Codex Windows launcher: resolve the protocol owner
  // from the signed OpenAI.Codex package manifest, then start the declared
  // Electron entry point. A plain Start-Process on the codex:// URL is not
  // reliable for internal executables protected by WindowsApps ACLs.
  const script = String.raw`& {
param($url)
$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue
if ($null -eq $package) { exit 1 }
$manifest = Get-AppxPackageManifest -Package $package.PackageFullName
$application = $manifest.Package.Applications.Application |
  Where-Object {
    @($_.Extensions.Extension) | Where-Object {
      $_.Category -eq 'windows.protocol' -and $_.Protocol.Name -eq 'codex'
    }
  } |
  Select-Object -First 1
if ($null -eq $application -or [string]::IsNullOrWhiteSpace($application.Executable)) { exit 1 }
$exe = Join-Path $package.InstallLocation $application.Executable
$appDir = Split-Path -Parent $exe
$app = Join-Path $appDir 'resources\app.asar'
if (-not (Test-Path $exe) -or -not (Test-Path $app)) { exit 1 }
Start-Process -FilePath $exe -WorkingDirectory $appDir -ArgumentList @('resources\app.asar', $url)
}`;
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', script, url],
  };
}
