#!/usr/bin/env python3
"""Closed public schema and recursive secret boundary. Diagnostics never quote values."""
import argparse
from collections import Counter
import ipaddress
import json
import math
import re
import sys
from urllib.parse import unquote


class Refused(ValueError):
    def __init__(self, path, rule):
        self.path, self.rule = path, rule
        super().__init__(f'{path}: {rule}')


STAMP = 'timestamp'
# A verdict record may end with signer labels. The work log names the reviewer's role, model and effort,
# never its seat; one value is at most 100 characters from this set.
SIGNER_VALUE = r'[A-Za-z0-9_.:@+\[\]-]{1,100}'
SIGNER = rf'model not recorded|checked by {SIGNER_VALUE} · {SIGNER_VALUE} @ {SIGNER_VALUE}'
SHA = 'sha'
POINT = {'value': 'number?', 'observed_at': 'timestamp?'}
SHIP = {'state': 'text', 'reason': 'text?', 'tokens': {
    'lifetime': POINT, 'recent': POINT, 'current': POINT}, 'loc': POINT}
COST = {'tokens': 'integer?', 'wall_seconds': 'integer?', 'wall_state': 'text'}
CHECKER = {'state': ('signed', 'review pass', 'revoked', 'review did not run',
                     'signature not recorded', 'not in the store', 'store not provided'),
           'verdict': (None, 'XO-SIGNED', 'PASS', 'FAIL', 'LaneDidNotRun'),
           'recorded_at': 'timestamp?', 'model': 'signer',
           'signature_sha256': 'digest?'}
COMMIT = {'sha': SHA, 'short_sha': 'short_sha', 'committed_at': STAMP,
          'subject': 'text', 'body': 'text', 'order': 'text?', 'builder': 'text?',
          'integrator': 'text?', 'files_changed': 'integer', 'files': ['text'],
          'insertions': 'integer', 'deletions': 'integer', 'binary_files': 'integer',
          'areas': ['text'], 'landing': 'integer?'}
LANE = {'lane': 'text', 'order': 'text', 'title': 'text', 'kind': 'text',
        'builder': {'provider': 'text', 'model': 'text?', 'effort': 'text?'},
        'started_at': 'timestamp?', 'ended_at': 'timestamp?', 'status': 'text',
        'landed_sha': 'sha?', 'tokens': {'total': 'integer?'}, 'cost': COST,
        'landings?': ['positive_integer']}
LANDING_COST = {'state': ('recorded', 'lanes not recorded'), 'integration': ('not metered',),
    'lanes': [{'lane': 'text', 'title': 'text', 'builder': LANE['builder'],
               'status': ('running', 'handed-up', 'staged', 'landed', 'abandoned'),
               'allocation': ('unshared', 'shared'), 'other_landings': ['positive_integer'],
               'tokens': 'integer?', 'wall_seconds': 'integer?',
               'wall_state': ('unknown', 'ended', 'elapsed at generation', 'shared')}]}
OBJECTION = {'id': 'text', 'raised_at': STAMP, 'by': 'text', 'about_sha': 'sha?',
             'objection': 'text', 'disposition': 'text', 'resolved_sha': 'sha?', 'status': 'text'}
