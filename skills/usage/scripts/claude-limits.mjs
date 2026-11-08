#!/usr/bin/env node
// claude-limits: usage of the Claude subscription limits (5-hour window and weekly window) and when they reset,
// for many Claude Code subscription accounts.
//
//   claude-limits [name ...] [--brief] [--json]
//     (no name)     every account that has credentials:
//                     current  ~/.claude/.credentials.json (the account Claude Code on this machine is logged in with)
//                     <name>   every entry of the tokens file (see below)
//     --brief       one line per account
//     --json        machine-readable (an array, one object per account)
//
// Tokens file: ~/.claude/claude-limits.tokens (outside the plugin, survives updates), or CLAUDE_LIMITS_TOKENS_FILE.
// One account per line, name=token (a token made by `claude setup-token`; you choose the names), like a .env file.
// Copy claude-limits.tokens.example to ~/.claude/claude-limits.tokens and fill it in:
//     work_a=sk-ant-oat01-...
//     work_b=sk-ant-oat01-...
//     sk-ant-oat01-...            (unnamed -> account-N, N = line order among entries)
//   Empty lines and lines starting with # are ignored.
//
// How it works: the usage endpoint behind `/usage` (/api/oauth/usage) needs the `user:profile` scope, which long-lived
// `claude setup-token` tokens do not have. But for a subscription account the API attaches the limit state to EVERY
// response in the `anthropic-ratelimit-unified-*` headers (utilization 0..1 and reset time of the 5h and 7d windows). So one
// minimal request is sent (max_tokens 1, Haiku) and those headers are read. Cost: a negligible fraction of the limit.
// The token is never printed or passed on a command line.
// Limitations: these headers are undocumented (Claude Code itself uses them) and may change or disappear; API-key accounts
// (ANTHROPIC_API_KEY) have no subscription windows and are not supported.
// Environment: CLAUDE_PROBE_MODEL (default claude-haiku-5-5), CLAUDE_LIMITS_TZ (default $TZ or Europe/Warsaw),
// CLAUDE_LIMITS_TOKENS_FILE.
// Exit code: 0 = every account answered and is allowed (also with a warning), 1 = token/network error or a limit reached.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = process.env.CLAUDE_PROBE_MODEL || 'claude-haiku-5-5';
const TZ = process.env.CLAUDE_LIMITS_TZ || process.env.TZ || 'Europe/Warsaw';
const TOKENS_FILE = process.env.CLAUDE_LIMITS_TOKENS_FILE || path.join(os.homedir(), '.claude', 'claude-limits.tokens');

const args = process.argv.slice(2);
const brief = args.includes('--brief');
const json = args.includes('--json');
const wanted = args.filter((a) => !a.startsWith('--'));
if (args.includes('-h') || args.includes('--help')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 29).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
for (const a of args) if (a.startsWith('--') && !['--brief', '--json'].includes(a)) {
  console.error(`claude-limits: unknown argument ${a}`); process.exit(2);
}

const readFile = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// Accounts from the tokens file (.env-like): Map name -> token. The names are whatever the user chose left of '='.
// Tolerated: UTF-8 BOM, CRLF, an optional 'export ' prefix, optional quotes around the token, a line without a name.
function fileTokens() {
  const map = new Map();
  let n = 0;
  const text = readFile(TOKENS_FILE).replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim().replace(/^export\s+/, '');
    if (!l || l.startsWith('#')) continue;
    n++;
    const i = l.indexOf('=');
    const name = i > 0 ? l.slice(0, i).trim() : `account-${n}`;
    const token = (i > 0 ? l.slice(i + 1) : l).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!token) continue;
    if (name === 'current') { console.error('claude-limits: the name "current" is reserved, skipping that line'); continue; }
    if (map.has(name)) console.error(`claude-limits: duplicate name "${name}" in ${TOKENS_FILE}, the last one wins`);
    map.set(name, token);
  }
  return map;
}
const fromFile = fileTokens();

// Returns { token } or { error } or null when the account has no credentials at all.
function credentials(account) {
  if (account !== 'current') {
    const token = fromFile.get(account);
    return token ? { token, source: path.basename(TOKENS_FILE) } : null;
  }
  const source = path.join(os.homedir(), '.claude', '.credentials.json');
  const raw = readFile(source).trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const oauth = j.claudeAiOauth ?? j;
    if (!oauth.accessToken) return { error: `no accessToken in ${source}`, source };
    const expired = oauth.expiresAt && oauth.expiresAt < Date.now();
    return { token: oauth.accessToken, source, expiresAt: oauth.expiresAt, expired, subscription: oauth.subscriptionType };
  } catch {
    return { error: `${source} is not valid JSON`, source };
  }
}

