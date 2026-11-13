# Changelog

All notable changes are documented here. The project follows Semantic Versioning after the first stable release.

## [Unreleased]

## [0.3.0] - 2026-11-13

### Added

- Connect an existing Dot's original ChatGPT conversation through the same Feishu/Lark bot, with dedicated switch/return buttons that preserve Codex projects, tasks, model selection, composed input and queued work.
- Forward text, original images and files into the native Dot room, and return the Dot's text and generated image/file attachments to their source Feishu messages, including after switching back to Codex.
- Transcribe voice input through the optional Aliyun Model Studio API and retain the original audio in the Dot conversation. Missing API keys produce local setup instructions in Feishu before audio is downloaded or forwarded; no local speech runtime or TTS is included.
- Track the native room's actual turn lifecycle so intermediate progress cannot finalize an input before a later file attachment arrives. Preserve stable request IDs, source deduplication, restart recovery and explicit handling of uncertain delivery or interleaved native input.

### Changed

- Correct the runtime requirement to Node.js 20.19+ (20.x), or 22.12 and later, matching the existing SDK module-loading requirements. Unsupported runtimes now receive a clear startup message instead of an ESM stack trace; CI also covers Node 20.19 on all supported operating systems.

### Notes

- Dots is opt-in and experimental: it relies on internal client messaging APIs. Original-room live acceptance is complete on macOS ChatGPT 26.1106.51428; Windows original-Dot live testing remains pending. Existing Codex functionality remains available on both platforms.
- Enable with `codex-lark dots init`, restart, then choose **Switch to Dots** in the owner's private chat. No Tunnel, custom MCP plugin, pairing code or initial browser setup is required. See `docs/DOTS.md` for limits, audio configuration and recovery.

## [0.2.10] - 2026-11-11

### Added

- Show the local system push time in `codex-lark notify` result cards.

### Fixed

- Include valid Desktop projects missing from the legacy `project-order` field so projects remain available from Feishu/Lark while Desktop migrates them to App Server project IDs.
- Update the Vitest/Vite development toolchain and transitive build dependencies to patched versions for newly disclosed vulnerabilities.

## [0.2.9] - 2026-11-09

### Fixed

- Read and write large ChatGPT Desktop IPC frames without repeatedly copying the complete accumulated payload, preventing sustained CPU usage and multi-gigabyte memory growth on long conversations.
- Update transitive HTTP dependencies to patched versions for newly disclosed axios, follow-redirects, and qs vulnerabilities.

## [0.2.8] - 2026-09-29

### Fixed

- Discover the Codex executable in the new ChatGPT Desktop `Resources/codex-cli/bin` layout and automatically repair stale Desktop-owned binary paths after an app upgrade.
- Normalize bridge-owned text inputs for ChatGPT Desktop 26.924 so Feishu/Lark-started turns no longer crash the conversation view until the app is restarted.

## [0.2.7] - 2026-09-02

### Changed

- Run the managed `codex-lark-notify` skill through `npx codex-lark@latest` so notifications do not require a global CLI installation.

## [0.2.6] - 2026-09-01

### Fixed

- Bind new Feishu/Lark-created Codex threads to the matching Desktop project so they appear in that project's conversation list.

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
