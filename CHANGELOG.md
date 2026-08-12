# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first stable release.

## [Unreleased]

### Added

- Foreground npm/npx launcher with terminal QR registration and connection status.
- Codex Desktop bundled-core discovery with no `PATH` fallback.
- App Server threads, turns, history, models, streaming, interruption, images, and approvals.
- Feishu project/task/model navigation cards and signed approval actions.
- Optional Remodex-derived Desktop IPC mirroring.
- Open-source governance, security, architecture, privacy, development, and release documentation.

### Changed

- Normal startup now uses `codex-lark` with no subcommand; `run` remains a compatibility alias.
- Release artifacts are standard npm packages instead of a standalone macOS application.

### Removed

- The local browser dashboard and operating-system service commands from the preview release surface.

## [0.1.0] - 2026-08-11

Initial preview project structure.
