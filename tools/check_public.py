#!/usr/bin/env python3
"""Check tracked working-tree files for public-boundary leaks, without printing values.

No network access. Exit 0: clean; 1: findings; 2: incomplete scan/configuration error.
Private project terms belong in an external UTF-8 file, one literal per line.
This heuristic gate complements history secret scanners and a publication review.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys


PATTERNS = {
    "email": re.compile(r"(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9](?:[A-Z0-9.-]{0,251}[A-Z0-9])?\.[A-Z]{2,63}(?![\w.-])", re.I),
    "private-host": re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:local|internal|lan|corp|home)\b(?!\()", re.I),
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
    "provider-token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{35})\b"),
    "credential-assignment": re.compile(r"\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[=:]\s*[\"']([A-Za-z0-9_+/=.-]{24,})[\"']", re.I),
    "credential-url": re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@", re.I),
    "documented-basic-auth": re.compile(r"\b(?:basic[ -]auth(?:entication)?|auth(?:entication)?[ -]realm)\s*(?:[:=]|is)?\s*`?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", re.I),
}
IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
IPV6 = re.compile(r"(?<![\w:])(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{0,39}(?![\w:])", re.I)
NETWORKS = tuple(ipaddress.ip_network((address, bits)) for address, bits in (
    (0x0A000000, 8), (0xAC100000, 12), (0xC0A80000, 16), (0xA9FE0000, 16),
    (0x64400000, 10), (0xFC00 << 112, 7), (0xFE80 << 112, 10),
))


PATTERNS.update({
    "absolute-local-path": re.compile(
        r"(?<![\w:/])/(?:ro[o]t|t[m]p|var|mnt|srv|etc|opt|usr|run|workspaces|Volumes)/(?:[^\s\"'<>`|;,)]+)", re.I),
    "user-password-pair": re.compile(
        r"\buser(?:name)?[`\"']?\s*(?:[:=]|is)?\s*[`\"']?[\w.@+-]+[`\"']?"
        r"[ \t,;/]+(?:and[ \t]+)?pass(?:word|wd)?[`\"']?\s*(?:[:=]|is)?\s*[`\"']?[^\s`\"',;|]+", re.I),
    "session-agent-id": re.compile(
        r"\b(?:session|agent)[_ -]?(?:id)?[`\"']?\s*[:=]\s*[`\"']?[a-z0-9][a-z0-9_-]{7,}"
        r"|\b(?:session|agent)-[a-f0-9]{8,}(?:-[a-f0-9]+)*\b", re.I),
})
# Include all tilde home references and Windows local drive paths, including JSON escapes.
PATTERNS["home-path"] = re.compile(
    r"(?:/ho[m]e/[^\s/]+|/Us[e]rs/[^\s/]+"
    r"|(?<![\w/])~(?:[a-z_][a-z0-9_.-]*)?/[a-z_.][a-z0-9_.-]*(?:/[a-z0-9_.-]+)*"
    r"|(?<![\w/])[A-Za-z]:[\\/]+Us[e]rs[\\/]+[^\s\\/]+)", re.I | re.ASCII)
PATTERNS["absolute-local-path"] = re.compile(
    r"(?<![\w:/])/(?:ro[o]t|t[m]p|var|mnt|srv|etc|opt|usr|run|workspaces|Volumes)/[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*"
    r"|(?<![^\s\"'`(=])[A-Za-z]:[\\/]+[a-z_][a-z0-9_.-]{2,}(?:[\\/]+[a-z0-9_.-]+)*", re.I | re.ASCII)



def matches(text: str, private_terms=()):
    lower = text.lower()
    hints = {
        "email": ("@",), "private-key": ("private key",),
        "private-host": (".local", ".internal", ".lan", ".corp", ".home"),
        "provider-token": ("ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "akia", "asia", "xox", "sk-", "aiza"),
        "credential-assignment": ("api", "access", "auth", "client", "password"),
        "credential-url": ("://",), "documented-basic-auth": ("auth",),
        "user-password-pair": ("user",), "session-agent-id": ("session", "agent"),
    }
    for rule, pattern in PATTERNS.items():
        if rule in hints and not any(hint in lower for hint in hints[rule]):
            continue
        for match in pattern.finditer(text):
            # Only the interpreter token of a real first-line shebang is syntax.
            # Arguments and identical paths in comments still undergo the scan.
            if (rule == "absolute-local-path" and text.startswith("#!")
                    and match.start() == 2 and match.end() == len(text.splitlines()[0].split()[0])):
                continue
            yield rule, match.start(), match.end()
    for pattern in (IPV4, IPV6):
        for match in pattern.finditer(text):
            try:
                address = ipaddress.ip_address(match.group())
            except ValueError:
                continue
            if any(address.version == net.version and address in net for net in NETWORKS):
                yield "private-address", match.start(), match.end()
    # Family footer destinations are published choices, each bound by policy.
    for span in re.finditer(r'<span\s+class="doms"[^>]*>(.*?)</span>', text, re.S):
        for link in re.finditer(r'href="(https?://[^"]+)"', span[1]):
            if link[1].rstrip("/") == "https://pinkrobotics.ca":
                continue
            yield "family-link", span.start(1) + link.start(1), span.start(1) + link.end(1)
    for term in private_terms:
        for match in re.finditer(re.escape(term), text, re.I):
            yield "private-name", match.start(), match.end()


def safe_path(path: str, private_terms=()):
    spans = []
    for rule, start, end in sorted(matches(path, private_terms), key=lambda x: x[1]):
        if spans and start <= spans[-1][2]:
            previous, first, last = spans[-1]
            spans[-1] = (previous, first, max(last, end))
        else:
            spans.append((rule, start, end))
    for rule, start, end in reversed(spans):
        path = path[:start] + "[" + rule + "]" + path[end:]
    return path


def read_lines(path: Path):
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")]


def representations(data: bytes):
    yield "bytes", data.decode("utf-8", errors="replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        yield "utf16", data.decode("utf-16")
    elif b"\x00" in data:
        for encoding in ("utf-16-le", "utf-16-be"):
            yield encoding, data.decode(encoding, errors="replace")
    if data.startswith(b"%PDF-"):
        result = subprocess.run(["pdftotext", "-", "-"], input=data, capture_output=True)
        if result.returncode:
            raise ValueError("PDF extraction failed")
        yield "pdf-text", result.stdout.decode("utf-8", errors="replace")


RULES = set(PATTERNS) | {"private-address", "private-name", "family-link"}
POLICY = "tools/public-policy.json"


def load_policy(root, name):
    """Exceptions bind one path, rule, representation and exact matched value digest.

    Counts prevent a second occurrence from inheriting an older approval. No literal
    private value belongs here; a digest identifies the reviewed match without copying it.
    """
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("policy must be inside the repository")
    try:
        document = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        if name != POLICY:
            raise ValueError("configured policy missing")
        return [], []
    policy = json.loads(document)
    rows = policy["exceptions"]
    withheld = policy.get("withheld", [])
    if not isinstance(rows, list):
        raise ValueError("exceptions must be a list")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) not in ({"path", "rule", "representation", "match_sha256", "count", "reason"},
                {"path", "rule", "representation", "match_sha256", "count", "reason", "pending", "date"}):
            raise ValueError("invalid exception fields")
        if any(not isinstance(row[k], str) for k in ("path", "rule", "representation", "match_sha256", "reason")):
            raise ValueError("exception text fields must be strings")
        if "pending" in row:
            if row["pending"] is not True or not isinstance(row["date"], str):
                raise ValueError("pending entry requires a date")
            date.fromisoformat(row["date"])
        p = Path(row["path"])
        if not row["path"] or p.is_absolute() or ".." in p.parts or any(c in row["path"] for c in "*?[]"):
            raise ValueError("exception paths must be exact repository-relative paths")
        if row["rule"] not in RULES or row["representation"] not in {
                "bytes", "utf16", "utf-16-le", "utf-16-be", "pdf-text", "path"}:
            raise ValueError("unknown exception rule or representation")
        if not re.fullmatch(r"[0-9a-f]{64}", row["match_sha256"]):
            raise ValueError("invalid exception digest")
        if type(row["count"]) is not int or row["count"] < 1 or not row["reason"].strip():
            raise ValueError("exception needs a positive count and reason")
        key = tuple(row[k] for k in ("path", "rule", "representation", "match_sha256"))
        if key in seen:
            raise ValueError("duplicate exception")
        seen.add(key)
    if not isinstance(withheld, list):
        raise ValueError("withheld must be a list")
    seen = set()
    for row in withheld:
        if (not isinstance(row, dict) or set(row) != {"path", "reason"}
                or not all(isinstance(v, str) and v.strip() for v in row.values())):
            raise ValueError("invalid withheld entry")
        name = row["path"]
        if (Path(name).is_absolute() or ".." in Path(name).parts
                or any(c in name for c in "*?[]\\") or name in seen
                or name.rstrip("/") in ("", ".") or name == POLICY):
            raise ValueError("invalid withheld path")
        seen.add(name)
    return rows, withheld


def is_withheld(name, withheld):
    return any(name == row["path"] or
               (row["path"].endswith("/") and name.startswith(row["path"]))
               for row in withheld)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--private-deny-file", type=Path, default=os.environ.get("PUBLIC_DENY_FILE"))
    parser.add_argument("--policy", default=POLICY)
    parser.add_argument("--include-untracked", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    findings, errors, exceptions, withheld, private_rows_not_evaluated = [], [], [], [], []
    scanned = accepted = 0
    loaded = False
    terms = []
    try:
        root = Path(subprocess.check_output(["git", "-C", str(args.repo), "rev-parse", "--show-toplevel"], stderr=subprocess.DEVNULL).decode().strip()).resolve()
        if args.private_deny_file:
            deny = Path(args.private_deny_file).resolve(strict=True)
            if deny.is_relative_to(root):
                raise ValueError("private deny-list must be outside the repository")
            terms = read_lines(deny)
            if not terms:
                raise ValueError("explicit private deny-list is empty")
            loaded = True
        exceptions, withheld = load_policy(root, args.policy)
        command = ["git", "-C", str(root), "ls-files", "-z", "--cached"]
        if args.include_untracked:
            command += ["--others", "--exclude-standard"]
        paths = sorted(set(subprocess.check_output(command).decode("utf-8", errors="surrogateescape").split("\0")) - {""})
        deleted = set(subprocess.check_output(["git", "-C", str(root), "ls-files", "-z", "--deleted"]).decode("utf-8", errors="surrogateescape").split("\0"))
        raw = []
        def collect(name, representation, text):
            for rule, start, end in matches(text, terms):
                raw.append({"path": name, "line": text.count("\n", 0, start) + 1,
                            "rule": rule, "representation": representation,
                            "match_sha256": hashlib.sha256(text[start:end].encode()).hexdigest()})
            if name != args.policy:
                for row in withheld:
                    pattern = r"(?<![\w.-])" + re.escape(row["path"])
                    if not row["path"].endswith("/"):
                        pattern += r"(?![\w-]|\.[\w-])"
                    for match in re.finditer(pattern, text):
                        raw.append({"path": name, "line": text.count("\n", 0, match.start()) + 1,
                                    "rule": "withheld-reference", "representation": representation,
                                    "match_sha256": hashlib.sha256(match.group().encode()).hexdigest()})
        for name in paths:
            if is_withheld(name, withheld):
                continue
            # Working-tree deletions are the proposed tip, even before staging.
            if name in deleted:
                try:
                    (root / name).lstat()
                except FileNotFoundError:
                    continue
                except OSError:
                    errors.append({"path": safe_path(name, terms), "error": "cannot inspect deleted path"})
                    continue
            display = safe_path(name, terms)
            collect(name, "path", name)
            try:
                path = root / name
                if any(parent.is_symlink() for parent in path.parents if parent != root and root in parent.parents):
                    raise ValueError("symlink ancestor")
                data = os.fsencode(os.readlink(path)) if path.is_symlink() else path.read_bytes()
                for representation, text in representations(data):
                    collect(name, representation, text)
                scanned += 1
            except (OSError, ValueError, UnicodeError):
                errors.append({"path": display, "error": "unreadable file or failed extraction"})
        exempt = set()
        for row in exceptions:
            if row["rule"] == "private-name" and not loaded:
                private_rows_not_evaluated.append({"path": safe_path(row["path"], terms),
                                                   "rule": row["rule"], "count": row["count"]})
                continue
            indices = [i for i, f in enumerate(raw) if all(f[k] == row[k] for k in
                       ("path", "rule", "representation", "match_sha256"))]
            if len(indices) != row["count"]:
                errors.append({"path": safe_path(row["path"], terms),
                               "error": "stale exception: match count differs", "rule": row["rule"]})
            else:
                exempt.update(indices)
        accepted = len(exempt)
        for i, finding in enumerate(raw):
            if i not in exempt:
                findings.append({**finding, "path": safe_path(finding["path"], terms)})
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, UnicodeError):
        errors.append({"error": "cannot enumerate repository or read configuration"})
    result = {"scanned_files": scanned, "private_deny_list": loaded,
              "private_deny_list_status": "loaded" if loaded else ("failed" if args.private_deny_file else "not configured"),
              "accepted_findings": accepted, "exceptions": sum(not r.get("pending") for r in exceptions),
              "private_rows_not_evaluated": private_rows_not_evaluated,
              "pending": [{"path": safe_path(r["path"], terms), "rule": r["rule"],
                           "count": r["count"], "date": r["date"]} for r in exceptions if r.get("pending")],
              "withheld": [{"path": safe_path(r["path"], terms)} for r in withheld],
              "findings": findings, "errors": errors}
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=True))
    else:
        for item in result["private_rows_not_evaluated"]:
            print(f"PRIVATE-ROW {item['path']}: {item['rule']} count={item['count']} not evaluated")
        for item in result["pending"]:
            print(f"PENDING {item['path']}: {item['rule']} count={item['count']} date={item['date']}")
        for item in result["withheld"]:
            print(f"WITHHELD {item['path']}")
        for item in findings:
            print(f"{item['path']}:{item['line']}: {item['rule']} ({item['representation']})")
        for item in errors:
            print(f"{item.get('path', '<configuration>')}: {item['error']}", file=sys.stderr)
        print(f"scanned={scanned} unexplained={len(findings)} accepted={accepted} exceptions={result['exceptions']} pending={len(result['pending'])} withheld={len(withheld)} errors={len(errors)} private-list={result['private_deny_list_status']} private-rows={len(private_rows_not_evaluated)} not evaluated")
    return 2 if errors else (1 if findings else 0)


if __name__ == "__main__":
    raise SystemExit(main())
