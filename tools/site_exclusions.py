"""Canonical site exclusions for export, live comparison and the recorded seed."""
from pathlib import Path
import re

EXCLUSIONS = "site-exclusions.txt"


class ExclusionError(ValueError):
    pass


def read_filter(path: Path) -> tuple[list[str], set[str], set[str]]:
    patterns, server_side, not_deployed = [], set(), set()
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line.startswith('# server-side: '):
            server_side.add(line.removeprefix('# server-side: '))
        elif line.startswith('# not-deployed: '):
            not_deployed.add(line.removeprefix('# not-deployed: '))
        elif line and not line.startswith('#'):
            if line.startswith('/') or '..' in Path(line).parts or '\\' in line:
                raise ExclusionError('filter contains an unsafe path')
            patterns.append(line)
    if not patterns or not server_side <= set(patterns) or not not_deployed <= set(patterns):
        raise ExclusionError('filter is empty or a marker has no rule')
    return patterns, server_side, not_deployed


def matches(relative: str, pattern: str) -> bool:
    if pattern.endswith('/'):
        return relative == pattern[:-1] or relative.startswith(pattern)
    expression = '^' + re.escape(pattern).replace(r'\*', '[^/]*') + '$'
    return re.fullmatch(expression, relative) is not None


def excluded(relative: str, patterns: list[str]) -> bool:
    return any(matches(relative, pattern) for pattern in patterns)


def seed_exclusions(path: Path) -> list[str]:
    _, server_side, _ = read_filter(path)
    omissions = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("# seed-exclude: "):
            value = line.removeprefix("# seed-exclude: ")
            if (not value or value.startswith("/") or ".." in Path(value).parts
                    or "\\" in value or "*" in value
                    or not any(matches(value.rstrip("/"), server) for server in server_side)):
                raise ExclusionError("seed omission must name a safe server-side path")
            omissions.append(value)
    return omissions
