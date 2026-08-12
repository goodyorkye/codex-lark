# Configuration and local data

The default state root is `~/.codex-lark/`. Set `CODEX_LARK_HOME` before startup to use another root.

```bash
CODEX_LARK_HOME=/path/to/state codex-lark
```

## Layout

```text
~/.codex-lark/
├── active-profile
├── config.json
├── profiles/
│   └── codex/
│       ├── secrets.enc
│       ├── sessions.json
│       ├── sessions.json.catalog.json
│       ├── workspaces.json
│       ├── media/
│       └── logs/
└── registry/
    ├── processes.json
    └── locks/
```

- `config.json` stores non-secret application and profile settings.
- `secrets.enc` stores the Feishu/Lark App Secret encrypted at rest.
- `sessions.json` and its catalog map Feishu chat selections to Codex tasks.
- `workspaces.json` stores discovered project aliases and selection state.
- `media/` caches files downloaded from Feishu/Lark for local submission.
- `logs/` contains sanitized JSONL operational logs.
- `registry/` prevents conflicting bridge processes and records running instances.

The canonical task transcript remains owned by Codex Desktop; the bridge does not copy the complete Desktop task database into this directory.

## Profiles

The foreground command uses the `codex` profile by default. Use `--profile <name>` for an isolated profile, or the `profile` commands to inspect, export, switch, archive, or permanently remove one.

```bash
codex-lark profile list
codex-lark profile export codex --output ./profile.json
codex-lark profile remove codex
```

Exports omit secrets unless `--include-secrets --yes` is supplied explicitly. Profile removal archives data by default; `--purge --yes` permanently deletes it.

## Compatibility switches

- `CODEX_LARK_DESKTOP_IPC=0` disables experimental Desktop IPC mirroring while keeping App Server task access.
- `CODEX_LARK_HOME=/path` changes the complete local state root.

Development-only executable and socket overrides are documented in [DEVELOPMENT.md](DEVELOPMENT.md) and should not be used for normal operation.
