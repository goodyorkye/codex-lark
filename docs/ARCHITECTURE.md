# Architecture

## Outcome

`codex-lark` is a local bridge. Feishu/Lark is the phone UI; Codex Desktop remains the installation, authentication, task-store, and execution owner on the Mac.

```text
Feishu/Lark phone
      │ encrypted long connection
      ▼
@larksuite/channel transport
      │ normalized messages / signed cards / files
      ▼
codex-lark runtime ─── local encrypted state (~/.codex-lark)
      │
      ├── JSONL stdio ── Desktop-bundled `codex app-server`
      │                     ├── threads and turns
      │                     ├── streaming events
      │                     ├── models
      │                     └── approvals
      │
      └── optional Unix socket ── Codex Desktop IPC
                                  ├── mirror Desktop-owned live tasks
                                  └── expose bridge-owned live tasks
```

## Components

### Desktop discovery

`src/codex/desktop-binary.ts` checks fixed macOS application bundle locations and an explicit development override. It intentionally ignores `PATH` so an unrelated or stale Codex CLI cannot change behavior.

### App Server client

`src/codex/app-server/client.ts` owns one long-lived subprocess and JSON-RPC request map. It sends `initialize`, then `initialized`, and exposes typed thread, turn, model, interruption, and approval operations. Notifications are converted into the bridge-neutral `AgentEvent` stream by `src/agent/codex/app-server-adapter.ts`.

### Desktop IPC

`src/vendor/remodex-ipc/` projects local live state onto the Desktop bus and follows Desktop-owned state. This is an optional compatibility layer, not the source of truth. It is isolated so it can fail or be disabled without replacing the App Server path.

### Feishu/Lark transport

The channel transport handles QR registration, long connection, message normalization, attachments, cards, callback authentication, document comments, access control, and reconnection. The runtime groups App Server threads by `cwd` to present projects and persists per-chat project/task/model selection.

### Setup dashboard

`src/desktop/dashboard.ts` binds a random local-only port, generates a random API token, renders the QR code, and reports status. It never serializes credentials into HTML or API responses. `src/desktop/sea-entry.ts` is bundled into a standalone macOS executable.

## Ownership rules

- The App Server child created by codex-lark owns bridge-started turns.
- Desktop IPC routing prevents a Desktop-owned thread from being mutated by a competing local owner.
- Feishu chat scopes retain only selection state; the canonical transcript remains in the Codex task store.
- Approval request IDs stay process-local and card callbacks use opaque bridge approval IDs.

## Failure boundaries

- A Feishu API failure affects the individual outgoing update and is logged without crashing the executor.
- App Server exit rejects pending RPC calls and ends active runs with a user-visible error.
- IPC failure falls back to App Server and reconnects independently.
- Duplicate bridge processes are prevented by profile and application locks.
