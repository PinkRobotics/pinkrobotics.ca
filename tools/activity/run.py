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
    parser.add_argument('--verdicts')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]

    def build(science: str, era_base: str, verdicts=None) -> int:
        command = [sys.executable, str(root / 'tools/activity/build.py'),
                   '--science', science, '--era-base', era_base,
                   '--roster', args.roster, '--objections', args.objections,
                   '--ship-feed', args.ship_feed, '--out', args.out]
        if verdicts:
            command += ['--verdicts', str(verdicts)]
        return subprocess.run(command, check=False).returncode

    if args.science == 'fixture':
        scratch = Path(os.environ.get('TMPDIR') or root / '.scratch')
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='activity-fixture-', dir=scratch) as temp:
            repo = Path(temp) / 'science'
            base = make_science(repo)
            verdicts = args.verdicts
            # The default store is synthetic: bind its two illustrative identities
            # to this disposable history, whose commit dates follow the build clock.
            if verdicts and Path(verdicts).resolve() == root / 'fixtures/activity/verdicts.tsv':
                raw = Path(verdicts).read_text()
                history = subprocess.check_output(['git', '-C', str(repo), 'rev-list', '--reverse', 'main']).decode().splitlines()
                for number, candidate in enumerate(history[1:3], 1):
                    raw = raw.replace(str(number) * 40, candidate)
                verdicts = Path(temp) / 'verdicts.tsv'
                verdicts.write_text(raw)
            return build(str(repo), base, verdicts)
    if not args.era_base:
        print('REFUSED: ERA_BASE is required with a supplied science repository.', file=sys.stderr)
        return 2
    return build(args.science, args.era_base, args.verdicts)


if __name__ == '__main__':
    sys.exit(main())
