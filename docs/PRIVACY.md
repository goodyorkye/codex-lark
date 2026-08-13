# Privacy

## Data flow

Messages and files sent in Feishu/Lark pass through that platform and the local bridge. Prompts and selected local files are then processed by the Codex Desktop account and services configured on the local computer. Review the privacy and retention terms of both services before use.

`codex-lark` does not add a hosted relay or local web dashboard. The project ships no telemetry backend; an optional telemetry adapter can receive only sanitized operational events and must not receive prompts, transcripts, credentials, or file contents.

## Local data

`~/.codex-lark/` can contain encrypted app credentials, chat-to-task selection, workspace aliases, downloaded attachment cache, callback nonces, locks, sanitized logs, and on Windows a versioned runtime copy of the signed core taken from the installed Desktop package. The canonical Codex task history remains in the Codex task store managed by the Desktop core.

Attachment cache entries expire and are garbage-collected. Removing a profile archives its state by default; permanent deletion requires the explicit `--purge --yes` CLI combination.

## Recommended operation

- Use a dedicated operating-system account if the computer is shared with untrusted users or software.
- Keep group access closed unless collaboration is intentional.
- Do not paste production secrets into tasks.
- Review approval cards carefully, especially commands and file changes outside the selected project.
- Stop the bridge when remote access is not needed.
