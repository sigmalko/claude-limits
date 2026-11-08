# Installation

## Prerequisites

- **Node.js 18 or newer** (needs the built-in `fetch`). Developed and tested on Node 24. Not installed? See
  [Install Node.js](#install-nodejs).
- **Network access to `https://api.anthropic.com`** (works the same on Windows, Linux, macOS and in Docker).
- **Claude subscription accounts** (Pro/Max). API-key accounts (`ANTHROPIC_API_KEY`) have no subscription windows and
  are not supported.
- **A long-lived token per account**, created with `claude setup-token` (see [Configuration](configuration.md)). This
  needs the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed once, on any machine, and you must
  be able to log in to each account.
- Optional: **Docker**, if you prefer to run the script in a container.

## Install as a plugin

Inside Claude Code:

```
/plugin marketplace add sigmalko/claude-limits
/plugin install subscription-limits@sigmalko-plugins
```

> The plugin is called `subscription-limits`, not `claude-limits`: plugin names starting with `claude-` are reserved
> for Anthropic. The repo, the script and the tokens file keep the `claude-limits` name.

Update later with `/plugin marketplace update sigmalko-plugins` and
`/plugin update subscription-limits@sigmalko-plugins`. Check what is installed with `claude plugin list`; remove it with
`claude plugin uninstall subscription-limits@sigmalko-plugins [--scope ...]`.

Next step: [Configuration](configuration.md) (or just run `/subscription-limits:setup`).

## Install scope: user, project or local

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

## Try it from a local clone, without installing

```bash
git clone https://github.com/sigmalko/claude-limits && cd claude-limits
claude --plugin-dir .
```

## Install Node.js

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

**Any system without installing anything:** use the Docker command from [Usage](usage.md#docker); the image already
contains Node.

Check it:

```bash
node --version   # should print v18.x or newer
```

Other options and installers: <https://nodejs.org/en/download>.
