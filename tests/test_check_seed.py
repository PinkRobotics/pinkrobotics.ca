"""The seed manifest holds site/ to an exact recorded tree; values are synthetic."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "check_seed", Path(__file__).resolve().parents[1] / "tools" / "check_seed.py")
seed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seed)


class SeedTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ.get("TMPDIR") or Path(__file__).resolve().parents[1] / ".scratch")
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="seed-test-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        (self.root / "site/animals").mkdir(parents=True)
        (self.root / "site/index.html").write_text("<p>fixture page</p>\n", encoding="utf-8")
        (self.root / "site/animals/index.html").write_text("<p>fixture animal</p>\n", encoding="utf-8")
        (self.root / "site/media").mkdir()
        (self.root / "site/media/hero.jpg").write_bytes(b"\xff\xd8fixture-bytes")
        # Generated work-log data: on disk, never part of the recorded seed.
        (self.root / "site/log/data").mkdir(parents=True)
        (self.root / "site/log/data/activity.json").write_text('{"generated": true}', encoding="utf-8")

    def run_seed(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = seed.main(["--repo", str(self.root), *args])
        return code, out.getvalue() + err.getvalue()

    def recorded(self):
        self.assertEqual(self.run_seed("--write")[0], 0)
        return json.loads((self.root / seed.MANIFEST).read_text(encoding="utf-8"))

    def test_write_records_every_file_except_generated_data(self):
        document = self.recorded()
        self.assertEqual(document["schema"], "pinkrobotics.site-seed/1")
        self.assertEqual([row["path"] for row in document["files"]],
                         ["animals/index.html", "index.html", "media/hero.jpg"])
        self.assertEqual(document["count"], 3)
        self.assertNotIn("log/data/activity.json", json.dumps(document))
        self.assertEqual(self.run_seed("--check")[0], 0)

    def test_added_file_is_refused_and_named(self):
        self.recorded()
        (self.root / "site/airships").mkdir(parents=True)
        (self.root / "site/airships/new-page.html").write_text("<p>new</p>\n", encoding="utf-8")
        code, output = self.run_seed("--check")
        self.assertEqual(code, 1)
        self.assertIn("site/airships/new-page.html: file added", output)

    def test_removed_file_is_refused_and_named(self):
        self.recorded()
        (self.root / "site/media/hero.jpg").unlink()
        code, output = self.run_seed("--check")
        self.assertEqual(code, 1)
        self.assertIn("site/media/hero.jpg: file in", output)
        self.assertIn("is missing from the seed", output)

    def test_one_changed_byte_is_refused_and_named(self):
        self.recorded()
        page = self.root / "site/index.html"
        page.write_text(page.read_text(encoding="utf-8") + "x", encoding="utf-8")
        code, output = self.run_seed("--check")
        self.assertEqual(code, 1)
        self.assertIn("site/index.html: file changed", output)

    def test_hand_edited_manifest_is_refused(self):
        for edit, complaint in (
            (lambda doc: doc["files"][0].update(sha256="0" * 64), "file changed"),
            (lambda doc: doc.update(count=9), "count does not match"),
            (lambda doc: doc.update(digest="0" * 64), "digest does not match"),
            (lambda doc: doc["files"].pop(), "file added to the seed"),
        ):
            with self.subTest(complaint=complaint):
                self.recorded()
                document = json.loads((self.root / seed.MANIFEST).read_text(encoding="utf-8"))
                edit(document)
                (self.root / seed.MANIFEST).write_text(json.dumps(document), encoding="utf-8")
                code, output = self.run_seed("--check")
                self.assertEqual(code, 1)
                self.assertIn(complaint, output)

    def test_unreadable_manifest_and_symlink_are_refused(self):
        self.assertEqual(self.run_seed("--check")[0], 2)
        self.recorded()
        (self.root / seed.MANIFEST).write_text("{not json", encoding="utf-8")
        self.assertEqual(self.run_seed("--check")[0], 2)
        self.recorded()
        (self.root / "site/link.html").symlink_to("index.html")
        code, output = self.run_seed("--check")
        self.assertEqual(code, 2)
        self.assertIn("symlink", output)

    def test_write_and_check_are_mutually_exclusive(self):
        for argv in (("--write", "--check"), ()):
            with self.subTest(argv=argv):
                out, err = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    with self.assertRaises(SystemExit) as stopped:
                        seed.main(["--repo", str(self.root), *argv])
                self.assertEqual(stopped.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
