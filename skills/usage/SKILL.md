---
name: usage
description: Show usage of the Claude subscription limits (5-hour and weekly window) and their reset times for the current account and every account in ~/.claude/claude-limits.tokens.
disable-model-invocation: true
argument-hint: "[account ...] [--brief] [--json]"
allowed-tools: Bash(node "*/skills/usage/scripts/claude-limits.mjs"), Bash(node "*/skills/usage/scripts/claude-limits.mjs" *), Bash(python3 "*/skills/usage/scripts/claude_limits.py"), Bash(python3 "*/skills/usage/scripts/claude_limits.py" *), Bash(python "*/skills/usage/scripts/claude_limits.py"), Bash(python "*/skills/usage/scripts/claude_limits.py" *), Bash(py "*/skills/usage/scripts/claude_limits.py"), Bash(py "*/skills/usage/scripts/claude_limits.py" *), Bash(node --version), Bash(python3 --version), Bash(python --version), Bash(py -3 --version)
---

# Claude limits

Check how much of the subscription limits has been used. Each check sends one minimal request per account
(Haiku, 1 token) and reads the `anthropic-ratelimit-unified-*` response headers, so it costs a negligible
fraction of a limit. Run it only when the user asked for it.

## Steps

1. Pick a runtime. The tool exists in two identical versions, so use whichever the machine has:
   1. Run `node --version`. If it prints v18 or newer, use Node (step 2a).
   2. Otherwise try Python 3.9+: `python3 --version` (Linux/macOS), then `python --version`, then `py -3 --version`
      (Windows launcher). Use the first one that prints Python 3.9 or newer (step 2b).
   3. If neither is available, tell the user to install Node.js 18+ or Python 3.9+
      (`winget install OpenJS.NodeJS.LTS` or `winget install Python.Python.3.12` on Windows, `brew install node` on
      macOS, the distro package or nvm on Linux) and stop.
2. Run the script. Pass the user's arguments through (account names, `--brief`, `--json`); with no arguments use `--brief`:

   a. Node:

   ```
   node "${CLAUDE_SKILL_DIR}/scripts/claude-limits.mjs" $ARGUMENTS
   ```

   b. Python (replace `python3` with `python` or `py -3` as detected):

   ```
   python3 "${CLAUDE_SKILL_DIR}/scripts/claude_limits.py" $ARGUMENTS
   ```

   Both versions print the same output and use the same exit codes.

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
