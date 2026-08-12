# Contributing

Thanks for helping make remote Codex Desktop control calmer and safer.

## Before opening a change

- Search existing issues and keep one pull request focused on one outcome.
- Never include App Secrets, access tokens, task transcripts, local paths, or screenshots with private project data.
- Treat Desktop IPC as compatibility-sensitive. Keep App Server as the primary path and add a regression test for every protocol change.
- Preserve third-party notices in vendored or adapted files.

## Local workflow

Use Node.js 22 and pnpm:

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

A real App Server smoke test is documented in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and must remain read-only unless the test explicitly creates a disposable task.

## Pull requests

Explain the user problem, the implementation boundary, security/privacy impact, tests, and any Desktop versions used. CI must pass. Changes to protocol handling, approval routing, secret storage, access control, or release signing need focused reviewer attention.

By contributing, you agree that your contribution is licensed under the project MIT license, except changes to clearly identified Apache-2.0 vendored files, which remain Apache-2.0.
