---
name: setup
description: First-time setup for the usage skill. Creates ~/.claude/claude-limits.tokens from a template with owner-only permissions and walks the user through getting a token per account with `claude setup-token`, without ever seeing the tokens.
disable-model-invocation: true
allowed-tools: Bash(test *), Bash(mkdir *), Bash(cp *), Bash(chmod *), Bash(icacls *), Bash(node *claude-limits.mjs*), Bash(node --version)
---

# Set up claude-limits

Prepare the tokens file used by `/subscription-limits:usage`. You only create the file from the template and check the
result. **You never see, read, print or ask for a token.**

## Steps

1. Check Node: run `node --version`. If it is missing or older than v18, tell the user to install Node 18+ and stop.

2. Check whether the file already exists, without reading it: `test -e ~/.claude/claude-limits.tokens && echo exists`.
   - If it exists, do **not** overwrite it. Skip to step 5 to verify it.

3. Create it from the template with owner-only permissions:

   ```bash
   mkdir -p ~/.claude
   cp "${CLAUDE_SKILL_DIR}/claude-limits.tokens.example" ~/.claude/claude-limits.tokens
   chmod 600 ~/.claude/claude-limits.tokens
   ```

   On Windows `chmod` does nothing, so also restrict the file to the current user:

   ```powershell
   icacls "$HOME\.claude\claude-limits.tokens" /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
   ```

4. Tell the user, in their language, to do the token part themselves (you cannot, and must not see tokens):
   1. For **each** Claude subscription account, log in to that account and run `claude setup-token` **in a separate
      terminal** (not in this chat; the output would end up in the conversation).
   2. Copy the printed `sk-ant-oat01-...` token.
   3. Open `~/.claude/claude-limits.tokens` in an editor, replace one `REPLACE_ME` line per account, **name the
      account on the left of `=`** (`work=sk-ant-oat01-...`), and delete the example lines that are not used.
   4. Never paste a token into this chat. If the user does, tell them it is now exposed and should be replaced with a
      new `claude setup-token`.

   Mention that the account Claude Code is logged in with is checked automatically as `current`, so an account that is
   already logged in does not need a token line.

5. When the user says the file is filled in, verify with the usage script (it never prints tokens):

   ```
   node "${CLAUDE_SKILL_DIR}/../usage/scripts/claude-limits.mjs" --brief
   ```

   - `[ OK ]` lines: setup works. Point the user to `/subscription-limits:usage`.
   - `HTTP 401` for an account: wrong, revoked or expired token; repeat step 4 for that account.
   - An account still named like `work_a` with `REPLACE_ME`: the example lines were not removed or replaced.
   - `no Claude credentials found`: the file is empty or in the wrong place; the expected path is
     `~/.claude/claude-limits.tokens` (or the path in `CLAUDE_LIMITS_TOKENS_FILE`).

## Security rules

- Never `cat`, `Read`, grep or otherwise display `~/.claude/claude-limits.tokens` or `~/.claude/.credentials.json`.
- Never put a token on a command line, in a repo file or in a chat message.
