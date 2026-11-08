#!/usr/bin/env node
// claude-limits: usage of the Claude subscription limits (5-hour window and weekly window) and when they reset,
// for many Claude Code subscription accounts.
//
//   claude-limits [name ...] [--brief] [--json]
//     (no name)     every account that has credentials:
//                     current  $CLAUDE_CONFIG_DIR/.credentials.json (default ~/.claude; on macOS the Keychain item
//                              "Claude Code-credentials" is the fallback, but only when CLAUDE_CONFIG_DIR is not set)
//                              = the account Claude Code here is logged in with
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
//   Empty lines and lines starting with # are ignored. UTF-8 (with or without BOM) and UTF-16 (with BOM) are read.
//
// How it works: the usage endpoint behind `/usage` (/api/oauth/usage) needs the `user:profile` scope, which long-lived
// `claude setup-token` tokens do not have. But for a subscription account the API attaches the limit state to EVERY
// response in the `anthropic-ratelimit-unified-*` headers (utilization 0..1 and reset time of the 5h and 7d windows). So one
// minimal request is sent (max_tokens 1, Haiku) and those headers are read. Cost: a negligible fraction of the limit.
// The token is never printed or passed on a command line, and a token with characters outside printable ASCII is
// rejected before any request. Limitations: these headers are undocumented (Claude Code itself uses them) and may change
// or disappear; API-key accounts (ANTHROPIC_API_KEY) have no subscription windows and are not supported; this Node
// version does not use HTTP(S)_PROXY (the Python version does).
// Environment: CLAUDE_PROBE_MODEL (default claude-haiku-5-5), CLAUDE_LIMITS_TZ (default $TZ, else the system time zone,
// else the local UTC offset), CLAUDE_LIMITS_TOKENS_FILE, CLAUDE_CONFIG_DIR.
// Exit code: 0 = every account answered and is allowed (also with a warning), 1 = token/network error or a limit reached.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const MODEL = process.env.CLAUDE_PROBE_MODEL || 'claude-haiku-5-5';
const CONFIG_DIR_SET = Boolean(process.env.CLAUDE_CONFIG_DIR);
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PLACEHOLDER = 'REPLACE_ME';
const TOKENS_FILE = process.env.CLAUDE_LIMITS_TOKENS_FILE || path.join(os.homedir(), '.claude', 'claude-limits.tokens');
const TOKEN_RE = /^[\x21-\x7E]+$/; // printable ASCII only: anything else cannot be a valid token (and would break the header)
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const HEADERS = ['5h-utilization', '5h-reset', '7d-utilization', '7d-reset'];

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
            (default ~/.claude/.credentials.json; on macOS the Keychain item "Claude Code-credentials" as fallback,
            only when CLAUDE_CONFIG_DIR is not set)
  <name>    an entry of the tokens file (name=token per line, token from 'claude setup-token'):
            ~/.claude/claude-limits.tokens or CLAUDE_LIMITS_TOKENS_FILE. Tokens containing REPLACE_ME are skipped.

Environment: CLAUDE_PROBE_MODEL (default claude-haiku-5-5), CLAUDE_LIMITS_TZ (default $TZ, else the system time zone,
else the local UTC offset), CLAUDE_LIMITS_TOKENS_FILE, CLAUDE_CONFIG_DIR.
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

// Only an error code is ever printed from an exception, never its message (it could contain a token).
const safeCode = (e) => {
  const c = e?.cause?.code ?? e?.code;
  if (typeof c === 'string' && /^[A-Z0-9_]{2,40}$/.test(c)) return c;
  return e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'ETIMEDOUT' : 'ERROR';
};
const exists = (f) => { try { fs.lstatSync(f); return true; } catch { return false; } };

