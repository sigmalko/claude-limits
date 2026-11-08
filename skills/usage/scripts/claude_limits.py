#!/usr/bin/env python3
"""claude-limits (Python port): usage of the Claude subscription limits (5-hour and weekly window) and reset times.

Same flags, output and exit codes as claude-limits.mjs. Standard library only, Python 3.9+, Windows/Linux/macOS.
Run with --help for the usage text.
"""
import errno
import json
import math
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal

MODEL = os.environ.get("CLAUDE_PROBE_MODEL") or "claude-haiku-5-5"
PLACEHOLDER = "REPLACE_ME"
HOME = os.path.expanduser("~")
CONFIG_DIR_SET = bool(os.environ.get("CLAUDE_CONFIG_DIR"))
CONFIG_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
TOKENS_FILE = os.environ.get("CLAUDE_LIMITS_TOKENS_FILE") or os.path.join(HOME, ".claude", "claude-limits.tokens")
TOKEN_RE = re.compile(r"[\x21-\x7E]+")  # printable ASCII only: anything else cannot be a valid token
NAME_RE = re.compile(r"[A-Za-z0-9_.-]+")
HEADERS = ("5h-utilization", "5h-reset", "7d-utilization", "7d-reset")

USAGE = """claude-limits: usage of the Claude subscription limits (5-hour and weekly window) and when they reset.

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
2 = bad argument."""


def err(msg):
    print(msg, file=sys.stderr)


def err_code(e):
    """Only an error code is ever printed from an exception, never its message (it could contain a token)."""
    if isinstance(e, socket.gaierror):
        return "ENOTFOUND"
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "ETIMEDOUT"
    return errno.errorcode.get(getattr(e, "errno", None), "ERROR")


def system_tz():
    """IANA name of the system zone if it can be found without third-party modules, else None."""
    try:
        target = os.path.realpath("/etc/localtime")
        if "zoneinfo/" in target:
            return target.split("zoneinfo/", 1)[1]
    except OSError:
        pass
    try:
        with open("/etc/timezone", "r", encoding="utf-8") as f:
            name = f.read().strip()
            if name:
                return name
    except (OSError, ValueError):
        pass
    return None


def load_zone(name):
    """A ZoneInfo for an IANA name, or None when the name is empty/unknown or there is no tz database (common on Windows)."""
    if not name or name[0] in "+-":
        return None
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:
        return None


def resolve_tz():
    """CLAUDE_LIMITS_TZ, then $TZ, then the system zone; the first valid one wins. (None, None) = print the local UTC offset."""
    explicit = os.environ.get("CLAUDE_LIMITS_TZ")
    if explicit and load_zone(explicit) is None:
        err('claude-limits: unknown time zone "%s" in CLAUDE_LIMITS_TZ, ignored' % explicit)
    for cand in (explicit, os.environ.get("TZ"), system_tz()):
        zone = load_zone(cand)
        if zone is not None:
            return cand, zone
    return None, None


TZ, ZONE = None, None


