# How it works, limitations and security

## How it works

The `/usage` endpoint needs the `user:profile` scope, which `setup-token` tokens don't have. But for subscription
accounts the API attaches the limit state to every response, in the `anthropic-ratelimit-unified-*` headers. So the
script sends one minimal request per account (`max_tokens: 1`, Haiku, a few tokens) and reads those headers. Each check
costs a negligible fraction of a limit. Tokens are never printed or passed on a command line.

## Limitations and security

- The headers are undocumented (Claude Code itself relies on them) and may change or disappear.
- If a response lacks one of the four usage/reset headers, or one is not a number, that account is reported as an error
  (`[FAIL] name: incomplete rate-limit headers ...`) instead of showing made-up numbers; the other accounts still run.
- A token with characters outside printable ASCII is rejected before any request, and error output never contains raw
  exception messages (only error codes), so a malformed token cannot leak into the output.
- The Node version does not use HTTP proxies (the Python version does); see [Configuration](configuration.md#proxies).
- `HTTP 401` means the token is wrong, revoked or expired: generate a new one with `claude setup-token`.
- Placeholder tokens (containing `REPLACE_ME`) are never sent; the `current` account with an expired access token is not
  probed either: run `claude` once to refresh it. Tokens are not refreshed by this tool.
- The tokens file holds secrets. Don't commit it, don't paste it into chats, and restrict its permissions where you can
  (`chmod 600` on Linux/macOS). See [Configuration](configuration.md#optional-hardening) to also forbid Claude from
  reading it.
- API-key accounts (`ANTHROPIC_API_KEY`) have no subscription windows and are not supported.
