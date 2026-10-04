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

    def rendered(self, row):
        root = Path(__file__).resolve().parents[2]
        node = os.environ.get('NODE', 'node')
        return subprocess.run([node, str(root / 'tools/activity/render_fixture.mjs'),
                               str(root / 'site/log/index.html')], input=json.dumps(row),
                              text=True, capture_output=True, check=True).stdout

    def test_withheld_text_keeps_date_and_model_in_served_renderer(self):
        doc, _ = self.f.build()
        rows = [r for r in doc['commits'] if r['sha'] == self.f.second]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(build.moment(row['committed_at']), build.moment(STAMP))
        self.assertEqual(row['builder'], 'Example model')
        self.assertEqual(row['subject'], 'Text withheld by the boundary check')
        rendered = self.rendered(row)
        self.assertIn('Example model', rendered)
        self.assertIn('2026-10-01', rendered)
        self.assertNotIn(PLANTS['local-path'], rendered)

    def test_missing_builder_is_explicit_in_served_renderer(self):
        doc, _ = self.f.build()
        row = next(r for r in doc['commits'] if r['subject'] == 'Attest landings')
        self.assertIn('model not recorded', self.rendered(row))

    def test_private_builder_is_never_retained(self):
        self.f.write('tests/extra.py', '# fixture')
        sha = self.f.commit('A change\n\nBuilder: ' + PLANTS['local-path'])
        doc, _ = self.f.build()
        rows = [r for r in doc['commits'] if r['sha'] == sha]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['builder'], 'model withheld by the boundary check')
        self.assertNotIn(PLANTS['local-path'], json.dumps(doc))

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

    def test_lead_seat_ids_and_ordinary_prose(self):
        for seat in ('lead-fictional-pair-0102', 'lead-fictional-unit-p1-0102'):
            for value in (seat, f'The public entry mentions {seat} in a sentence.'):
                with self.subTest(value=value):
                    with self.assertRaises(boundary.Refused) as refused:
                        boundary.scan_string(value)
                    self.assertEqual(refused.exception.rule, 'seat-id')
        for value in ('the primary gear', 'a secondary effect', 'version r-2',
                      'the two-step-2024 plan', 'part number wo-1234', 'rotor-r-12',
                      'max 5x gearing', 'at 20x magnification',
                      'a lead time of 2024 hours', 'lead-acid cells'):
            with self.subTest(value=value):
                boundary.scan_string(value)
        with self.assertRaises(boundary.Refused) as refused:
            boundary.scan_string('post-secondary')
        self.assertEqual(refused.exception.rule, 'subscription-pool')

    def test_public_gate_shapes_are_refused_here_including_style_names(self):
        # The public gate plants these invented shapes in its own tests and narrows the
        # pool shape inside style-name positions; this boundary keeps the strict rule and
        # refuses every one of them, so the work log's data can hold none of the shapes.
        shapes = (('lead-fictional-r-010203', 'seat-id'),
                  ('lead-fictional-primary', 'subscription-pool'),
                  ('wo-fictional-0102', 'seat-id'),
                  ('lead-fictional/transcript.json', 'record-path'),
                  ('class="btn-primary"', 'subscription-pool'),
                  ('.btn-primary { top: 0 }', 'subscription-pool'),
                  ('--accent-secondary: #fff', 'subscription-pool'))
        for value, rule in shapes:
            with self.subTest(value=value):
                with self.assertRaises(boundary.Refused) as refused:
                    boundary.scan_string(value)
                self.assertEqual(refused.exception.rule, rule)
                self.assertTrue(value not in str(refused.exception))

    def test_refused_text_in_the_science_files_costs_that_text_not_the_log(self):
        # A loopback address names no network, yet this boundary refuses every non-global address.
        # In a gate description, a question or a goal it is withheld as commit text is; the log builds.
        address = '127.0' + '.0.1'
        f = self.f
        f.write('Makefile', f'check: lint test  ## All checks\nlint:  ## Import boundaries\ntest:  ## No network beyond {address}\n')
        f.write('docs/OPEN-QUESTIONS.md', f'## 1. Reach {address} only\n## 2. Closed issue — FIXED 2026-10-01\n')
        f.write('GOALS.md', '<!-- goals:v1 -->\n| id | Objective | Weight | Done means |\n|---|---|---|---|\n'
                f'| O1 | Truth | 100 | Served from {address}. |\n<!-- /goals:v1 -->')
        f.commit('Describe the checks\n\nA public explanation.\n\nOrder: 4\nBuilder: Example model\n')
        doc, log = f.build()
        notice = 'Text withheld by the boundary check.'
        self.assertEqual([gate['description'] for gate in doc['gates']], ['Import boundaries', notice])
        self.assertEqual([row['title'] for row in doc['questions']], [notice, 'Closed issue'])
        self.assertEqual((doc['goals'][0]['objective'], doc['goals'][0]['done_means']), ('Truth', notice))
        for line in ('WITHHELD gates text: $.gates[1].description: private-network',
                     'WITHHELD questions text: $.questions[0].title: private-network',
                     'WITHHELD goals text: $.goals[0].done_means: private-network'):
            self.assertIn(line, log)
        self.assertTrue(address not in json.dumps(doc) and address not in log)

    def test_escaped_pipe_in_a_record_cell_stays_in_that_cell(self):
        # A landing record prints the gate command as it ran; a pipeline in it is escaped as \|.
        with tempfile.TemporaryDirectory(prefix='activity-pipe-') as root:
            f = Fixture(Path(root), attestation_extra="`` bash -c 'make check \\| tail -n 1' ``")
            doc, _ = f.build()
        self.assertEqual([row['number'] for row in doc['landings']], [2, 1])
        self.assertEqual([row['evidence'] for row in doc['landings']],
                         [{'result': 'rc=0', 'test_files': ['tests/test_one.py']}] * 2)
        self.assertEqual(build.table_rows("| a \\| b | c |\n|---|---|\n| d | e \\| |"),
                         [['a | b', 'c'], ['d', 'e |']])

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


