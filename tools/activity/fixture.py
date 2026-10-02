"""Build a small, wholly synthetic science history for the offline work-log demo."""

from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess


def make_science(repo: Path) -> str:
    """Create the fixture repository and return its pre-demo era-base commit."""
    repo.mkdir(parents=True, exist_ok=False)
    stamp = datetime.now(timezone.utc).replace(microsecond=0)
    iso = stamp.isoformat()
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1',
               GIT_AUTHOR_NAME='Fixture', GIT_COMMITTER_NAME='Fixture',
               GIT_AUTHOR_EMAIL='fixture', GIT_COMMITTER_EMAIL='fixture',
               GIT_AUTHOR_DATE=iso, GIT_COMMITTER_DATE=iso)

    def git(*args: str, message: str | None = None) -> str:
        result = subprocess.run(['git', '-C', str(repo), *args], input=message,
                                text=True, capture_output=True, check=True, env=env)
        return result.stdout.strip()

    def write(name: str, content: str) -> None:
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')

    def commit(message: str, parent: str | None = None) -> str:
        git('add', '--all')
        tree = git('write-tree')
        args = ['commit-tree', tree]
        if parent:
            args += ['-p', parent]
        sha = git(*args, message=message)
        git('update-ref', 'refs/heads/main', sha)
        return sha

    git('init', '-q', '--initial-branch=main')
    write('Makefile', 'check: example review  ## Fixture checks\n'
          'example:  ## Example calculation\nreview:  ## Example review\n')
    write('GOALS.md', '<!-- goals:v1 -->\n| id | Objective | Weight | Done means |\n'
          '|---|---|---|---|\n| F1 | Explain the fixture | 1 | The sample is labelled. |\n'
          '<!-- /goals:v1 -->\n')
    write('docs/OPEN-QUESTIONS.md', '## 1. Fixture question\n'
          '## 2. Label the sample — FIXED 2026-01-01\n')
    base = commit('Fixture setup')

    write('tests/check_fixture.py', '# Example check; this repository is demonstration data.\n')
    first = commit('Fixture: record a sample calculation\n\n'
                   'This is a synthetic landing.\n\nOrder: fixture-one\n'
                   'Builder: Fixture builder\nIntegrator: Fixture checker\n', base)
    first_tree = git('rev-parse', first + '^{tree}')
    write('research/sample.md', '# Sample calculation\n\nNo physical result is claimed.\n')
    second = commit('Fixture: label the sample clearly\n\n'
                    'The example remains demonstration data.\n\nOrder: fixture-two\n'
                    'Builder: Fixture builder\nIntegrator: Fixture checker\n', first)
    second_tree = git('rev-parse', second + '^{tree}')

    records = []
    for number, previous, candidate, tree, title in (
        (1, base, first, first_tree, 'Fixture: sample calculation'),
        (2, first, second, second_tree, 'Fixture: sample label'),
    ):
        records.append(
            f'## Landing {number} — {title}\n'
            '| field | value |\n|---|---|\n'
            f'| Landed | {stamp:%Y-%m-%d %H:%M:%S} UTC FAST-FORWARD: main `{previous}` → `{candidate}` |\n'
            f'| The object | SIGNED `{candidate}`, tree `{tree}` |\n'
            '| Gate | XO-SIGNED |\n'
            '| Evidence before landing | python3 tests/check_fixture.py rc=0 |\n'
        )
    write('docs/governance/landing-attestations.md', '\n'.join(records))
    commit('Fixture: record the two sample landings', second)
    return base
