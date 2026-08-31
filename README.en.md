# codex-lark

<p align="center">
  <a href="https://www.npmjs.com/package/codex-lark"><img alt="npm version" src="https://img.shields.io/npm/v/codex-lark?logo=npm"></a>
  <a href="https://www.npmjs.com/package/codex-lark"><img alt="npm downloads" src="https://img.shields.io/npm/dm/codex-lark"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/goodyorkye/codex-lark"></a>
  <a href="https://github.com/goodyorkye/codex-lark/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/goodyorkye/codex-lark/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://nodejs.org"><img alt="Node.js" src="https://img.shields.io/node/v/codex-lark"></a>
</p>

**Continue Codex tasks from ChatGPT or Codex Desktop in Feishu/Lark on your phone.**

You do not start a second agent on your phone or explain the work again. `codex-lark` brings existing Codex projects and tasks from ChatGPT or Codex Desktop into Feishu/Lark, so you can continue while away and return to the same task on your computer later.

**Scan once in Feishu/Lark to create and connect your personal assistant automatically. That single assistant can manage multiple Codex projects and tasks from ChatGPT / Codex Desktop on your computer.**

It connects specifically to **Codex projects and tasks** in the desktop app—not ordinary ChatGPT chats or ChatGPT Work conversations.

**Feishu/Lark uses convenient card buttons throughout.** Recent tasks, projects, models, reasoning effort, and composed input are one tap away—there are no commands or names to memorize.

[简体中文](README.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Privacy](docs/PRIVACY.md)

<p align="center">
  <img src="docs/images/feishu-card-navigation.png" width="420" alt="ChatGPT / Codex Desktop common actions card in Feishu">
</p>

## When it is useful

- Codex is working in ChatGPT / Codex Desktop and you want to check progress or approve an action from your phone.
- You step away from the computer and want to continue an existing task in Feishu/Lark.
- You work across several projects and need to switch between them without rebuilding context.
- You want to send text, images, audio, and files to Codex without using a general-purpose remote desktop.

`codex-lark` does not try to recreate Codex inside Feishu. It turns Feishu into a **lightweight phone remote for Codex tasks in ChatGPT / Codex Desktop**.

## What you can do from your phone

- Browse and switch between Desktop projects and tasks.
- Continue an existing task or quickly start a new one inside a project.
- Send text, images, audio, and files.
- Use **Compose input** to submit several messages and attachments as one turn.
- Follow Codex replies and execution progress live.
- Fetch the latest turn when you want to catch up with work done on Desktop.
- Allow or decline command, file-change, and other permission requests from your phone.
- Select a model and reasoning effort, or stop an active task.

Projects, tasks, models, and common actions appear as Feishu/Lark cards. You can move quickly between several projects and tasks; normal use is just tapping a button or sending a message.

## Start in three steps

You need:

- Node.js 20.12 or later
- A signed-in official ChatGPT or Codex Desktop app
  - macOS: ChatGPT or Codex Desktop
  - Windows: Codex Desktop from Microsoft Store
- Feishu or Lark on your phone

### 1. Open ChatGPT or Codex Desktop

Make sure it is signed in and working normally.

### 2. Run this in a terminal on your computer

```bash
npx -y codex-lark@latest
```

### 3. Scan the QR code with Feishu or Lark

On the first run, a QR code appears in the terminal. After scanning it, the assistant sends a common-actions card to your phone. Tap a button and start working.

That is all. There is no separate Codex CLI to install, no OpenAI API key to enter, no Feishu developer console to configure, no browser window, and no public server to deploy.

For later use, run the same command again. Your setup is kept locally, so you do not scan the QR code every time.

## Everyday use

Keep the terminal open, then in Feishu/Lark:

1. Pick work from **Recent tasks** or **Projects**.
2. Send a message as you would in a normal chat.
3. Tap **Compose input** when text and attachments belong in one turn.
4. Respond to permission requests directly on their approval cards.
5. When you return to the computer, open the same Codex task in ChatGPT / Codex Desktop and continue.

Press `Ctrl+C` to stop. Closing the terminal also disconnects the phone, but it does not delete your Codex tasks or Feishu/Lark setup.

## Why it feels lightweight

- **Your Desktop context stays with you:** phone and computer continue the same work.
- **No second Codex installation:** it uses the official ChatGPT / Codex Desktop login and tasks already on your computer.
- **Scan and go:** the assistant is created and connected for you.
- **One assistant for all your work:** you do not create a separate bot for every project or task.
- **Card buttons, one-tap switching:** projects, tasks, models, reasoning effort, and composed input do not require commands.
- **Local by default:** configuration and temporary attachments stay on your computer, and sensitive logs are redacted.
- **macOS and Windows:** after a Desktop update, restart `codex-lark` and it detects the current installed version.

## Good to know

- The computer must stay awake and the terminal must stay open.
- The computer needs working access to OpenAI and Feishu/Lark.
- On Windows, use the official Codex Desktop app from Microsoft Store.
- Some local Desktop interaction can change between official app versions. See [Troubleshooting](docs/TROUBLESHOOTING.md) if something stops working.

## More information

- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Privacy](docs/PRIVACY.md)
- [Security](SECURITY.md)
- [Development and contribution](docs/DEVELOPMENT.md)
- [Technical architecture](docs/ARCHITECTURE.md)

The project is MIT licensed. It is not affiliated with or endorsed by OpenAI, Feishu, ByteDance, or Remodex. See [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party provenance.

## Reference projects

- [Lark Channel Bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge)
- [Remodex](https://github.com/Emanuele-web04/remodex)
