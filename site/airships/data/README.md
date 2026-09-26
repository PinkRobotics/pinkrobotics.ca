# `data/`

Everything the page loads that is not code. Six committed files plus a `live/` directory
whose contents are gitignored on purpose — `/data/live/*` with `!/data/live/README.md`, so
the directory and its explanation are committed and the mirrored feeds are not.

The wildfire data here is real and comes from public agencies under open licences. The
fleet that responds to it is imagined. Full licence text, required attribution wording and
retrieval URLs are in [`../DATA-SOURCES.md`](../DATA-SOURCES.md); each file also has a
machine-readable `<name>.prov.json` sidecar beside it. This page is the index.

## Files

| File | Bytes | What it is | Source | Licence | Regenerate |
|------|------:|-----------|--------|---------|-----------|
| `snapshot.json` | 117,591 | 105 active BC fires and 73 perimeters as retrieved 2026-08-08T18:42:38Z. The pinned input for `?data=snapshot`, and the last-resort fallback when both the mirror and the live feed are unreachable. | BC Wildfire Service ArcGIS FeatureServer | OGL – British Columbia | No committed generator. Re-fetch the two `BCWS_*_PublicView` query URLs in `pipeline/live.py` and write them under `fires` and `perimeters` with a `retrievedAt`. Regenerating changes the golden files. |
| `snapshot-heat.json` | 193,828 | The hottest 2000 of the 24-hour satellite hotspot detections at 2026-08-09T07:02:39Z. Pinned heat layer for `?data=snapshot`. | NRCan CWFIS hotspots WFS | OGL – Canada | No committed generator. Re-fetch the `heat` URL in `pipeline/live.py`, keep the top 2000 by `temp`, reduce to geometry plus `temp`. Regenerating changes the golden files. |
| `water-bc.json` | 1,004,192 | 13,617 lakes and 29 reservoirs of 10 ha or more: centroid, area in hectares, name, and a simplified outer ring for bodies of 80 ha or more. The fleet's water supply. | BC Freshwater Atlas, via `openmaps.gov.bc.ca` WFS | OGL – British Columbia | `python3 pipeline/water.py data/water-bc.json` |
| `terrain-bc.jpg` | 621,849 | 2560 × 2304 dark hillshade of BC and its margins, zoom-7 mercator mosaic, longitude −140.625°…−112.5°. A rendering, not elevation data. | AWS Terrain Tiles (CDEM / SRTM / GMTED2010 / ETOPO1) | per-source; see DATA-SOURCES.md §4 | `python3 pipeline/terrain.py data/terrain-bc.jpg` |
| `roads-bc.json` | 54,455 | 294 highway polylines, 3032 vertices, bare `[[lon,lat],…]` with no properties. Orientation only; the model never reads it. | Natural Earth 1:10m Roads | public domain | **No generator — see below.** |
| `bc-outline.json` | 14,336 | The BC provincial boundary and its islands: 23 rings, 804 vertices, simplified. Orientation only. | Natural Earth 1:50m Admin-1, feature "British Columbia" | public domain | **No generator — see below.** |
| `live/` | — | The server-side mirror of the live feeds: `fires.json`, `perims.json`, `heat.json`. Gitignored on purpose. | see [`live/README.md`](live/README.md) | as upstream | `python3 pipeline/live.py` |

Byte counts are as committed and will move if a file is regenerated.

## The `roads-bc.json` finding

`roads-bc.json` reached this repository with **no stated source, no generator script and no
licence**. That was the single largest publication risk in the project: a road network with
unknown provenance is most likely OpenStreetMap-derived, and OSM carries ODbL share-alike,
which would attach obligations to anything published alongside it.

**It is not OpenStreetMap. It is Natural Earth, which is public domain.** The provenance was
established by vertex identity, not by guesswork:

- All **3032 of 3032** vertices in `roads-bc.json` appear, exact to the three decimal places
  the file stores, in the `ne_10m_roads` layer of `nvkelso/natural-earth-vector`, restricted
  to this bounding box.
- The same check on `bc-outline.json`, which had the same problem, matched **804 of 804**
  vertices against the `ne_50m_admin_1_states_provinces` feature named "British Columbia",
  with the file's 23 rings corresponding one-to-one to that feature's 23 polygon parts.

Natural Earth's terms: *"All versions of Natural Earth raster + vector map data found on
this website are in the public domain… No permission is needed to use Natural Earth.
Crediting the authors is unnecessary."* No ODbL obligation exists, nothing needs to be
removed, and the project credits Natural Earth anyway because Natural Earth asks nicely.

Reproduce the check yourself:

```
curl -sLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_roads.geojson
python3 - <<'EOF'
import json
ne = json.load(open('ne_10m_roads.geojson'))
ours = json.load(open('roads-bc.json'))
nep = {(round(p[0],3), round(p[1],3))
       for f in ne['features'] if f['geometry']
       for ln in ([f['geometry']['coordinates']] if f['geometry']['type'] == 'LineString'
                  else f['geometry']['coordinates'])
       for p in ln}
pts = [(round(p[0],3), round(p[1],3)) for l in ours for p in l]
print(sum(p in nep for p in pts), 'of', len(pts))
EOF
```

**What is still open.** The provenance is settled; the *reproducibility* is not. Neither
file has a script in `pipeline/`, so the exact Natural Earth release they were cut from is
unrecorded and the processing steps are inferred from the match rather than replayed. Those
steps appear to be: clip to about −137.5°…−112° by 47.3°…60.6°; drop `featurecla = Ferry`;
Douglas–Peucker simplify (roughly half the in-box vertices are gone); round to three
decimal places (≈100 m); discard all properties. The fix is a `pipeline/vectors.py` that
regenerates both from a pinned Natural Earth release. Until that exists, treat the source
release as "Natural Earth 5.x" — the comparison above was made against 5.2.0-pre, and
Natural Earth geometry does shift between releases.

## Regenerating is not free

`snapshot.json` and `snapshot-heat.json` are the pinned inputs behind `?data=snapshot`,
which is what `tests/golden/` compares against. Re-fetching them changes every golden file.
If you do it deliberately, regenerate the goldens in the same commit and say so in the
message. If a golden diff surprises you, check whether a snapshot moved before you go
looking for a bug in `sim/`.

## What the licences require of you

Two sentences must travel with any redistribution of this data, and both are already in
`../NOTICE`:

> Contains information licensed under the Open Government Licence – British Columbia.

> Contains information licensed under the Open Government Licence – Canada.

The Information was modified — simplified, filtered, rounded, rendered. The providers do
not endorse this project and nothing here has official status. For real emergencies use the
BC Wildfire Service, not this page.
