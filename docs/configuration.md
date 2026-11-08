# Configuration

The script needs a token for every account you want to check, except the account Claude Code is logged in with on this
machine (that one is `current`, see below).

## Fastest way: the setup skill

```
/subscription-limits:setup
```

It creates `~/.claude/claude-limits.tokens` from a template with owner-only permissions, tells you how to get a token
for each account, and verifies the result. It never sees, reads or prints a token. The manual steps below are what it
does for you.

## Get the tokens

For each account, log in to that account and run, **in a terminal (not in a chat)**:

```bash
claude setup-token
```

Copy the printed token (`sk-ant-oat01-...`). Treat it like a password.

## The tokens file

The script reads the tokens from a `.env`-style file, **`~/.claude/claude-limits.tokens`**. It lives in your home
directory, outside the plugin and outside any repo, so plugin updates never overwrite it and it can't be committed by
accident. The template is `skills/setup/claude-limits.tokens.example`.

Create it with the `--init` flag of either script. It is the same on Linux, macOS and Windows: it creates the parent
directory, copies the template, sets owner-only permissions (`chmod 600`, or `icacls` on Windows), prints the path and
never overwrites an existing file. It makes no network request.

```bash
node skills/usage/scripts/claude-limits.mjs --init            # or: python3 skills/usage/scripts/claude_limits.py --init
```

The `/subscription-limits:setup` skill runs exactly this, so it also works with the plugin installed (no clone needed).
Then fill the file in by hand using the format below. To use another location, set `CLAUDE_LIMITS_TOKENS_FILE` first.

One account per line, `name=token`. **You choose the names** (the left side); the script uses them in the output and as
arguments.

```
# comments and empty lines are ignored
work_a=sk-ant-oat01-...
work_b=sk-ant-oat01-...
private=sk-ant-oat01-...
```

Details:

- A line without a name (just a token) is called `account-N`, where N is the line number among the entries.
- A duplicated name prints a warning and the last line wins.
- The name `current` is reserved (see below); a line using it is skipped with a message.
- Tolerated: UTF-8 BOM, Windows line endings (CRLF), an `export ` prefix and quotes around the token.
- Delete the template lines you do not use: a `REPLACE_ME` token just fails with `HTTP 401`.

## The `current` account

The account that Claude Code is currently logged in with on this machine (`~/.claude/.credentials.json`) is checked
automatically as `current`, if that file exists. You don't have to configure it. On macOS the credentials usually live
in the Keychain, so `current` may be missing there; add that account to the tokens file instead. If you also put the
same account in the tokens file it shows up twice, with identical numbers.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_LIMITS_TOKENS_FILE` | `~/.claude/claude-limits.tokens` | Path to the tokens file |
| `CLAUDE_LIMITS_TZ` | `$TZ`, else `Europe/Warsaw` | Time zone used to print reset times |
| `CLAUDE_PROBE_MODEL` | `claude-haiku-5-5` | Model used for the probe request |

## Optional hardening

Forbid Claude from reading the secrets at all, in `~/.claude/settings.json`:

```json
{ "permissions": { "deny": ["Read(~/.claude/claude-limits.tokens)", "Read(~/.claude/.credentials.json)"] } }
```
