---
name: codex-lark-notify
description: Push a completed Codex task result and requested output files to the user's Feishu/Lark bot with codex-lark. Use when the user asks to notify them, push the result to their phone, or send the completed work to Feishu/Lark. Do not use for ordinary replies that lack an explicit push request.
---

# Codex Lark Notify

Finish and verify the requested work before sending its result. The user's request to push or notify authorizes this one outbound notification; it does not authorize unrelated messages or recipients.

Use the npm-hosted CLI for delivery so the skill does not depend on a globally installed `codex-lark` executable:

```bash
npx --yes codex-lark@latest notify "任务已经完成。" --title "任务完成"
```

The default delivery is an interactive result card. In a Codex task, the command automatically reads `CODEX_THREAD_ID` and the current working directory, so the card identifies the source project and thread and provides actions to continue that thread or view its details. Do not add `--thread` or `--cwd` when the automatically detected context is correct. Card actions require the codex-lark bridge to be running when the user clicks them; the initial delivery does not.

Preserve Markdown line breaks as real newline characters. Never put the two literal characters `\\n` in the positional message. For a multi-line result, prefer an existing `--markdown-file`; otherwise pass actual line breaks in the message or use `--stdin`.

Prefer an existing Markdown result when the completed task produced one:

```bash
npx --yes codex-lark@latest notify \
  --title "任务完成" \
  --markdown-file /absolute/path/result.md \
  --cwd /absolute/path/to/workspace \
  --file /absolute/path/report.pdf
```

Repeat `--file` for multiple output files. Markdown image and file links are projected into native Feishu/Lark resource messages. `--cwd` defines the allowed workspace root used to resolve those local links; when omitted for `--markdown-file`, the file's directory is used.

Use `--plain` only when the user explicitly requests a plain, non-interactive Markdown notification.

The command uses the active profile by default. Add `--profile <name>` only when the user identifies another configured profile. The default recipient is that profile's Feishu/Lark application owner. Use `--to <open_id|chat_id>` only when the user explicitly identifies another recipient or chat.

Treat exit code zero as delivery success. Do not claim the notification was delivered when the command fails or reports incomplete resources. Report the failure to the user and do not retry unless the user asks.

This workflow sends immediately. It does not queue messages for later delivery and does not configure Codex notification hooks.
