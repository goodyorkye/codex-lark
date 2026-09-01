# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first stable release.

## [Unreleased]

## [0.2.5] - 2026-09-01

### Added

- Send `codex-lark notify` results as interactive cards with source profile, project, and Codex thread context, plus actions to continue the thread or view its details.

### Changed

- Discover the current Codex thread from `CODEX_THREAD_ID` and add `--thread`, `--task-title`, and `--plain` notification options.

## [0.2.4] - 2026-09-01

### Added

- Add `codex-lark notify` for pushing completed task results, Markdown, images, audio, video, and files directly to the configured Feishu/Lark recipient.
- Add the `codex-lark-notify` Codex skill and install it automatically as a managed user skill under `~/.agents/skills`.
- Add `codex-lark skill install`, `status`, and `remove` commands with user-change protection.

### Fixed

- Allow history resource delivery without a reply target so direct notifications can reuse the native media delivery pipeline.

## [0.2.3] - 2026-09-01

### Fixed

- Deliver generated images and other Codex turn resources as native Feishu/Lark messages without leaving invalid resource elements in streaming cards.

## [0.2.2] - 2026-08-24

### Changed

- Resume existing ChatGPT or Codex Desktop tasks from Feishu/Lark while keeping Desktop-owned task history and routing.

## [0.2.1] - 2026-08-13

### Changed

- Display the current `codex-lark` version in the foreground terminal startup title.
- Make the concise Chinese guide the default repository README, with English available separately, an anonymized Feishu card preview, and links to the upstream reference projects.

## [0.2.0] - 2026-08-13

### Added

- Foreground npm/npx launcher with terminal QR registration and connection status.
- Codex Desktop bundled-core discovery with no `PATH` fallback.
- Windows support for official Store-package discovery, Desktop task routing, named-pipe IPC, and process-tree shutdown.
- Per-user Windows Desktop-core materialization to avoid `spawn EPERM` under the Microsoft Store `WindowsApps` ACL.
- App Server threads, turns, history, models, streaming, interruption, images, and approvals.
- Feishu project/task/model navigation cards and signed approval actions.
- Optional Remodex-derived Desktop IPC mirroring.
- Open-source governance, security, architecture, privacy, development, and release documentation.

### Changed

- Normal startup now uses `codex-lark` with no subcommand; `run` remains a compatibility alias.
- Release artifacts are standard npm packages instead of a standalone macOS application.
- Terminal connection status labels the operating-system PID as a decimal number.
- Foreground shutdown now captures Windows Ctrl+C directly in the terminal, retains signal fallbacks, restores terminal state, applies a bounded graceful timeout, and supports second-press forced exit.

### Fixed

- Release bridge-owned App Server threads after each completed phone turn so the same task can immediately reopen in Codex Desktop.
- Treat `no-client-found` as a normal local App Server fallback instead of printing a misleading Desktop follower failure.
- Materialize Desktop-owned Windows App Server files outside the protected `WindowsApps` directory to avoid `spawn EPERM`.

### Removed

- The local browser dashboard and operating-system service commands from the preview release surface.

## [0.1.0] - 2026-08-11

Initial preview project structure.
