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
from unittest.mock import patch

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
SERVER_WRITTEN = "live/now.json"
FILTER_BASIC = "drafts/\nlive/\nlog/data/\n# server-side: live/\n# server-side: log/data/\n# seed-exclude: log/data/\n"
FILTER_WITH_RULE = ("drafts/\nlive/\nlog/data/\n" + HERO_TEST + "\n"
                    "# server-side: live/\n# server-side: log/data/\n# seed-exclude: log/data/\n"
                    "# not-deployed: log/draft.html\nlog/draft.html\n")

# the decoder's path shape, with an invented version segment
DECODER = "/cdn-cgi/scripts/0a1b2c3d/cloudflare-static/email-decode.min.js"
DECODER_TAG = f'<script data-cfasync="false" src="{DECODER}"></script>\n'
CONTACT_SEED = f'<p>write to <a class="mail" href="mailto:{ADDRESS}">{ADDRESS}</a>.</p>\n'
CONTACT_LIVE = (
    '<p>write to <a class="mail" href="/cdn-cgi/l/email-protection#' + PAYLOAD + '">'
    '<span class="__cf_email__" data-cfemail="' + PAYLOAD + '">[protected]</span></a>.</p>\n'
    + DECODER_TAG
)
BEACON = "https://analytics-fixture.invalid/beacon.min.js/v1"
CHART_LIVE = f'<p>chart</p>\n<script defer src="{BEACON}" data-fixture="1"></script>\n'
TAMPERED_LIVE = '<p>changed words</p>\n' + DECODER_TAG


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    files = {}
    queries = []
    statuses = {}

    def do_GET(self):
        path, _, query = self.path.partition("?")
        FixtureHandler.queries.append((path.lstrip("/"), query))
        status = FixtureHandler.statuses.get(path.lstrip("/"))
        if status is not None:
            self.send_response(status)
            self.end_headers()
            return
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
            SERVER_WRITTEN: '{"written": "at seed time"}\n',
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
        (self.root / "site-exclusions.txt").write_text(FILTER_BASIC, encoding="utf-8")
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
            # the server rewrites this file after every deploy, so it never equals the seed
            SERVER_WRITTEN: ([], b'{"written": "by the server"}\n'),
        }
        FixtureHandler.queries = []
        FixtureHandler.statuses = {}
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
            "chart.html": "injected-script",
            "contact.html": "email-rewrite",
            "drafts/internal.html": "excluded",
            "gone.html": "missing",
            "index.html": "equal",
            "media/hero.jpg": "equal",
            "old.htm": "equal",
            SERVER_WRITTEN: "server-side",
            "tampered.html": "differs",
        })
        self.assertEqual(document["findings"], 4)  # hero, gone, tampered, the injected chart script
        self.assertEqual(code, 1)

    def test_additions_are_listed_and_values_are_never_printed(self):
        _, document = self.run_live_json()
        rows = {row["path"]: row for row in document["rows"]}
        self.assertEqual(rows["contact.html"]["scripts"], [["email-decoder", DECODER]])
        self.assertEqual(rows["contact.html"]["addresses_decoded"], 1)
        self.assertEqual(rows["contact.html"]["headers"], {"nel": 1, "report-to": 1})
        self.assertEqual(rows["chart.html"]["scripts"], [["foreign", BEACON]])
        self.assertEqual(rows["index.html"]["headers"], {})
        _, text = self.run_live()
        self.assertIn("header nel: 1", text)
        self.assertIn("header report-to: 1", text)
        self.assertIn("injected foreign script: " + BEACON, text)
        self.assertIn("the live page carries a script the deploy did not send", text)
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

    def test_a_server_written_path_is_named_and_is_not_a_finding(self):
        code, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == SERVER_WRITTEN)
        self.assertEqual(row["class"], "server-side")
        self.assertEqual(row["note"], "deployment leaves it out; the server writes it")
        self.assertEqual(document["findings"], 4)  # hero, gone, tampered, chart
        # Before the server first writes it, the path is simply absent.
        del FixtureHandler.files[SERVER_WRITTEN]
        _, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == SERVER_WRITTEN)
        self.assertEqual(row["class"], "excluded")
        # Without the marker, the same served path is what it was before: a finding.
        FixtureHandler.files[SERVER_WRITTEN] = ([], b'{"written": "by the server"}\n')
        (self.root / "site-exclusions.txt").write_text("drafts/\nlive/\nlog/data/\n# server-side: log/data/\n# seed-exclude: log/data/\n",
                                                    encoding="utf-8")
        code, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == SERVER_WRITTEN)
        self.assertEqual(row["class"], "served")
        self.assertEqual(document["findings"], 5)
        self.assertEqual(code, 1)

    def test_a_server_error_is_a_finding_whether_or_not_the_path_is_filtered(self):
        FixtureHandler.statuses = {"old.htm": 503, "drafts/internal.html": 500}
        code, document = self.run_live_json()
        rows = {row["path"]: row for row in document["rows"]}
        self.assertEqual(rows["old.htm"]["class"], "error")
        self.assertEqual(rows["drafts/internal.html"]["class"], "error")
        self.assertEqual(document["findings"], 6)  # hero, gone, tampered, chart and the two errors
        self.assertEqual(code, 1)

    def test_the_deploy_filter_rule_closes_the_deployment_gap(self):
        code, document = self.run_live_json()
        self.assertEqual(next(row for row in document["rows"] if row["path"] == HERO_TEST)["class"], "missing")
        (self.root / "site-exclusions.txt").write_text(FILTER_WITH_RULE, encoding="utf-8")
        code, document = self.run_live_json()
        self.assertEqual(next(row for row in document["rows"] if row["path"] == HERO_TEST)["class"], "excluded")
        self.assertEqual(document["findings"], 3)  # gone, tampered and chart remain
        self.assertEqual(code, 1)

    def test_an_injected_script_is_a_finding_even_when_the_page_otherwise_equals_the_seed(self):
        FixtureHandler.files = {"chart.html": ([], CHART_LIVE.encode("utf-8"))}
        code, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == "chart.html")
        self.assertEqual(row["class"], "injected-script")
        self.assertEqual(row["note"], "the live page carries a script the deploy did not send")
        # Without the script the same page is equal and no finding.
        FixtureHandler.files = {"chart.html": ([], self.seed_bytes["chart.html"])}
        _, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == "chart.html")
        self.assertEqual(row["class"], "equal")

    def test_only_the_decoder_at_its_exact_path_is_excused(self):
        lookalikes = {
            "a shorter path under the network's prefix":
                ("cdn-cgi", '<script src="/cdn-cgi/scripts/email-decode.min.js"></script>\n'),
            "another script at the decoder's place":
                ("cdn-cgi", '<script src="/cdn-cgi/scripts/0a1b2c3d/cloudflare-static/other.min.js"></script>\n'),
            "the decoder's path with a query":
                ("cdn-cgi", f'<script src="{DECODER}?v=2"></script>\n'),
            "the decoder's tag with a body":
                ("cdn-cgi", f'<script src="{DECODER}">run()</script>\n'),
            "the decoder's path on another host":
                ("foreign", f'<script src="https://cdn-fixture.invalid{DECODER}"></script>\n'),
            "a host without a scheme":
                ("foreign", '<script src="//analytics-fixture.invalid/pixel.js"></script>\n'),
        }
        for name, (kind, tag) in lookalikes.items():
            with self.subTest(name):
                live = CONTACT_LIVE.replace(DECODER_TAG, tag)
                FixtureHandler.files["contact.html"] = ([], live.encode("utf-8"))
                code, document = self.run_live_json()
                row = next(row for row in document["rows"] if row["path"] == "contact.html")
                self.assertEqual(row["class"], "injected-script")
                self.assertEqual([script[0] for script in row["scripts"]], [kind])
                self.assertEqual(code, 1)
        # The decoder itself, on the site's own host by its full address, stays excused.
        origin = self.base.split("//", 1)[1]
        live = CONTACT_LIVE.replace(f'src="{DECODER}"', f'src="http://{origin}{DECODER}"')
        FixtureHandler.files["contact.html"] = ([], live.encode("utf-8"))
        _, document = self.run_live_json()
        row = next(row for row in document["rows"] if row["path"] == "contact.html")
        self.assertEqual(row["class"], "email-rewrite")

    def test_encoded_addresses_round_trip(self):
        self.assertEqual(check_live.decode_address(PAYLOAD), ADDRESS)
        with self.assertRaises(ValueError):
            check_live.decode_address("")

    def test_real_seed_omissions_do_not_excuse_a_served_live_readme(self):
        root = Path(self.temporary.name) / "production-shape"
        live = root / "site/airships/data/live"
        live.mkdir(parents=True)
        (live / "README.md").write_text("Development documentation")
        for name in ("fires", "heat", "perims"):
            (live / f"{name}.json").write_text('{"server": true}')
        (root / "site-exclusions.txt").write_text(
            (TOOLS.parent / "site-exclusions.txt").read_text())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_seed.main(["--repo", str(root), "--write"]), 0)
        with patch.object(check_live, "fetch", return_value=(200, {}, b"Development documentation")) as fetch:
            rows = check_live.walk("http://fixture.invalid", root, "site-seed.json",
                                   "site-exclusions.txt", 1)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual([(row["path"], row["class"]) for row in rows],
                         [("airships/data/live/README.md", "served")])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_live.report(rows, True), 1)

    def test_a_base_without_scheme_is_refused(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_live.main(["--base", "127.0.0.1:1", "--repo", str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("BASE", err.getvalue())


if __name__ == "__main__":
    unittest.main()
