# Repository agent instructions

## Release workflow

When the user asks to publish a new `codex-lark` version:

1. Read the release checklist in `docs/DEVELOPMENT.md` and inspect `.github/workflows/release.yml` before taking release actions.
2. Do not run `npm login`, `npm adduser`, or `npm publish` locally. npm publication is owned by the GitHub Actions `Publish release` workflow through Trusted Publishing (OIDC).
3. Update `CHANGELOG.md` and the package version, run the documented checks, commit the release, then create and push the matching `v*` tag.
4. Push both the release commit and tag. The tag is the only trigger for npm publication and GitHub Release creation.
5. Wait for the `Publish release` workflow and verify both npm and the GitHub Release before reporting success. Query npm with the explicit official registry because the developer machine may default to `npmmirror.com`.

Never request npm credentials for this repository's normal release process.
