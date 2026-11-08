# Development

## Repo layout

```
.claude-plugin/plugin.json                  plugin manifest (name: subscription-limits), the single source of the version
.claude-plugin/marketplace.json             makes the repo an installable marketplace (sigmalko-plugins)
.claude-plugin/icon.png                     plugin icon (512x512)
skills/usage/SKILL.md                       the /subscription-limits:usage skill
skills/usage/scripts/claude-limits.mjs      the actual tool, Node.js version (also runnable by hand)
skills/usage/scripts/claude_limits.py       the same tool, Python version (keep both in sync: flags, output, exit codes)
skills/setup/SKILL.md                       the /subscription-limits:setup skill
skills/setup/claude-limits.tokens.example   template of the tokens file
scripts/check-version.mjs                   checks that plugin.json, marketplace.json and CHANGELOG.md agree
docs/                                       documentation
CHANGELOG.md                                release notes
```

Test locally without installing: `claude --plugin-dir .`, then `claude plugin validate .`.

## Versioning and releases

The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`.

**Why a bump is needed:** Claude Code updates an installed plugin only when its `version` changes. Same version means
users keep their cached copy, so every change that users should receive needs a new version.

**Single source of truth:** `version` in `.claude-plugin/plugin.json`. Do not put a version in `marketplace.json`.
`CHANGELOG.md` must have a matching `## [X.Y.Z] - YYYY-MM-DD` section, and the git tag is `vX.Y.Z`.

| Bump | When | Examples |
| --- | --- | --- |
| **MAJOR** | A change that can break existing users | rename or remove a skill or a CLI flag; change the default tokens file path or format; change exit codes or the `--json` shape; raise the minimum Node major |
| **MINOR** | New backwards-compatible functionality | a new skill, flag, `--json` field or environment variable |
| **PATCH** | Backwards-compatible fixes | bug fix, corrected output or messages, a docs fix that ships in the plugin |

Changes users never receive (CI, tests, repo-only docs) need no release: note them under `## [Unreleased]` if useful.

### Release checklist

1. In `CHANGELOG.md` move the items from `## [Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD` section (groups:
   Added, Changed, Deprecated, Removed, Fixed, Security) and update the two links at the bottom.
2. Set `version` to `X.Y.Z` in `.claude-plugin/plugin.json`.
3. Check: `node scripts/check-version.mjs` and `claude plugin validate .`.
4. Commit: `git commit -am "Release vX.Y.Z"`.
5. Tag and push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z`.
6. Publish the release: `gh release create vX.Y.Z --title vX.Y.Z --notes "<the changelog section>"`.

`node scripts/check-version.mjs --tag vX.Y.Z` also verifies that the tag matches the version (handy in release CI).
Users then update with `/plugin marketplace update sigmalko-plugins` and
`/plugin update subscription-limits@sigmalko-plugins`.
