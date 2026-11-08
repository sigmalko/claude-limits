# claude-limits

Shows how much of the Claude Code **subscription limits** each of your accounts has used: the 5-hour window and the
weekly window, plus when each one resets. It works for many accounts at once.

It is a **Claude Code plugin** (`subscription-limits`) and its own single-plugin marketplace. The core is one file with
no dependencies, `skills/usage/scripts/claude-limits.mjs` (Node.js 18+, built-ins only), which you can also run by hand.

## Quick start

```
/plugin marketplace add sigmalko/claude-limits
/plugin install subscription-limits@sigmalko-plugins
/subscription-limits:setup
/subscription-limits:usage
```

Install in the **`user` scope** (the default): the tokens it uses live in your home directory, not in a project.
The `setup` skill creates `~/.claude/claude-limits.tokens` and guides you through `claude setup-token` without ever
seeing a token.

Example output:

```
[ OK ] Account work_a (claude-limits.tokens; status: allowed; binding window: five_hour)
   5 hours :  29% used,  71% left, reset 2026-11-08 21:00 Europe/Warsaw (in 23 min)
   week    :   3% used,  97% left, reset 2026-11-15 15:00 Europe/Warsaw (in 6 d 19 h)
```

## Documentation

| Page | What is in it |
| --- | --- |
| [Installation](docs/installation.md) | prerequisites, install scopes (`user` / `project` / `local`), updating, installing Node.js |
| [Configuration](docs/configuration.md) | getting tokens, the tokens file, the `current` account, environment variables, hardening |
| [Usage](docs/usage.md) | the skills, running the script by hand, output and exit codes, Docker |
| [How it works](docs/how-it-works.md) | the rate-limit headers, limitations, security |
| [Development](docs/development.md) | repo layout, versioning rules, release checklist |
| [Changelog](CHANGELOG.md) | what changed in each version |

## Security in one line

The tokens file holds secrets: it stays outside the repo (`~/.claude/claude-limits.tokens`), is never committed, and
Claude is told never to read or print it. Details in [How it works](docs/how-it-works.md#limitations-and-security).

## License

[MIT](LICENSE).
