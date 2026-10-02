# Pink Robotics

This repository holds the source pages for pinkrobotics.ca, a research project on
working-animal technology, energy, and proposed water-carrying airships. The fleet
shown on the site is simulated; no aircraft has been built or flown.
Historical wildfire data describes real events. The simulation makes no claim
that any fire outcome would have changed.

The site is currently deployed from a separate source. Changes here do not go
live until the deployment cutover is completed.

## Start here

Install Git, Python 3.10 or newer, and Node.js 22. Copy this repository's clone
URL from its hosting page into `REPO_URL`, then run:

```sh
git clone "$REPO_URL" pinkrobotics
cd pinkrobotics
make check
make demo
make preview
```

The science source is a separate repository; its published pages are in
`site/airships/` and `site/research/`. `make demo` builds the work log from
synthetic Git, roster and objection fixtures with its feed disabled.
`make preview` serves a filtered export with that generated log data;
raw `site/` also contains development and server-managed files.

`make check` runs the work-log unit tests, builds and checks the offline demo,
checks the exported site, and runs the 3D viewer's control tests. It was tested
with Python 3.14.4 and Node.js 22.14.0. `make preview` serves the export in the
foreground at the first free address from `http://127.0.0.1:8980/` through port
8989. Open `/` and `/log/`; stop the server with Ctrl+C. These commands need no
network access after the clone. Tool scratch defaults to `.scratch/` and can be
changed with `TMPDIR`.

`make firstparty` checks the site's own pages for external runtime loads.
`make publiccheck-test` tests the public-boundary gate; `make publiccheck`
scans the candidate tree for local paths, credentials and private terms. A
release check requires a reviewed list outside the checkout via
`PUBLIC_DENY_FILE`; a generic-only pass is incomplete for release.

## Science and work-log inputs

`site/` contains the site pages. The published science pages are under
`site/airships/`, with research material under `site/research/`. The airships
source and its calculations live in a separate science repository; the copy in
`site/airships/` is published from there.

`make activity` and `make demo` generate the ignored
`$(TMPDIR)/activity/activity.json`. By default, a script builds a small synthetic
science Git history in scratch, reads the fixture roster and objections in
`fixtures/activity/`, and disables the ship feed. The sample landings and all
demo counts are fictional examples, not project history or telemetry.

Contributors with authorized inputs can override the defaults:

```sh
make activity SCIENCE=<science-checkout> ERA_BASE=<full-base-sha> \
  ACTIVITY_INPUTS=<input-directory> SHIP_FEED=none
```

The input directory must contain `lanes.json` and `objections.json`. A supplied
science checkout requires its full era-base commit identity. `SHIP_FEED` can be
set explicitly to a local JSON file or a feed URL when appropriate; the default
never makes a request. The builder projects only fields allowed by
`tools/activity/boundary.py` before writing the public JSON.

## Export and preview

`site/` is source, not the tree served. `make export DEST=.scratch/served` applies
the tracked `deploy-filter.txt`: development READMEs, diagnoses, scripts and
tests are omitted, as is the server-managed fire-data path. If activity JSON has
been generated, export adds that separately published file after checking its
public boundary. The live fire mirror is supplied on the server and is not
recreated locally. `make preview` serves a fresh export, so it matches this
local, filtered view rather than a raw `site/` directory.

This repository has no overall licence yet. Third-party assets and data have
separate terms; the release inventory must be reviewed before publication.