class CheckerTests(unittest.TestCase):
    setUp = ActivityTests.setUp

    def checker(self, text):
        store = self.f.root / 'verdicts.tsv'
        store.write_text(text)
        with contextlib.redirect_stderr(io.StringIO()):
            doc = build.build(self.f.repo, self.f.base, self.f.roster, self.f.objections,
                              self.f.feed, now=NOW, verdicts=store)
        self.assertNotIn('unit=', json.dumps(doc))
        return next(row['checker'] for row in doc['landings'] if row['number'] == 1)

    def record(self, verdict='XO-SIGNED', text=None, sha=None):
        return f'{STAMP}\t{sha or self.f.first}\t{verdict}\t{text or self.signed_text()}\n'

    def signed_text(self):
        return f'{self.f.first} XO-SIGNED tree={self.f.first_tree} signature-sha256={"a" * 64} unit=fictional-check'

    def test_signed_digest(self):
        self.assertEqual(self.checker(self.record()), dict(state='signed', verdict='XO-SIGNED',
            recorded_at=STAMP, model='model not recorded', signature_sha256='a' * 64))

    def test_extra_label_cannot_name_model(self):
        self.assertEqual(self.checker(self.record(text=self.signed_text() + ' extra=fictional-model'))['model'],
                         'model not recorded')

    def signer(self, billet='reviewer', model='fictional-model-1', effort='high'):
        return (f' signer-seat={PLANTS["seat-id"]} signer-billet={billet}'
                f' signer-model={model} signer-effort={effort}')

    def test_signer_labels_show_role_model_and_effort_never_the_seat(self):
        # The store's newer row: the signed text, then the four signer labels, always in this order.
        row = self.checker(self.record(text=self.signed_text() + self.signer()))
        self.assertEqual((row['state'], row['model']), ('signed', 'checked by reviewer · fictional-model-1 @ high'))
        self.assertNotIn(PLANTS['seat-id'], json.dumps(row))
        unknown = self.checker(self.record(text=self.signed_text() + self.signer(effort='unknown')))
        self.assertEqual(unknown['model'], 'checked by reviewer · fictional-model-1 @ unknown')

    def test_incomplete_or_refused_signer_keeps_model_not_recorded(self):
        for labels in (self.signer().replace(' signer-effort=high', ''),
                       ' signer-billet signer-model=fictional-model-1 signer-effort=high',
                       self.signer(billet=PLANTS['seat-id']), self.signer(model='fictional/model'),
                       self.signer(effort='x' * 101)):
            with self.subTest(labels=labels):
                self.assertEqual(self.checker(self.record(text=self.signed_text() + labels))['model'],
                                 'model not recorded')

    def test_abbreviated_sha_compatibility(self):
        self.assertEqual(self.checker(self.record(sha=self.f.first[:7]))['state'], 'signed')
        self.assertTrue(build.compatible_sha(self.f.first[:7], self.f.first))
        self.assertFalse(build.compatible_sha('b' * 7, 'a' * 40))

    def test_last_complete_record_revokes(self):
        row = self.checker(self.record() + self.record('FAIL', 'Review failed.'))
        self.assertEqual((row['state'], row['verdict'], row['signature_sha256']), ('revoked', 'FAIL', None))

    def test_torn_tail_ignored(self):
        self.assertEqual(self.checker(self.record() + self.record('FAIL', 'Review failed.').rstrip('\n'))['state'], 'signed')

    def test_malformed_line_ignored(self):
        malformed = f'{STAMP}\t{self.f.first}\tFAIL\n'
        self.assertEqual(self.checker(self.record() + malformed)['state'], 'signed')

    def test_no_record(self):
        row = self.checker(self.record(sha='b' * 40))
        self.assertEqual((row['state'], row['verdict'], row['recorded_at']), ('not in the store', None, None))

    def test_no_store(self):
        self.assertEqual(self.f.build()[0]['landings'][0]['checker']['state'], 'store not provided')

    def test_pass_is_not_signature(self):
        row = self.checker(self.record('PASS', 'Review passed.'))
        self.assertEqual((row['state'], row['signature_sha256']), ('review pass', None))

    def test_review_did_not_run(self):
        row = self.checker(self.record('LaneDidNotRun', 'Review did not run.'))
        self.assertEqual((row['state'], row['signature_sha256']), ('review did not run', None))

    def test_bad_or_repeated_digest_is_not_signed(self):
        for text in ('signature-sha256=' + 'A' * 64, 'signature-sha256=short',
                     self.signed_text() + ' signature-sha256=' + 'b' * 64, 'No digest.'):
            with self.subTest(text=text):
                row = self.checker(self.record(text=text))
                self.assertEqual((row['state'], row['signature_sha256']), ('signature not recorded', None))

    def test_store_read_failure_preserves_output(self):
        out = self.f.root / 'out'
        out.mkdir()
        (out / 'activity.json').write_text('previous bytes')
        argv = ['build.py', '--science', str(self.f.repo), '--era-base', self.f.base,
                '--roster', str(self.f.roster), '--objections', str(self.f.objections),
                '--ship-feed', 'none', '--out', str(out), '--verdicts', str(self.f.root / 'absent')]
        with patch('sys.argv', argv), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(build.main(), 1)
        self.assertEqual((out / 'activity.json').read_text(), 'previous bytes')
        with patch('build.Path.read_bytes', side_effect=PermissionError('withheld')):
            with self.assertRaises(PermissionError):
                build.verdicts_from(self.f.root / 'unreadable')

    def test_checker_fields_refuse_plants_and_unknown_fields(self):
        doc, _ = self.f.build()
        checker = doc['landings'][0]['checker']
        for field in checker:
            for plant in ('unit=fictional-check', PLANTS['local-path'], 'Free text'):
                altered = copy.deepcopy(doc)
                altered['landings'][0]['checker'][field] = plant
                with self.assertRaises(boundary.Refused):
                    boundary.assert_public(altered)
        altered = copy.deepcopy(doc)
        altered['landings'][0]['checker']['text'] = 'unit=fictional-check'
        with self.assertRaises(boundary.Refused):
            boundary.assert_public(altered)
        print('checker plants: REFUSED in every field and unknown text field')


