#!/usr/bin/env python3
"""Independently recount published totals; no generator parser is imported."""
import argparse
from collections import Counter
from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import subprocess


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--science', required=True)
    ap.add_argument('--roster', required=True)
    args = ap.parse_args()
    doc = json.loads(Path('site/log/data/activity.json').read_text())
    roster = json.loads(Path(args.roster).read_text())
    git = lambda *cmd: subprocess.check_output(['git', '-C', args.science, *cmd], text=True).strip()
    main_sha, base = doc['science_main'], doc['era_base']
    attest = git('show', main_sha + ':docs/governance/landing-attestations.md')
    make = git('show', main_sha + ':Makefile')
    questions = git('show', main_sha + ':docs/OPEN-QUESTIONS.md')
    headings = [line for line in questions.splitlines() if re.match(r'^## \d+\.', line)]
    fixed = sum(' — FIXED ' in line for line in headings)
    partly = sum(' — BALLAST FIXED ' in line for line in headings)
    prerequisite_line = next(line for line in make.splitlines() if line.startswith('check:'))
    rows = []

    def compare(name, generated, independent):
        rows.append({'metric': name, 'generated': generated, 'independent': independent,
                     'result': 'PASS' if generated == independent else 'FAIL'})

    sb = doc['scoreboard']
    compare('landings', sb['landings']['all'], len(re.findall(r'^## Landing \d+ ', attest, re.M)))
    now = datetime.fromisoformat(doc['generated_at'])
    times = []
    for stamp, zone in re.findall(r'^\| Landed \| (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (PDT|PST|UTC)', attest, re.M):
        times.append(datetime.fromisoformat(stamp + {'PDT': '-07:00', 'PST': '-08:00', 'UTC': '+00:00'}[zone]))
    compare('landings last seven days', sb['landings']['last_7_days'], sum(now - timedelta(days=7) <= t <= now for t in times))
    compare('governed commits', sb['governed_commits'], int(git('rev-list', '--count', base + '..' + main_sha)))
    compare('earlier commits', sb['earlier_commits'], int(git('rev-list', '--count', base)))
    compare('gates', sb['gates'], len(prerequisite_line.split('##')[0].split(':', 1)[1].split()))
    compare('open questions', sb['questions']['open'], len(headings) - fixed - partly)
    compare('fixed questions', sb['questions']['fixed'], fixed)
    compare('partly fixed questions', sb['questions']['partly_fixed'], partly)
    states = Counter(row['status'] for row in roster['lanes'])
    for state, total in sb['lanes'].items():
        compare('lanes ' + state, total, states[state])
    compare('roster tokens', sb['tokens']['roster_total'], sum(row['tokens']['total'] or 0 for row in roster['lanes']))
    compare('unmetered lanes', sb['tokens']['unmetered_lanes'], sum(row['tokens']['total'] is None for row in roster['lanes']))
    evidence = {'generated_at': doc['generated_at'], 'science_main': main_sha, 'era_base': base,
                'question_heading_numbers': [int(re.match(r'^## (\d+)', line)[1]) for line in headings],
                'fixed_heading_numbers': [int(re.match(r'^## (\d+)', line)[1]) for line in headings if ' — FIXED ' in line],
                'partly_fixed_heading_numbers': [int(re.match(r'^## (\d+)', line)[1]) for line in headings if ' — BALLAST FIXED ' in line],
                'gate_names': prerequisite_line.split('##')[0].split(':', 1)[1].split(),
                'comparisons': rows}
    Path('tools/activity/evidence/counts.json').write_text(json.dumps(evidence, indent=2) + '\n')
    for row in rows:
        print(f'{row["result"]} {row["metric"]}: generated={row["generated"]:,}; independent={row["independent"]:,}')
    return 0 if all(row['result'] == 'PASS' for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
