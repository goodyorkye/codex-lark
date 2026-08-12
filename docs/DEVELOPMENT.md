# Development and release

## Toolchain

- Node.js 22
- pnpm 10
- macOS 13+ for Desktop integration

## Checks

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Tests are split across unit, integration, and process suites. Fake App Server executables exercise JSONL framing and race conditions without OpenAI network access. Real Desktop smoke checks must remain read-only by default.

## Read-only Desktop smoke check

The release checklist verifies that the bundled executable exists, accepts App Server initialization, and serves `thread/list`. Do not create a task in an automated smoke check because it would mutate the developer's real history.

Set `CODEX_LARK_DESKTOP_IPC=0` to isolate App Server behavior. Use `CODEX_LARK_CODEX_BIN` only for fake executable tests or explicit development builds; production discovery must use the Desktop bundle.

## npm package

`pnpm build` creates the foreground CLI and public library output under `dist/`. Use `npm pack --dry-run` to inspect the exact publish surface. The published package must not include local profiles, media, logs, Desktop credentials, or generated macOS application bundles.

## Release checklist

- Update `CHANGELOG.md`, package version, and `Info.plist` version.
- Run all checks on macOS, Linux, and Windows; Desktop-only tests may skip off macOS.
- Run a read-only smoke check on the oldest and newest supported Desktop versions.
- Run dependency and license audits.
- Pack on a clean runner and inspect the tarball contents.
- Test both `npx codex-lark` first-run QR registration and an already-configured restart.
