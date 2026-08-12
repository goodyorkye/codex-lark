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

## Easiest setup

Requirements: macOS 13+, Node.js 20.12+, and the signed-in official ChatGPT or Codex Desktop app.

Run directly without installing:

```bash
npx -y codex-lark@latest
```

On first run the terminal displays a QR code. Scan it with Feishu/Lark, then leave the terminal open while the bridge is in use. The terminal shows Desktop discovery, connection, and online status. Press Ctrl+C to stop. No browser opens, and no separate Codex CLI is installed or invoked.

For frequent use, install once and launch with a shorter command:

```bash
npm install -g codex-lark
codex-lark
```

The current release runs only in the foreground. Closing the terminal stops the bridge; OS service registration is intentionally deferred.

## Phone commands

Normal use does not require typing commands. Every completed Codex reply includes a common-actions navigator. Recent tasks are ordered across projects by last activity and switch with one tap; selecting a project immediately opens its task list.

To submit text, images, and files as one turn, tap **Compose input**, send every item, then tap **Send** on the basket card or reply with `发送`. Nothing reaches Codex while collection is active; the basket also supports undo, clear, and cancel.

| Command | Result |
| --- | --- |
| `/projects` | List Codex projects discovered from task history |
| `/project use <path>` | Select a project for this chat |
| `/tasks` | List recent tasks in the selected project |
| `/task use <id>` | Continue an existing task |
| `/task show <id>` | Show the task transcript |
| `/task latest` | Fetch the latest turn from the current task |
| `/new` | Start a new task in the current project |
| `/models` | List models reported by the active Desktop core |
| `/compose` | Collect text, images, and files and submit them as one turn |
| `/model select <model>` | Select a model and open its reasoning-effort choices |
| `/model effort <model> <effort>` | Set both model and reasoning effort for later messages |
| `/stop` | Interrupt the active turn |
| `/status` | Show the current project, task, model, and run state |
| `/help` | Show the phone remote commands |

A model and reasoning-effort choice overrides the current task and becomes the default for later new tasks. Switching to another existing task preserves that task's previous model settings.

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
The Feishu/Lark App Secret remains in the local bridge process and its encrypted local configuration; the terminal QR does not print it.

See [docs/PRIVACY.md](docs/PRIVACY.md) and [SECURITY.md](SECURITY.md) before operating this on a shared Mac.

## Development

Requirements: macOS 13+, Node.js 22, pnpm, and an installed ChatGPT/Codex Desktop app for real integration checks.

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Run the development terminal bridge:

```bash
pnpm build
node dist/cli.cjs
```

`run` remains as a compatibility spelling for the same foreground startup:

```bash
codex-lark run
codex-lark profile export codex --output ./profile.json
codex-lark profile remove codex
codex-lark profile remove codex --purge --yes
codex-lark profile export codex --include-secrets --yes
```

Foreground startup skips lark-cli installation by default; chat, cards, files, and approvals do not depend on lark-cli. Profile commands remain available for exporting, switching, or safely cleaning local configuration.

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
