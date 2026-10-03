"""The live comparison: a loopback fixture plays the content network. Values are synthetic."""
import contextlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest

import check_live
import check_seed

TOOLS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("export_for_live", TOOLS / "export.py")
export = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export)

# invented values only; the address is assembled so no scanner sees a literal one
ADDRESS = "crew" + "@" + "example.invalid"
PAYLOAD = check_live.encode_key(ADDRESS)
NEL_VALUE = "fixture-nel-endpoint.invalid"
REPORT_TO_VALUE = "fixture-report-endpoint.invalid"
HERO_TEST = "airships/ship/_hero_test.html"
FILTER_BASIC = "drafts/\nlog/data/\n# server-side: log/data/\n"
FILTER_WITH_RULE = ("drafts/\nlog/data/\n" + HERO_TEST + "\n"
                    "# server-side: log/data/\n"
                    "# not-deployed: log/draft.html\nlog/draft.html\n")

CONTACT_SEED = f'<p>write to <a class="mail" href="mailto:{ADDRESS}">{ADDRESS}</a>.</p>\n'
CONTACT_LIVE = (
    '<p>write to <a class="mail" href="/cdn-cgi/l/email-protection#' + PAYLOAD + '">'
    '<span class="__cf_email__" data-cfemail="' + PAYLOAD + '">[protected]</span></a>.</p>\n'
    '<script src="/cdn-cgi/scripts/email-decode.min.js"></script>\n'
)
CHART_LIVE = '<p>chart</p>\n<script src="https://analytics-fixture.invalid/pixel.js"></script>\n'
TAMPERED_LIVE = ('<p>changed words</p>\n'
                 '<script src="/cdn-cgi/scripts/email-decode.min.js"></script>\n')


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    files = {}
    queries = []

    def do_GET(self):
        path, _, query = self.path.partition("?")
        FixtureHandler.queries.append((path.lstrip("/"), query))
        entry = FixtureHandler.files.get(path.lstrip("/"))
        if entry is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        for name, value in entry[0]:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(entry[1])))
        self.end_headers()
        self.wfile.write(entry[1])

    def log_message(self, *args):
        pass


class LiveCheckTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ.get("TMPDIR") or TOOLS.parent / ".scratch")
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="live-test-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        pages = {
            "index.html": "<!doctype html>\n<title>fixture</title>\n<p>home</p>\n",
            "contact.html": CONTACT_SEED,
            "chart.html": "<p>chart</p>\n",
            "tampered.html": "<p>original words</p>\n",
            "old.htm": "<p>old page</p>\n",
            "gone.html": "<p>gone</p>\n",
            "drafts/internal.html": "<p>draft</p>\n",
            HERO_TEST: "<p>hero test</p>\n",
        }
        for name, text in pages.items():
            page = self.root / "site" / name
            page.parent.mkdir(parents=True, exist_ok=True)
            page.write_text(text, encoding="utf-8")
        media = self.root / "site/media/hero.jpg"
        media.parent.mkdir(parents=True)
        media.write_bytes(b"\xff\xd8fixture-bytes")
        (self.root / "site/log/data").mkdir(parents=True)
        (self.root / "site/log/data/activity.json").write_text('{"generated": true}', encoding="utf-8")
        (self.root / "deploy-filter.txt").write_text(FILTER_BASIC, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_seed.main(["--repo", str(self.root), "--write"]), 0)
        self.seed_bytes = {name: (self.root / "site" / name).read_bytes() for name in pages}
        self.seed_bytes["media/hero.jpg"] = media.read_bytes()
        FixtureHandler.files = {
            "index.html": ([], self.seed_bytes["index.html"]),
            "contact.html": ([("nel", NEL_VALUE), ("report-to", REPORT_TO_VALUE)],
                             CONTACT_LIVE.encode("utf-8")),
            "chart.html": ([], CHART_LIVE.encode("utf-8")),
            "tampered.html": ([], TAMPERED_LIVE.encode("utf-8")),
            "old.htm": ([], self.seed_bytes["old.htm"]),
            "media/hero.jpg": ([], self.seed_bytes["media/hero.jpg"]),
        }
        FixtureHandler.queries = []
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        self.addCleanup(self.server.server_close)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def run_live(self, *extra):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_live.main(["--base", self.base, "--repo", str(self.root), *extra])
        return code, out.getvalue() + err.getvalue()

    def run_live_json(self):
        code, text = self.run_live("--json")
        return code, json.loads(text)

    def test_every_class_is_reported(self):
        code, document = self.run_live_json()
        classes = {row["path"]: row["class"] for row in document["rows"]}
        self.assertEqual(classes, {
            HERO_TEST: "missing",          # the deployment leaves it out (gap f, before the fix)
            "chart.html": "script-only",
            "contact.html": "email-rewrite",
            "drafts/internal.html": "excluded",
            "gone.html": "missing",
            "index.html": "equal",
            "media/hero.jpg": "equal",
            "old.htm": "equal",
            "tampered.html": "differs",
        })
        self.assertEqual(document["findings"], 3)  # hero, gone, tampered
        self.assertEqual(code, 1)

    def test_additions_are_listed_and_values_are_never_printed(self):
        _, document = self.run_live_json()
        rows = {row["path"]: row for row in document["rows"]}
        self.assertEqual(rows["contact.html"]["scripts"],
                         [["cdn-cgi", "/cdn-cgi/scripts/email-decode.min.js"]])
        self.assertEqual(rows["contact.html"]["addresses_decoded"], 1)
        self.assertEqual(rows["contact.html"]["headers"], {"nel": 1, "report-to": 1})
        self.assertEqual(rows["chart.html"]["scripts"],
                         [["foreign", "https://analytics-fixture.invalid/pixel.js"]])
        self.assertEqual(rows["index.html"]["headers"], {})
        _, text = self.run_live()
        self.assertIn("header nel: 1", text)
        self.assertIn("header report-to: 1", text)
        self.assertIn("injected foreign script: https://analytics-fixture.invalid/pixel.js", text)
        for never in (ADDRESS, NEL_VALUE, REPORT_TO_VALUE, "mailto:"):
            self.assertNotIn(never, text)

    def test_every_fetch_carries_the_same_cache_busting_nonce(self):
        self.run_live()
        # one request per manifest row, each with the run's single nonce
        self.assertEqual(len(FixtureHandler.queries), len(self.seed_bytes))
        nonces = {query for _, query in FixtureHandler.queries}
        self.assertEqual(len(nonces), 1)
        self.assertTrue(nonces.pop().startswith("livecheck="))

    def test_a_filtered_path_that_serves_is_a_finding(self):
        FixtureHandler.files["drafts/internal.html"] = ([], self.seed_bytes["drafts/internal.html"])
        code, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == "drafts/internal.html")
        self.assertEqual(row["class"], "served")
        self.assertEqual(code, 1)

    def test_the_deploy_filter_rule_closes_the_deployment_gap(self):
        code, document = self.run_live_json()
        self.assertEqual(next(row for row in document["rows"] if row["path"] == HERO_TEST)["class"], "missing")
        (self.root / "deploy-filter.txt").write_text(FILTER_WITH_RULE, encoding="utf-8")
        code, document = self.run_live_json()
        self.assertEqual(next(row for row in document["rows"] if row["path"] == HERO_TEST)["class"], "excluded")
        self.assertEqual(document["findings"], 2)  # gone and tampered remain
        self.assertEqual(code, 1)

    def test_encoded_addresses_round_trip(self):
        self.assertEqual(check_live.decode_address(PAYLOAD), ADDRESS)
        with self.assertRaises(ValueError):
            check_live.decode_address("")

    def test_a_base_without_scheme_is_refused(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_live.main(["--base", "127.0.0.1:1", "--repo", str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("BASE", err.getvalue())


if __name__ == "__main__":
    unittest.main()
