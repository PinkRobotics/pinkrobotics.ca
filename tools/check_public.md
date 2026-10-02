# Public boundary gate

`make publiccheck` scans tracked working-tree files and untracked files that Git would add.
It includes filenames, symlink targets, raw bytes, UTF-16 text and extracted PDF text. It
never follows symlinks. Working-tree deletions are excluded, so an unstaged removal is part
of the proposed tree. Git-ignored untracked files, history and Git configuration are outside
this check. Forced additions are scanned even if their path is ignored.

Python 3.10+ and `pdftotext` are required. There is no network access. Run the gate tests with
`python3 -m unittest discover -s tests -p test_check_public.py -v` after setting `TMPDIR`.

Generic rules detect home paths, common absolute local filesystem paths, e-mail shapes,
private hosts and network addresses, private-key and provider-token shapes, credential
assignments and URLs, Basic Auth pairs, user/password prose and session/agent identifiers.
Loopback and documentation network ranges are allowed for local examples. Rules are
heuristics: arbitrary names, obfuscated credentials, archives and image-only text need review.
PDF extraction checks text, not OCR or encryption. Raw PDF metadata is also scanned.

The private operating record's own identifier shapes — seat names, subscription-pool
names, order and queue identifiers, and record paths — are imported from the work log's
boundary module (`tools/activity/boundary.py`), so the two gates share one definition.
Every tracked file is held to them, not only the work log's data. The work log's rule is
stricter where pages legitimately use the vocabulary: a hyphenated token ending in one of
the pool suffixes is refused in work-log data anywhere it appears, while this gate narrows
that one shape to positions that do not name a style — a token preceded by a class or id
selector mark or a custom-property prefix, a token carrying selector dot syntax, or a
token inside an HTML class/id attribute value is a style name, not a subscription pool.
Bare identifiers of that shape remain refused everywhere. Seat, order, queue and record-path
shapes are applied exactly as the boundary defines them, with no narrowing.

Private terms never belong in the repository. Set `PUBLIC_DENY_FILE` to an external UTF-8
file with one literal per line. Matching is case-insensitive; blank lines and comment lines
beginning with `#` are ignored. An explicitly configured list must be readable, nonempty and
outside the checkout. Output distinguishes `loaded`, `not configured` and `failed`.
Without a list, `private-name` policy rows are not evaluated. Each is printed as
`PRIVATE-ROW` with its path and count; the summary says `private-rows=N not evaluated`.
JSON lists these rows under `private_rows_not_evaluated`. They do not count as accepted
findings. All other rules and policy validation still apply. With the list loaded, these
rows are evaluated normally: a changed count or removed match fails as stale policy.
Generic-only success does not clear known private names. Release review uses the external list.

`tools/public-policy.json` is the only exception policy. Every entry names one exact
repository-relative path, rule, representation, SHA-256 of the matched text, expected
occurrence count and a sentence explaining why it is safe. A changed value, added occurrence
or removed match fails when its rule is evaluated. Paths cannot contain wildcards.
Names the owner has chosen to publish may have exact, reviewed exceptions. Private references
awaiting a source repair use pending rows; credentials and unexplained matches are never approved.
Digests avoid copying matched values into policy;
they identify reviewed text, and are not a way to make a secret safe to publish.

The CLI also supports `--repo`, `--include-untracked`, `--json`, and `--private-deny-file`.
Findings show path, line, rule and representation, with sensitive filename spans masked;
matched values are never printed. A `pdf-text` line refers to `pdftotext` output. Exit 0 is
clean under the loaded policy, 1 is unexplained findings and 2 is an incomplete scan or stale
policy. Success is not a certificate of permissions, scientific accuracy or clean history.

Interpreter tokens on the first shebang line are executable syntax, not local data
references. Identical paths elsewhere and shebang arguments remain scanned.
Family footer links have their own rule and exact digest approvals.

Pending entries have `pending: true` and an ISO date alongside the exact match fields.
They name private references awaiting source repairs, not safe publication choices.
Every run lists them; changed counts or removed matches fail until policy is updated,
except that `private-name` rows require the external list to be evaluated.
The summary separates exceptions, pending entries and withheld declarations.

The policy also declares withheld paths, each an exact file or a directory prefix ending
in a slash, with a reason. These local operational files remain on disk but are excluded
from public scanning and export. References to them from public files fail the gate.
Only the policy declaration itself may name withheld paths. Removing the files from
version control needs coordination with the system that consumes them.
