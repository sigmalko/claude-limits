# claude-limits

Shows how much of the Claude Code **subscription limits** each of your accounts has used: the 5-hour window and the
weekly window, plus when each one resets. It works for many accounts at once.

Single file, no dependencies: `bin/claude-limits.mjs` (Node.js built-ins only).

## Prerequisites

- **Node.js 18 or newer** (needs the built-in `fetch`). Developed and tested on Node 24.
  Not installed yet? See [Install Node.js](#install-nodejs-quick).
- **Network access to `https://api.anthropic.com`** (works the same on Windows, Linux, macOS and in Docker).
- **Claude subscription accounts** (Pro/Max). API-key accounts (`ANTHROPIC_API_KEY`) have no subscription windows and
  are not supported.
- **A long-lived token per account**, created with `claude setup-token`. This needs the
  [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed once, on any machine, and you must be able to
  log in to each account.
- Optional: **Docker**, if you prefer to run it in a container.

## Install Node.js (quick)

Skip this if `node --version` already prints v18 or newer. Otherwise install the latest LTS release:

**Windows (PowerShell)**

```powershell
winget install OpenJS.NodeJS.LTS
```

Then **open a new terminal** so `node` is on the `PATH`.

**macOS**

```bash
brew install node
```

**Linux** (the distro's `apt`/`dnf` package is often too old, so use nvm instead)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# open a new terminal, then:
nvm install --lts
```

**Any system without installing anything:** use the Docker command from the [Docker](#docker) section; the image
already contains Node.

Check it:

```bash
node --version   # should print v18.x or newer
```

Other options and installers: <https://nodejs.org/en/download>.

## Get the tokens

For each account, log in to that account and run:

```bash
claude setup-token
```

Copy the printed token (`sk-ant-oat01-...`). Treat it like a password.

## Configure

The script reads the tokens from a `.env`-style file, `.claude.tokens`, in the repo root. The file is gitignored; the
committed `.claude.tokens.example` is the template.

```bash
# Linux / macOS / Git Bash
cp .claude.tokens.example .claude.tokens
```

```powershell
# PowerShell
Copy-Item .claude.tokens.example .claude.tokens
```

Then edit `.claude.tokens`: one account per line, `name=token`. **You choose the names** (the left side); the script
uses them in the output and as arguments.

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
- To keep the file somewhere else, set `CLAUDE_LIMITS_TOKENS_FILE=/path/to/file`.

The account that Claude Code is currently logged in with on this machine (`~/.claude/.credentials.json`) is checked
automatically as `current`, if that file exists. You don't have to configure it.

## Run

From the repo root:

```bash
node bin/claude-limits.mjs                 # all accounts: current + everything in .claude.tokens
node bin/claude-limits.mjs work_a work_b   # only the named accounts
node bin/claude-limits.mjs --brief         # one line per account
node bin/claude-limits.mjs --json          # machine-readable (an array, one object per account)
node bin/claude-limits.mjs --help
```

The command is the same in Bash and PowerShell.

Example output:

```
[ OK ] Account work_a (.claude.tokens; status: allowed; binding window: five_hour)
   5 hours :  29% used,  71% left, reset 2026-11-08 21:00 Europe/Warsaw (in 23 min)
   week    :   3% used,  97% left, reset 2026-11-15 15:00 Europe/Warsaw (in 6 d 19 h)
```

Markers: `[ OK ]` allowed, `[WARN]` allowed but close to a limit, `[FAIL]` limit reached or the account could not be
checked (bad/expired token, no network).

**Exit code:** `0` when every account answered and is allowed (a warning still counts as allowed); `1` on a token or
network error or when a limit is reached; `2` for an unknown argument. Handy for scripts and cron.

### Docker

Mount the repo (read-only is fine) and run it with any Node 18+ image:

```bash
# Linux / macOS / Git Bash (on Git Bash prefix with MSYS_NO_PATHCONV=1)
docker run --rm -v "$PWD:/app:ro" -w /app node:24-alpine node bin/claude-limits.mjs --brief
```

```powershell
# PowerShell
docker run --rm -v "${PWD}:/app:ro" -w /app node:24-alpine node bin/claude-limits.mjs --brief
```

Inside a container there is no `~/.claude/.credentials.json`, so `current` is skipped and only the accounts from
`.claude.tokens` are checked. To keep the tokens file outside the mounted repo, mount it and point to it:

```bash
docker run --rm -v "$PWD/bin:/app/bin:ro" -v "/secure/.claude.tokens:/run/tokens:ro" \
  -e CLAUDE_LIMITS_TOKENS_FILE=/run/tokens -w /app node:24-alpine node bin/claude-limits.mjs
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_LIMITS_TOKENS_FILE` | `<repo>/.claude.tokens` | Path to the tokens file |
| `CLAUDE_LIMITS_TZ` | `$TZ`, else `Europe/Warsaw` | Time zone used to print reset times |
| `CLAUDE_PROBE_MODEL` | `claude-haiku-5-5` | Model used for the probe request |

## How it works

The `/usage` endpoint needs the `user:profile` scope, which `setup-token` tokens don't have. But for subscription
accounts the API attaches the limit state to every response, in the `anthropic-ratelimit-unified-*` headers. So the
script sends one minimal request per account (`max_tokens: 1`, Haiku, a few tokens) and reads those headers. Each check
costs a negligible fraction of a limit. Tokens are never printed or passed on a command line.

## Limitations and security

- The headers are undocumented (Claude Code itself relies on them) and may change or disappear.
- `HTTP 401` means the token is wrong, revoked or expired: generate a new one with `claude setup-token`.
- `.claude.tokens` holds secrets. It is gitignored; don't commit it, don't paste it into chats, and restrict its
  permissions where you can (`chmod 600 .claude.tokens` on Linux/macOS).
