#!/usr/bin/env node
// claude-limits: usage of the Claude subscription limits (5-hour window and weekly window) and when they reset,
// for many Claude Code subscription accounts.
//
//   claude-limits [name ...] [--brief] [--json]
//     (no name)     every account that has credentials:
//                     current  $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude; on macOS the Keychain item
//                              "Claude Code-credentials" is the fallback) = the account Claude Code here is logged in with
//                     <name>   every entry of the tokens file (see below)
//     --brief       one line per account
//     --json        machine-readable (an array, one object per account)
//     --init        create the tokens file from the template (owner-only permissions), never overwrites; no network
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
// Environment: CLAUDE_PROBE_MODEL (default claude-haiku-5-5), CLAUDE_LIMITS_TZ (default $TZ, else the system time zone),
// CLAUDE_LIMITS_TOKENS_FILE, CLAUDE_CONFIG_DIR.
// Exit code: 0 = every account answered and is allowed (also with a warning), 1 = token/network error or a limit reached.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const MODEL = process.env.CLAUDE_PROBE_MODEL || 'claude-haiku-5-5';
const systemTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const TZ = process.env.CLAUDE_LIMITS_TZ || process.env.TZ || systemTz();
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PLACEHOLDER = 'REPLACE_ME';
const TOKENS_FILE = process.env.CLAUDE_LIMITS_TOKENS_FILE || path.join(os.homedir(), '.claude', 'claude-limits.tokens');

const USAGE = `claude-limits: usage of the Claude subscription limits (5-hour and weekly window) and when they reset.

Usage: claude-limits [name ...] [--brief] [--json] [-h | --help]
       claude-limits --init

  name ...    accounts to check; without a name: "current" plus every account in the tokens file
  --brief     one line per account
  --json      machine-readable output (an array, one object per account)
  --init      create the tokens file from the template (owner-only permissions); never overwrites; no network
  -h, --help  show this help

Accounts:
  current   the account Claude Code on this machine is logged in with: $CLAUDE_CONFIG_DIR/.credentials.json
            (default ~/.claude/.credentials.json; on macOS the Keychain item "Claude Code-credentials" as fallback)
  <name>    an entry of the tokens file (name=token per line, token from 'claude setup-token'):
            ~/.claude/claude-limits.tokens or CLAUDE_LIMITS_TOKENS_FILE. Tokens containing REPLACE_ME are skipped.

Environment: CLAUDE_PROBE_MODEL (default claude-haiku-5-5), CLAUDE_LIMITS_TZ (default $TZ, else the system time zone),
CLAUDE_LIMITS_TOKENS_FILE, CLAUDE_CONFIG_DIR.
Exit code: 0 = every account answered and is allowed (also with a warning), 1 = token/network error or a limit reached,
2 = bad argument.`;

const args = process.argv.slice(2);
const brief = args.includes('--brief');
const json = args.includes('--json');
const wanted = args.filter((a) => !a.startsWith('--'));
if (args.includes('-h') || args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}
for (const a of args) if (a.startsWith('--') && !['--brief', '--json', '--init'].includes(a)) {
  console.error(`claude-limits: unknown argument ${a}`); process.exit(2);
}

// --init: create the tokens file from the template with owner-only permissions. Never overwrites, never reads an existing file.
function initTokensFile() {
  const template = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'setup', 'claude-limits.tokens.example');
  let data;
  try { data = fs.readFileSync(template); } catch { console.error(`claude-limits: template not found: ${template}`); return 1; }
  try {
    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, data, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code === 'EEXIST') { console.log(`Tokens file already exists, left untouched: ${TOKENS_FILE}`); return 0; }
    console.error(`claude-limits: cannot create ${TOKENS_FILE} (${e.code || e.message})`); return 1;
  }
  try {
    if (process.platform === 'win32') {
      execFileSync('icacls', [TOKENS_FILE, '/inheritance:r', '/grant:r', `${process.env.USERNAME || os.userInfo().username}:(R,W)`], { stdio: 'ignore', windowsHide: true });
    } else fs.chmodSync(TOKENS_FILE, 0o600);
  } catch (e) {
    console.error(`claude-limits: created ${TOKENS_FILE} but could not restrict its permissions (${e.code || e.message}); restrict it to your user manually`); return 1;
  }
  console.log(`Created ${TOKENS_FILE} (owner-only permissions).`);
  console.log('Next: run `claude setup-token` per account in a separate terminal, put each token in that file as name=sk-ant-oat01-... (remove the REPLACE_ME example lines), then run this script with --brief.');
  return 0;
}
if (args.includes('--init')) process.exit(initTokensFile());

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
    if (!token) return null;
    if (token.includes(PLACEHOLDER)) return { placeholder: true };
    return { token, source: path.basename(TOKENS_FILE) };
  }
  let source = path.join(CONFIG_DIR, '.credentials.json');
  let raw = readFile(source).trim();
  if (!raw && process.platform === 'darwin') {
    try { // the output is only parsed, never printed
      raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
      source = 'macOS Keychain (Claude Code-credentials)';
    } catch { raw = ''; }
  }
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    const oauth = j.claudeAiOauth ?? j;
    if (!oauth.accessToken) return { error: `no accessToken in ${source}`, source };
    const expired = oauth.expiresAt && oauth.expiresAt < Date.now();
    if (expired) return { error: `the access token in ${source} expired ${new Date(oauth.expiresAt).toISOString()}; run \`claude\` once to refresh it`, source };
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
  if (cred.placeholder) {
    if (wanted.length) { problem = 1; results.push({ account, ok: false, error: 'not configured (placeholder token)' }); }
    else console.error(`claude-limits: account "${account}" skipped: not configured (placeholder token containing ${PLACEHOLDER})`);
    continue;
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
  const msg = `no Claude credentials found (${path.join(CONFIG_DIR, '.credentials.json')} or tokens in ${TOKENS_FILE})`;
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
