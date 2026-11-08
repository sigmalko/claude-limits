# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). See "Versioning and releases" in
[docs/development.md](docs/development.md#versioning-and-releases) for what counts as a major, minor or patch change.

## [Unreleased]

## [1.2.0] - 2026-11-08

### Added
- `--init` flag in both scripts: creates the tokens file from the template with owner-only permissions on Windows,
  Linux and macOS, never overwriting an existing file (#2).
- `current` account honours `CLAUDE_CONFIG_DIR` and falls back to the macOS Keychain; an expired access token now gives a
  clear "run `claude` once to refresh" message (#5).

### Changed
- The `setup` skill uses `--init` instead of `test`/`mkdir`/`cp`/`chmod`/`icacls`, so it works the same on every platform (#2).
- Tighter `allowed-tools` patterns in both skills (#8).
- The default time zone is the system zone instead of Europe/Warsaw (#3).
- `--help` prints an explicit usage text instead of a slice of the source (#7).

### Fixed
- Placeholder `REPLACE_ME` tokens are no longer sent to the API (#4).

### Development
- `scripts/check-version.mjs` uses a readable regex (#10).

## [1.1.0] - 2026-11-08

### Added
- Python 3.9+ version of the tool, `skills/usage/scripts/claude_limits.py` (standard library only, same flags, output and
  exit codes as the Node.js version), for machines without Node.js.

### Changed
- The `usage` and `setup` skills detect the runtime: Node.js 18+ if present, otherwise Python 3.9+ (`python3`, `python`
  or `py -3`), on Windows and Linux. Docs describe both runtimes and how to install Python.

## [1.0.0] - 2026-11-08

First release as a Claude Code plugin.

### Added
- Plugin `subscription-limits` and its own single-plugin marketplace `sigmalko-plugins`
  (`/plugin marketplace add sigmalko/claude-limits`).
- Skill `/subscription-limits:usage`: usage of the 5-hour and weekly limits and reset times for every configured
  account; only runs when invoked; never reads or prints the tokens file.
- Skill `/subscription-limits:setup`: creates `~/.claude/claude-limits.tokens` from a template with owner-only
  permissions and guides through `claude setup-token` without seeing any token.
- Plugin icon, MIT `LICENSE`, `CHANGELOG.md` and `scripts/check-version.mjs` (keeps `plugin.json` and the changelog in sync).
- Documentation in `docs/` (installation with install scopes where `user` is recommended, configuration, usage, how it works, development and release process); the README is now a short quick start.

### Changed
- The tokens file moved out of the repo to `~/.claude/claude-limits.tokens` (override with
  `CLAUDE_LIMITS_TOKENS_FILE`), so plugin updates never overwrite it.
- The script moved from `bin/claude-limits.mjs` to `skills/usage/scripts/claude-limits.mjs`.
- The tokens template was renamed from `.claude.tokens.example` to `skills/setup/claude-limits.tokens.example`.

### Before the plugin (standalone CLI)
- Single-file Node.js tool reading `anthropic-ratelimit-unified-*` headers for many accounts, with `--brief`, `--json`,
  exit codes and Docker usage.

[Unreleased]: https://github.com/sigmalko/claude-limits/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/sigmalko/claude-limits/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/sigmalko/claude-limits/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/sigmalko/claude-limits/releases/tag/v1.0.0
