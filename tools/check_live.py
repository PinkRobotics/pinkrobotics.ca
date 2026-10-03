#!/usr/bin/env python3
"""Compare the deployed site with the recorded seed manifest. Needs a network.

Run after a deploy: `make livecheck BASE=https://pinkrobotics.ca`. This is not part
of `make check`, which stays offline. Every manifest path the deploy filter does
not exclude is fetched with a cache-busting query and compared by SHA-256; an
excluded path is fetched to confirm the deployment leaves it out.

Reported per path: equal; missing; differs; or a difference fully explained by the
content network — `email-rewrite` (the network's e-mail obfuscation and its decoder
script, undone, restore the recorded bytes) or `script-only` (removing injected
scripts restores them). Scripts under `/cdn-cgi/` on the site's own host, scripts
from another host, and the `nel` and `report-to` headers are listed per page:
script sources are printed; header names and counts only, never header values.
A page that still differs is a finding, as are a missing page and an excluded path
that serves. Live pages absent from the manifest cannot be found by this walk;
undeclared new files need the seed gate or a review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
import urllib.request

import export  # one definition of the deploy filter

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "pinkrobotics-livecheck/1"
# direct fetches only: the comparison must not pass through a cache that answers
# with a stored copy despite the cache-busting query
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
# The content network's e-mail obfuscation: a key byte then key-xored characters,
# carried by a span it inserted around a plain address or by an anchor whose
# mailto href it rewrote to its protection endpoint.
ENCODED_SPAN = re.compile(r"<span\b[^>]*?\bdata-cfemail=\"(?P<payload>[0-9a-f]+)\"[^>]*>.*?</span>", re.I | re.S)
PROTECTED_HREF = re.compile(r"(?P<href_start><a\b[^>]*?\bhref=\")/cdn-cgi/l/email-protection#(?P<payload>[0-9a-f]+)\"", re.I)
SCRIPT_TAG = re.compile(r"[ \t]*<script\b[^>]*\bsrc\s*=\s*[\"'](?P<src>[^\"']+)[\"'][^>]*>.*?</script\s*>[ \t]*\n?", re.I | re.S)
PAGE_SUFFIXES = (".html", ".htm")
REPORT_HEADERS = ("nel", "report-to")


class LiveError(ValueError):
    pass


def encode_key(address: str) -> str:
    """The network's encoding of an address, for the fixture that plays it."""
    key = 0x5A
    return f"{key:02x}" + "".join(f"{ord(character) ^ key:02x}" for character in address)


def decode_address(payload: str) -> str:
    data = bytes.fromhex(payload)
    if not data:
        raise LiveError("empty encoded address")
    return "".join(chr(byte ^ data[0]) for byte in data[1:])


def normalize_page(text: str, scripts: list | None, decoded: list | None) -> str:
    """Undo the content network's documented rewrites, counting what was undone.

    The same normalization is applied to the recorded page, so no rewrite can hide
    a difference: whatever the network does to the live page is removed from both
    sides before they are compared. An undecodable payload is left in place, which
    leaves the page red rather than guessing.
    """
    def restore_span(match):
        try:
            address = decode_address(match.group("payload"))
        except (LiveError, ValueError):
            return match.group(0)
        if decoded is not None:
            decoded.append(address)
        return address

    def restore_href(match):
        try:
            address = decode_address(match.group("payload"))
        except (LiveError, ValueError):
            return match.group(0)
        if decoded is not None:
            decoded.append(address)
        return f'{match.group("href_start")}mailto:{address}"'

    def drop_script(match):
        source = match.group("src")
        parts = urlsplit(source)
        same_origin = not parts.netloc or parts.netloc == normalize_page.origin
        if parts.path.startswith("/cdn-cgi/") and same_origin:
            if scripts is not None:
                scripts.append(("cdn-cgi", source))
            return ""
        if parts.scheme in ("http", "https") and parts.netloc and not same_origin:
            if scripts is not None:
                scripts.append(("foreign", source))
            return ""
        return match.group(0)

    text = ENCODED_SPAN.sub(restore_span, text)
    text = PROTECTED_HREF.sub(restore_href, text)
    return SCRIPT_TAG.sub(drop_script, text)


def load_manifest(root: Path, name: str):
    path = root / name
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise LiveError(f"{name} is unreadable: {error.__class__.__name__}") from None
    if not isinstance(document, dict) or document.get("schema") != "pinkrobotics.site-seed/1":
        raise LiveError(f"{name} is not a site-seed manifest")
    return [(row["path"], row["sha256"]) for row in document["files"]]