SCHEMA = {
    'schema': 'text', 'demonstration?': 'boolean', 'generated_at': STAMP, 'science_main': SHA, 'era_base': SHA,
    'sources': [{'section': 'text', 'source': 'text', 'state': 'text', 'observed_at': 'timestamp?'}],
    'scoreboard': {'landings': {'all': 'integer', 'last_7_days': 'integer'},
        'governed_commits': 'integer', 'earlier_commits': 'integer', 'gates': 'integer',
        'questions': {'open': 'integer', 'fixed': 'integer', 'partly_fixed': 'integer'},
        'lanes': {x: 'integer' for x in ('running', 'handed-up', 'staged', 'landed', 'abandoned')},
        'tokens': {'roster_total': 'integer', 'unmetered_lanes': 'integer', 'ship': SHIP}},
    'landings': [{'number': 'integer', 'title': 'text', 'landed_at': STAMP,
        'base': SHA, 'candidate': SHA, 'tree': SHA, 'fast_forward': 'boolean',
        'verdict': 'text', 'evidence': {'result': 'text', 'test_files': ['text']},
        'commits': [SHA], 'withheld_commits': 'integer', 'checker': CHECKER, 'cost': LANDING_COST}],
    'commits': [COMMIT], 'withheld_commits': 'integer', 'withheld_notice': 'text',
    'gates': [{'name': 'text', 'description': 'text'}],
    'questions': [{'number': 'integer', 'title': 'text', 'state': 'text', 'fixed_date': 'date?'}],
    'goals': [{'id': 'text', 'objective': 'text', 'weight': 'integer', 'done_means': 'text'}],
    'checks': {'state': 'text', 'message': 'text', 'items': [{'name': 'text', 'class': 'text', 'verdict': 'text'}]},
    'lanes': [LANE], 'objections': [OBJECTION],
    'tokens': {'definition': 'text', 'cost_basis': 'text', 'roster_total': 'integer',
        'unmetered_lanes': 'integer', 'ship': SHIP, 'difference': 'text',
        'by_provider': [{'provider': 'text', 'tokens': 'integer', 'unmetered_lanes': 'integer',
                         'wall_seconds': 'integer', 'unknown_wall_lanes': 'integer'}]}}

RULES = [
    ('url-credentials', re.compile(r'https?://[^\s/]+:[^\s/]*@', re.I)),
    ('local-path', re.compile(r'/(?:home|Users|mnt|srv|tmp|var|etc|opt|root|private|run|usr|Volumes)/|~/|(?<![A-Za-z])[A-Za-z]:[\\/]', re.I)),
    ('absolute-path', re.compile(r'''(?:^|[\s`"'(=])/(?!/)[\w.-]+(?:/|\b)''')),
    ('email', re.compile(r'[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}')),
    ('session-id', re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)),
    ('agent-id', re.compile(r'\ba[0-9a-f]{16}\b', re.I)),
    ('authorization', re.compile(r'''\bauthorization["']?\s*[:=]|\b(?:bearer|basic)\s+[A-Za-z0-9+/=_-]{8,}''', re.I)),
    ('key-prefix', re.compile(r'\b(?:sk-[A-Za-z0-9_-]{8,}|(?:gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})')),
    ('subscription-pool', re.compile(r'\b[\w.-]+-(?:primary|secondary|tertiary|max\d+x)\b', re.I)),
    ('seat-id', re.compile(r'\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-r-\d{6,12}\b|\bwo-[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}\b|\blead-[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{4}\b', re.I)),
    ('record-path', re.compile(r'[^\s`"<>]*(?:[/\\][^\s`"<>]*(?:transcript|prompt)|(?:transcript|prompt)[^\s`"<>]*[/\\])[^\s`"<>]*', re.I)),
]


def scan_string(value, path='$', sha=False):
    # Scan common encoded spellings as well as the original; never include either in diagnostics.
    for s in dict.fromkeys((value, unquote(unquote(value)))):
        for rule, pattern in RULES:
            if pattern.search(s):
                raise Refused(path, rule)
        for token in re.findall(r'(?<![\w:])(?:\d{1,3}\.){3}\d{1,3}(?!\w)|(?<!\w)[0-9a-fA-F:]*:[0-9a-fA-F:]+(?:%\w+)?', s):
            try:
                address = ipaddress.ip_address(token)
            except ValueError:
                continue
            if not address.is_global:
                raise Refused(path, 'private-network')
        for token in re.findall(r'(?<![A-Za-z0-9])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9])', s):
            if re.fullmatch(r'[0-9a-fA-F]{40}', token):
                if sha and s == token:
                    continue
                raise Refused(path, 'undeclared-sha')
            frequencies = Counter(token)
            entropy = -sum((n / len(token)) * math.log2(n / len(token)) for n in frequencies.values())
            if entropy >= 4 or re.fullmatch(r'[0-9a-fA-F]{32,}', token):
                raise Refused(path, 'opaque-token')


