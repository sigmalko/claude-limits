# claude-limits

Shows how much of the Claude Code **subscription limits** each of your accounts has used: the 5-hour window and the
weekly window, plus when each one resets. It works for many accounts at once.

The repo is a **Claude Code plugin** (`subscription-limits`) and, at the same time, its own single-plugin marketplace.
The core is one file with no dependencies, `skills/usage/scripts/claude-limits.mjs` (Node.js built-ins only). It sits
next to the skill's `SKILL.md`, and you can also [run it by hand](#run-it-by-hand).

> The plugin is called `subscription-limits`, not `claude-limits`: plugin names starting with `claude-` are reserved
> for Anthropic. The repo, the script and the tokens file keep the `claude-limits` name.

## Install as a plugin

Inside Claude Code:

```
/plugin marketplace add sigmalko/claude-limits
/plugin install subscription-limits@sigmalko-plugins
```

Update later with `/plugin marketplace update sigmalko-plugins` and `/plugin update subscription-limits@sigmalko-plugins`.

### Install scope: user, project or local

`sigmalko/claude-limits` is the GitHub repo the marketplace is fetched from; it is not the repo of the project you are
working in. Where the plugin is **enabled** depends on the scope:

| Scope | Stored in | Who gets it |
| --- | --- | --- |
| `user` (default) | `~/.claude/settings.json` | only you, in every project |
| `project` | `.claude/settings.json` of the current project (commit it) | everyone who uses that repo |
| `local` | `.claude/settings.local.json` of the current project (gitignored) | only you, only in that project |

In every case the plugin files are cached once per machine in `~/.claude/plugins/cache/`; the scope only decides where
it is switched on.

**Use `user` scope. It is the one that makes the most sense here**, because everything this plugin works with is
personal and lives in your home directory, not in a project:

- the tokens file `~/.claude/claude-limits.tokens` (your `claude setup-token` tokens, i.e. secrets),
- the `current` account from `~/.claude/.credentials.json`,
- the accounts you want to compare, which have nothing to do with any single repo.

A `user`-scope install sits next to the tokens, works in every project, and puts nothing in a project's `.claude/`
that could be committed by accident. `project` scope would share the skill with a team, but the tokens would not come
with it (each person still needs their own tokens file), so it adds little. `local` is only useful to try the plugin
in a single project without touching your global settings.

From the terminal (for `project` and `local`, run it in the project directory):

```bash
# user (default, recommended): personal, all projects
claude plugin marketplace add sigmalko/claude-limits
claude plugin install subscription-limits@sigmalko-plugins

# project: shared with the team through the repo's .claude/settings.json
claude plugin marketplace add sigmalko/claude-limits --scope project
claude plugin install subscription-limits@sigmalko-plugins --scope project

# local: only you, only this project, not committed
claude plugin marketplace add sigmalko/claude-limits --scope local
claude plugin install subscription-limits@sigmalko-plugins --scope local
```

Check what is installed with `claude plugin list`; remove it with
`claude plugin uninstall subscription-limits@sigmalko-plugins [--scope ...]`.

Then set up the tokens (next sections) and run:

```
/subscription-limits:usage                  # all accounts, brief
/subscription-limits:usage work_a --json    # arguments are passed to the script
```

The skill only runs when you invoke it (`disable-model-invocation`): every check sends one tiny request per account.
Claude is told never to read or print the tokens file.

**Try it from a local clone, without installing:**

```bash
git clone https://github.com/sigmalko/claude-limits && cd claude-limits
claude --plugin-dir .
```

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

The script reads the tokens from a `.env`-style file, **`~/.claude/claude-limits.tokens`**. It lives in your home
directory, outside the plugin and outside any repo, so plugin updates never overwrite it and it can't be committed by
accident. `claude-limits.tokens.example` in this repo is the template.

```bash
# Linux / macOS / Git Bash
cp claude-limits.tokens.example ~/.claude/claude-limits.tokens
chmod 600 ~/.claude/claude-limits.tokens
```

```powershell
# PowerShell
Copy-Item claude-limits.tokens.example "$HOME\.claude\claude-limits.tokens"
```

(With the plugin installed there is no clone to copy from: just create the file by hand with the format below.)

Then edit it: one account per line, `name=token`. **You choose the names** (the left side); the script uses them in the
output and as arguments.

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
automatically as `current`, if that file exists. You don't have to configure it. On macOS the credentials usually live
in the Keychain, so `current` may be missing there; add that account to the tokens file instead.

Optional hardening: forbid Claude from reading the secrets at all, in `~/.claude/settings.json`:

