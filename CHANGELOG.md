# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). See "Versioning and releases" in
[docs/development.md](docs/development.md#versioning-and-releases) for what counts as a major, minor or patch change.

## [Unreleased]

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

[Unreleased]: https://github.com/sigmalko/claude-limits/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sigmalko/claude-limits/releases/tag/v1.0.0
