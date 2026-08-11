# Troubleshooting

## “没有找到 ChatGPT / Codex Desktop”

Install the official macOS app in `/Applications` or `~/Applications`, open it once, and sign in. `codex-lark` intentionally ignores separately installed commands on `PATH`.

## The QR code expired

Click **重新检查** in the local dashboard. A new registration flow and QR code will be created.

## The bot exists but does not answer

Keep the Mac awake and confirm both OpenAI and Feishu/Lark are reachable from the Mac. Reopen Codex Lark.app and check its local status page. Duplicate processes are rejected, so seeing “already running” is normally harmless.

## A Desktop task is missing on the phone

Send `/tasks` to refresh App Server history. Live Desktop mirroring additionally needs the current Desktop IPC socket. If a Desktop update changed it, disable IPC with `CODEX_LARK_DESKTOP_IPC=0`; history and bridge-started tasks should still work through App Server.

## Login or authorization errors

Open ChatGPT/Codex Desktop, verify the account is signed in, and retry. The bridge reuses Desktop-owned authentication and does not accept an OpenAI API key as a replacement.

## Resetting a broken local setup

Use `codex-lark profile export codex --output ./backup.json` first. `codex-lark profile remove codex` archives state recoverably. Permanent deletion requires `--purge --yes`; it cannot be undone.
