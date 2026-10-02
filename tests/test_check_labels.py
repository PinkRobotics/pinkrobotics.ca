"""Geometry controls for the estimate; no font rendering is claimed."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('labels', ROOT / 'tools/check_labels.py')
labels = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(labels)


class LabelTests(unittest.TestCase):
    def test_overlap_and_touching_controls(self):
        overlap = (ROOT / 'fixtures/labels/overlap.html').read_text()
        apart = (ROOT / 'fixtures/labels/apart.html').read_text()
        self.assertEqual(labels.inspect_svg(overlap)[1], [
            "OVERLAP 3.7 x 10.0 units: label 1 'ABCD' / label 2 'EFGH'"])
        self.assertEqual(labels.inspect_svg(apart), (2, []))

    def test_viewbox_origin_translation_anchor_and_spacing(self):
        svg = '<svg viewBox="10 10 100 40"><g transform="translate(10,10)" font-size="10"><text x="20" y="20" text-anchor="middle" letter-spacing=".1em">AB</text></g></svg>'
        self.assertEqual(labels.inspect_svg(svg), (1, []))
        for coordinate in ('x="0"', 'x="120"', 'y="0"', 'y="60"'):
            svg = '<svg viewBox="10 10 100 40"><text font-size="10" ' + coordinate + '>AB</text></svg>'
            self.assertIn('OUTSIDE', labels.inspect_svg(svg)[1][0])

    def test_unsupported_geometry_does_not_pass(self):
        with self.assertRaises(ValueError):
            labels.inspect_svg('<svg viewBox="0 0 100 100"><text transform="rotate(45)">AB</text></svg>')
