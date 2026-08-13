# Development and release

## Toolchain

- Node.js 22
- pnpm 10
- macOS 13+ or Windows with the official Desktop app for real integration

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

Run the read-only check with:

```bash
pnpm smoke:app-server
```

## npm package

`pnpm build` creates the foreground CLI and public library output under `dist/`. Use `npm pack --dry-run` to inspect the exact publish surface. The published package must not include local profiles, media, logs, Desktop credentials, or generated application bundles.

## Release checklist

- Update `CHANGELOG.md` and the package version.
- Run all checks on macOS, Linux, and Windows; Desktop-only tests may skip when the official app is unavailable.
- Run a read-only smoke check on the oldest and newest supported Desktop versions on both end-user platforms.
- Run dependency and license audits.
- Pack on a clean runner and inspect the tarball contents.
- Test both `npx codex-lark` first-run QR registration and an already-configured restart.
- Create and push a `v*` Git tag matching the package version only after those checks pass. The `release.yml` workflow publishes to npm through Trusted Publishing (OIDC), attaches the tarball and checksum to a GitHub release, and stores no npm token in GitHub.