def read_text(path):
    """Text of a file: "" when it cannot be read, None when it is not valid text. UTF-8 (BOM stripped) or UTF-16 with a BOM."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return ""
    try:
        if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
            return data.decode("utf-16")  # uses and strips the BOM
        return data.decode("utf-8-sig")
    except UnicodeError:
        return None


def file_tokens():
    """Accounts from the tokens file: (dict name -> token in file order, file_is_bad).

    A line is name=token only when the left part looks like a name and the rest does not start with '=' (base64
    padding of an unnamed token); otherwise the whole line is an unnamed token."""
    result, n = {}, 0
    text = read_text(TOKENS_FILE)
    if text is None:
        err("claude-limits: %s is not valid UTF-8 or UTF-16 text; save it as UTF-8" % TOKENS_FILE)
        return result, True
    for line in re.split(r"\r?\n", text):
        line = re.sub(r"^export\s+", "", line.strip())
        if not line or line.startswith("#"):
            continue
        n += 1
        name, token = "account-%d" % n, line
        i = line.find("=")
        if i > 0:
            left, right = line[:i].strip(), line[i + 1:].strip()
            if NAME_RE.fullmatch(left) and not right.startswith("="):
                name, token = left, right
        m = re.fullmatch(r"([\"'])(.*)\1", token)
        if m:
            token = m.group(2)
        if not token:
            continue
        if name == "current":
            err('claude-limits: the name "current" is reserved, skipping that line')
            continue
        if name in result:
            err('claude-limits: duplicate name "%s" in %s, the last one wins' % (name, TOKENS_FILE))
        result[name] = token
    return result, False


def iso_time(ms):
    try:
        return datetime.fromtimestamp(ms // 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (int(ms) % 1000)
    except (OverflowError, OSError, ValueError):
        return str(ms)


def _reject_constant(_):
    raise ValueError("NaN/Infinity are not JSON")


def credentials(account, from_file):
    """Returns a dict with token / error, or None when the account has no credentials at all."""
    if account != "current":
        token = from_file.get(account)
        if not token:
            return None
        if PLACEHOLDER in token:
            return {"placeholder": True}
        source, extra = os.path.basename(TOKENS_FILE), {}
    else:
        source = os.path.join(CONFIG_DIR, ".credentials.json")
        raw = read_text(source)
        if raw is None:
            return {"error": "%s is not valid UTF-8 text" % source, "source": source}
        raw = raw.strip()
        if not raw and sys.platform == "darwin" and not CONFIG_DIR_SET:  # a custom CLAUDE_CONFIG_DIR is another account than the Keychain one
            try:  # the output is only parsed, never printed
                raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                                     capture_output=True, text=True, timeout=10, check=True).stdout.strip()
                source = "macOS Keychain (Claude Code-credentials)"
            except (OSError, ValueError, subprocess.SubprocessError):
                raw = ""
        if not raw:
            return None
        try:
            j = json.loads(raw, parse_constant=_reject_constant)
        except (ValueError, RecursionError):
            return {"error": "%s is not valid JSON" % source, "source": source}
        if not isinstance(j, dict):
            return {"error": "%s is not valid JSON" % source, "source": source}
        oauth = j.get("claudeAiOauth", j)
        if oauth is None:
            oauth = j
        if not isinstance(oauth, dict) or not isinstance(oauth.get("accessToken"), str) or not oauth["accessToken"]:
            return {"error": "no accessToken in %s" % source, "source": source}
        exp = oauth.get("expiresAt")
        if isinstance(exp, bool) or not isinstance(exp, (int, float)) or not math.isfinite(exp):
            exp = None  # anything else = unknown
        if exp and exp < time.time() * 1000:
            return {"error": "the access token in %s expired %s; run `claude` once to refresh it" % (source, iso_time(exp)),
                    "source": source}
        token = oauth["accessToken"]
        sub = oauth.get("subscriptionType")
        extra = {"subscription": sub if isinstance(sub, str) else None}
    if not TOKEN_RE.fullmatch(token):
        return {"error": "token contains invalid characters", "source": source}
    return dict({"token": token, "source": source}, **extra)


def norm(x):
    """A float as an int when it is integral, so the JSON output reads 1 / 0 like the Node version."""
    return int(x) if float(x).is_integer() and abs(x) < 2 ** 53 else x


def js_num(x):
    """A float written like JavaScript's JSON.stringify does (0.00001, not 1e-05)."""
    r = repr(x)
    if "e" not in r:
        return r
    mant, exp = r.split("e")
    exp = int(exp)
    if -7 < exp < 21:
        return format(Decimal(r), "f")
    return "%se%s%d" % (mant, "+" if exp > 0 else "-", abs(exp))


def dumps(obj):
    """json.dumps with the number format of the Node version."""
    def mark(o):
        if isinstance(o, float):
            return "@@NUM" + js_num(o) + "@@"
        if isinstance(o, dict):
            return {k: mark(v) for k, v in o.items()}
        if isinstance(o, list):
            return [mark(v) for v in o]
        return o
    return re.sub(r'"@@NUM([^"@]*)@@"', r"\1", json.dumps(mark(obj), indent=2, ensure_ascii=False))


