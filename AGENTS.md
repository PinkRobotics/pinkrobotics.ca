# Pink Robotics — agent notes

**Source of truth, until the deploy cutover.** This repository was seeded (fresh root) from the
site folder of the deploy source, which still DEPLOYS the site and
still receives every writer: the airships repository's `tools/publish.py`, the deploy source's design-inline
and figure tools, and the live-fire mirror timer. Until the cutover lands, edit the site there, and
re-seed here with one commit whose `site/` tree equals the source tree:

    git rm -rq site && mkdir site
    git -C <deploy-source> archive <sha>:pinkrobotics | tar -x -C site && git add site
    test "$(git write-tree --prefix=site/)" = "$(git -C <deploy-source> rev-parse <sha>:pinkrobotics)"

Every re-seed also records the new tree in the seed manifest, and the seed gate
(`make seedcheck`) holds `site/` to it:

    python3 tools/check_seed.py --write && git add site-seed.json
    python3 tools/check_seed.py --check

The manifest records every file under `site/` by path and SHA-256 (`site/log/data/`, the
server-generated work-log data, excepted). `make seedcheck` proves the committed seed is the
recorded seed — a file added, removed or changed is refused by name. It cannot prove offline
that the seed equals what serves.

The cutover (a named unit, not a side effect) repoints those writers and `deploy.sh` at `site/` here,
then removes `pinkrobotics/` from the deploy source.

**Site rules** (inherited from the deploy source): single-file pages where possible, no external assets or
runtime requests, `prefers-reduced-motion` fallbacks, per-site accent and favicon, family footer
links. Verify visually at 1440/834/390 before any deploy. Nothing is served that is not meant to be
read: development files (diagnoses, scripts, tests, READMEs under `site/`) are excluded at deploy.

**Airships is its own repository** (Apache-2.0). `site/airships/` is its published copy; fix source
there and publish, never hand-edit the copy (its `publish.py --check` fails on drift).

**Never** commit personal documents, private reports or anything from other estate sites. This
repository is intended to become public.
