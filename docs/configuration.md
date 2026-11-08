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
directory, copies the template, sets owner-only permissions (`chmod 600`, or `icacls.exe` from `System32` on Windows, granting only your user SID), prints
the path and never overwrites or reads an existing file (it says "already exists, left untouched"). If the permissions
cannot be restricted, the new file is deleted again and the command exits with 1, so you never end up with a loosely
protected tokens file by accident. It makes no network request.

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

- A line without a name (just a token) is called `account-N`, where N is the line number among the entries. A line is
  `name=token` only when the part left of the first `=` consists of letters, digits, `_`, `.`, `-` and what follows does not
  start with `=`; otherwise the whole line is one unnamed token (so base64 padding like `sk-ant-...==` works).
- Lines end with LF or CRLF only; a lone CR is not a line break (such a token is rejected, see below).
- A token may only contain printable ASCII characters (no spaces, control characters, smart quotes or other non-ASCII
  characters). Otherwise that account reports `[FAIL] name: token contains invalid characters` without any request, and
  the token is never echoed. The other accounts are still checked.
- A duplicated name prints a warning and the last line wins.
- The name `current` is reserved (see below); a line using it is skipped with a message.
- Tolerated: UTF-8 BOM, UTF-16 with a BOM (as saved by some Windows editors), Windows line endings (CRLF), an `export `
  prefix and quotes around the token. Any other encoding is reported as an error (save the file as UTF-8).
- Delete the template lines you do not use: a token containing `REPLACE_ME` is skipped without a network call (a warning on stderr when all accounts are checked;
  `[FAIL] name: not configured (placeholder token)` and exit code 1 when you ask for that account by name).

## The `current` account

The account that Claude Code is currently logged in with on this machine (`$CLAUDE_CONFIG_DIR/.credentials.json`,
default `~/.claude/.credentials.json`) is checked automatically as `current`, if that file exists. You don't have to
configure it. On macOS, where the credentials usually live in the Keychain, the script falls back to the Keychain item
`Claude Code-credentials` (read with `security find-generic-password`, parsed and never printed), but **only when
`CLAUDE_CONFIG_DIR` is not set**: that Keychain item belongs to the default account, so with a custom `CLAUDE_CONFIG_DIR`
whose `.credentials.json` is missing, `current` reports no credentials instead of showing another account. An
`expiresAt` that is not a number is treated as unknown. If the access token
has expired, `current` reports that you should run `claude` once to refresh it; the script never refreshes tokens itself. If you also put the
same account in the tokens file it shows up twice, with identical numbers.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_LIMITS_TOKENS_FILE` | `~/.claude/claude-limits.tokens` | Path to the tokens file |
| `CLAUDE_LIMITS_TZ` | `$TZ`, else the system time zone, else the local UTC offset (e.g. `UTC+02:00`) | Time zone (IANA name) used to print reset times. An invalid name is ignored (with a warning for `CLAUDE_LIMITS_TZ`) and the next candidate is used. Python needs a tz database for names (on Windows: `pip install tzdata`), otherwise it prints the UTC offset |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where `current` finds `.credentials.json` (same variable Claude Code uses) |
| `CLAUDE_PROBE_MODEL` | `claude-haiku-5-5` | Model used for the probe request |

## Proxies

The Python version honours `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (standard `urllib` behaviour). The Node version does
not use proxies (`fetch` in Node 18-22 ignores these variables; newer Node versions need `NODE_USE_ENV_PROXY=1`). Behind
a proxy use the Python version.

## Optional hardening

Forbid Claude from reading the secrets at all, in `~/.claude/settings.json`:

```json
{ "permissions": { "deny": ["Read(~/.claude/claude-limits.tokens)", "Read(~/.claude/.credentials.json)"] } }
```
