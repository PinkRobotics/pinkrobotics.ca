"""Boundary regressions use constructed, synthetic values and isolated repositories."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zlib

SPEC = importlib.util.spec_from_file_location(
    "check_public", Path(__file__).resolve().parents[1] / "tools" / "check_public.py")
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        os.environ.pop("PUBLIC_DENY_FILE", None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def tracked(self, name, data):
        (self.root / name).write_bytes(data)
        subprocess.run(["git", "-C", str(self.root), "add", "--", name], check=True)

    def run_gate(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = gate.main(["--repo", str(self.root), "--json", *args])
        return code, json.loads(out.getvalue()), out.getvalue() + err.getvalue()

    def test_shebang_is_not_a_local_path(self):
        interpreter = "/" + "usr/bin/env"
        self.tracked("program.py", ("#!" + interpreter + " python3\n").encode())
        self.assertEqual(self.run_gate()[0], 0)
        (self.root / "program.py").write_text("#!" + interpreter + " python3\n# " + interpreter)
        self.assertEqual(self.run_gate()[0], 1)

    def test_pending_is_listed_and_expires_with_its_match(self):
        value = "/" + "home" + "/fictional/private"
        self.tracked("sample.txt", value.encode())
        self.policy("/" + "home" + "/fictional", rule="home-path")
        path = self.root / gate.POLICY
        doc = json.loads(path.read_text())
        doc["exceptions"][0].update(pending=True, date="2026-10-02")
        path.write_text(json.dumps(doc))
        code, result, _ = self.run_gate()
        self.assertEqual(code, 0)
        self.assertEqual(len(result["pending"]), 1)
        (self.root / "sample.txt").write_text(value + " " + value)
        self.assertEqual(self.run_gate()[0], 2)
        (self.root / "sample.txt").write_text("fixed")
        self.assertEqual(self.run_gate()[0], 2)

    def test_withheld_reference_is_refused(self):
        self.tracked("private.md", ("/" + "home" + "/fictional/private").encode())
        (self.root / "tools").mkdir()
        (self.root / gate.POLICY).write_text(json.dumps({"exceptions": [], "withheld": [
            {"path": "private.md", "reason": "Local instructions."},
            {"path": "internal/", "reason": "Local records."}]}))
        code, result, _ = self.run_gate()
        self.assertEqual(code, 0)
        self.assertEqual(len(result["withheld"]), 2)
        for reference in ("private.md", "private.md.", "internal/record.md"):
            self.tracked("README.md", ("Read [instructions](" + reference + ")").encode())
            code, result, _ = self.run_gate()
            self.assertEqual(code, 1)
            self.assertEqual(result["findings"][0]["rule"], "withheld-reference")
        (self.root / "README.md").write_text("Public instructions.")
        self.assertEqual(self.run_gate()[0], 0)

    def test_values_never_printed_and_no_secret_file_exemption(self):
        value = "gh" + "p_" + "A7b9" * 10
        self.tracked("sample.txt", value.encode())
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual(result["findings"][0]["rule"], "provider-token")
        self.assertNotIn(value, output)

    def test_working_tree_not_just_index(self):
        self.tracked("sample.txt", b"clean")
        (self.root / "sample.txt").write_text("/" + "home" + "/example/private")
        self.assertEqual(self.run_gate()[0], 1)

    def test_external_terms_optional_and_required_when_explicit(self):
        self.tracked("sample.txt", b"fictional-estate")
        self.assertEqual(self.run_gate()[0], 0)
        deny = self.root.parent / "deny.txt"
        deny.write_text("fictional-estate\n")
        code, result, output = self.run_gate("--private-deny-file", str(deny))
        self.assertEqual(code, 1)
        self.assertNotIn("fictional-estate", output)
        self.assertEqual(self.run_gate("--private-deny-file", str(deny)+"-missing")[0], 2)
        inside = self.root / "deny.txt"
        inside.write_text("fictional-estate")
        self.assertEqual(self.run_gate("--private-deny-file", str(inside))[0], 2)

    def policy(self, value, *, count=1, name="sample.txt", rule="email"):
        (self.root / "tools").mkdir(exist_ok=True)
        row = {"path": name, "rule": rule, "representation": "bytes",
               "match_sha256": hashlib.sha256(value.encode()).hexdigest(), "count": count,
               "reason": "Synthetic fixture approved only for this exact match."}
        (self.root / gate.POLICY).write_text(json.dumps({"exceptions": [row]}))

    def private_policy_fixture(self, *, pending=False):
        value = "fictional-orchard"
        self.tracked("sample.txt", value.encode())
        deny = self.root.parent / "deny.txt"
        deny.write_text(value + "\n")
        self.policy(value, rule="private-name")
        if pending:
            path = self.root / gate.POLICY
            doc = json.loads(path.read_text())
            doc["exceptions"][0].update(pending=True, date="2026-10-02")
            path.write_text(json.dumps(doc))
        return value, deny

    def test_private_row_is_accepted_with_list_loaded(self):
        value, deny = self.private_policy_fixture()
        code, result, output = self.run_gate("--private-deny-file", str(deny))
        self.assertEqual(code, 0)
        self.assertTrue(result["private_deny_list"])
        self.assertEqual(result["accepted_findings"], 1)
        self.assertEqual(result["private_rows_not_evaluated"], [])
        self.assertNotIn(value, output)

    def test_private_rows_without_list_are_listed_and_not_evaluated(self):
        for pending in (False, True):
            with self.subTest(pending=pending):
                value, _ = self.private_policy_fixture(pending=pending)
                code, result, output = self.run_gate()
                self.assertEqual(code, 0)
                self.assertFalse(result["private_deny_list"])
                self.assertEqual(result["accepted_findings"], 0)
                self.assertEqual(result["private_rows_not_evaluated"], [
                    {"path": "sample.txt", "rule": "private-name", "count": 1}])
                self.assertNotIn(value, output)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = gate.main(["--repo", str(self.root)])
                self.assertEqual(code, 0)
                self.assertIn("PRIVATE-ROW sample.txt: private-name count=1 not evaluated", out.getvalue())
                self.assertIn("private-rows=1 not evaluated", out.getvalue().splitlines()[-1])
                # Only private-name count checks are skipped; generic rows still expire.
                self.policy("fixture", rule="email")
                self.assertEqual(self.run_gate()[0], 2)

    def test_private_row_with_extra_occurrence_fails_with_list_loaded(self):
        value, deny = self.private_policy_fixture()
        (self.root / "sample.txt").write_text(value + " " + value)
        code, result, output = self.run_gate("--private-deny-file", str(deny))
        self.assertEqual(code, 2)
        self.assertEqual(result["accepted_findings"], 0)
        self.assertEqual(len(result["findings"]), 2)
        self.assertEqual(result["errors"], [{"path": "sample.txt", "rule": "private-name",
                                          "error": "stale exception: match count differs"}])
        self.assertEqual(result["private_rows_not_evaluated"], [])
        self.assertNotIn(value, output)

    def test_exception_is_exact_and_does_not_allow_another_value(self):
        address = "person" + "@" + "example.invalid"
        self.tracked("sample.txt", address.encode())
        self.assertEqual(self.run_gate()[0], 1)
        self.policy(address)
        code, result, _ = self.run_gate()
        self.assertEqual(code, 0)
        self.assertEqual(result["accepted_findings"], 1)
        (self.root / "sample.txt").write_text(address + " other" + address)
        self.assertEqual(self.run_gate()[0], 1)

    def test_stale_and_duplicate_count_exceptions_fail(self):
        value = "person" + "@" + "example.invalid"
        self.tracked("sample.txt", value.encode())
        self.policy(value)
        (self.root / "sample.txt").write_text("clean")
        self.assertEqual(self.run_gate()[0], 2)
        (self.root / "sample.txt").write_text(value + " " + value)
        self.assertEqual(self.run_gate()[0], 2)
        self.policy(value, count=2)
        self.assertEqual(self.run_gate()[0], 0)

    def test_wildcard_exception_rejected(self):
        self.tracked("sample.txt", b"clean")
        self.policy("fixture", name="*.txt")
        self.assertEqual(self.run_gate()[0], 2)

    def test_binary_and_utf16_values(self):
        value = "/" + "Users" + "/synthetic/private"
        self.tracked("binary.bin", b"\0prefix" + value.encode() + b"\0")
        self.tracked("wide.txt", value.encode("utf-16-le"))
        code, result, _ = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual({f["path"] for f in result["findings"]}, {"binary.bin", "wide.txt"})

    def test_network_rules_and_local_examples(self):
        for text in ["10" + ".2.3.4", "172" + ".31.2.3", "192" + ".168.1.4",
                     "fd12" + ":3456::1", "fe80" + "::1", "seat" + ".internal"]:
            self.assertTrue(list(gate.matches(text)), text)
        for text in ["127" + ".0.0.1", "::1", "192" + ".0.2.4", "pathlib.Path.home()"]:
            self.assertFalse(list(gate.matches(text)), text)

    def test_working_tree_deletion_and_bad_pdf(self):
        self.tracked("sample.txt", b"clean")
        (self.root / "sample.txt").unlink()
        self.assertEqual(self.run_gate()[0], 0)
        (self.root / "sample.txt").write_bytes(b"%PDF-broken")
        self.assertEqual(self.run_gate()[0], 2)

    def test_symlink_not_followed(self):
        outside = self.root.parent / "outside"
        outside.write_text("gh" + "p_" + "a7B9" * 10)
        (self.root / "link").symlink_to("../outside")
        subprocess.run(["git", "-C", str(self.root), "add", "link"], check=True)
        self.assertEqual(self.run_gate()[0], 0)

    def test_documented_auth_pair_is_detected(self):
        text = "basic auth " + "synthetic" + "/" + "fixture-password"
        self.tracked("note.md", text.encode())
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual(result["findings"][0]["rule"], "documented-basic-auth")
        self.assertNotIn(text, output)

    def test_secret_filename_and_overlapping_terms_are_redacted(self):
        token = "gh" + "p_" + "a7B9" * 10
        self.tracked(token + ".txt", b"clean")
        deny = self.root.parent / "deny.txt"
        deny.write_text(token[10:22])
        code, _, output = self.run_gate("--private-deny-file", str(deny))
        self.assertEqual(code, 1)
        self.assertNotIn(token, output)
        self.assertNotIn(token[10:22], output)

    def test_json_escaped_windows_path(self):
        path = "C:" + "\\" + "Users" + "\\" + "synthetic"
        self.tracked("settings.json", json.dumps({"path": path}).encode())
        self.assertEqual(self.run_gate()[0], 1)

    def test_every_generic_rule_goes_red_in_a_real_file(self):
        examples = {
            "family-link": '<span class="' + 'doms"><a href="https://example.invalid">Family</a></span>',
            "home-path": "/" + "home" + "/fictional/project",
            "absolute-local-path": "/" + "mnt" + "/fictional/project",
            "email": "fixture" + "@" + "example.invalid",
            "private-host": "fixture" + ".internal",
            "private-key": "-----BEGIN " + "PRIVATE KEY-----",
            "provider-token": "gh" + "p_" + "a7B9" * 10,
            "credential-assignment": 'api_key="' + "a7B9" * 10 + '"',
            "credential-url": "https://" + "fixture:password" + "@example.invalid",
            "documented-basic-auth": "basic auth " + "fixture" + "/password",
            "user-password-pair": "user: fixture, " + "password: synthetic",
            "session-agent-" + "id": "session_id: " + "abcd1234-1234-1234-1234-123456789012",
            "private-address": "10" + ".2.3.4",
            "seat-id": "lead-" + "fictional-r-010203",
            "subscription-pool": "lead-" + "fictional-primary",
            "record-path": "lead-" + "fictional/transcript.json",
        }
        self.assertEqual(set(examples), gate.RULES - {"private-name"})
        self.tracked("sample.txt", b"clean")
        for rule, value in examples.items():
            with self.subTest(rule=rule):
                (self.root / "sample.txt").write_text(value)
                code, result, output = self.run_gate()
                self.assertEqual(code, 1)
                self.assertIn(rule, {f["rule"] for f in result["findings"]})
                self.assertNotIn(value, output)

    def test_user_password_prose_variants(self):
        for value in ["username = `demo`; " + "password = `synthetic`",
                      'user="demo" and ' + 'password="synthetic"',
                      "user is demo, " + "password is synthetic",
                      "user `demo`, " + "password `synthetic`"]:
            self.assertIn("user-password-pair", {m[0] for m in gate.matches(value)})

    def test_json_session_identifier(self):
        self.tracked("session.json", json.dumps({"session_id": "a123" + "4567-1234-1234-1234-123456789012"}).encode())
        code, result, _ = self.run_gate()
        self.assertEqual(code, 1)
        self.assertIn("session-agent-id", {f["rule"] for f in result["findings"]})

    def test_public_url_is_not_windows_path(self):
        self.assertFalse(list(gate.matches("https://example.invalid/paper")))

    def test_environment_list_reports_actual_load(self):
        self.tracked("sample.txt", b"clean")
        os.environ["PUBLIC_DENY_FILE"] = str(self.root.parent / "missing")
        code, result, _ = self.run_gate()
        self.assertEqual(code, 2)
        self.assertFalse(result["private_deny_list"])
        deny = self.root.parent / "deny"
        deny.write_text("fictional-estate")
        os.environ["PUBLIC_DENY_FILE"] = str(deny)
        code, result, _ = self.run_gate()
        self.assertEqual(code, 0)
        self.assertTrue(result["private_deny_list"])

    def test_new_untracked_file_scanned_when_requested(self):
        value = "gh" + "p_" + "a7B9" * 10
        (self.root / "new.txt").write_text(value)
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual(self.run_gate("--include-untracked")[0], 1)

    def test_unreadable_file_fails_closed(self):
        self.tracked("sample.txt", b"clean")
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.assertEqual(self.run_gate()[0], 2)

    def test_symlink_directory_is_not_traversed(self):
        (self.root / "folder").mkdir()
        self.tracked("folder/file.txt", b"clean")
        (self.root / "folder/file.txt").unlink()
        (self.root / "folder").rmdir()
        outside = self.root.parent / "outside"
        outside.mkdir()
        (outside / "file.txt").write_text("external data")
        (self.root / "folder").symlink_to(outside)
        self.assertEqual(self.run_gate()[0], 2)

    def test_compressed_pdf_text_is_checked(self):
        value = "fixture" + "@" + "example.invalid"
        stream = zlib.compress(f"BT /F1 12 Tf 10 20 Td ({value}) Tj ET".encode())
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
                   b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                   b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
                   b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                   f"<< /Filter /FlateDecode /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"]
        data = b"%PDF-1.4\n"
        offsets = []
        for i, obj in enumerate(objects, 1):
            offsets.append(len(data))
            data += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
        xref = len(data)
        data += b"xref\n0 6\n0000000000 65535 f \n"
        data += b"".join(f"{n:010} 00000 n \n".encode() for n in offsets)
        data += f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        self.tracked("paper.pdf", data)
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        self.assertIn("pdf-text", {f["representation"] for f in result["findings"]})
        self.assertNotIn(value, output)
        # UTF-16 metadata/comment bytes must be checked even when extraction omits them.
        private = "/" + "home" + "/fictional/project"
        prefix = data + b"% "
        prefix += b" " * (len(prefix) % 2)
        (self.root / "paper.pdf").write_bytes(prefix + private.encode("utf-16-le") + b"\n")
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        self.assertTrue(any(f["rule"] == "home-path" and f["representation"].startswith("utf")
                            for f in result["findings"]))
        self.assertNotIn(private, output)


class RecordShapeTests(unittest.TestCase):
    """The private record's own identifier shapes, applied to every scanned file.

    The shapes come from the work log's boundary module; a seat-shaped name in any
    tracked file is a leak of the private operating record, not a work-log data issue.
    """

    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        os.environ.pop("PUBLIC_DENY_FILE", None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def tracked(self, name, data):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        subprocess.run(["git", "-C", str(self.root), "add", "--", name], check=True)

    def run_gate(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = gate.main(["--repo", str(self.root), "--json", *args])
        return code, json.loads(out.getvalue()), out.getvalue() + err.getvalue()

    # Invented values, shaped like the record but never a name seen anywhere else.
    PLANTS = {
        "seat": ("lead-" + "fictional-r-010203", "seat-id"),
        "pool": ("lead-" + "fictional-primary", "subscription-pool"),
        "order": ("wo-" + "fictional-0102", "seat-id"),
        "record": ("lead-" + "fictional/transcript.json", "record-path"),
    }
    LOCATIONS = {
        "readme": ("README.md", "Guided by %s in the log.\n"),
        "page": ("site/animals/index.html", "<p>Built by %s today.</p>\n"),
        "fixture": ("fixtures/activity/lanes.json", '{"note": "guided by %s"}\n'),
    }

    def test_each_shape_is_refused_in_each_kind_of_file(self):
        for shape, (value, rule) in self.PLANTS.items():
            for where, (name, template) in self.LOCATIONS.items():
                with self.subTest(shape=shape, where=where):
                    # One planted file at a time: unlink the other locations so each
                    # subtest proves its own file turns the gate red on its own.
                    for other in self.LOCATIONS.values():
                        target = self.root / other[0]
                        if target.exists():
                            target.unlink()
                    self.tracked(name, (template % value).encode())
                    code, result, output = self.run_gate()
                    self.assertEqual(code, 1)
                    finding = next(f for f in result["findings"] if f["rule"] == rule)
                    self.assertEqual(finding["path"], name)
                    self.assertNotIn(value, output)

    def test_pool_shape_ignores_style_names_but_not_bare_identifiers(self):
        styles = ('<a class="btn-primary" id="nav-secondary">pair</a>\n'
                  '<style>.btn-primary{top:0} #nav-secondary{top:1}</style>\n'
                  ':root{--accent-secondary:#fff}\n'
                  'a.btn-primary:hover{color:red}\n')
        self.tracked("site/animals/index.html", styles.encode())
        self.assertEqual(self.run_gate()[0], 0)
        self.tracked("site/animals/index.html", (styles + "<p>pool lead-"
                     + "fictional-primary</p>\n").encode())
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual({f["rule"] for f in result["findings"]}, {"subscription-pool"})
        self.assertNotIn("fictional-primary", output)

    def test_style_positions_are_excused_only_in_page_and_style_files(self):
        pool = "fictional-" + "primary"
        prose = f"See .{pool}, #{pool} and --{pool} in the notes.\n"
        self.tracked("README.md", prose.encode())
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        found = [f for f in result["findings"] if f["rule"] == "subscription-pool"]
        self.assertEqual([f["path"] for f in found], ["README.md"] * 3)
        self.assertNotIn(pool, output)
        # The same text in a page names styles, and passes.
        (self.root / "README.md").unlink()
        self.tracked("site/notes/index.html", prose.encode())
        self.assertEqual(self.run_gate()[0], 0)
        # A file name is never a style position, whatever its extension.
        self.tracked(f"site/notes/a.{pool}.html", b"<p>clean</p>\n")
        code, result, output = self.run_gate()
        self.assertEqual(code, 1)
        finding = next(f for f in result["findings"] if f["rule"] == "subscription-pool")
        self.assertEqual(finding["representation"], "path")
        self.assertNotIn(pool, output)

    def test_a_listed_name_is_refused_in_every_style_position(self):
        # The excuse narrows the pool shape; a name on the private list stays red there.
        pool = "fictional-" + "max9x"
        page = (f'<a class="{pool}">pair</a>\n'
                f'<style>.{pool}{{top:0}} :root{{--{pool}:#fff}}</style>\n'
                f'<p>served from host.{pool}</p>\n')
        self.tracked("site/notes/index.html", page.encode())
        # Without the list every one of the four is a style position, and passes.
        self.assertEqual(self.run_gate()[0], 0)
        deny = self.root.parent / "deny.txt"
        deny.write_text(pool + "\n")
        code, result, output = self.run_gate("--private-deny-file", str(deny))
        self.assertEqual(code, 1)
        self.assertEqual([f["rule"] for f in result["findings"]], ["private-name"] * 4)
        self.assertEqual([f["line"] for f in result["findings"]], [1, 2, 2, 3])
        self.assertNotIn(pool, output)

    def test_landing_record_sections_stay_green_and_a_seat_name_stays_red(self):
        record = Path(__file__).resolve().parents[1] / "docs/governance/landing-attestations.md"
        name = "docs/governance/landing-attestations.md"
        self.tracked(name, record.read_bytes())
        (self.root / "tools").mkdir()
        (self.root / gate.POLICY).write_text(json.dumps({"exceptions": [], "withheld": []}))
        self.assertEqual(self.run_gate()[0], 0)
        # The landing tool appends one such section after every landing, after the
        # candidate's gates have run: new numbers, the same kinds of identifier.
        section = ("\n## Landing 5 — The next section the landing tool writes\n\n"
                   "| field | value |\n|---|---|\n"
                   "| Landed | 2026-10-02 12:00:00 PDT by the landing tool (`ship/tools/land.py`), "
                   "a pure **FAST-FORWARD**: main `" + "c" * 40 + "` → `" + "d" * 40 + "`; NOT pushed. |\n"
                   "| The object | SIGNED `" + "d" * 40 + "`, tree `" + "e" * 40 + "`, "
                   "from `pr/next` (source checkout redacted), governance `gov-" + "0123456789ab"
                   + "` preserved. |\n"
                   "| Evidence before landing | `make check` rc=0: OK |\n")
        with (self.root / name).open("a") as stream:
            stream.write(section)
        self.assertEqual(self.run_gate()[0], 0)
        # A seat-shaped name outside those kinds still turns the file red.
        with (self.root / name).open("a") as stream:
            stream.write("\nDrafted with `" + self.PLANTS["seat"][0] + "` watching.\n")
        code, result, _ = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual(result["findings"][0]["rule"], "seat-id")

    def test_real_policy_pins_no_exact_counts_on_the_landing_record(self):
        """Exact counts on the landing record would turn main red after every landing."""
        policy = json.loads((Path(__file__).resolve().parents[1] / gate.POLICY).read_text())
        self.assertFalse([row for row in policy["exceptions"]
                          if row["path"] == "docs/governance/landing-attestations.md"])

    def test_landing_record_accepts_machine_paths_by_rule_and_nowhere_else(self):
        """A landing record prints the gate command as it ran, with this machine's paths."""
        name = "docs/governance/landing-attestations.md"
        (self.root / "docs" / "governance").mkdir(parents=True)
        (self.root / "tools").mkdir()
        (self.root / gate.POLICY).write_text(json.dumps({"exceptions": [], "withheld": []}))
        home, local = "/" + "home" + "/fictional", "/" + "mnt" + "/scratch/gate"
        section = ("| The object | SIGNED `" + "d" * 40 + "`, from `pr/next` in `" + home + "/t/next`. |\n"
                   "| Gate | store `" + home + "/data/verdicts.tsv` |\n"
                   "| Evidence before landing | `bash -c 'TMPDIR=" + local + " PUBLIC_DENY_FILE="
                   + home + "/deny.txt make check'` rc=0 |\n")
        self.tracked(name, section.encode())
        code, result, _ = self.run_gate()
        self.assertEqual((code, result["findings"], result["accepted_by_rule"]), (0, [], 4))
        # The same paths in any other file are findings, as before.
        self.tracked("notes.md", section.encode())
        code, result, _ = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual({(f["path"], f["rule"]) for f in result["findings"]},
                         {("notes.md", "home-path"), ("notes.md", "absolute-local-path")})
        (self.root / "notes.md").write_text("Public notes.")
        # Every other rule still applies inside the record.
        with (self.root / name).open("a") as stream:
            stream.write("Drafted with `" + self.PLANTS["seat"][0] + "` watching.\n")
        code, result, _ = self.run_gate()
        self.assertEqual(code, 1)
        self.assertEqual([f["rule"] for f in result["findings"]], ["seat-id"])


if __name__ == "__main__":
    unittest.main()