async function probe(token) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1,
        system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(40000),
    });
  } catch (e) {
    return { error: `no connection to api.anthropic.com (${e.cause?.code || e.message})` };
  }
  const h = (k) => res.headers.get(`anthropic-ratelimit-unified-${k}`);
  if (!h('status') && !h('5h-utilization')) {
    let msg = '';
    try { msg = (await res.json()).error?.message ?? ''; } catch {}
    return { error: `HTTP ${res.status}${msg ? `: ${msg.slice(0, 120)}` : ''} (no limit headers: wrong/expired token or not a subscription account)` };
  }
  const num = (k, d) => (h(k) == null ? d : Number(h(k)));
  const now = Math.floor(Date.now() / 1000);
  return {
    http: res.status,
    status: h('status'),
    binding_window: h('representative-claim'),
    five_hour: { used: num('5h-utilization', 0), reset_epoch: num('5h-reset', now), status: h('5h-status') },
    seven_day: { used: num('7d-utilization', 0), reset_epoch: num('7d-reset', now), status: h('7d-status'), surpassed_threshold: h('7d-surpassed-threshold') },
  };
}

const pct = (u) => Math.round(u * 100);
function dur(sec) {
  if (sec <= 0) return 'now';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}
const when = (epoch) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(epoch * 1000)) + ` ${TZ}`;

const accounts = wanted.length ? wanted : ['current', ...fromFile.keys()];
const results = [];
let problem = 0;
for (const account of accounts) {
  const cred = credentials(account);
  if (!cred) {
    if (wanted.length) { problem = 1; results.push({ account, ok: false, error: 'no credentials' }); }
    continue; // not configured and not asked for explicitly: skip silently
  }
  if (cred.error) { problem = 1; results.push({ account, ok: false, error: cred.error }); continue; }
  const r = await probe(cred.token);
  if (r.error) {
    problem = 1;
    results.push({ account, ok: false, error: r.error + (cred.expired ? `; the access token in ${cred.source} expired ${new Date(cred.expiresAt).toISOString()}` : '') });
    continue;
  }
  if (r.status !== 'allowed' && r.status !== 'allowed_warning') problem = 1;
  results.push({ account, ok: true, source: cred.source, subscription: cred.subscription, ...r });
}

if (!results.length) {
  const msg = `no Claude credentials found (~/.claude/.credentials.json or tokens in ${TOKENS_FILE})`;
  if (json) console.log(JSON.stringify([{ ok: false, error: msg }], null, 2)); else console.log(`[FAIL] ${msg}`);
  process.exitCode = 1;
} else {

const now = Math.floor(Date.now() / 1000);
if (json) {
  console.log(JSON.stringify(results.map((r) => (r.ok ? {
    ...r,
    five_hour: { ...r.five_hour, left: +(1 - r.five_hour.used).toFixed(4) },
    seven_day: { ...r.seven_day, left: +(1 - r.seven_day.used).toFixed(4) },
  } : r)), null, 2));
} else {
  for (const r of results) {
    if (!r.ok) { console.log(`[FAIL] ${r.account}: ${r.error}`); continue; }
    const mark = r.status === 'allowed' ? '[ OK ]' : r.status === 'allowed_warning' ? '[WARN]' : '[FAIL]';
    const f = r.five_hour, s = r.seven_day;
    if (brief) {
      console.log(`${mark} ${r.account}: 5h ${pct(f.used)}% used (reset in ${dur(f.reset_epoch - now)}) | 7d ${pct(s.used)}% used (reset in ${dur(s.reset_epoch - now)}) | status ${r.status}`);
    } else {
      console.log(`${mark} Account ${r.account} (${r.source}${r.subscription ? `, ${r.subscription}` : ''}; status: ${r.status}; binding window: ${r.binding_window ?? '?'})`);
      console.log(`   5 hours : ${String(pct(f.used)).padStart(3)}% used, ${String(100 - pct(f.used)).padStart(3)}% left, reset ${when(f.reset_epoch)} (in ${dur(f.reset_epoch - now)})`);
      console.log(`   week    : ${String(pct(s.used)).padStart(3)}% used, ${String(100 - pct(s.used)).padStart(3)}% left, reset ${when(s.reset_epoch)} (in ${dur(s.reset_epoch - now)})`);
      if (s.status === 'allowed_warning') console.log(`   warning : weekly limit passed its warning threshold (${s.surpassed_threshold ?? '?'})`);
    }
  }
}
process.exitCode = problem; // not process.exit(): on Windows, calling it right after fetch() crashes libuv (UV_HANDLE_CLOSING assertion)
}
