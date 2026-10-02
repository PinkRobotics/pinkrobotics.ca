#!/usr/bin/env python3
"""Generate a public work log from a pinned science main and private accounting inputs."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

if __package__:
    from .boundary import COMMIT, Refused, assert_public, validate
else:
    from boundary import COMMIT, Refused, assert_public, validate

PROVIDERS = dict(claude='Claude', codex='Codex', glm='GLM', grok='Grok', muse='Muse', local='local')
STATUSES = ('running', 'handed-up', 'staged', 'landed', 'abandoned')
SHA_RE = r'[0-9a-f]{40}'
DEFAULT_FEED = 'https://pinkai.ca/bridge/work-targets.json'
# The edge refuses the library's default agent string; say who is asking.
USER_AGENT = 'pinkrobotics-activity/1 (+https://pinkrobotics.ca/log/)'
ORDER_ID = re.compile(r'ord-[a-z0-9-]+')
DEFINITION = "gross tokens: input + output + cache read + cache write, read from each harness's own records"
DIFFERENCE = ("The two sources count different things. The roster counts the lanes of the current push, from its first "
              "lane's start, each from its own records. The tracker on pinkai.ca covers the project's whole history (lifetime) "
              "or its recent window; it attributes tokens by working directory and leaves out what it cannot place, so "
              "its figures are lower bounds. The observation times can differ.")
COST_BASIS = 'Cost is tokens and wall-clock time, never dollars: the work runs on flat-rate subscriptions.'


class InputError(ValueError):
    pass


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise InputError('science git read failed')
    return result.stdout.decode('utf-8', errors='strict')


def read_blob(repo, main, name, optional=False):
    names = git(repo, 'ls-tree', '--name-only', main, '--', name).splitlines()
    if not names and optional:
        return None
    return git(repo, 'show', main + ':' + name)


def moment(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise InputError('timestamp has no zone')
    return parsed


def table_rows(text):
    rows = []
    for line in text.splitlines():
        if line.startswith('|'):
            cells = [v.strip() for v in line.strip().strip('|').split('|')]
            if all(re.fullmatch(r':?-+:?', v) for v in cells):
                continue
            rows.append(cells)
    return rows


def landings_from(text, repo, main, governed):
    result = []
    pieces = re.split(r'^## Landing (\d+) [—–-] (.+)$', text, flags=re.M)
    for i in range(1, len(pieces), 3):
        number, title, section = pieces[i:i + 3]
        rows = {cells[0]: cells[1] for cells in table_rows(section) if len(cells) == 2}
        landed = rows['Landed']
        stamp = re.search(r'\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}) (PDT|PST|UTC)\b', landed)
        if not stamp:
            raise InputError('attestation timestamp not understood')
        offset = {'PDT': '-07:00', 'PST': '-08:00', 'UTC': '+00:00'}[stamp[3]]
        identities = re.search(r'main\s+`?(' + SHA_RE + r')`?\s*(?:→|->)\s*`?(' + SHA_RE + r')', landed)
        tree = re.search(r'\btree\s+`?(' + SHA_RE + r')', rows['The object'])
        verdict = re.search(r'\b(XO-SIGNED|PASS|FAIL|HOLD|NO-VERDICT)\b', rows['Gate'])
        rc = re.search(r'\brc=(-?\d+)\b', rows['Evidence before landing'])
        if not all((identities, tree, verdict, rc)):
            raise InputError('attestation required fields missing')
        base, candidate = identities.groups()
        # Only whole repository-relative filename tokens; never salvage a suffix of a local path.
        filenames = []
        for token in rows['Evidence before landing'].replace('`', ' ').split():
            if re.fullmatch(r'(?:[\w.-]+/)*[\w.-]+\.(?:py|mjs|js|sh)', token) and 'test' in token.lower():
                filenames.append(token)
        carried = [sha for sha in git(repo, 'rev-list', candidate, '^' + base).splitlines() if sha in governed]
        if candidate not in set(git(repo, 'rev-list', main).splitlines()):
            raise InputError('attestation candidate is not on main')
        if git(repo, 'rev-parse', candidate + '^{tree}').strip() != tree[1]:
            raise InputError('attestation tree mismatch')
        result.append({'number': int(number), 'title': title, 'landed_at': f'{stamp[1]}T{stamp[2]}{offset}',
                       'base': base, 'candidate': candidate, 'tree': tree[1],
                       'fast_forward': bool(re.search(r'\bFAST-FORWARD\b', landed, re.I)),
                       'verdict': verdict[1], 'evidence': {'result': 'rc=' + rc[1], 'test_files': filenames},
                       'commits': carried, 'withheld_commits': 0})
    return sorted(result, key=lambda row: (moment(row['landed_at']), row['number']), reverse=True)


def commit_from(repo, sha, landing):
    stamp, message = git(repo, 'show', '-s', '--format=%cI%x00%B', sha).split('\x00', 1)
    lines = message.strip().splitlines()
    subject = lines[0]
    # Governance tools append separate trailer paragraphs. All footer metadata is removed;
    # only the explicitly public three trailers are projected.
    start = next((i for i in range(1, len(lines)) if re.match(r'^(?:Order|Builder|Integrator|Helm-[\w-]+|Co-Authored-By):', lines[i], re.I)), len(lines))
    trailers = {}
    for line in lines[start:]:
        match = re.match(r'^(Order|Builder|Integrator):\s*(.*)$', line, re.I)
        if match:
            trailers[match[1].lower()] = match[2]
    files, insertions, deletions, binary = [], 0, 0, 0
    # --no-renames keeps NUL-delimited numstat unambiguous even for strange filenames.
    stats = git(repo, 'show', '--format=', '--numstat', '-z', '--no-renames', '--first-parent', sha)
    for row in stats.split('\x00'):
        if not row:
            continue
        added, removed, name = row.split('\t', 2)
        files.append(name)
        if added == '-' or removed == '-':
            binary += 1
        else:
            insertions += int(added)
            deletions += int(removed)
    return {'sha': sha, 'short_sha': sha[:12], 'committed_at': stamp.strip(), 'subject': subject,
            'body': '\n'.join(lines[1:start]).strip(),
            **{key: trailers.get(key) for key in ('order', 'builder', 'integrator')},
            'files_changed': len(files), 'files': files, 'insertions': insertions,
            'deletions': deletions, 'binary_files': binary,
            'areas': sorted({name.split('/')[0] if '/' in name else '(root)' for name in files}),
            'landing': landing}


def gates_from(text):
    logical = re.sub(r'\\\n\s*', ' ', text)
    check = re.search(r'^check:\s*([^#\n]+)', logical, re.M)
    if not check:
        raise InputError('check inventory missing')
    descriptions = dict(re.findall(r'^([\w-]+):[^\n]*?##\s*(.+)$', logical, re.M))
    return [{'name': name, 'description': descriptions.get(name, 'No description recorded.')}
            for name in check[1].split()]


def questions_from(text):
    rows = []
    for number, heading in re.findall(r'^## (\d+)\. (.+)$', text, re.M):
        suffix = re.search(r'\s+[—–-]\s+((?:BALLAST|PARTLY) )?FIXED (\d{4}-\d{2}-\d{2})$', heading)
        rows.append({'number': int(number), 'title': heading[:suffix.start()] if suffix else heading,
                     'state': ('partly fixed' if suffix[1] else 'fixed') if suffix else 'open',
                     'fixed_date': suffix[2] if suffix else None})
    return sorted(rows, key=lambda row: ({'open': 0, 'partly fixed': 1, 'fixed': 2}[row['state']], row['number']))


def goals_from(text):
    match = re.search(r'<!-- goals:v1\b.*?-->(.*?)<!-- /goals:v1 -->', text, re.S)
    if not match:
        raise InputError('goals table missing')
    return [{'id': row[0], 'objective': row[1], 'weight': int(row[2]), 'done_means': row[3]}
            for row in table_rows(match[1])[1:]]


def lanes_from(roster, now):
    if roster['schema'] != 'pinkrobotics.lanes/1':
        raise InputError('roster schema unsupported')
    rows = []
    for row in roster['lanes']:
        if row['status'] not in STATUSES or row['builder']['harness'] not in PROVIDERS:
            raise InputError('roster status or provider unsupported')
        start, end = row.get('started_at'), row.get('ended_at')
        wall, wall_state = None, 'unknown'
        if start and end:
            wall, wall_state = int((moment(end) - moment(start)).total_seconds()), 'ended'
        elif start and row['status'] == 'running':
            wall, wall_state = int((now - moment(start)).total_seconds()), 'elapsed at generation'
        total = row.get('tokens', {}).get('total')
        rows.append({**{key: row[key] for key in ('lane', 'order', 'title', 'kind', 'status')},
                     'builder': {'provider': PROVIDERS[row['builder']['harness']],
                                 'model': row['builder'].get('model'), 'effort': row['builder'].get('effort')},
                     'started_at': start, 'ended_at': end, 'landed_sha': row.get('landed_sha'),
                     'tokens': {'total': total}, 'cost': {'tokens': total, 'wall_seconds': wall, 'wall_state': wall_state}})
    return rows


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def ship_from(source):
    empty = {'state': 'disabled' if source == 'none' else 'unavailable',
             'reason': 'Feed disabled for this build.' if source == 'none' else 'The pinkai.ca tracker was unavailable when this snapshot was generated.',
             'tokens': {key: {'value': None, 'observed_at': None} for key in ('lifetime', 'recent', 'current')},
             'loc': {'value': None, 'observed_at': None}}
    if source == 'none':
        return empty
    try:
        if source.startswith(('https://', 'http://')):
            # One bounded GET, no redirect traversal, no retry, no raw URL in public diagnostics.
            request = urllib.request.Request(source, headers={'User-Agent': USER_AGENT})
            with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise InputError('feed too large')
            data = json.loads(raw)
        else:
            data = json.loads(Path(source).read_text())
    except urllib.error.HTTPError as exc:
        empty['reason'] = f'The pinkai.ca tracker refused the request (status {exc.code}).'
        return empty
    except (OSError, ValueError, urllib.error.URLError):
        return empty
    try:
        project = data['projects']['pink-robotics']
        tokens = {key: {field: project['tokens'][key][field] for field in ('value', 'observed_at')}
                  for key in ('lifetime', 'recent', 'current')}
        loc = project['loc']
        points = loc.get('series', loc.get('points', [])) if isinstance(loc, dict) else loc
        last = points[-1] if points else None
        point = {'value': None, 'observed_at': None}
        if isinstance(last, dict):
            point = {field: last[field] for field in ('value', 'observed_at')}
        elif last is not None:
            # The feed's own shape: [seconds since the epoch, {kind of file: tracked text lines}].
            when, counts = last
            total = sum(counts.values()) if isinstance(counts, dict) else counts
            if isinstance(total, bool) or not isinstance(total, int) or isinstance(when, bool):
                raise TypeError('line count')
            point = {'value': total,
                     'observed_at': datetime.fromtimestamp(when, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
        return {'state': 'available', 'reason': None, 'tokens': tokens, 'loc': point}
    except (KeyError, TypeError, IndexError, ValueError, OverflowError, OSError):
        empty['reason'] = 'The pinkai.ca tracker answered in a shape this page does not read; no figure was copied.'
        return empty


def public_title(title, candidate, subjects):
    """A landing recorded under an internal order identifier is shown under the subject of the commit it landed."""
    if ORDER_ID.fullmatch(title.strip()):
        return subjects.get(candidate, 'Title withheld by the boundary check')
    return title


def build(science, era_base, roster_file, objections_file, ship_feed=DEFAULT_FEED, now=None):
    now = now or datetime.now(timezone.utc)
    main = git(science, 'rev-parse', 'refs/heads/main^{commit}').strip()
    if not re.fullmatch(SHA_RE, era_base):
        raise InputError('era base must be a full git identity')
    if git(science, 'merge-base', main, era_base).strip() != era_base:
        raise InputError('era base is not an ancestor of main')
    shas = git(science, 'rev-list', '--date-order', main, '^' + era_base).splitlines()
    landings = landings_from(read_blob(science, main, 'docs/governance/landing-attestations.md'), science, main, set(shas))
    carried = {sha: row['number'] for row in landings for sha in row['commits']}
    commits, withheld = [], set()
    for i, sha in enumerate(shas):
        commit = commit_from(science, sha, carried.get(sha))
        try:
            validate(commit, COMMIT, f'$.commits[{i}]')
        except Refused as exc:
            print(f'OMITTED commit: {exc}', file=sys.stderr)
            withheld.add(sha)
        else:
            commits.append(commit)
    subjects = {commit['sha']: commit['subject'] for commit in commits}
    for row in landings:
        row['withheld_commits'] = sum(sha in withheld for sha in row['commits'])
        row['title'] = public_title(row['title'], row['candidate'], subjects)
    gates = gates_from(read_blob(science, main, 'Makefile'))
    questions = questions_from(read_blob(science, main, 'docs/OPEN-QUESTIONS.md'))
    goals = goals_from(read_blob(science, main, 'GOALS.md'))
    validation = read_blob(science, main, 'research/validation/report.json', optional=True)
    checks = {'state': 'pending', 'message': 'Labelled checks: lands with the next batch.', 'items': []}
    if validation is not None:
        report = json.loads(validation)
        checks = {'state': 'available', 'message': 'Verdicts recorded by the labelled checks.',
                  'items': [{'name': row.get('title') or row.get('name') or row['id'],
                             'class': row['class'], 'verdict': row['verdict']} for row in report['checks']]}
    roster = json.loads(Path(roster_file).read_text())
    lanes = lanes_from(roster, now)
    objection_doc = json.loads(Path(objections_file).read_text())
    if objection_doc['schema'] != 'pinkrobotics.objections/1':
        raise InputError('objections schema unsupported')
    objections = [{key: row.get(key) for key in ('id', 'raised_at', 'by', 'about_sha', 'objection', 'disposition', 'resolved_sha', 'status')}
                  for row in objection_doc['objections']]
    ship = ship_from(str(ship_feed))
    roster_total = sum(row['tokens']['total'] or 0 for row in lanes)
    unmetered = sum(row['tokens']['total'] is None for row in lanes)
    providers = []
    for provider in sorted({row['builder']['provider'] for row in lanes}):
        members = [row for row in lanes if row['builder']['provider'] == provider]
        providers.append({'provider': provider, 'tokens': sum(row['cost']['tokens'] or 0 for row in members),
                          'unmetered_lanes': sum(row['cost']['tokens'] is None for row in members),
                          'wall_seconds': sum(row['cost']['wall_seconds'] or 0 for row in members),
                          'unknown_wall_lanes': sum(row['cost']['wall_seconds'] is None for row in members)})
    states = Counter(row['status'] for row in lanes)
    qstates = Counter(row['state'] for row in questions)
    sources = [{'section': section, 'source': source, 'state': 'available', 'observed_at': None}
               for section, source in (('commits', 'science main git history'),
                 ('landings', 'docs/governance/landing-attestations.md'), ('gates', 'Makefile: check prerequisites'),
                 ('questions', 'docs/OPEN-QUESTIONS.md'), ('goals', 'GOALS.md: goals:v1 table'))]
    sources += [{'section': 'lanes', 'source': 'project lane roster, public projection', 'state': 'available',
                 'observed_at': roster.get('metered_at', roster.get('written_at'))},
                {'section': 'objections', 'source': 'project review objections', 'state': 'available', 'observed_at': None},
                {'section': 'checks', 'source': 'research/validation/report.json', 'state': checks['state'], 'observed_at': None},
                {'section': 'ship', 'source': DEFAULT_FEED + ': projects.pink-robotics' if str(ship_feed) == DEFAULT_FEED else 'ship feed override; location withheld', 'state': ship['state'], 'observed_at': ship['tokens']['lifetime']['observed_at']}]
    doc = {'schema': 'pinkrobotics.activity/1', 'generated_at': now.isoformat(timespec='seconds'),
           'science_main': main, 'era_base': era_base, 'sources': sources,
           'scoreboard': {'landings': {'all': len(landings), 'last_7_days': sum(now - timedelta(days=7) <= moment(row['landed_at']) <= now for row in landings)},
                         'governed_commits': len(shas), 'earlier_commits': int(git(science, 'rev-list', '--count', era_base)),
                         'gates': len(gates), 'questions': {'open': qstates['open'], 'fixed': qstates['fixed'], 'partly_fixed': qstates['partly fixed']},
                         'lanes': {key: states[key] for key in STATUSES},
                         'tokens': {'roster_total': roster_total, 'unmetered_lanes': unmetered, 'ship': ship}},
           'landings': landings, 'commits': commits, 'withheld_commits': len(withheld),
           'withheld_notice': f'{len(withheld)} commit' + ('' if len(withheld) == 1 else 's') + ' withheld by the boundary check',
           'gates': gates, 'questions': questions, 'goals': goals, 'checks': checks, 'lanes': lanes,
           'objections': objections, 'tokens': {'definition': DEFINITION, 'cost_basis': COST_BASIS,
               'roster_total': roster_total, 'unmetered_lanes': unmetered, 'ship': ship, 'difference': DIFFERENCE, 'by_provider': providers}}
    assert_public(doc)
    return doc


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    for key in ('science', 'era-base', 'roster', 'objections', 'out'):
        ap.add_argument('--' + key, required=True)
    ap.add_argument('--ship-feed', default=DEFAULT_FEED)
    args = ap.parse_args()
    try:
        doc = build(args.science, args.era_base, args.roster, args.objections, args.ship_feed)
        # Boundary runs before creating the output directory or temporary file.
        encoded = json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        scratch = None
        try:
            with tempfile.NamedTemporaryFile('w', dir=out, prefix='.activity-', delete=False, encoding='utf-8') as stream:
                scratch = Path(stream.name)
                stream.write(encoded)
            os.replace(scratch, out / 'activity.json')
        finally:
            if scratch is not None:
                scratch.unlink(missing_ok=True)
    except Refused as exc:
        print(f'REFUSED {exc}', file=sys.stderr)
        return 1
    except (InputError, OSError, ValueError, KeyError, TypeError, IndexError):
        print('REFUSED $: invalid-or-unreadable-input (no output written)', file=sys.stderr)
        return 1
    print(f'activity: {len(doc["landings"])} landings; {len(doc["commits"])} public commits; {doc["withheld_commits"]} withheld; ship {doc["tokens"]["ship"]["state"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
