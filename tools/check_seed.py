#!/usr/bin/env python3
"""Record the site/ seed as an exact manifest, and hold the tree to it.

--write records every file's path and SHA-256; --check refuses a file added,
removed or changed, naming the path. The manifest proves the committed seed is
the recorded seed. It cannot prove offline that the seed equals what serves;
compare the deployed site with `make livecheck BASE=...` after a deploy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from site_exclusions import EXCLUSIONS, ExclusionError, excluded, seed_exclusions

SCHEMA = "pinkrobotics.site-seed/1"
MANIFEST = "site-seed.json"


class SeedError(ValueError):
    pass


def seed_files(root: Path):
    """Every file under site/, sorted by path, excluding exact server-written paths declared in the canonical exclusions.

    Paths are recorded relative to site/, the form site-exclusions.txt uses. The
    seed holds no symlinks, matching what export and deployment refuse.
    """
    site = root / "site"
    entries = []
    omissions = seed_exclusions(root / EXCLUSIONS)
    for current, dirs, files in os.walk(site, followlinks=False):
        relative_dir = Path(current).relative_to(site)
        kept = []
        for name in dirs:
            if excluded((relative_dir / name).as_posix(), omissions):
                continue
            if (Path(current) / name).is_symlink():
                raise SeedError(f"site contains a symlink: site/{(relative_dir / name).as_posix()}")
            kept.append(name)
        dirs[:] = kept
        for name in files:
            relative = (relative_dir / name).as_posix()
            if excluded(relative, omissions):
                continue
            path = Path(current) / name
            if path.is_symlink():
                raise SeedError(f"site contains a symlink: site/{relative}")
            entries.append((relative, hashlib.sha256(path.read_bytes()).hexdigest()))
    return sorted(entries)


def manifest_document(entries):
    listing = "".join(f"{path}  {digest}\n" for path, digest in entries)
    return {"schema": SCHEMA, "count": len(entries),
            "digest": hashlib.sha256(listing.encode()).hexdigest(),
            "files": [{"path": path, "sha256": digest} for path, digest in entries]}


def load_manifest(root: Path, name: str):
    path = root / name
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise SeedError(f"{name} is unreadable: {error.__class__.__name__}") from None
    if not isinstance(document, dict) or set(document) != {"schema", "count", "digest", "files"}:
        raise SeedError(f"{name} is not a site-seed manifest")
    if document["schema"] != SCHEMA:
        raise SeedError(f"{name} declares a different schema")
    rows = document["files"]
    if not isinstance(rows, list):
        raise SeedError(f"{name} files entries are malformed")
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {"path", "sha256"}
                or not isinstance(row["path"], str) or not row["path"]
                or not isinstance(row["sha256"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])):
            raise SeedError(f"{name} files entries are malformed")
    return document


def check(root: Path, name: str) -> list[str]:
    document = load_manifest(root, name)
    rows = {row["path"]: row["sha256"] for row in document["files"]}
    actual = dict(seed_files(root))
    findings = []
    for path in sorted(set(actual) - set(rows)):
        findings.append(f"site/{path}: file added to the seed, not in {name}")
    for path in sorted(set(rows) - set(actual)):
        findings.append(f"site/{path}: file in {name} is missing from the seed")
    for path in sorted(set(rows) & set(actual)):
        if rows[path] != actual[path]:
            findings.append(f"site/{path}: file changed since {name} recorded it")
    if document["count"] != len(document["files"]):
        findings.append(f"{name}: count does not match its own file list")
    listing = "".join(f"{row['path']}  {row['sha256']}\n" for row in document["files"])
    if [row["path"] for row in document["files"]] != sorted(row["path"] for row in document["files"]):
        findings.append(f"{name}: files are not sorted by path")
    elif hashlib.sha256(listing.encode()).hexdigest() != document["digest"]:
        findings.append(f"{name}: digest does not match its own file list")
    return findings


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--manifest", default=MANIFEST)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = args.repo.resolve()
        if args.write:
            document = manifest_document(seed_files(root))
            (root / args.manifest).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
            print(f"seed: recorded {document['count']} files in {args.manifest}, digest {document['digest'][:12]}…")
            return 0
        findings = check(root, args.manifest)
    except (SeedError, ExclusionError, OSError) as error:
        print(f"SEED REFUSED: {error}", file=sys.stderr)
        return 2
    for finding in findings:
        print(f"SEED DRIFT: {finding}")
    print(f"seed: {len(findings)} drift findings")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
