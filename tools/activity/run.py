#!/usr/bin/env python3
"""Run the activity builder with an offline fixture or explicitly supplied real inputs."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from fixture import make_science


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--science', required=True)
    parser.add_argument('--era-base', default='')
    parser.add_argument('--roster', required=True)
    parser.add_argument('--objections', required=True)
    parser.add_argument('--ship-feed', default='none')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]

    def build(science: str, era_base: str) -> int:
        command = [sys.executable, str(root / 'tools/activity/build.py'),
                   '--science', science, '--era-base', era_base,
                   '--roster', args.roster, '--objections', args.objections,
                   '--ship-feed', args.ship_feed, '--out', args.out]
        return subprocess.run(command, check=False).returncode

    if args.science == 'fixture':
        scratch = Path(os.environ.get('TMPDIR') or root / '.scratch')
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='activity-fixture-', dir=scratch) as temp:
            repo = Path(temp) / 'science'
            base = make_science(repo)
            return build(str(repo), base)
    if not args.era_base:
        print('REFUSED: ERA_BASE is required with a supplied science repository.', file=sys.stderr)
        return 2
    return build(args.science, args.era_base)


if __name__ == '__main__':
    sys.exit(main())
