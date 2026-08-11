# Protocol notes

The primary protocol is the documented Codex App Server JSON-RPC dialect over newline-delimited JSON on stdio.

## Lifecycle

1. Spawn the Desktop-bundled executable with `app-server --listen stdio://`.
2. Send `initialize` with client metadata and capabilities.
3. Receive the response and send the `initialized` notification.
4. Keep one process alive for task listing, task runs, and approvals.
5. On shutdown, stop IPC followers and terminate the child gracefully before a forced fallback.

## Operations used

- `thread/list`, `thread/read`, `thread/start`, `thread/resume`
- `turn/start`, `turn/interrupt`
- `model/list`
- notifications such as `item/agentMessage/delta`, item lifecycle, token usage, and `turn/completed`
- server requests for command execution, file changes, and permission approvals

Approval requests are answered using the same JSON-RPC ID. Permission approvals return a permissions/scope result; command and file requests return a decision.

## Compatibility discipline

- Unknown notifications and item types are ignored rather than treated as fatal.
- Required IDs are correlated by thread and turn.
- Notifications received in the same read batch as `turn/start` are buffered until the response establishes the turn ID.
- Raw invalid JSON emits a protocol error but does not reveal full payloads in user-facing output.
- Protocol changes require fixture-based tests.

Reference: [official OpenAI Codex App Server documentation](https://developers.openai.com/codex/app-server/).