// Windows tools by absolute path (never looked up via PATH or the current directory).
function winExe(name) {
  const p = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', name);
  return exists(p) ? p : path.join('C:\\Windows', 'System32', name);
}
// The current user as a SID ("*S-1-..." is accepted by icacls), so names with special characters or domains cannot break it.
function windowsUserSid() {
  const out = execFileSync(winExe('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const m = /"(S-1-\d+(?:-\d+)+)"/.exec(out);
  if (!m) throw new Error('no SID');
  return m[1];
}

// --init: create the tokens file from the template with owner-only permissions. Never overwrites, never reads an existing file.
function initTokensFile() {
  if (exists(TOKENS_FILE)) { console.log(`Tokens file already exists, left untouched: ${TOKENS_FILE}`); return 0; }
  const template = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'setup', 'claude-limits.tokens.example');
  let data;
  try { data = fs.readFileSync(template); } catch { console.error(`claude-limits: template not found: ${template}`); return 1; }
  const dir = path.dirname(TOKENS_FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
    if (e.code === 'EEXIST' || e.code === 'ENOTDIR') console.error(`claude-limits: cannot create ${TOKENS_FILE}: ${dir} (or one of its parents) exists but is not a directory`);
    else console.error(`claude-limits: cannot create the directory ${dir} (${safeCode(e)})`);
    return 1;
  }
  try {
    fs.writeFileSync(TOKENS_FILE, data, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code === 'EEXIST') { console.log(`Tokens file already exists, left untouched: ${TOKENS_FILE}`); return 0; }
    console.error(`claude-limits: cannot create ${TOKENS_FILE} (${safeCode(e)})`); return 1;
  }
  try {
    if (process.platform === 'win32') {
      execFileSync(winExe('icacls.exe'), [TOKENS_FILE, '/inheritance:r', '/grant:r', `*${windowsUserSid()}:(R,W)`], { stdio: 'ignore', windowsHide: true });
    } else fs.chmodSync(TOKENS_FILE, 0o600);
  } catch (e) {
    let removed = true;
    try { fs.unlinkSync(TOKENS_FILE); } catch { removed = false; }
    console.error(`claude-limits: could not restrict the permissions of ${TOKENS_FILE} (${safeCode(e)}); ` +
      (removed ? 'the file was removed again, nothing was created' : 'delete it manually before putting tokens in it'));
    return 1;
  }
  console.log(`Created ${TOKENS_FILE} (owner-only permissions).`);
  console.log('Next: run `claude setup-token` per account in a separate terminal, put each token in that file as name=sk-ant-oat01-... (remove the REPLACE_ME example lines), then run this script with --brief.');
  return 0;
}
if (args.includes('--init')) process.exit(initTokensFile());

let problem = 0;

// Time zone: CLAUDE_LIMITS_TZ, then $TZ, then the system zone; the first valid IANA name wins. When none is valid the
// local UTC offset is printed instead (UTC+02:00), like the Python version.
const validTz = (z) => {
  if (!z || /^[+-]/.test(z)) return false;
  try { new Intl.DateTimeFormat('sv-SE', { timeZone: z }); return true; } catch { return false; }
};
const systemTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };
if (process.env.CLAUDE_LIMITS_TZ && !validTz(process.env.CLAUDE_LIMITS_TZ)) console.error(`claude-limits: unknown time zone "${process.env.CLAUDE_LIMITS_TZ}" in CLAUDE_LIMITS_TZ, ignored`);
const TZ = [process.env.CLAUDE_LIMITS_TZ, process.env.TZ, systemTz()].find(validTz) || null;

// Text of a file: '' when it cannot be read, null when it is not valid text. UTF-8 (BOM stripped) or UTF-16 with a BOM.
function readText(f) {
  let buf;
  try { buf = fs.readFileSync(f); } catch { return ''; }
  try {
    const enc = buf[0] === 0xFF && buf[1] === 0xFE ? 'utf-16le' : buf[0] === 0xFE && buf[1] === 0xFF ? 'utf-16be' : 'utf-8';
    return new TextDecoder(enc, { fatal: true }).decode(buf); // strips the BOM
  } catch { return null; }
}

