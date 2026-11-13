# Architecture

## Outcome

`codex-lark` is a local bridge. Feishu/Lark is the phone UI; Codex Desktop remains the installation, authentication, task-store, and execution owner on the local Mac or Windows PC.

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
      └── optional local IPC ── Codex Desktop IPC
                                ├── Unix socket on macOS
                                ├── named pipe on Windows
                                ├── mirror Desktop-owned live tasks
                                └── expose bridge-owned live tasks
```

## Components

### Desktop discovery

`src/codex/desktop-binary.ts` checks fixed macOS application bundle locations or resolves the signed `OpenAI.Codex` package installed for the current Windows user. Since Windows may deny direct `CreateProcess` calls inside `WindowsApps`, the Desktop-owned core and known helper executables are materialized into a versioned per-user runtime cache before launch. An explicit binary override exists for tests and development. Production discovery intentionally ignores `PATH` so an unrelated or stale Codex CLI cannot change behavior.

### App Server client

`src/codex/app-server/client.ts` owns one long-lived subprocess and JSON-RPC request map. It sends `initialize`, then `initialized`, and exposes typed thread, turn, model, interruption, and approval operations. Notifications are converted into the bridge-neutral `AgentEvent` stream by `src/agent/codex/app-server-adapter.ts`.

### Desktop IPC

`src/vendor/remodex-ipc/` projects local live state onto the Desktop bus and follows Desktop-owned state. This is an optional compatibility layer, not the source of truth. It is isolated so it can fail or be disabled without replacing the App Server path.

### Feishu/Lark transport

The channel transport handles QR registration, long connection, message normalization, attachments, cards, callback authentication, document comments, access control, and reconnection. The runtime groups App Server threads by `cwd` to present projects and persists per-chat project/task/model selection.

### Terminal startup

The npm executable starts in the foreground. `src/cli/terminal-ui.ts` reports Desktop discovery and connection progress, while `src/bot/wizard.ts` renders the first-run QR code directly in the terminal. No browser, local web server, Electron runtime, or separately installed Codex CLI is involved. Closing the terminal or pressing Ctrl+C stops the bridge.

### Optional Dots backend

`src/dots/` provides an opt-in original-Dot connection behind the existing Feishu transport. The installed Desktop core supplies the current ChatGPT login through read-only `getAuthStatus`; a separate core with Desktop IPC disabled avoids competing for Codex task ownership. The bridge validates the account, primary Dot and both members of the native private room. Tokens remain in memory and are sent only to the fixed OpenAI HTTPS origin.

Inputs use a serial, source-bound durable queue with stable native request/idempotency IDs. Original image/file bytes are uploaded through the room's native file API; the bridge does not parse documents. Audio is sent directly to the optional Aliyun ASR API, then the transcript and original audio are attached to the native input. Missing credentials are reported before download or queueing. No local speech process, TTS, custom MCP server or Tunnel is involved.

The native room-live HTTPS/SSE and authenticated WebSocket channels supply root-turn identity and completion, including active child work. A prior completed turn or a quiet progress message cannot finalize a new input. After completion and a short consistency window, source-bound native replies and file IDs are forwarded to the original Feishu message, including after returning to Codex. Background updates are excluded. Account changes, interleaved human input and uncertain delivery stop automatic association or resending.

Private atomic `dots/desktop-state.json` stores the queue, text, transcripts, replies and file/resource IDs. Temporary input files are removed, and expiring file URLs and credentials are never persisted. Interrupted preparation can resume; interrupted native/Feishu sends require verification. Feishu ingress acknowledgement is not transactionally coupled to persistence. See [Dots](DOTS.md) for limits, recovery and real-account acceptance.

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
