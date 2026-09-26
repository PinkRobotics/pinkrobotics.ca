#!/usr/bin/env python3
"""Faithful port of stamp-version.mjs for machines without node (this box has none).

Same algorithm, same regexes, same output: the version is sha256 over the STRIPPED contents
of every module (sorted by absolute path), truncated to 8 hex chars; every relative .js/.mjs
specifier in the modules and the HTML entry points is stamped `?v=<version>`; version.json is
rewritten. Running either stamper after the other is a no-op — if it is not, one of them has
drifted and THAT is the bug to fix. See stamp-version.mjs for the full rationale.

    python3 scripts/stamp-version.py            # stamp
    python3 scripts/stamp-version.py --check    # fail if the stamp is stale
    python3 scripts/stamp-version.py --strip    # remove the stamps
"""
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SITE = ROOT.parent

check = "--check" in sys.argv
strip = "--strip" in sys.argv

SKIP_DIRS = {"node_modules", "assets"}


def walk(dir_, suffixes):
    out = []
    for p in sorted(dir_.iterdir()):
        if p.name in SKIP_DIRS:
            continue
        if p.is_dir():
            out += walk(p, suffixes)
        elif p.suffix in suffixes:
            out.append(p)
    return out


# JS side: `walkFiles(ROOT).filter((p) => !p.includes('scripts/'))` on the absolute path.
modules = [p for p in walk(ROOT, {".js", ".mjs"}) if "scripts/" not in str(p)]

html_entries = walk(ROOT, {".html"}) + [
    p for p in [SITE / "airships" / "model-lab" / "index.html"] if p.exists()
]

STAMP = re.compile(r"(\.m?js)\?v=[A-Za-z0-9_.-]+(['\"])")
SPEC = re.compile(r"(from\s*|import\s*\(\s*)(['\"])(\.{1,2}/[^'\"?]+\.m?js)(?:\?[^'\"]*)?(['\"])")


def strip_stamp(s):
    return STAMP.sub(r"\1\2", s)


h = hashlib.sha256()
for p in sorted(modules, key=lambda q: str(q)):
    h.update(strip_stamp(p.read_text()).encode())
VERSION = h.hexdigest()[:8]


def stamp_source(src):
    base = strip_stamp(src)
    if strip:
        return base
    return SPEC.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={VERSION}{m.group(4)}", base)


changed, stale = 0, []
for p in modules + html_entries:
    src = p.read_text()
    out = stamp_source(src)
    if out == src:
        continue
    changed += 1
    if check:
        stale.append(str(p.relative_to(SITE)))
    else:
        p.write_text(out)

# Foreign pages that import the tree unversioned are REPORTED, never edited.
foreign = []
FOREIGN = re.compile(r"airship3d/airship3d\.js(?!\?v=)")
for p in walk(SITE, {".html"}):
    if ROOT in p.parents or p in html_entries:
        continue
    if FOREIGN.search(p.read_text()):
        foreign.append(str(p.relative_to(SITE)))
if foreign:
    print(f"stamp: NOTE — unversioned airship3d imports (can be served a stale graph):\n  "
          + "\n  ".join(foreign), file=sys.stderr)

if not check and not strip:
    (ROOT / "version.json").write_text(json.dumps(
        {"version": VERSION, "note": "Pin dynamic imports to this. See scripts/stamp-version.mjs."},
        indent=2) + "\n")

if check:
    if stale:
        print(f"stamp: {len(stale)} file(s) are not stamped at {VERSION}:", file=sys.stderr)
        for f in stale[:12]:
            print(f"  {f}", file=sys.stderr)
        sys.exit(1)
    print(f"stamp: all module URLs carry ?v={VERSION}")
else:
    print(f"stamp: removed version queries from {changed} file(s)" if strip
          else f"stamp: {changed} file(s) stamped at ?v={VERSION}")