class LandingCostTests(unittest.TestCase):
    setUp = ActivityTests.setUp

    def cost(self, numbers=None):
        if numbers is not None:
            self.f.roster_doc['lanes'][0]['landings'] = numbers
        return next(row['cost'] for row in self.f.build()[0]['landings'] if row['number'] == 1)

    def test_unshared_lane_and_builder(self):
        row = self.cost([1])
        self.assertEqual(row['state'], 'recorded')
        self.assertEqual(row['integration'], 'not metered')
        lane = row['lanes'][0]
        self.assertEqual((lane['lane'], lane['title'], lane['builder']),
            ('example', 'Example work', dict(provider='Codex', model='Example model', effort='high')))
        self.assertEqual((lane['allocation'], lane['tokens'], lane['wall_seconds']), ('unshared', 1200, 3600))
        self.assertNotIn('pool', json.dumps(row))

    def test_shared_has_no_numbers(self):
        lane = self.cost([1, 2])['lanes'][0]
        self.assertEqual((lane['allocation'], lane['other_landings']), ('shared', [2]))
        self.assertIsNone(lane['tokens'])
        self.assertIsNone(lane['wall_seconds'])

    def test_running_lane(self):
        lane = self.f.roster_doc['lanes'][0]
        lane.update(status='running', ended_at=None)
        row = self.cost([1])['lanes'][0]
        self.assertEqual((row['status'], row['wall_state'], row['wall_seconds']),
                         ('running', 'elapsed at generation', 7200))

    def test_missing_readings_stay_missing(self):
        lane = self.f.roster_doc['lanes'][0]
        lane.update(started_at=None, ended_at=None)
        lane['tokens']['total'] = None
        row = self.cost([1])['lanes'][0]
        self.assertIsNone(row['tokens'])
        self.assertIsNone(row['wall_seconds'])
        self.assertEqual(row['wall_state'], 'unknown')

    def test_future_landing_is_normal_and_shared(self):
        self.assertEqual(self.cost([99])['lanes'], [])
        row = self.cost([1, 99])['lanes'][0]
        self.assertEqual((row['allocation'], row['other_landings'], row['tokens']), ('shared', [99], None))

    def test_no_landings_is_not_recorded(self):
        self.assertEqual(self.cost(), dict(state='lanes not recorded', lanes=[], integration='not metered'))

    def test_invalid_membership_refused(self):
        for numbers in (None, '1', [0], [-1], [True], [1.0], [2, 1], [1, 1], ['1']):
            self.f.roster_doc['lanes'][0]['landings'] = numbers
            with self.subTest(numbers=numbers):
                with self.assertRaises((build.InputError, boundary.Refused)):
                    self.f.build()

    def test_cost_boundary_refuses_private_fields(self):
        self.f.roster_doc['lanes'][0]['landings'] = [1]
        doc, _ = self.f.build()
        # Private input metadata is discarded; any attempt to project it is refused.
        for key in ('pool', 'subscription', 'seat', 'session'):
            altered = copy.deepcopy(doc)
            row = next(row for row in altered['landings'] if row['number'] == 1)
            row['cost']['lanes'][0]['builder'][key] = PLANTS['subscription-pool']
            with self.assertRaises(boundary.Refused) as refused:
                boundary.assert_public(altered)
            self.assertEqual(refused.exception.rule, 'field-allowlist')
        for key in ('lane', 'title'):
            altered = copy.deepcopy(doc)
            row = next(row for row in altered['landings'] if row['number'] == 1)
            row['cost']['lanes'][0][key] = PLANTS['subscription-pool']
            with self.assertRaises(boundary.Refused):
                boundary.assert_public(altered)
        print('cost metadata and pool value plants: REFUSED')