// Accounts from the tokens file (.env-like): Map name -> token. The names are whatever the user chose left of '='.
// Tolerated: BOM, CRLF, an optional 'export ' prefix, optional quotes around the token, a line without a name.
// A line is name=token only when the left part looks like a name and the rest does not start with '=' (base64 padding
// of an unnamed token); otherwise the whole line is an unnamed token.
function fileTokens() {
  const map = new Map();
  let n = 0;
  const text = readText(TOKENS_FILE);
  if (text === null) {
    console.error(`claude-limits: ${TOKENS_FILE} is not valid UTF-8 or UTF-16 text; save it as UTF-8`);
    problem = 1;
    return map;
  }
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim().replace(/^export\s+/, '');
    if (!l || l.startsWith('#')) continue;
    n++;
    let name = `account-${n}`, token = l;
    const i = l.indexOf('=');
    if (i > 0) {
      const left = l.slice(0, i).trim(), right = l.slice(i + 1).trim();
      if (NAME_RE.test(left) && !right.startsWith('=')) { name = left; token = right; }
    }
    token = token.replace(/^(["'])(.*)\1$/, '$2');
    if (!token) continue;
    if (name === 'current') { console.error('claude-limits: the name "current" is reserved, skipping that line'); continue; }
    if (map.has(name)) console.error(`claude-limits: duplicate name "${name}" in ${TOKENS_FILE}, the last one wins`);
    map.set(name, token);
  }
  return map;
}
const fromFile = fileTokens();

const isoTime = (ms) => { try { return new Date(ms).toISOString(); } catch { return String(ms); } };

// Returns { token } or { error } or null when the account has no credentials at all.
function credentials(account) {
  let token, source, extra = {};
  if (account !== 'current') {
    token = fromFile.get(account);
    if (!token) return null;
    if (token.includes(PLACEHOLDER)) return { placeholder: true };
    source = path.basename(TOKENS_FILE);
  } else {
    source = path.join(CONFIG_DIR, '.credentials.json');
    let raw = readText(source);
    if (raw === null) return { error: `${source} is not valid UTF-8 text`, source };
    raw = raw.trim();
    if (!raw && process.platform === 'darwin' && !CONFIG_DIR_SET) { // a custom CLAUDE_CONFIG_DIR is another account than the Keychain one
      try { // the output is only parsed, never printed
        raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
        source = 'macOS Keychain (Claude Code-credentials)';
      } catch { raw = ''; }
    }
    if (!raw) return null;
    let j, oauth;
    try { j = JSON.parse(raw); } catch { return { error: `${source} is not valid JSON`, source }; }
    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    oauth = isObj(j) ? (j.claudeAiOauth ?? j) : null;
    if (!isObj(j)) return { error: `${source} is not valid JSON`, source };
    if (!isObj(oauth) || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return { error: `no accessToken in ${source}`, source };
    const exp = typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null; // anything else = unknown
    if (exp && exp < Date.now()) return { error: `the access token in ${source} expired ${isoTime(exp)}; run \`claude\` once to refresh it`, source };
    token = oauth.accessToken;
    extra = { subscription: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null };
  }
  if (!TOKEN_RE.test(token)) return { error: 'token contains invalid characters', source };
  return { token, source, ...extra };
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
    return { error: `no connection to api.anthropic.com (${safeCode(e)})` };
  }
  const h = (k) => res.headers.get(`anthropic-ratelimit-unified-${k}`);
  if (!h('status') && !h('5h-utilization')) {
    let msg = '';
    try { const m = (await res.json()).error?.message; if (typeof m === 'string') msg = m.split(token).join('[token]').replace(/\s+/g, ' '); } catch {}
    return { error: `HTTP ${res.status}${msg ? `: ${msg.slice(0, 120)}` : ''} (no limit headers: wrong/expired token or not a subscription account)` };
  }
  const v = {};
  for (const k of HEADERS) {
    const raw = (h(k) ?? '').trim();
    if (!raw) return { error: `incomplete rate-limit headers: ${k} is missing, cannot tell the usage` };
    const x = /^[0-9]+(\.[0-9]+)?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(x) || (k.endsWith('reset') && x > 253402300799)) return { error: `invalid rate-limit header ${k} (not a number)` };
    v[k] = x;
  }
  return {
    http: res.status,
    status: h('status'),
    binding_window: h('representative-claim'),
    five_hour: { used: v['5h-utilization'], reset_epoch: v['5h-reset'], status: h('5h-status') },
    seven_day: { used: v['7d-utilization'], reset_epoch: v['7d-reset'], status: h('7d-status'), surpassed_threshold: h('7d-surpassed-threshold') },
  };
}

const pct = (u) => Math.round(u * 100);
function dur(sec) {
  if (sec <= 0) return 'now';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}
const fmt = (zone) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' });
function when(epoch) {
  const date = new Date(epoch * 1000);
  if (TZ) return `${fmt(TZ).format(date)} ${TZ}`;
  const off = -date.getTimezoneOffset(); // minutes east of UTC
  const a = Math.abs(off), p = (x) => String(x).padStart(2, '0');
  return `${fmt('UTC').format(new Date(date.getTime() + off * 60000))} UTC${off < 0 ? '-' : '+'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

const accounts = wanted.length ? wanted : ['current', ...fromFile.keys()];
const results = [];
for (const account of accounts) {
  try {
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
    if (r.error) { problem = 1; results.push({ account, ok: false, error: r.error }); continue; }
    if (r.status !== 'allowed' && r.status !== 'allowed_warning') problem = 1;
    results.push({ account, ok: true, source: cred.source, subscription: cred.subscription ?? null, ...r });
  } catch (e) {
    problem = 1;
    results.push({ account, ok: false, error: `unexpected error (${safeCode(e)})` });
  }
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
    const f = r.five_hour, s = r.seven_day, st = r.status || '?';
    if (brief) {
      console.log(`${mark} ${r.account}: 5h ${pct(f.used)}% used (reset in ${dur(f.reset_epoch - now)}) | 7d ${pct(s.used)}% used (reset in ${dur(s.reset_epoch - now)}) | status ${st}`);
    } else {
      console.log(`${mark} Account ${r.account} (${r.source}${r.subscription ? `, ${r.subscription}` : ''}; status: ${st}; binding window: ${r.binding_window || '?'})`);
      console.log(`   5 hours : ${String(pct(f.used)).padStart(3)}% used, ${String(100 - pct(f.used)).padStart(3)}% left, reset ${when(f.reset_epoch)} (in ${dur(f.reset_epoch - now)})`);
      console.log(`   week    : ${String(pct(s.used)).padStart(3)}% used, ${String(100 - pct(s.used)).padStart(3)}% left, reset ${when(s.reset_epoch)} (in ${dur(s.reset_epoch - now)})`);
      if (s.status === 'allowed_warning') console.log(`   warning : weekly limit passed its warning threshold (${s.surpassed_threshold || '?'})`);
    }
  }
}
process.exitCode = problem; // not process.exit(): on Windows, calling it right after fetch() crashes libuv (UV_HANDLE_CLOSING assertion)
}