def fetch(base: str, path: str, nonce: str, timeout: float):
    request = urllib.request.Request(f"{base}/{path}?livecheck={nonce}",
                                     headers={"User-agent": USER_AGENT})
    try:
        with OPENER.open(request, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        status, headers = error.code, error.headers
        error.close()  # an unclosed 404 response leaks until garbage collection
        return status, headers, b""


def header_counts(headers) -> dict:
    found = {}
    for name in REPORT_HEADERS:
        values = headers.get_all(name) if headers else None
        if values:
            found[name] = len(values)
    return found


def classify(path: str, status: int, headers, body: bytes, recorded: str,
             seed_text: str | None, origin: str):
    summary = {"path": path, "status": status, "headers": header_counts(headers),
               "scripts": [], "addresses_decoded": 0}
    if status != 200:
        summary["class"] = "missing" if status == 404 else "error"
        return summary
    summary["class"] = "differs"
    if hashlib.sha256(body).hexdigest() == recorded:
        summary["class"] = "equal"
        return summary
    if seed_text is None:
        return summary
    scripts, decoded = [], []
    normalize_page.origin = origin
    restored = normalize_page(body.decode("utf-8", errors="replace"), scripts, decoded)
    # the same rules on the recorded side, so no rewrite can hide a difference
    if restored == normalize_page(seed_text, None, None):
        summary["class"] = "email-rewrite" if decoded else "script-only"
    summary["scripts"] = scripts
    # one address is typically rewritten twice — the visible text and the href
    summary["addresses_decoded"] = len(set(decoded))
    return summary


def walk(base: str, root: Path, manifest_name: str, filter_name: str, timeout: float):
    origin = urlsplit(base)
    if origin.scheme not in ("http", "https") or not origin.netloc:
        raise LiveError("BASE must be an http(s) address, e.g. https://pinkrobotics.ca")
    entries = load_manifest(root, manifest_name)
    patterns, _, _ = export.read_filter(root / filter_name)
    nonce = f"{int(time.time() * 1000)}-{os.urandom(4).hex()}"
    rows = []
    for path, recorded in entries:
        filtered = export.excluded(path, patterns)
        status, headers, body = fetch(base, path, nonce, timeout)
        seed_text = None
        if not filtered and (root / "site" / path).is_file() and path.lower().endswith(PAGE_SUFFIXES):
            seed_text = (root / "site" / path).read_text(encoding="utf-8", errors="replace")
        if filtered:
            row = {"path": path, "status": status, "class": "excluded" if status == 404 else "served"}
            if status not in (200, 404):
                row["class"] = "error"
        else:
            row = classify(path, status, headers, body, recorded, seed_text, origin.netloc)
        rows.append(row)
        if row["class"] == "served":
            row["note"] = "the deploy filter excludes this path, but the live site serves it"
        if row["class"] == "missing":
            row["note"] = "in the recorded seed, but the live site does not serve it"
    return rows


FINDING_CLASSES = {"differs", "missing", "served", "error"}


def report(rows, as_json: bool):
    counts = {}
    for row in rows:
        counts[row["class"]] = counts.get(row["class"], 0) + 1
    findings = sum(counts.get(name, 0) for name in FINDING_CLASSES)
    if as_json:
        print(json.dumps({"rows": rows, "counts": counts, "findings": findings}, indent=2))
    else:
        for row in rows:
            line = f"{row['class']:>13} {row['path']}"
            if row.get("note"):
                line += f"  — {row['note']}"
            extras = []
            if row.get("addresses_decoded"):
                extras.append(f"{row['addresses_decoded']} addresses decoded")
            for kind, source in row.get("scripts", []):
                extras.append(f"injected {kind} script: {source}")
            for name, count in sorted(row.get("headers", {}).items()):
                extras.append(f"header {name}: {count}")
            if extras:
                line += "\n              " + "\n              ".join(extras)
            print(line)
        print(f"livecheck: {len(rows)} paths,"
              + " ".join(f"{name}={counts[name]}" for name in sorted(counts))
              + f" findings={findings}")
    return 1 if findings else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--manifest", default="site-seed.json")
    parser.add_argument("--filter", default="deploy-filter.txt")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        rows = walk(args.base, args.repo.resolve(), args.manifest, args.filter, args.timeout)
    except (LiveError, OSError, ValueError) as error:
        print(f"LIVECHECK REFUSED: {error}", file=sys.stderr)
        return 2
    except URLError as error:
        print(f"LIVECHECK REFUSED: {error.__class__.__name__}", file=sys.stderr)
        return 2
    return report(rows, args.json)


if __name__ == "__main__":
    raise SystemExit(main())
