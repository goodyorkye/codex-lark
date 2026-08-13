# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first stable release.

## [Unreleased]

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
