# How it works, limitations and security

## How it works

The `/usage` endpoint needs the `user:profile` scope, which `setup-token` tokens don't have. But for subscription
accounts the API attaches the limit state to every response, in the `anthropic-ratelimit-unified-*` headers. So the
script sends one minimal request per account (`max_tokens: 1`, Haiku, a few tokens) and reads those headers. Each check
costs a negligible fraction of a limit. Tokens are never printed or passed on a command line.

## Limitations and security

- The headers are undocumented (Claude Code itself relies on them) and may change or disappear.
- `HTTP 401` means the token is wrong, revoked or expired: generate a new one with `claude setup-token`.
- The tokens file holds secrets. Don't commit it, don't paste it into chats, and restrict its permissions where you can
  (`chmod 600` on Linux/macOS). See [Configuration](configuration.md#optional-hardening) to also forbid Claude from
  reading it.
- API-key accounts (`ANTHROPIC_API_KEY`) have no subscription windows and are not supported.
