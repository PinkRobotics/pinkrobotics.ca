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

    def test_each_filter_rule_matches_a_source_or_is_marked_server_side(self):
        patterns, server_side = export.read_filter(ROOT / 'deploy-filter.txt')
        entries = [path.relative_to(ROOT / 'site').as_posix()
                   for path in (ROOT / 'site').rglob('*')]
        self.assertEqual(server_side, {'log/data/'})
        for pattern in patterns:
            with self.subTest(pattern=pattern):
                self.assertTrue(pattern in server_side or
                                any(export.matches(entry, pattern) for entry in entries),
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
