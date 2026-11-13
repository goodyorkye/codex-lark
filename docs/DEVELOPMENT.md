# Development and release

## Toolchain

- Node.js 22
- pnpm 10
- macOS 13+ or Windows with the official Desktop app for real integration

The shipped CLI requires Node.js 20.19+ (20.x), or 22.12 and later, because the existing Feishu SDK and terminal prompts load native ES modules from CommonJS. The CLI checks this before loading dependencies. See the official [Node 20.19](https://nodejs.org/en/blog/release/v20.19.0) and [Node 22.12](https://nodejs.org/en/blog/release/v22.12.0) module-loading changes. CI covers the minimum 20.19 runtime and Node 22 across all three operating systems.

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

- Read `.github/workflows/release.yml` before releasing. GitHub Actions owns npm publication through Trusted Publishing (OIDC); do **not** run `npm login`, `npm adduser`, or `npm publish` locally.
- Update `CHANGELOG.md` and the package version. The Git tag must exactly match the package version as `v<version>`.
- Run all checks on macOS, Linux, and Windows; Desktop-only tests may skip when the official app is unavailable.
- Run a read-only smoke check on the oldest and newest supported Desktop versions on both end-user platforms.
- Run dependency and license audits.
- Pack on a clean runner and inspect the tarball contents.
- Test both `npx codex-lark` first-run QR registration and an already-configured restart.
- Commit and push the release changes, then create and push the matching `v*` Git tag only after the checks pass.
- Wait for the `Publish release` workflow to complete. It publishes to npm, attaches the tarball and checksum to a GitHub Release, and stores no npm token in GitHub.
- Verify the version against the official npm registry and inspect the GitHub Release before reporting completion. The developer machine may use `npmmirror.com` as its default registry, so always pass `--registry=https://registry.npmjs.org` for npm verification.

Typical patch release commands:

```bash
npm version patch --no-git-tag-version
pnpm ci:local
npm pack --dry-run
git add CHANGELOG.md package.json <release-files>
git commit -m "release: codex-lark <version>"
git push origin main
git tag -a v<version> -m "v<version>"
git push origin v<version>
gh run list --workflow release.yml --limit 1
gh run watch <run-id>
npm view codex-lark version --registry=https://registry.npmjs.org
gh release view v<version>
```

If the tag was already pushed, do not retry with a local `npm publish`. Inspect the GitHub Actions run first:

```bash
gh run list --workflow release.yml --limit 5
```