def probe(token):
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1,
        "system": [{"type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude."}],
        "messages": [{"role": "user", "content": "hi"}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST", headers={
        "Authorization": "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    })
    try:
        res = urllib.request.urlopen(req, timeout=40)
        status, headers, payload = res.status, res.headers, b""
    except urllib.error.HTTPError as e:  # 4xx/5xx still carry the headers (e.g. 429)
        status, headers = e.code, e.headers
        try:
            payload = e.read()
        except OSError:
            payload = b""
    except urllib.error.URLError as e:
        return {"error": "no connection to api.anthropic.com (%s)" % err_code(e.reason if isinstance(e.reason, BaseException) else e)}
    except Exception as e:  # never print the message of an exception: it could contain the token
        return {"error": "no connection to api.anthropic.com (%s)" % err_code(e)}

    def h(k):
        return headers.get("anthropic-ratelimit-unified-" + k)

    if not h("status") and not h("5h-utilization"):
        msg = ""
        try:
            m = json.loads(payload).get("error", {}).get("message", "")
            if isinstance(m, str):
                msg = re.sub(r"\s+", " ", m.replace(token, "[token]"))
        except (ValueError, AttributeError):
            pass
        return {"error": "HTTP %d%s (no limit headers: wrong/expired token or not a subscription account)"
                % (status, ": " + msg[:120] if msg else "")}
    v = {}
    for k in HEADERS:
        raw = (h(k) or "").strip()
        if not raw:
            return {"error": "incomplete rate-limit headers: %s is missing, cannot tell the usage" % k}
        x = float(raw) if re.fullmatch(r"[0-9]+(\.[0-9]+)?", raw) else float("nan")
        if not math.isfinite(x) or (k.endswith("reset") and x > 253402300799):
            return {"error": "invalid rate-limit header %s (not a number)" % k}
        v[k] = norm(x)
    return {
        "http": status, "status": h("status"), "binding_window": h("representative-claim"),
        "five_hour": {"used": v["5h-utilization"], "reset_epoch": v["5h-reset"], "status": h("5h-status")},
        "seven_day": {"used": v["7d-utilization"], "reset_epoch": v["7d-reset"], "status": h("7d-status"),
                      "surpassed_threshold": h("7d-surpassed-threshold")},
    }


def pct(u):
    return int(u * 100 + 0.5)


def dur(sec):
    if sec <= 0:
        return "now"
    d, h, m = int(sec // 86400), int(sec % 86400 // 3600), int(sec % 3600 // 60)
    return "%d d %d h" % (d, h) if d else "%d h %d min" % (h, m) if h else "%d min" % m


def when(epoch):
    dt = datetime.fromtimestamp(epoch, timezone.utc)
    if ZONE is not None:
        return dt.astimezone(ZONE).strftime("%Y-%m-%d %H:%M") + " " + TZ
    dt = dt.astimezone()  # local zone, shown as UTC offset
    off = int(dt.utcoffset().total_seconds() // 60)
    return dt.strftime("%Y-%m-%d %H:%M") + " UTC%s%02d:%02d" % ("-" if off < 0 else "+", abs(off) // 60, abs(off) % 60)


def exists(path):
    return os.path.lexists(path)


def win_exe(name):
    """A Windows tool by absolute path (never looked up via PATH or the current directory)."""
    p = os.path.join(os.environ.get("SystemRoot") or os.environ.get("windir") or "C:\\Windows", "System32", name)
    return p if os.path.exists(p) else os.path.join("C:\\Windows", "System32", name)


def windows_user_sid():
    """The current user as a SID ("*S-1-..." is accepted by icacls), so names with special characters cannot break it."""
    out = subprocess.run([win_exe("whoami.exe"), "/user", "/fo", "csv", "/nh"], check=True, capture_output=True,
                         text=True).stdout
    m = re.search(r'"(S-1-[0-9]+(?:-[0-9]+)+)"', out)
    if not m:
        raise ValueError("no SID")
    return m.group(1)


def init_tokens_file():
    """--init: create the tokens file from the template with owner-only permissions. Never overwrites or reads an existing file."""
    if exists(TOKENS_FILE):
        print("Tokens file already exists, left untouched: " + TOKENS_FILE)
        return 0
    template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "setup", "claude-limits.tokens.example")
    try:
        with open(template, "rb") as f:
            data = f.read()
    except OSError:
        err("claude-limits: template not found: " + os.path.normpath(template))
        return 1
    d = os.path.dirname(TOKENS_FILE) or "."
    try:
        os.makedirs(d, exist_ok=True)
    except (FileExistsError, NotADirectoryError):
        err("claude-limits: cannot create %s: %s (or one of its parents) exists but is not a directory" % (TOKENS_FILE, d))
        return 1
    except OSError as e:
        err("claude-limits: cannot create the directory %s (%s)" % (d, err_code(e)))
        return 1
    try:
        fd = os.open(TOKENS_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    except FileExistsError:
        print("Tokens file already exists, left untouched: " + TOKENS_FILE)
        return 0
    except OSError as e:
        err("claude-limits: cannot create %s (%s)" % (TOKENS_FILE, err_code(e)))
        return 1
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        if os.name == "nt":
            subprocess.run([win_exe("icacls.exe"), TOKENS_FILE, "/inheritance:r", "/grant:r", "*%s:(R,W)" % windows_user_sid()],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.chmod(TOKENS_FILE, 0o600)
    except Exception as e:
        try:
            os.unlink(TOKENS_FILE)
            removed = True
        except OSError:
            removed = False
        err("claude-limits: could not restrict the permissions of %s (%s); %s" % (
            TOKENS_FILE, err_code(e),
            "the file was removed again, nothing was created" if removed else "delete it manually before putting tokens in it"))
        return 1
    print("Created %s (owner-only permissions)." % TOKENS_FILE)
    print("Next: run `claude setup-token` per account in a separate terminal, put each token in that file as "
          "name=sk-ant-oat01-... (remove the REPLACE_ME example lines), then run this script with --brief.")
    return 0


def main(argv):
    global TZ, ZONE
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="backslashreplace")
        except (AttributeError, ValueError):
            pass
    if "-h" in argv or "--help" in argv:
        print(USAGE)
        return 0
    for a in argv:
        if a.startswith("--") and a not in ("--brief", "--json", "--init"):
            err("claude-limits: unknown argument " + a)
            return 2
    if "--init" in argv:
        return init_tokens_file()
    brief, as_json = "--brief" in argv, "--json" in argv
    wanted = [a for a in argv if not a.startswith("--")]
    TZ, ZONE = resolve_tz()
    from_file, file_bad = file_tokens()
    accounts = wanted or ["current"] + list(from_file)
    results, problem = [], 1 if file_bad else 0
    for account in accounts:
        try:
            cred = credentials(account, from_file)
            if not cred:
                if wanted:
                    problem = 1
                    results.append({"account": account, "ok": False, "error": "no credentials"})
                continue
            if cred.get("placeholder"):
                if wanted:
                    problem = 1
                    results.append({"account": account, "ok": False, "error": "not configured (placeholder token)"})
                else:
                    err('claude-limits: account "%s" skipped: not configured (placeholder token containing %s)'
                        % (account, PLACEHOLDER))
                continue
            if cred.get("error"):
                problem = 1
                results.append({"account": account, "ok": False, "error": cred["error"]})
                continue
            r = probe(cred["token"])
            if r.get("error"):
                problem = 1
                results.append({"account": account, "ok": False, "error": r["error"]})
                continue
            if r["status"] not in ("allowed", "allowed_warning"):
                problem = 1
            results.append(dict({"account": account, "ok": True, "source": cred["source"],
                                 "subscription": cred.get("subscription")}, **r))
        except Exception as e:  # a bad account must never abort the others
            problem = 1
            results.append({"account": account, "ok": False, "error": "unexpected error (%s)" % err_code(e)})
    if not results:
        msg = "no Claude credentials found (%s or tokens in %s)" % (os.path.join(CONFIG_DIR, ".credentials.json"), TOKENS_FILE)
        print(dumps([{"ok": False, "error": msg}]) if as_json else "[FAIL] " + msg)
        return 1
    now = int(time.time())
    if as_json:
        for r in results:
            if r["ok"]:
                for k in ("five_hour", "seven_day"):
                    r[k]["left"] = norm(round(1 - r[k]["used"], 4))
        print(dumps(results))
        return problem
    for r in results:
        if not r["ok"]:
            print("[FAIL] %s: %s" % (r["account"], r["error"]))
            continue
        mark = {"allowed": "[ OK ]", "allowed_warning": "[WARN]"}.get(r["status"], "[FAIL]")
        f, s, st = r["five_hour"], r["seven_day"], r["status"] or "?"
        if brief:
            print("%s %s: 5h %d%% used (reset in %s) | 7d %d%% used (reset in %s) | status %s" % (
                mark, r["account"], pct(f["used"]), dur(f["reset_epoch"] - now),
                pct(s["used"]), dur(s["reset_epoch"] - now), st))
        else:
            sub = ", " + r["subscription"] if r.get("subscription") else ""
            print("%s Account %s (%s%s; status: %s; binding window: %s)" % (
                mark, r["account"], r["source"], sub, st, r.get("binding_window") or "?"))
            for label, w in (("5 hours ", f), ("week    ", s)):
                print("   %s: %3d%% used, %3d%% left, reset %s (in %s)" % (
                    label, pct(w["used"]), 100 - pct(w["used"]), when(w["reset_epoch"]), dur(w["reset_epoch"] - now)))
            if s["status"] == "allowed_warning":
                print("   warning : weekly limit passed its warning threshold (%s)" % (s.get("surpassed_threshold") or "?"))
    return problem


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