class LandingPageTests(unittest.TestCase):
    setUp = ActivityTests.setUp

    def rendered_page(self, doc):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run([os.environ.get('NODE', 'node'),
            str(root / 'tools/activity/render_fixture.mjs'), str(root / 'site/log/index.html'), '--page'],
            input=json.dumps(doc), text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_new_page_old_data_is_explicit(self):
        doc, _ = self.f.build()
        for row in doc['landings']:
            row.pop('checker')
            row.pop('cost')
        result = self.rendered_page(doc)
        self.assertTrue(result['visible'])
        self.assertIn('Who checked', result['landings'])
        self.assertIn('Checker not recorded', result['landings'])
        self.assertIn('Signature digest', result['landings'])
        self.assertIn('Lanes not recorded', result['landings'])
        self.assertIn('integration: not metered', result['landings'])
        self.assertNotIn('Related order costs', result['landings'])

    def test_shared_costs_render_without_allocated_numbers(self):
        self.f.roster_doc['lanes'][0]['landings'] = [1, 2]
        doc, _ = self.f.build()
        result = self.rendered_page(doc)
        self.assertTrue(result['visible'])
        self.assertIn('shared', result['landings'])
        self.assertIn('Example work', result['landings'])
        self.assertIn('Example model', result['landings'])
        self.assertNotIn('1,200', result['landings'])

    def test_shared_with_one_landing_reads_singular(self):
        self.f.roster_doc['lanes'][0]['landings'] = [1, 2]
        doc, _ = self.f.build()
        text = self.rendered_page(doc)['landings']
        self.assertIn('shared with landing ', text)
        self.assertNotIn('shared with landings', text)
        self.f.roster_doc['lanes'][0]['landings'] = [1, 2, 3]
        doc, _ = self.f.build()
        self.assertIn('shared with landings ', self.rendered_page(doc)['landings'])

    def test_signed_checker_renders_digest(self):
        doc, _ = self.f.build()
        doc['landings'][0]['checker'].update(state='signed', verdict='XO-SIGNED',
            recorded_at=STAMP, signature_sha256='a' * 64)
        result = self.rendered_page(doc)
        self.assertTrue(result['visible'])
        self.assertIn('Separate reviewer', result['landings'])
        self.assertIn('model not recorded', result['landings'])
        self.assertIn('a' * 64, result['landings'])

    def test_signed_checker_renders_signer(self):
        doc, _ = self.f.build()
        doc['landings'][0]['checker'].update(state='signed', verdict='XO-SIGNED', recorded_at=STAMP,
            model='checked by reviewer · fictional-model-1 @ high', signature_sha256='a' * 64)
        boundary.assert_public(doc)
        self.assertIn('Separate reviewer: signed · checked by reviewer · fictional-model-1 @ high',
                      self.rendered_page(doc)['landings'])


if __name__ == '__main__':
    unittest.main()
