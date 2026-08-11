# Development and release

## Toolchain

- Node.js 22
- pnpm 10
- macOS 13+ for Desktop integration and packaging

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

## macOS package

`pnpm package:mac`:

1. bundles the dashboard and runtime as CommonJS;
2. creates a Node Single Executable Application blob;
3. copies the current Node executable into `Codex Lark.app`;
4. injects the blob with `postject`;
5. applies an ad-hoc signature; and
6. creates a zip under `release/`.

Public releases should replace ad-hoc signing with Developer ID signing and notarization. CI secrets must be GitHub environment protected. The app and zip should be malware scanned and their SHA-256 checksums published.

## Release checklist

- Update `CHANGELOG.md`, package version, and `Info.plist` version.
- Run all checks on macOS, Linux, and Windows; Desktop-only tests may skip off macOS.
- Run a read-only smoke check on the oldest and newest supported Desktop versions.
- Run dependency and license audits.
- Build on a clean macOS runner.
- Sign, notarize, staple, zip, checksum, and verify the downloaded artifact on another Mac user account.