def validate(value, shape, path='$'):
    if isinstance(shape, tuple):
        if value not in shape or (value is not None and not isinstance(value, str)):
            raise Refused(path, 'closed-value-list')
    elif isinstance(shape, dict):
        if not isinstance(value, dict):
            raise Refused(path, 'object-required')
        allowed = {key.removesuffix('?') for key in shape}
        required = {key for key in shape if not key.endswith('?')}
        if not required <= set(value) <= allowed:
            raise Refused(path, 'field-allowlist')
        for key, spec in shape.items():
            if key.endswith('?'):
                key = key[:-1]
                if key not in value:
                    continue
            validate(value[key], spec, path + '.' + key)
    elif isinstance(shape, list):
        if not isinstance(value, list):
            raise Refused(path, 'array-required')
        for i, item in enumerate(value):
            validate(item, shape[0], f'{path}[{i}]')
    else:
        if shape.endswith('?'):
            if value is None:
                return
            shape = shape[:-1]
        if shape in ('integer', 'number', 'positive_integer'):
            if type(value) not in ((int, float) if shape == 'number' else (int,)) or value < (1 if shape == 'positive_integer' else 0) or not math.isfinite(value):
                raise Refused(path, 'nonnegative-number-required')
        elif shape == 'boolean':
            if type(value) is not bool:
                raise Refused(path, 'boolean-required')
        elif shape == 'digest':
            if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
                raise Refused(path, 'digest-required')
        else:
            if not isinstance(value, str):
                raise Refused(path, 'string-required')
            scan_string(value, path, shape == SHA)
            patterns = {'sha': r'[0-9a-f]{40}', 'short_sha': r'[0-9a-f]{12}',
                        'date': r'\d{4}-\d{2}-\d{2}',
                        'signer': SIGNER,
                        'timestamp': r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})'}
            if shape in patterns and not re.fullmatch(patterns[shape], value):
                raise Refused(path, shape + '-required')


def assert_public(document):
    validate(document, SCHEMA)
    if document['schema'] != 'pinkrobotics.activity/1':
        raise Refused('$.schema', 'schema-version')
    for lane in document['lanes']:
        numbers = lane.get('landings', [])
        if numbers != sorted(set(numbers)):
            raise Refused('$.lanes.landings', 'sorted-distinct-required')
    for landing in document['landings']:
        cost = landing['cost']
        if (cost['state'] == 'recorded') != bool(cost['lanes']):
            raise Refused('$.landings.cost.state', 'cost-state-mismatch')
        for lane in cost['lanes']:
            numbers = lane['other_landings']
            if numbers != sorted(set(numbers)) or landing['number'] in numbers:
                raise Refused('$.landings.cost.lanes.other_landings', 'other-landings-required')
            shared = lane['allocation'] == 'shared'
            if shared != bool(numbers) or shared != (lane['wall_state'] == 'shared'):
                raise Refused('$.landings.cost.lanes', 'allocation-mismatch')
            if shared and (lane['tokens'] is not None or lane['wall_seconds'] is not None):
                raise Refused('$.landings.cost.lanes', 'shared-numbers-refused')


def scan_json(value, path='$'):
    """For arbitrary JSON, no field is implicitly trusted to hold a git identity."""
    if isinstance(value, str):
        scan_string(value, path)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            scan_json(item, f'{path}[{i}]')
    elif isinstance(value, dict):
        for i, (key, item) in enumerate(value.items()):
            scan_string(key, f'{path}.key[{i}]')
            scan_json(item, f'{path}.value[{i}]')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('file')
    args = ap.parse_args()
    try:
        with open(args.file, encoding='utf-8') as stream:
            doc = json.load(stream)
        if isinstance(doc, dict) and doc.get('schema') == 'pinkrobotics.activity/1':
            assert_public(doc)
        else:
            scan_json(doc)
    except Refused as exc:
        print(f'REFUSED {exc}', file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print('REFUSED $: unreadable-json', file=sys.stderr)
        return 1
    print('PASS public boundary')
    return 0


if __name__ == '__main__':
    sys.exit(main())
