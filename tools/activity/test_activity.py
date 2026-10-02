"""Disposable git evidence and hostile-input tests; no production checkout is mutated."""
import contextlib
import copy
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import boundary
import build

NOW = datetime(2026, 10, 2, 4, 0, tzinfo=timezone.utc)
STAMP = '2026-10-02T03:00:00+00:00'
# Deliberately synthetic examples, never real records or credentials.
PLANTS = {
    'local-path': '/' + 'home/example/private.txt',
    'absolute-path': '/' + 'vault/private.txt',
    'email': 'example' + '@' + 'example.invalid',
    'session-id': '12345678-1234-1234-1234-123456789abc',
    'agent-id': 'a' + '0123456789abcdef',
    'url-credentials': 'https://example:fictional@example.invalid/file',
    'authorization': 'Authorization: Bearer fictional-value',
    'key-prefix': 'sk-' + 'fictionaltestvalue123',
    'opaque-token': 'aB3dE5gH7jK9mN2pQ4sT6vW8yZ0cF1iL',
    'private-network': '10.12.34.56',
    'subscription-pool': 'fictional-primary',
    'seat-id': 'fictional-r-01020304',
    'record-path': 'records/transcript.json',
    'undeclared-sha': 'b' * 40,
}


class Fixture:
    def __init__(self, root, bad_body=None, attestation_extra=''):
        self.root = root
        self.repo = root / 'science'
        self.repo.mkdir()
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1',
                        GIT_AUTHOR_NAME='Fixture', GIT_COMMITTER_NAME='Fixture',
                        GIT_AUTHOR_EMAIL='fixture' + '@' + 'example.invalid',
                        GIT_COMMITTER_EMAIL='fixture' + '@' + 'example.invalid',
                        GIT_AUTHOR_DATE=STAMP, GIT_COMMITTER_DATE=STAMP)
        self.git('init', '-q', '--initial-branch=main')
        self.write('Makefile', 'check: lint test  ## All checks\nlint:  ## Import boundaries\ntest:  ## Unit tests\n')
        self.write('docs/OPEN-QUESTIONS.md', '## 1. Open issue\n## 2. Closed issue — FIXED 2026-10-01\n## 3. Partial issue — BALLAST FIXED 2026-10-01\n## 4. Half done — PARTLY FIXED 2026-10-01\n')
        self.write('GOALS.md', '<!-- goals:v1 -->\n| id | Objective | Weight | Done means |\n|---|---|---|---|\n| O1 | Truth | 100 | A checkable result. |\n<!-- /goals:v1 -->')
        self.base = self.commit('Earlier subject must never be public')
        self.write('tests/test_one.py', '# fixture\n')
        self.first = self.commit('A public change\n\nA public explanation.\n\nOrder: 4\nBuilder: Example model\nIntegrator: Other model\nCo-Authored-By: fixture' + '@' + 'example.invalid\n\nHelm-Audit-ID: private-record\nHelm-Graph-Head: 123\n')
        self.first_tree = self.git('rev-parse', self.first + '^{tree}').strip()
        self.write('tests/test_two.py', '# second fixture\n')
        self.second = self.commit('Another change\n\n' + (bad_body or PLANTS['local-path']) + '\n\nOrder: 11\nBuilder: Example model\n')
        self.second_tree = self.git('rev-parse', self.second + '^{tree}').strip()
        attestations = []
        for n, base, candidate, tree in ((1, self.base, self.first, self.first_tree), (2, self.first, self.second, self.second_tree)):
            attestations.append(f'''## Landing {n} — Public landing
| field | value |
|---|---|
| Landed | 2026-10-01 20:00:00 PDT FAST-FORWARD: main `{base}` → `{candidate}` |
| The object | SIGNED `{candidate}`, tree `{tree}` {attestation_extra} |
| Gate | rc=0, XO-SIGNED {attestation_extra} |
| Evidence before landing | node --test tests/test_one.py rc=0 {attestation_extra} |
''')
        self.write('docs/governance/landing-attestations.md', '\n'.join(attestations))
        self.commit('Attest landings\n\nRecord only.\n\nHelm-Audit-ID: private-record')
        self.roster = root / 'lanes.json'
        self.objections = root / 'objections.json'
        self.feed = root / 'feed.json'
        self.roster_doc = {'schema': 'pinkrobotics.lanes/1', 'metered_at': STAMP,
            'sessions': [PLANTS['session-id']], 'lanes': [dict(lane='example', order='4', title='Example work',
             kind='worker', builder=dict(harness='codex', model='Example model', effort='high', pool='fictional-primary'),
             cwd=PLANTS['local-path'], session=PLANTS['session-id'], agent=PLANTS['agent-id'],
             started_at='2026-10-02T02:00:00+00:00', ended_at=STAMP, exit=0, status='landed',
             landed_sha=self.first, tokens=dict(total=1200, rows=5, first_at=STAMP, last_at=STAMP))]}
        self.objections_doc = {'schema': 'pinkrobotics.objections/1', 'objections': [dict(id='OBJ-001',
            raised_at=STAMP, by='Review desk', about_sha=self.first, objection='A check failed.',
            disposition='Corrected and checked.', resolved_sha=self.second, status='resolved')]}
        self.feed_doc = {'projects': {'pink-robotics': {'tokens': {key: dict(value=1100, observed_at=STAMP, private='discard') for key in ('lifetime', 'recent', 'current')},
            'loc': {'series': [dict(value=99, observed_at=STAMP, private='discard')]}, 'private': PLANTS['local-path']}}}
        self.save()

    def git(self, *args, input=None):
        return subprocess.run(['git', '-C', str(self.repo), *args], input=input, text=True,
                              capture_output=True, check=True, env=self.env).stdout

    def write(self, path, text):
        p = self.repo / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self, message):
        self.git('add', '.')
        tree = self.git('write-tree').strip()
        parent = self.git('rev-parse', '--verify', 'refs/heads/main').strip() if (self.repo / '.git/refs/heads/main').exists() else None
        args = ['commit-tree', tree] + (['-p', parent] if parent else [])
        sha = self.git(*args, input=message).strip()
        self.git('update-ref', 'refs/heads/main', sha)
        return sha

    def save(self):
        for path, doc in ((self.roster, self.roster_doc), (self.objections, self.objections_doc), (self.feed, self.feed_doc)):
            path.write_text(json.dumps(doc))

    def build(self):
        self.save()
        with contextlib.redirect_stderr(io.StringIO()) as log:
            doc = build.build(self.repo, self.base, self.roster, self.objections, self.feed, now=NOW)
        return doc, log.getvalue()


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='activity-test-')
        self.addCleanup(self.tmp.cleanup)
        self.f = Fixture(Path(self.tmp.name))

    def test_two_landings_counts_projection_and_schema(self):
        doc, log = self.f.build()
        boundary.assert_public(doc)
        self.assertEqual(doc['scoreboard']['landings'], {'all': 2, 'last_7_days': 2})
        self.assertEqual(doc['scoreboard']['governed_commits'], 3)
        self.assertEqual(doc['scoreboard']['earlier_commits'], 1)
        self.assertEqual(doc['scoreboard']['questions'], dict(open=1, fixed=1, partly_fixed=2))
        self.assertEqual(doc['scoreboard']['gates'], 2)
        self.assertEqual(doc['tokens']['roster_total'], 1200)
        self.assertEqual(doc['tokens']['ship']['tokens']['lifetime']['value'], 1100)
        self.assertEqual(doc['tokens']['ship']['loc']['value'], 99)
        self.assertEqual(doc['lanes'][0]['cost']['wall_seconds'], 3600)
        self.assertEqual(doc['withheld_notice'], '1 commit withheld by the boundary check')
        self.assertEqual(doc['landings'][0]['withheld_commits'], 1)
        public = json.dumps(doc)
        for forbidden in ('Earlier subject', 'Helm-Audit-ID', 'Co-Authored-By', 'sessions', 'cwd', 'agent', 'pool'):
            self.assertTrue(forbidden not in public)
        for secret in PLANTS.values():
            self.assertTrue(secret not in public and secret not in log)
        change = next(row for row in doc['commits'] if row['sha'] == self.f.first)
        self.assertEqual(change['body'], 'A public explanation.')
        self.assertEqual(change['order'], '4')
        self.assertEqual(change['landing'], 1)
        self.assertEqual(change['insertions'], 1)
        self.assertEqual(change['files'], ['tests/test_one.py'])
        self.assertEqual(doc['checks']['state'], 'pending')
        self.assertIn('lands with the next batch', doc['checks']['message'])
        altered = copy.deepcopy(doc)
        altered['lanes'][0]['session'] = 'private'
        with self.assertRaises(boundary.Refused) as refused:
            boundary.assert_public(altered)
        self.assertEqual(refused.exception.rule, 'field-allowlist')
        # A fixed clock and unchanged inputs make the document byte-stable.
        self.assertEqual(doc, self.f.build()[0])

    def test_each_boundary_class_in_all_five_inputs(self):
        for rule, secret in PLANTS.items():
            with self.subTest(rule=rule):
                try:
                    boundary.scan_string(secret, '$.example')
                except boundary.Refused as exc:
                    self.assertEqual(exc.rule, rule)
                    self.assertTrue(secret not in str(exc))
                    print(f'boundary {rule}: REFUSED {exc}')
                else:
                    self.fail('planted value was accepted')
                for input_name in ('roster', 'objection', 'ship'):
                    with self.subTest(input=input_name):
                        f = self.f
                        docs = copy.deepcopy((f.roster_doc, f.objections_doc, f.feed_doc))
                        if input_name == 'roster':
                            f.roster_doc['lanes'][0]['title'] = secret
                        elif input_name == 'objection':
                            f.objections_doc['objections'][0]['objection'] = secret
                        else:
                            f.feed_doc['projects']['pink-robotics']['tokens']['lifetime']['observed_at'] = secret
                        with self.assertRaises(boundary.Refused) as refused:
                            f.build()
                        self.assertEqual(refused.exception.rule, rule)
                        self.assertTrue(secret not in str(refused.exception))
                        f.roster_doc, f.objections_doc, f.feed_doc = docs
                with tempfile.TemporaryDirectory(prefix='activity-plant-') as root:
                    f = Fixture(Path(root), bad_body=secret, attestation_extra=secret)
                    doc, log = f.build()
                    self.assertEqual(doc['withheld_commits'], 1)
                    self.assertTrue(secret not in json.dumps(doc) and secret not in log)
                    self.assertIn(rule, log)
                    # Arbitrary row contents are dropped, including the unsafe row extension.
                    self.assertEqual(doc['landings'][0]['evidence']['test_files'], ['tests/test_one.py'])

    def test_additional_path_network_and_encoded_shapes(self):
        values = ['/' + root + '/example/file' for root in ('Users', 'mnt', 'srv', 'tmp')]
        values += ['~/example', 'C:\\example\\secret', 'records/prompt.txt', 'prompt/file.txt',
                   'fictional-max5x', 'fictional-max20x', 'fictional-secondary', 'fictional-tertiary',
                   'two-word-r-0102030405', 'wo-fictional-task-0102', '192.168.1.1', '172.16.0.1', '127.0.0.1', '[::1]',
                   'fd00::1234', 'fe80::1234', '%2Fhome%2Fexample', 'Basic ZmFrZTpmYWtl',
                   'ghp_' + 'fictional0123456789', 'AKIA' + 'A' * 16,
                   '{"Authorization": "fictional"}']
        for value in values:
            with self.assertRaises(boundary.Refused):
                boundary.scan_string(value)
        boundary.scan_string('sim/targets.js and tests/test_one.py are repository-relative.')
        # Near misses that are ordinary public text: a model id, a secondary structure, a short suffix.
        for public in ('claude-opus-5-5 and glm-5.3 built it', 'the secondary structure and the primary load path',
                       'an r-value of 12', 'a two-stage release in 2026', 'section-r-12'):
            boundary.scan_string(public)
        boundary.scan_string('a' * 40, sha=True)
        with self.assertRaises(boundary.Refused):
            boundary.scan_string('a' * 40)

    def test_landing_recorded_under_an_order_identifier_shows_its_commit_subject(self):
        subjects = {'a' * 40: 'A plain sentence'}
        self.assertEqual(build.public_title('ord-desk-land-thing-1001', 'a' * 40, subjects), 'A plain sentence')
        self.assertEqual(build.public_title('ord-desk-land-thing-1001', 'b' * 40, subjects),
                         'Title withheld by the boundary check')
        # A name the batch gave itself wins over the subject, but never revives a withheld commit.
        self.assertEqual(build.public_title('ord-desk-land-thing-1001', 'a' * 40, subjects, 'The batch, named'),
                         'The batch, named')
        self.assertEqual(build.public_title('ord-desk-land-thing-1001', 'b' * 40, subjects, 'The batch, named'),
                         'Title withheld by the boundary check')
        self.assertEqual(build.public_title('The gates run from a clean clone', 'a' * 40, subjects),
                         'The gates run from a clean clone')
        self.assertEqual(build.public_title('A sentence already', 'a' * 40, subjects, 'The batch, named'),
                         'A sentence already')

    def test_landing_trailer_names_the_landing_and_stays_out_of_the_body(self):
        f = self.f
        f.write('tests/test_three.py', '# third fixture\n')
        named = f.commit('Regenerated files\n\nA public explanation.\n\nLanding: The front door, made true\nOrder: 4\nBuilder: Example model\n')
        self.assertEqual(build.landing_name(f.repo, named), 'The front door, made true')
        self.assertEqual(build.commit_from(f.repo, named, None)['body'], 'A public explanation.')
        self.assertIsNone(build.landing_name(f.repo, f.first))
        f.write('tests/test_four.py', '# fourth fixture\n')
        private = f.commit('Another\n\nLanding: see ' + PLANTS['local-path'] + '\nOrder: 4\n')
        self.assertIsNone(build.landing_name(f.repo, private))
        f.write('tests/test_five.py', '# fifth fixture\n')
        twice = f.commit('Another\n\nLanding: One name\nLanding: Two names\nOrder: 4\n')
        self.assertIsNone(build.landing_name(f.repo, twice))

    def test_labelled_report_rows_are_named_by_title(self):
        self.f.write('research/validation/report.json', json.dumps({'checks': [
            {'id': '1-atmosphere', 'title': 'Air density with altitude', 'class': 'equation', 'verdict': 'MISS'}]}))
        self.f.commit('Add the labelled report\n\nHelm-Audit-ID: fixture')
        self.assertEqual(self.f.build()[0]['checks']['items'],
                         [{'name': 'Air density with altitude', 'class': 'equation', 'verdict': 'MISS'}])

    def test_ship_line_count_series_of_time_and_counts_pairs(self):
        stamp = {'value': 5, 'observed_at': '2026-10-02T04:04:22Z'}
        feed = {'projects': {'pink-robotics': {'tokens': {key: dict(stamp) for key in ('lifetime', 'recent', 'current')},
                'loc': {'series': [[1790522748, {'docs': 1, 'web': 2}], [1790524308, {'docs': 40, 'web': 2}]]}}}}
        self.f.feed.write_text(json.dumps(feed))
        ship = build.ship_from(str(self.f.feed))
        self.assertEqual(ship['state'], 'available')
        self.assertEqual(ship['loc'], {'value': 42, 'observed_at': '2026-09-27T15:51:48Z'})
        feed['projects']['pink-robotics']['loc']['series'][-1][1] = {'docs': 'many'}
        self.f.feed.write_text(json.dumps(feed))
        self.assertEqual(build.ship_from(str(self.f.feed))['state'], 'unavailable')

    def test_miss_survives_and_worktree_edits_are_not_main(self):
        self.f.write('research/validation/report.json', json.dumps({'checks': [dict(name='Measured lift', **{'class': 'measurement'}, verdict='MISS', private='discard')]}))
        self.assertEqual(self.f.build()[0]['checks']['state'], 'pending')
        self.f.commit('Add a labelled check\n\nHelm-Audit-ID: fixture')
        self.assertEqual(self.f.build()[0]['checks']['items'][0]['verdict'], 'MISS')

    def test_missing_meter_and_stopped_lane_time_are_unknown(self):
        row = self.f.roster_doc['lanes'][0]
        row['tokens']['total'] = None
        row['ended_at'] = None
        row['status'] = 'abandoned'
        doc, _ = self.f.build()
        self.assertIsNone(doc['lanes'][0]['cost']['wall_seconds'])
        self.assertEqual(doc['tokens']['unmetered_lanes'], 1)
        self.assertEqual(doc['tokens']['by_provider'][0]['unknown_wall_lanes'], 1)

    def test_ship_disabled_failed_malformed_and_one_request(self):
        self.assertEqual(build.ship_from('none')['state'], 'disabled')
        self.assertEqual(build.ship_from(str(self.f.root / 'absent'))['state'], 'unavailable')
        self.f.feed.write_text('{}')
        self.assertEqual(build.ship_from(str(self.f.feed))['state'], 'unavailable')
        with patch('build.urllib.request.build_opener') as factory:
            factory.return_value.open.side_effect = OSError('private details')
            result = build.ship_from('https://example.invalid/feed')
            self.assertEqual(result['state'], 'unavailable')
            factory.return_value.open.assert_called_once()
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'https://example.invalid/feed')
            self.assertEqual(request.get_header('User-agent'), build.USER_AGENT)
            self.assertEqual(factory.return_value.open.call_args.kwargs, {'timeout': 10})
            self.assertTrue('private details' not in json.dumps(result))
        self.assertIsNone(build.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.invalid/next'))

    def test_cli_refusal_writes_nothing_and_preserves_previous_output(self):
        self.f.roster_doc['lanes'][0]['title'] = PLANTS['local-path']
        self.f.save()
        out = self.f.root / 'out'
        argv = ['build.py', '--science', str(self.f.repo), '--era-base', self.f.base,
                '--roster', str(self.f.roster), '--objections', str(self.f.objections), '--ship-feed', 'none', '--out', str(out)]
        for previous in (False, True):
            if previous:
                out.mkdir()
                (out / 'activity.json').write_text('previous bytes')
            with patch('sys.argv', argv), contextlib.redirect_stderr(io.StringIO()) as log:
                self.assertEqual(build.main(), 1)
            self.assertTrue(PLANTS['local-path'] not in log.getvalue())
            if previous:
                self.assertEqual((out / 'activity.json').read_text(), 'previous bytes')
            else:
                self.assertFalse(out.exists())

    def test_boundary_cli_generic_json_and_secret_keys(self):
        path = self.f.root / 'sample.json'
        path.write_text(json.dumps({PLANTS['local-path']: 'text'}))
        with patch('sys.argv', ['boundary.py', str(path)]), contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertEqual(boundary.main(), 1)
        self.assertTrue(PLANTS['local-path'] not in log.getvalue())

    def test_page_contracts(self):
        root = Path(__file__).resolve().parents[2]
        page = (root / 'site/log/index.html').read_text()
        homepage = (root / 'site/index.html').read_text()
        source = (root / 'site/animals/index.html').read_text()
        design = lambda text: text.split('/*DESIGN*/', 1)[1].split('/*/DESIGN*/', 1)[0]
        self.assertEqual(design(page), design(source))
        self.assertIn('The work log is generated from', page)
        self.assertIn("fetch('./data/activity.json'", page)
        self.assertIn("fetch('log/data/activity.json'", homepage)
        self.assertIn('Read the public work log', homepage)
        self.assertNotIn('innerHTML', page)
        # The immutable foundation contains six em dashes in CSS comments.
        # The house copy limit applies outside that copied block.
        self.assertLessEqual(page.replace(design(page), '').count('—'), 2)
        self.assertLess(homepage.index('<!-- ACTIVITY STRIP -->'), homepage.index('<section id="pages">'))


if __name__ == '__main__':
    unittest.main()
