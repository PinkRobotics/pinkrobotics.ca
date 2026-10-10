# Pink Robotics — agent notes

**Source of truth, until the deploy cutover.** This repository was seeded (fresh root) from the
site folder of the deploy source, which still DEPLOYS the site and
still receives every writer: the airships repository's `tools/publish.py`, the deploy source's design-inline
and figure tools, and the live-fire mirror timer. Until the cutover lands, edit the site there, and
re-seed here with one commit whose `site/` tree equals the accepted source tree except the three exact server-written fire JSONs:

    git rm -rq site && mkdir -p site
    git -C <deploy-source> archive <sha>:pinkrobotics | tar -x -C site \
      --exclude=airships/data/live/fires.json --exclude=airships/data/live/heat.json \
      --exclude=airships/data/live/perims.json
    git add site
    git rm --cached --ignore-unmatch -- site/airships/data/live/fires.json site/airships/data/live/heat.json site/airships/data/live/perims.json

Compare the remaining tracked seed bytes against that accepted archive. The three JSONs
stay on disk, ignored; the landing order must name all three in `preserve_paths` so live
working copies survive landing. Do not omit any other source path.

Every re-seed also records the new tree in the seed manifest, and the seed gate
(`make seedcheck`) holds `site/` to it:

    python3 tools/check_seed.py --write && git add site-seed.json
    python3 tools/check_seed.py --check

The manifest records every file under `site/` by path and SHA-256 (generated `site/log/data/` and the three exact fire JSONs above excepted).
`site-exclusions.txt` is the canonical export/live/seed exclusion surface. Keep its
deployment pattern set consistent with the deploy source; only its `seed-exclude`
markers omit files from the manifest. The live-data README stays tracked. `make seedcheck` proves the committed seed is the
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
