"""Checks for the actual preview tree and for deploy-filter drift."""

import os
import json
from pathlib import Path
import tempfile
import unittest

import export


ROOT = Path(__file__).resolve().parents[1]


class ExportTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ.get('TMPDIR') or ROOT / '.scratch')
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='export-test-', dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.destination = Path(self.temporary.name) / 'served'

    def test_each_filter_rule_matches_a_source_or_is_marked(self):
        patterns, server_side, not_deployed = export.read_filter(ROOT / 'deploy-filter.txt')
        entries = [path.relative_to(ROOT / 'site').as_posix()
                   for path in (ROOT / 'site').rglob('*')]
        self.assertEqual(server_side, {'log/data/'})
        self.assertEqual(not_deployed, {'airships/ship/_hero_test.html'})
        for pattern in patterns:
            with self.subTest(pattern=pattern):
                matches_source = any(export.matches(entry, pattern) for entry in entries)
                if pattern in not_deployed:
                    # deployment leaves it out; a match would mean the marker is stale
                    self.assertFalse(matches_source, f'stale not-deployed marker: {pattern}')
                else:
                    self.assertTrue(pattern in server_side or matches_source,
                                    f'unmatched deploy filter: {pattern}')

    def test_export_has_the_pages_and_no_development_or_server_fire_files(self):
        export.export_site(self.destination)
        files = {path.relative_to(self.destination).as_posix()
                 for path in self.destination.rglob('*') if path.is_file()}
        self.assertTrue({'index.html', 'log/index.html', 'robots.txt'} <= files)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o755)
        self.assertTrue(all((self.destination / name).stat().st_mode & 0o777 == 0o644
                            for name in files))
        # The committed source's notices page links this public attribution record.
        self.assertIn('airships/DATA-SOURCES.md', files)
        self.assertIn('href="DATA-SOURCES.md"', (ROOT / 'site/airships/notices.html').read_text())
        activity = Path(os.environ['TMPDIR']) / 'activity/activity.json'
        self.assertEqual('log/data/activity.json' in files, activity.is_file())
        if activity.is_file():
            self.assertEqual((self.destination / 'log/data/activity.json').read_bytes(),
                             activity.read_bytes())
        for name in files:
            with self.subTest(file=name):
                parts = Path(name).parts
                self.assertNotIn('tests', parts)
                self.assertNotIn('scripts', parts)
                self.assertFalse((name.endswith('.md') and name != 'airships/DATA-SOURCES.md')
                                 or name.endswith('/.gitignore'))
                self.assertNotIn('DIAGNOSIS', name.upper())
                self.assertFalse(Path(name).name.startswith('_hero_test'))
                self.assertFalse(name.startswith('airships/data/live/'))

    def test_declared_withheld_site_path_is_excluded(self):
        fake = Path(self.temporary.name) / 'fixture-root'
        (fake / 'site/internal').mkdir(parents=True)
        (fake / 'site/internal/note.txt').write_text('Local instructions')
        (fake / 'site/index.html').write_text('Public page')
        (fake / 'deploy-filter.txt').write_text('unused/\n')
        (fake / 'tools').mkdir()
        (fake / 'tools/public-policy.json').write_text(json.dumps({
            'exceptions': [], 'withheld': [{'path': 'site/internal/', 'reason': 'Local use.'}]}))
        export.export_site(self.destination, root=fake)
        self.assertFalse((self.destination / 'internal/note.txt').exists())
        self.assertTrue((self.destination / 'index.html').exists())

    def test_the_deployment_omitted_page_is_filtered_when_the_seed_brings_it(self):
        # Deployment leaves airships/ship/_hero_test.html out; without the rule the
        # export ships it, and the no-test-page assertion above goes red on it.
        fake = Path(self.temporary.name) / 'fixture-root'
        (fake / 'site/airships/ship').mkdir(parents=True)
        (fake / 'site/index.html').write_text('Public page')
        (fake / 'site/airships/ship/_hero_test.html').write_text('test page')
        (fake / 'tools').mkdir()
        (fake / 'tools/public-policy.json').write_text(json.dumps(
            {'exceptions': [], 'withheld': []}))
        rules = (ROOT / 'deploy-filter.txt').read_text(encoding='utf-8')
        without_rule = rules.replace('# not-deployed: airships/ship/_hero_test.html\n', '') \
                            .replace('airships/ship/_hero_test.html\n', '')
        (fake / 'deploy-filter.txt').write_text(without_rule)
        export.export_site(self.destination, root=fake)
        shipped = {path.relative_to(self.destination).as_posix()
                   for path in self.destination.rglob('*') if path.is_file()}
        self.assertIn('airships/ship/_hero_test.html', shipped)
        other = Path(self.temporary.name) / 'served-with-rule'
        (fake / 'deploy-filter.txt').write_text(rules)
        export.export_site(other, root=fake)
        filtered = {path.relative_to(other).as_posix()
                    for path in other.rglob('*') if path.is_file()}
        self.assertNotIn('airships/ship/_hero_test.html', filtered)
        self.assertIn('index.html', filtered)
        (fake / 'deploy-filter.txt').write_text(
            'log/data/\n# server-side: log/data/\n# not-deployed: gone/\n')
        with self.assertRaisesRegex(export.ExportError, 'marker has no rule'):
            export.read_filter(fake / 'deploy-filter.txt')

    def test_export_refuses_unchecked_activity_data(self):
        fake = Path(self.temporary.name) / 'fixture-root'
        (fake / 'site/log/data').mkdir(parents=True)
        (fake / 'site/index.html').write_text('fixture page')
        (fake / 'site/log/data/activity.json').write_text('{"title":"unsafe schema"}')
        (fake / 'deploy-filter.txt').write_text('# server-side: log/data/\nlog/data/\n')
        with self.assertRaisesRegex(export.ExportError, 'public boundary'):
            export.export_site(self.destination, root=fake, activity_file=fake / 'site/log/data/activity.json')
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
