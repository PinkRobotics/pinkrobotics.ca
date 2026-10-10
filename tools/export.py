#!/usr/bin/env python3
"""Export the repository's deployable site plus its separately published work log."""

import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

from activity.boundary import Refused, assert_public
from check_public import load_policy, is_withheld, POLICY

ROOT = Path(__file__).resolve().parents[1]


from site_exclusions import EXCLUSIONS, ExclusionError as ExportError, read_filter, matches, excluded


def export_site(destination: Path, root: Path = ROOT, activity_file: Path | None = None) -> int:
    source = (root / 'site').resolve()
    destination = destination.absolute()
    if destination.is_symlink():
        raise ExportError('destination is a symlink')
    resolved = destination.resolve()
    scratch = Path(os.environ.get('TMPDIR') or root / '.scratch').resolve()
    if resolved == root.resolve() or resolved == source or root.resolve().is_relative_to(resolved) or resolved.is_relative_to(source):
        raise ExportError('destination overlaps the repository or site source')
    if resolved == scratch or scratch.is_relative_to(resolved):
        raise ExportError('destination overlaps the scratch root')
    patterns, _, _ = read_filter(root / EXCLUSIONS)
    _, withheld = load_policy(root.resolve(), POLICY)
    if destination.exists() and any(destination.iterdir()) and not resolved.is_relative_to(scratch):
        raise ExportError('nonempty destination outside TMPDIR; choose a new directory')
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.site-export-', dir=destination.parent))
    copied = 0
    try:
        for current, dirs, files in os.walk(source, followlinks=False):
            relative_dir = Path(current).relative_to(source)
            kept = []
            for name in dirs:
                relative = (relative_dir / name).as_posix()
                if excluded(relative, patterns) or is_withheld("site/" + relative, withheld):
                    continue
                if (Path(current) / name).is_symlink():
                    raise ExportError('site contains a symlink')
                (staging / relative).mkdir(parents=True, exist_ok=True)
                kept.append(name)
            dirs[:] = kept
            for name in files:
                relative = (relative_dir / name).as_posix()
                if excluded(relative, patterns) or is_withheld("site/" + relative, withheld):
                    continue
                original = Path(current) / name
                if original.is_symlink():
                    raise ExportError('site contains a symlink')
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, target)
                copied += 1

        activity = activity_file or scratch / 'activity/activity.json'
        if activity.is_file():
            try:
                assert_public(json.loads(activity.read_text(encoding='utf-8')))
            except (OSError, ValueError, Refused) as error:
                rule = error.rule if isinstance(error, Refused) else 'unreadable-json'
                raise ExportError(f'activity data refused by public boundary: {rule}') from None
            target = staging / 'log/data/activity.json'
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(activity, target)
            copied += 1

        # Match the deployment's D755,F644 normalization, including the
        # temporary export root and the generated data copied from a 0600 file.
        for path in staging.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        staging.chmod(0o755)

        if destination.exists():
            if resolved.is_relative_to(scratch):
                shutil.rmtree(destination)
            else:
                destination.rmdir()
        staging.rename(destination)
        return copied
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, type=Path)
    parser.add_argument('--activity', type=Path)
    args = parser.parse_args()
    try:
        count = export_site(args.dest, activity_file=args.activity)
    except (ExportError, OSError) as error:
        print(f'EXPORT REFUSED: {error}')
        return 1
    print(f'export: {count} files -> {args.dest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
