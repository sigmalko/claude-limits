---
name: usage
description: Show usage of the Claude subscription limits (5-hour and weekly window) and their reset times for the current account and every account in ~/.claude/claude-limits.tokens.
disable-model-invocation: true
argument-hint: "[account ...] [--brief] [--json]"
allowed-tools: Bash(node *claude-limits.mjs*), Bash(node --version)
---

# Claude limits

Check how much of the subscription limits has been used. Each check sends one minimal request per account
(Haiku, 1 token) and reads the `anthropic-ratelimit-unified-*` response headers, so it costs a negligible
fraction of a limit. Run it only when the user asked for it.

## Steps

1. Run `node --version`. If Node is missing or older than v18, tell the user to install it
   (`winget install OpenJS.NodeJS.LTS` on Windows, `brew install node` on macOS, nvm on Linux) and stop.
2. Run the script. Pass the user's arguments through (account names, `--brief`, `--json`); with no arguments use `--brief`:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/claude-limits.mjs" $ARGUMENTS
   ```

3. Summarise the result in the user's language: per account, percent used and left in the 5-hour window and in the
   week, when each resets, and flag any `[WARN]` or `[FAIL]`. Exit code 1 only means some account has a problem or
   hit a limit; it is not a crash.

## Troubleshooting

- `no Claude credentials found`: there is no `~/.claude/claude-limits.tokens` and no logged-in account. Point the user
  to the plugin README (section "Configure"). Do not create the file with real tokens yourself.
- `HTTP 401`: the token is wrong, revoked or expired. The user should generate a new one with `claude setup-token`.
- The account called `current` is the one Claude Code is logged in with (`~/.claude/.credentials.json`); on macOS
  it may be missing because credentials live in the Keychain.

## Security rules

- Never read, print, `cat`, grep or otherwise display `~/.claude/claude-limits.tokens` or
  `~/.claude/.credentials.json`. Only run the script; it never prints tokens.
- Never put a token on a command line, in a file in the repo, or in a chat message.
