# Troubleshooting

## “没有找到 ChatGPT / Codex Desktop”

On macOS, install the official app in `/Applications` or `~/Applications`, open it once, and sign in.

On Windows, install the official Codex Desktop app from Microsoft Store, open it once, and sign in. To verify that Windows registered the package for the current user, run this read-only PowerShell command:

```powershell
Get-AppxPackage -Name OpenAI.Codex | Select-Object Name, Version, InstallLocation
```

`codex-lark` intentionally ignores separately installed commands on `PATH` on both platforms.

If Windows reports `spawn EPERM` while opening recent tasks, update `codex-lark` to a build that uses the per-user Desktop-core cache. The cache lives under `~/.codex-lark/runtime/windows-desktop-core/`; no administrator permission is required.

## The QR code expired

Press Ctrl+C and run `codex-lark` again. The terminal starts a new registration flow and prints a fresh QR code.

## The bot exists but does not answer

Keep the bridge computer awake and confirm both OpenAI and Feishu/Lark are reachable from it. Check the foreground terminal and `~/.codex-lark/profiles/codex/logs/`. Use `codex-lark ps` to find an existing bridge process; duplicate processes are rejected intentionally.

## Dot acknowledged a request, but its later result is missing in Feishu

Update to **0.3.1 or later** and restart the same profile. In 0.3.0, a Dot could finish its root turn after delegating work, so the bridge delivered its acknowledgement but missed the later result. The fix keeps checking delivered inputs for continuations and persists native message IDs for deduplication.

Existing configuration and bindings are retained. Within the original 24-hour processing window, an old delivery can recover automatically when its saved text and file IDs match the original reply prefix. Switching back to Codex does not disable that recovery. Uncertain sends require verification rather than an automatic retry; expired or disconnected records are not replayed.

The next native human input ends the preceding input's attribution window. Results arriving beyond that boundary without explicit correlation still need to be read in the client. Automation notifications are excluded. See the [Dots guide](DOTS.md) for upgrade commands and recovery limits.

## A Desktop task is missing on the phone

Send `/tasks` to refresh App Server history. Live Desktop mirroring additionally needs the current Desktop IPC endpoint (a Unix socket on macOS or named pipe on Windows). If a Desktop update changed it, disable IPC with `CODEX_LARK_DESKTOP_IPC=0`; history and bridge-started tasks should still work through App Server.

## Login or authorization errors

Open ChatGPT/Codex Desktop, verify the account is signed in, and retry. The bridge reuses Desktop-owned authentication and does not accept an OpenAI API key as a replacement.

## Resetting a broken local setup

Use `codex-lark profile export codex --output ./backup.json` first. `codex-lark profile remove codex` archives state recoverably. Permanent deletion requires `--purge --yes`; it cannot be undone.