```json
{ "permissions": { "deny": ["Read(~/.claude/claude-limits.tokens)", "Read(~/.claude/.credentials.json)"] } }
```

## Run it by hand

The script is a normal Node program, so you can run it without Claude (terminal, cron, CI).

**Installed as a plugin** (the path contains the version, so the command looks the script up):

```bash
# Linux / macOS / Git Bash
node "$(find ~/.claude/plugins/cache -name claude-limits.mjs | head -1)" --brief
```

```powershell
# PowerShell
node (Get-ChildItem "$HOME\.claude\plugins\cache" -Recurse -Filter claude-limits.mjs | Select-Object -First 1).FullName --brief
```

**From a clone of the repo**, from the repo root:

```bash
node skills/usage/scripts/claude-limits.mjs                 # all accounts: current + everything in the tokens file
node skills/usage/scripts/claude-limits.mjs work_a work_b   # only the named accounts
node skills/usage/scripts/claude-limits.mjs --brief         # one line per account
node skills/usage/scripts/claude-limits.mjs --json          # machine-readable (an array, one object per account)
node skills/usage/scripts/claude-limits.mjs --help
```

The command is the same in Bash and PowerShell.

Example output:

```
[ OK ] Account work_a (claude-limits.tokens; status: allowed; binding window: five_hour)
   5 hours :  29% used,  71% left, reset 2026-11-08 21:00 Europe/Warsaw (in 23 min)
   week    :   3% used,  97% left, reset 2026-11-15 15:00 Europe/Warsaw (in 6 d 19 h)
```

Markers: `[ OK ]` allowed, `[WARN]` allowed but close to a limit, `[FAIL]` limit reached or the account could not be
checked (bad/expired token, no network).

**Exit code:** `0` when every account answered and is allowed (a warning still counts as allowed); `1` on a token or
network error or when a limit is reached; `2` for an unknown argument. Handy for scripts and cron.

### Docker

Mount the repo (read-only is fine) and the tokens file, and run it with any Node 18+ image:

```bash
# Linux / macOS / Git Bash (on Git Bash prefix with MSYS_NO_PATHCONV=1)
docker run --rm -v "$PWD/skills/usage/scripts:/app/scripts:ro" -v "$HOME/.claude/claude-limits.tokens:/run/tokens:ro" \
  -e CLAUDE_LIMITS_TOKENS_FILE=/run/tokens -w /app node:24-alpine node scripts/claude-limits.mjs --brief
```

```powershell
# PowerShell
docker run --rm -v "${PWD}/skills/usage/scripts:/app/scripts:ro" -v "$HOME\.claude\claude-limits.tokens:/run/tokens:ro" `
  -e CLAUDE_LIMITS_TOKENS_FILE=/run/tokens -w /app node:24-alpine node scripts/claude-limits.mjs --brief
```

Inside a container there is no `~/.claude/.credentials.json`, so `current` is skipped and only the accounts from the
tokens file are checked.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_LIMITS_TOKENS_FILE` | `~/.claude/claude-limits.tokens` | Path to the tokens file |
| `CLAUDE_LIMITS_TZ` | `$TZ`, else `Europe/Warsaw` | Time zone used to print reset times |
| `CLAUDE_PROBE_MODEL` | `claude-haiku-5-5` | Model used for the probe request |

## Repo layout

```
.claude-plugin/plugin.json       plugin manifest (name: subscription-limits)
.claude-plugin/marketplace.json  makes the repo an installable marketplace (sigmalko-plugins)
skills/usage/SKILL.md            the /subscription-limits:usage skill
skills/usage/scripts/claude-limits.mjs   the actual tool (also runnable by hand)
claude-limits.tokens.example     template of the tokens file
```

When you change the plugin, bump `version` in `.claude-plugin/plugin.json`, otherwise installed copies may not update.

## How it works

The `/usage` endpoint needs the `user:profile` scope, which `setup-token` tokens don't have. But for subscription
accounts the API attaches the limit state to every response, in the `anthropic-ratelimit-unified-*` headers. So the
script sends one minimal request per account (`max_tokens: 1`, Haiku, a few tokens) and reads those headers. Each check
costs a negligible fraction of a limit. Tokens are never printed or passed on a command line.

## Limitations and security

- The headers are undocumented (Claude Code itself relies on them) and may change or disappear.
- `HTTP 401` means the token is wrong, revoked or expired: generate a new one with `claude setup-token`.
- The tokens file holds secrets. Don't commit it, don't paste it into chats, and restrict its permissions where you can
  (`chmod 600` on Linux/macOS).
- The repo has no `LICENSE` file yet; `claude plugin validate` flags that only for submission to the public plugin
  directory, not for installing from this marketplace.
