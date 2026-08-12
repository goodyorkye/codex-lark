# codex-lark

Control the Codex Desktop tasks on your Mac from Feishu or Lark. Install no separate Codex CLI, expose no public web server, and create no developer-console bot by hand.

[简体中文](README.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Roadmap](ROADMAP.md)

> Status: early preview for macOS. The core App Server integration is covered by automated tests; Desktop IPC mirroring is experimental because that local Desktop interface is not a documented public contract.

## What it does

- Finds the Codex core bundled with `ChatGPT.app` or `Codex.app`; it never falls back to a `codex` executable on `PATH`.
- Reads projects, task lists, full task history, and available models through Codex App Server.
- Starts a new task or continues an existing one from Feishu/Lark.
- Streams text, reasoning summaries, tool activity, usage, errors, and completion state into live cards.
- Sends images and downloaded attachments to Codex as local inputs.
- Presents command, file-change, and permission approvals as signed card actions.
- Optionally mirrors active Desktop-owned tasks over the local Desktop IPC bus, based on the relevant Remodex implementation.
- Creates a PersonalAgent by QR code with `@larksuite/channel`; no Feishu developer-console setup is required.

The App Server portion follows the [official OpenAI Codex App Server documentation](https://developers.openai.com/codex/app-server/): JSONL over stdio, initialization, threads, turns, models, streaming notifications, and server-initiated approvals.

## Easiest setup on macOS

1. Install and sign in to the official ChatGPT or Codex Desktop app.
2. Download `codex-lark-macos-*.zip` from Releases, unzip it, and open **Codex Lark.app**.
3. A local setup page opens. Scan its QR code with Feishu/Lark once.
4. Open the newly created personal assistant on your phone and send `/projects`.

The setup page listens only on a random `127.0.0.1` port and requires a random per-process token. The App Secret remains in the bridge process and is never returned to the browser.

Unsigned development builds use ad-hoc signing. On first open, macOS may require **Control-click → Open**. Official releases should be Developer ID signed and notarized before broad distribution.

## Phone commands

Normal use does not require typing commands. Every completed Codex reply includes a two-by-two **Recent tasks / Choose project / New task / Switch model** navigator. Recent tasks are ordered across projects by last activity and switch with one tap; selecting a project immediately opens its task list.

| Command | Result |
| --- | --- |
| `/projects` | List Codex projects discovered from task history |
| `/project use <path>` | Select a project for this chat |
| `/tasks` | List recent tasks in the selected project |
| `/task use <id>` | Continue an existing task |
| `/task show <id>` | Show the task transcript |
| `/new` | Start a new task in the current project |
| `/models` | List models reported by the active Desktop core |
| `/model use <model>` | Select a model for later messages in this chat |
| `/stop` | Interrupt the active turn |
| `/status` | Show the current project, task, model, and run state |
| `/help` | Show the phone remote commands |

The legacy `/reset`, `/resume`, `/cd`, and `/ws` commands are redundant in Codex phone-remote mode and are replaced by `/new`, `/tasks`, and `/projects`. Internal account, process, reconnect, and group-access maintenance commands are not exposed in the phone remote UI.

Approval cards offer **Allow once**, **Allow for session** where supported, and **Decline**. The bridge does not silently approve a request.

Cloud-doc comments are document-scoped: people who can access the document can see and use its comment thread according to Feishu permissions.

## How the no-CLI promise works

`codex-lark` does launch a local App Server process, but the executable comes from the installed official Desktop app:

```text
/Applications/ChatGPT.app/Contents/Resources/codex app-server --listen stdio://
```

That is not a separately installed Codex CLI. Desktop owns its installation, updates, local task store, and ChatGPT authentication. An optional local IPC follower makes Desktop-started activity visible to the bridge and exposes bridge-started activity back to Desktop when the current app version supports it.

## Data and permissions

State is stored under `~/.codex-lark/` by default. Set `CODEX_LARK_HOME` for an isolated development profile.

Fresh profiles use the canonical configuration:

```json
{
  "permissions": {
    "defaultAccess": "workspace",
    "maxAccess": "full"
  }
}
```

The legacy `sandbox` field is accepted only when migrating older bridge configurations. It is not the recommended configuration surface.

The QR creator is resolved as the application owner and is the initial administrator. Access lists are otherwise closed by default. Secrets are encrypted at rest through the local keystore implementation; logs redact credentials, resource identifiers, prompts, and local paths.

See [docs/PRIVACY.md](docs/PRIVACY.md) and [SECURITY.md](SECURITY.md) before operating this on a shared Mac.

## Development

Requirements: macOS 13+, Node.js 22, pnpm, and an installed ChatGPT/Codex Desktop app for real integration checks.

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm package:mac
```

Run the development dashboard:

```bash
pnpm build
node dist/cli.cjs desktop
```

The CLI remains available for maintainers and headless service setup:

```bash
codex-lark run
codex-lark start
codex-lark status
codex-lark stop
codex-lark profile export codex --output ./profile.json
codex-lark profile remove codex
codex-lark profile remove codex --purge --yes
codex-lark profile export codex --include-secrets --yes
```

Each profile is a per-profile service and keeps a profile-local lark-cli directory for compatibility features. The recommended Desktop dashboard skips lark-cli installation and does not require it for chat, cards, files, or approvals. The lark-cli identity policy applies only to optional agent-side Feishu tools.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for test layers and release steps.

## Compatibility and limitations

- macOS is the supported end-user platform in `0.1.x`.
- Codex App Server is the primary integration. Desktop IPC is best-effort and can be disabled with `CODEX_LARK_DESKTOP_IPC=0`.
- A newer Desktop release can change its private IPC behavior. App Server behavior follows the documented protocol, but bundled versions can still differ.
- The bridge must remain running on the Mac and the Mac must have network access to OpenAI and Feishu/Lark.
- This project is not affiliated with or endorsed by OpenAI, Feishu, ByteDance, or Remodex.

## License and provenance

The project is MIT licensed. Portions adapted from Lark Channel Bridge remain under MIT; the vendored Desktop IPC modules adapted from Remodex remain under Apache-2.0. See [NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
