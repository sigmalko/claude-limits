---
name: setup
description: First-time setup for the usage skill. Creates the tokens file (~/.claude/claude-limits.tokens) with owner-only permissions (via the scripts' `--init`) and walks the user through getting a token per account with `claude setup-token`, without ever seeing the tokens.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/../usage/scripts/claude-limits.mjs" --init), Bash(node "${CLAUDE_SKILL_DIR}/../usage/scripts/claude-limits.mjs" --brief), Bash(python3 "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --init), Bash(python3 "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --brief), Bash(python "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --init), Bash(python "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --brief), Bash(py -3 "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --init), Bash(py -3 "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --brief), Bash(node --version), Bash(python3 --version), Bash(python --version), Bash(py -3 --version)
---

# Set up claude-limits

Prepare the tokens file used by `/subscription-limits:usage`. You only create the file with `--init` and check the
result. **You never see, read, print or ask for a token.**

## Steps

1. Pick a runtime. The tool exists in two identical versions, so use whichever the machine has:
   1. Run `node --version`. If it prints v18 or newer, use Node (script `claude-limits.mjs`).
   2. Otherwise try Python 3.9+: `python3 --version` (Linux/macOS), then `python --version`, then `py -3 --version`
      (Windows launcher). Use the first one that prints Python 3.9 or newer (script `claude_limits.py`).
   3. If none works, tell the user to install Node.js 18+ or Python 3.9+ and stop.

2. Create the tokens file with `--init`. It works the same on Linux, macOS and Windows: it creates the parent
   directory, copies the template, restricts the file to the current user, and **never overwrites an existing file**
   (it then says "already exists" and does not read it). Run it exactly as written, as one plain command with the quoted
   script path (no `cd`, pipes or redirections; the pre-approved permission patterns match only this exact form, anything
   else just triggers a normal permission prompt):

   ```
   node "${CLAUDE_SKILL_DIR}/../usage/scripts/claude-limits.mjs" --init
   python3 "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --init   # if Node is not available
   ```

   For Python, replace `python3` with `python` or `py -3` as detected; nothing else changes.

   It prints the path of the file. If it fails, show the user the error and stop.

3. If the file already existed, skip step 4 unless the user wants to add accounts, and go to step 5.

4. Tell the user, in their language, to do the token part themselves (you cannot, and must not see tokens):
   1. For **each** Claude subscription account, log in to that account and run `claude setup-token` **in a separate
      terminal** (not in this chat; the output would end up in the conversation).
   2. Copy the printed `sk-ant-oat01-...` token.
   3. Open the file printed by `--init` in an editor, replace one `REPLACE_ME` line per account, **name the
      account on the left of `=`** (`work=sk-ant-oat01-...`), and delete the example lines that are not used.
   4. Never paste a token into this chat. If the user does, tell them it is now exposed and should be replaced with a
      new `claude setup-token`.

   Mention that the account Claude Code is logged in with is checked automatically as `current`, so an account that is
   already logged in does not need a token line.

5. When the user says the file is filled in, verify with the usage script (it never prints tokens):

   ```
   node "${CLAUDE_SKILL_DIR}/../usage/scripts/claude-limits.mjs" --brief
   python3 "${CLAUDE_SKILL_DIR}/../usage/scripts/claude_limits.py" --brief   # if Node is not available (same runtime rule)
   ```

   - `[ OK ]` lines: setup works. Point the user to `/subscription-limits:usage`.
   - `HTTP 401` for an account: wrong, revoked or expired token; repeat step 4 for that account.
   - An account still named like `work_a` with `REPLACE_ME`: the example lines were not removed or replaced.
   - `no Claude credentials found`: the file is empty or in the wrong place; the expected path is
     `~/.claude/claude-limits.tokens` (or the path in `CLAUDE_LIMITS_TOKENS_FILE`).

## Security rules

- Never `cat`, `Read`, grep or otherwise display `~/.claude/claude-limits.tokens` or `~/.claude/.credentials.json`.
- Never put a token on a command line, in a repo file or in a chat message.
