#!/usr/bin/env python3
"""claude-limits (Python port): usage of the Claude subscription limits (5-hour and weekly window) and reset times.

Same flags, output and exit codes as claude-limits.mjs. Standard library only, Python 3.9+, Windows/Linux/macOS.

  claude_limits.py [name ...] [--brief] [--json]
  claude_limits.py --init   create the tokens file from the template (owner-only permissions), never overwrites; no network

Tokens file: ~/.claude/claude-limits.tokens or CLAUDE_LIMITS_TOKENS_FILE (name=token per line, '#' comments).
Environment: CLAUDE_PROBE_MODEL (default claude-haiku-5-5), CLAUDE_LIMITS_TZ (default $TZ or Europe/Warsaw),
CLAUDE_LIMITS_TOKENS_FILE.
Exit code: 0 = every account answered and is allowed, 1 = token/network error or a limit reached, 2 = bad argument.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

MODEL = os.environ.get("CLAUDE_PROBE_MODEL") or "claude-haiku-5-5"
TZ = os.environ.get("CLAUDE_LIMITS_TZ") or os.environ.get("TZ") or "Europe/Warsaw"
HOME = os.path.expanduser("~")
TOKENS_FILE = os.environ.get("CLAUDE_LIMITS_TOKENS_FILE") or os.path.join(HOME, ".claude", "claude-limits.tokens")


def err(msg):
    print(msg, file=sys.stderr)


def read_file(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return f.read()
    except OSError:
        return ""


def file_tokens():
    """Accounts from the tokens file: dict name -> token (insertion ordered)."""
    result, n = {}, 0
    for line in read_file(TOKENS_FILE).splitlines():
        line = re.sub(r"^export\s+", "", line.strip())
        if not line or line.startswith("#"):
            continue
        n += 1
        i = line.find("=")
        name = line[:i].strip() if i > 0 else "account-%d" % n
        token = (line[i + 1:] if i > 0 else line).strip()
        m = re.match(r"^([\"'])(.*)\1$", token)
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
    return result


def credentials(account, from_file):
    """Returns a dict with token / error, or None when the account has no credentials at all."""
    if account != "current":
        token = from_file.get(account)
        return {"token": token, "source": os.path.basename(TOKENS_FILE)} if token else None
    source = os.path.join(HOME, ".claude", ".credentials.json")
    raw = read_file(source).strip()
    if not raw:
        return None
    try:
        j = json.loads(raw)
        oauth = j.get("claudeAiOauth", j)
        if not oauth.get("accessToken"):
            return {"error": "no accessToken in %s" % source, "source": source}
        exp = oauth.get("expiresAt")
        return {"token": oauth["accessToken"], "source": source, "expiresAt": exp,
                "expired": bool(exp and exp < time.time() * 1000), "subscription": oauth.get("subscriptionType")}
    except (ValueError, AttributeError):
        return {"error": "%s is not valid JSON" % source, "source": source}


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
        status, headers, payload = e.code, e.headers, e.read()
    except (urllib.error.URLError, OSError) as e:
        return {"error": "no connection to api.anthropic.com (%s)" % getattr(e, "reason", e)}

    def h(k):
        return headers.get("anthropic-ratelimit-unified-" + k)

    if not h("status") and not h("5h-utilization"):
        msg = ""
        try:
            msg = json.loads(payload).get("error", {}).get("message", "")
        except (ValueError, AttributeError):
            pass
        return {"error": "HTTP %d%s (no limit headers: wrong/expired token or not a subscription account)"
                % (status, ": " + msg[:120] if msg else "")}
    now = int(time.time())

    def num(k, d):
        v = h(k)
        return d if v is None else float(v)

    return {
        "http": status, "status": h("status"), "binding_window": h("representative-claim"),
        "five_hour": {"used": num("5h-utilization", 0), "reset_epoch": int(num("5h-reset", now)), "status": h("5h-status")},
        "seven_day": {"used": num("7d-utilization", 0), "reset_epoch": int(num("7d-reset", now)), "status": h("7d-status"),
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
    try:
        from zoneinfo import ZoneInfo
        dt = dt.astimezone(ZoneInfo(TZ))
    except Exception:  # no tzdata (common on Windows) or unknown zone: fall back to the local zone
        dt = dt.astimezone()
    return dt.strftime("%Y-%m-%d %H:%M") + " " + TZ


def init_tokens_file():
    """--init: create the tokens file from the template with owner-only permissions. Never overwrites or reads an existing file."""
    template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "setup", "claude-limits.tokens.example")
    try:
        with open(template, "rb") as f:
            data = f.read()
    except OSError:
        err("claude-limits: template not found: " + os.path.normpath(template))
        return 1
    try:
        os.makedirs(os.path.dirname(TOKENS_FILE) or ".", exist_ok=True)
        fd = os.open(TOKENS_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    except FileExistsError:
        print("Tokens file already exists, left untouched: " + TOKENS_FILE)
        return 0
    except OSError as e:
        err("claude-limits: cannot create %s (%s)" % (TOKENS_FILE, e.strerror or e))
        return 1
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    try:
        if os.name == "nt":
            user = os.environ.get("USERNAME") or os.getlogin()
            subprocess.run(["icacls", TOKENS_FILE, "/inheritance:r", "/grant:r", user + ":(R,W)"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.chmod(TOKENS_FILE, 0o600)
    except (OSError, subprocess.SubprocessError) as e:
        err("claude-limits: created %s but could not restrict its permissions (%s); restrict it to your user manually" % (TOKENS_FILE, e))
        return 1
    print("Created %s (owner-only permissions)." % TOKENS_FILE)
    print("Next: run `claude setup-token` per account in a separate terminal, put each token in that file as "
          "name=sk-ant-oat01-... (remove the REPLACE_ME example lines), then run this script with --brief.")
    return 0


def main(argv):
    if "-h" in argv or "--help" in argv:
        print(__doc__.strip())
        return 0
    for a in argv:
        if a.startswith("--") and a not in ("--brief", "--json", "--init"):
            err("claude-limits: unknown argument " + a)
            return 2
    if "--init" in argv:
        return init_tokens_file()
    brief, as_json = "--brief" in argv, "--json" in argv
    wanted = [a for a in argv if not a.startswith("--")]
    from_file = file_tokens()
    accounts = wanted or ["current"] + list(from_file)
    results, problem = [], 0
    for account in accounts:
        cred = credentials(account, from_file)
        if not cred:
            if wanted:
                problem = 1
                results.append({"account": account, "ok": False, "error": "no credentials"})
            continue
        if cred.get("error"):
            problem = 1
            results.append({"account": account, "ok": False, "error": cred["error"]})
            continue
        r = probe(cred["token"])
        if r.get("error"):
            problem = 1
            extra = ""
            if cred.get("expired"):
                exp = datetime.fromtimestamp(cred["expiresAt"] / 1000, timezone.utc).isoformat()
                extra = "; the access token in %s expired %s" % (cred["source"], exp)
            results.append({"account": account, "ok": False, "error": r["error"] + extra})
            continue
        if r["status"] not in ("allowed", "allowed_warning"):
            problem = 1
        results.append(dict({"account": account, "ok": True, "source": cred["source"],
                             "subscription": cred.get("subscription")}, **r))
    if not results:
        msg = "no Claude credentials found (~/.claude/.credentials.json or tokens in %s)" % TOKENS_FILE
        print(json.dumps([{"ok": False, "error": msg}], indent=2) if as_json else "[FAIL] " + msg)
        return 1
    now = int(time.time())
    if as_json:
        for r in results:
            if r["ok"]:
                for k in ("five_hour", "seven_day"):
                    r[k]["left"] = round(1 - r[k]["used"], 4)
        print(json.dumps(results, indent=2))
        return problem
    for r in results:
        if not r["ok"]:
            print("[FAIL] %s: %s" % (r["account"], r["error"]))
            continue
        mark = {"allowed": "[ OK ]", "allowed_warning": "[WARN]"}.get(r["status"], "[FAIL]")
        f, s = r["five_hour"], r["seven_day"]
        if brief:
            print("%s %s: 5h %d%% used (reset in %s) | 7d %d%% used (reset in %s) | status %s" % (
                mark, r["account"], pct(f["used"]), dur(f["reset_epoch"] - now),
                pct(s["used"]), dur(s["reset_epoch"] - now), r["status"]))
        else:
            sub = ", " + r["subscription"] if r.get("subscription") else ""
            print("%s Account %s (%s%s; status: %s; binding window: %s)" % (
                mark, r["account"], r["source"], sub, r["status"], r.get("binding_window") or "?"))
            for label, w in (("5 hours ", f), ("week    ", s)):
                print("   %s: %3d%% used, %3d%% left, reset %s (in %s)" % (
                    label, pct(w["used"]), 100 - pct(w["used"]), when(w["reset_epoch"]), dur(w["reset_epoch"] - now)))
            if s["status"] == "allowed_warning":
                print("   warning : weekly limit passed its warning threshold (%s)" % (s.get("surpassed_threshold") or "?"))
    return problem


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
