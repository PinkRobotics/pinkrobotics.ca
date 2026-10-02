# Pink Robotics

This repository holds the source for [pinkrobotics.ca](https://pinkrobotics.ca),
a public site about working-animal technology, energy and an airship research
program. The airship fleet shown on the site is a simulation; it never flew.
Historical wildfire data describes real events, but the simulation makes no
claim that any fire outcome would have changed.

The site is static. `site/` is the candidate web root and needs no asset build
step. Root documents and tools are development material; deployment must also
exclude development files under `site/`. `site/airships/` and `site/airship3d/` are published copies of
separate source trees; changes to those copies must be made at their sources.
The site is currently deployed from a separate private deployment source;
changes in this repository do not go live until the cutover is completed.

| Path | Purpose |
| --- | --- |
| `site/` | Static pages and local assets |
| `site/log/` | Published work log generated from reviewed activity records |
| `tools/activity/` | Work-log generator, boundary rules and tests |
| `site/airships/` | Published airship research pages and simulation |
| `site/airship3d/` | Published 3D viewer copy |

Run `make activity-test` to test the work-log generator. Run `make publiccheck`
to scan the proposed tree for local paths, credentials and private terms. A
release check requires a reviewed external private-term list via
`PUBLIC_DENY_FILE`; a generic-only pass is incomplete for release. Run
`make publiccheck-test` for the boundary check's regression tests. The published
site can be inspected locally by serving `site/` with a static file server.
Development does not require requests to emergency agency feeds.

To regenerate the work-log data, `make activity` reads the companion science
checkout (`SCIENCE`, default `../airships`), reviewed local roster and objection
inputs (`ACTIVITY_INPUTS`), the pinned `ERA_BASE` and a configured ship record
feed (`SHIP_FEED`). It validates the public boundary before writing
`site/log/data/activity.json`. Regeneration requires those inputs and may read
the configured feed; it was not part of this readiness audit.

The calculations, evidence and research papers behind the airship project live
in a separate science repository. Its public address will be added once that
repository is released; the site is a presentation of that work, not its full
source. This repository has no overall licence yet. Third-party assets and data
have separate terms; the release inventory must be reviewed before publication.
