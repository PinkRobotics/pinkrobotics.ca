# Pink Robotics

This repository holds the pages of [pinkrobotics.ca](https://pinkrobotics.ca) and the generator of its public work log.
The site presents working-animal technology, energy, and airship research.
The science has its own repository; the copies here are published presentations, not the full research source.

The fleet is simulated and never flew.
The fires in historical records are real.
Nothing here claims a fire would have burned differently.

## Served source

`site/` is a seed of the committed site tree from the deploy source.
Served bytes change there first, then deployment and a new seed bring this repository into agreement.
A candidate seed includes proposed changes and is not evidence of deployment.
The seed is recorded in `site-seed.json`, and `make seedcheck` holds `site/` to that record:
a file added, removed or changed under `site/` fails the gate by name.
This proves the committed seed is the recorded seed; it cannot prove offline that the
recorded seed equals what serves.
`make livecheck BASE=<live address>` compares the two after a deploy.
It fetches every recorded path, cache-busted, and reports equal pages, real differences and
missing pages.
Files the server writes itself, the live fire data, are named server-side and not compared.
The content network's e-mail rewrite is named as such: the encoded addresses and its decoder
script, which is excused only at that script's exact path on this site's own host.
Any other script the network injects, from another host or elsewhere under `/cdn-cgi/`, is a
finding, listed by its source; report headers are listed by name and count.
It needs the network, so it is not part of `make check`.
[AGENTS.md](AGENTS.md) gives the seed and tree-verification commands.

The science pages and viewer are copied into `site/airships/` and `site/airship3d/`.
Fix their source and publish a new copy; never hand-edit them here.
The home page's figure generator and the deployment machinery live outside this repository today.

The local hook settings, operating instructions and ingested governance mirror that the directing system once read from this checkout now live outside the repository.
The policy declares no withheld path, so every tracked file is scanned and exported by the same rules.
Public documents must not link to withheld files.

## Offline walk

Install Git, Make, Python, Node.js, Chromium, Poppler's `pdftotext`, and the Python `websockets` package before disconnecting.
From the repository root, run `make check`, then `make demo` and `make preview`; open the printed address and `/log/` to see fictional activity; `make export` writes the same filtered site to `DEST` (default: `$(TMPDIR)/export`, or `.scratch/export` with the default scratch setting).

```sh
make check
make demo
make preview
```

`make help` prints the exact gates included in `make check`.
Every gate runs even if another fails; a failure keeps the command red.
Findings requiring changes at an external source remain findings until a new seed fixes them.
The tools do not download dependencies or request emergency agency feeds.

`make demo` builds synthetic history, including withheld text and an unrecorded builder, with its feed disabled.
The demo is fictional evidence for the generator, never project activity.
Generated data and disposable files live under `TMPDIR`, which defaults to `.scratch/`.
The demo never edits `site/`.

`make preview` serves a filtered export on loopback and prints its address.
Open the home page and work log, then stop the foreground server with Ctrl+C.
`make export` writes the same filtered site to `DEST`, with checked activity data overlaid.
Development files and server-managed fire data are excluded by `deploy-filter.txt`.

## What the checks show

| Command | Evidence | Limit |
| --- | --- | --- |
| `make activity-test` | Synthetic history, privacy controls, and the served commit renderer agree | Does not verify real project inputs |
| `make fixturecheck` | Demo inputs and output meet the public data schema | Synthetic records are not scientific evidence |
| `make publiccheck` | Public files match generic rules and exact policy declarations | Does not clear history, licences, arbitrary obfuscation, or image text |
| `make publiccheck-test` | Boundary controls reject planted private values and stale approvals | Coverage is limited to tested cases |
| `make seedcheck` | Every file under `site/` matches the recorded seed manifest, by name and digest | Cannot prove offline that the seed equals what serves |
| `make seedcheck-test` | Seed controls refuse added, removed, changed and hand-edited manifests | Coverage is limited to tested cases |
| `make livecheck` | Every recorded seed path serves the same bytes, or the only difference is the network's e-mail rewrite; any other injected script is a finding | The e-mail rewrite's normalization is trusted; server-written files are not compared; live pages the seed omits stay unseen |
| `make livecheck-test` | Live-comparison controls exercise every reported class against a loopback fixture | Coverage is limited to tested cases |
| `make firstparty` | Static loading checks and intercepted browser requests cover site-owned pages | Copied science trees, unexercised behavior, deployment headers, and scripts the content network adds while serving need separate checks; `make livecheck` excuses the e-mail decoder at its exact path and reports every other added script as a finding |
| `make labelcheck` | Estimated inline SVG text boxes avoid overlaps and view-box overflow | Font shaping and actual glyph outlines need visual inspection |
| `make labelcheck-test` | Geometry controls exercise overlap, separation, bounds, and unsupported shapes | Does not establish rendered typography |
| `make export-test` | Filtering, withholding, permissions, and activity validation behave as specified | Does not prove a server used this export |
| `make control-test` | The copied viewer's control tests pass | Does not validate aircraft hardware or flight |

[The public-boundary document](tools/check_public.md) explains the rules and exact digest policy.
Pending entries identify private source references awaiting correction and expire when their matches change.
Exceptions record reviewed matches, including the owner's published contact and family links.
Every run lists pending and withheld declarations; without the private list, it also lists and counts `private-name` rows as not evaluated.

Release checks require a reviewed private-term list outside every repository, selected through `PUBLIC_DENY_FILE`.
A generic-only pass does not clear known private names.
The gate never prints matched values.

## Real work-log inputs

`make activity` defaults to the demo.
Real generation requires a science checkout, a pinned era base, and reviewed roster and objection inputs:

```sh
make activity SCIENCE="$SCIENCE_SOURCE" ERA_BASE="$BASE" ACTIVITY_INPUTS="$INPUTS" SHIP_FEED=none
```

`ACTIVITY_OUT` selects the generated data directory.
Export and preview use its validated activity file.
A withheld message retains its recorded date and safe builder metadata; missing builders say `model not recorded`.
Unavailable measurements remain unavailable.

`VERDICTS` supplies an optional verdict store to `make activity`; the default is
`fixtures/activity/verdicts.tsv`. Set `VERDICTS=` to omit it. With real science inputs,
pass the corresponding store explicitly. Both generator entry points accept `--verdicts`.
An unreadable supplied store refuses the build before replacing the previous output.
The demo binds the default store's illustrative identities to its disposable science history;
its signature digests refer to fictional records, never project signatures.

Each landing adds `checker`: `state`, `verdict`, `recorded_at`, `model`, and
`signature_sha256`. Only complete, well-formed store records count; the last matching
record wins. Abbreviated identities follow prefix compatibility in either direction;
two distinct matching identities refuse the build. A signed record needs exactly one
lowercase 64-hex signature digest. A review pass has no signature; a failed review
revokes it, and a review that did not run says so. Missing records and omitted stores
have distinct states. Newer store records end with signer labels: with the reviewer's
role, model and effort all present, `model` reads `checked by <role> · <model> @ <effort>`,
and a value recorded as `unknown` prints as `unknown`. The role is shown, never the
reviewer's session identifier. Older records, incomplete labels and values the boundary refuses keep
`model not recorded`. The digest is copied from the store and commits to the
exact bytes of the private signature record. An outside reader cannot verify it
against that record. No other store text, internal identifier or location is published.

Roster lanes may add `landings`, a sorted list of distinct positive science landing
numbers. Integration maintains it from the landing records. A future number is valid
and displays only when that landing exists; an omitted list claims no attribution.
The existing lane projection adds that list only when supplied. Each landing adds
`cost`, selected by this membership rather than by commit order fields. It contains
public lane names, work titles, builder provider/model/effort, status and allocation.
A lane listing only this landing supplies its token and wall readings, including
null readings and elapsed time for running work. A lane listing several landings
is `shared`, lists the other numbers (including future landings), and supplies no
numeric allocation. No landing total is claimed. Integration is always `not metered`.
Existing fields and whole-lane totals retain their names, types and values.

## Licence

The code and tooling in this repository are licensed under the Apache License 2.0 ([LICENSE](LICENSE)).
Our own written content and figures, the prose of the pages and the figures generated from the simulation, are licensed under Creative Commons Attribution 4.0 International, CC BY 4.0 ([LICENSE-CONTENT](LICENSE-CONTENT)).
Attribute them as: Pink Robotics, pinkrobotics.ca.
Third-party papers, datasets and assets keep their own terms, as the [NOTICE](site/airships/NOTICE) table and [DATA-SOURCES.md](site/airships/DATA-SOURCES.md) record them, including the two papers in [`site/research/`](site/research/); nothing there is relicensed.
The Pink Robotics and PinkAI names and marks are not licensed.
The stills in [`site/media/`](site/media/) are the project's own figures, renders of its 3D model and frames of its 3D viewer, and CC BY 4.0 covers them.
Two screenshots of the August fleet monitor were removed from the current tree: their map background is third-party satellite imagery whose provider and terms were not recorded.
