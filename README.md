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
[AGENTS.md](AGENTS.md) gives the seed and tree-verification commands.

The science pages and viewer are copied into `site/airships/` and `site/airship3d/`.
Fix their source and publish a new copy; never hand-edit them here.
The home page's figure generator and the deployment machinery live outside this repository today.

Local hook settings, foundational operating instructions, and an ingested governance mirror also remain outside the intended public tree.
The directing system still reads those files from this checkout.
The policy withholds them from scanning and export until that system moves them elsewhere.
Public documents must not link to withheld files.

## Offline walk

Install Git, Make, Python, Node.js, Chromium, Poppler's `pdftotext`, and the Python `websockets` package before disconnecting.
Then run from this repository:

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
| `make firstparty` | Static loading checks and intercepted browser requests cover site-owned pages | Copied science trees, unexercised behavior, and deployment headers need separate checks |
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

No repository-wide licence is granted yet.
Third-party assets and research papers retain their own terms.
History, attribution, asset rights, and publication decisions need separate review before a public release.
