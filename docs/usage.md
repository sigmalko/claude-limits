# Usage

## In Claude Code

```
/subscription-limits:usage                  # all accounts, brief
/subscription-limits:usage work_a --json    # arguments are passed to the script
/subscription-limits:setup                  # first-time setup, see Configuration
```

The `usage` skill only runs when you invoke it (`disable-model-invocation`): every check sends one tiny request per
account. Claude is told never to read or print the tokens file.

## Run it by hand

The tool is a normal Node or Python program, so you can run it without Claude (terminal, cron, CI). The two versions
are interchangeable: same flags, output and exit codes. Examples below use Node; for Python replace
`node .../claude-limits.mjs` with `python3 .../claude_limits.py` (`py -3` or `python` on Windows).

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

The command is the same in Bash and PowerShell. The Python equivalent:

```bash
python3 skills/usage/scripts/claude_limits.py --brief       # Windows: py -3 skills/usage/scripts/claude_limits.py --brief
```

## Output

```
[ OK ] Account work_a (claude-limits.tokens; status: allowed; binding window: five_hour)
   5 hours :  29% used,  71% left, reset 2026-11-08 21:00 Europe/Warsaw (in 23 min)
   week    :   3% used,  97% left, reset 2026-11-15 15:00 Europe/Warsaw (in 6 d 19 h)
```

Markers: `[ OK ]` allowed, `[WARN]` allowed but close to a limit, `[FAIL]` limit reached or the account could not be
checked (bad/expired token, placeholder token, no network).

`--help` prints the usage; an unknown flag exits with code 2. Without `CLAUDE_LIMITS_TZ`/`TZ`, reset times use the
system time zone.

**Exit code:** `0` when every account answered and is allowed (a warning still counts as allowed); `1` on a token or
network error or when a limit is reached; `2` for an unknown argument. Handy for scripts and cron.

## Docker

Mount the script (read-only is fine) and the tokens file, and run it with any Node 18+ image:

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
