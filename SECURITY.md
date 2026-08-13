# Security policy

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving App Secrets, callback forgery, access-control bypass, arbitrary local file access, command approvals, Desktop IPC impersonation, or secret/log leakage. Use GitHub private vulnerability reporting. If it is unavailable, contact the repository owner privately and include a minimal reproduction without real credentials or transcripts.

Maintainers should acknowledge reports within 7 days and publish a remediation timeline after validation. There is no bug bounty promise.

## Security model

- First-run registration is rendered in the local terminal; the bridge does not expose a setup web server.
- Feishu card callbacks use signed, scoped, nonce-protected actions.
- The application owner is the initial administrator; other user/group lists are closed by default.
- Fresh Codex tasks default to workspace access, with full access as a user-selectable maximum.
- Approval requests are shown to the user and are never automatically accepted by the bridge.
- App Secrets are encrypted at rest and are never rendered in terminal status output or the QR code.
- Logs are local and sanitized. Raw task content must not be added to telemetry.
- Desktop IPC uses a local Unix socket on macOS and a named pipe on Windows. Any process running as the same operating-system user may share that trust boundary; do not run untrusted software under the same account.

## Supported versions

Until 1.0, security fixes are made on the latest release line only. Desktop IPC can be disabled with `CODEX_LARK_DESKTOP_IPC=0` if a Desktop update introduces unexpected behavior.
