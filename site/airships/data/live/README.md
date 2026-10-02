# Server-side feed mirror

`pipeline/live.py` writes fire points (`fires.json`), perimeters (`perims.json`),
satellite heat (`heat.json`) and 850 hPa wind (`wind.json`) into this directory.
Generated files are gitignored and excluded from repository publication; a deployment
must preserve the server's current mirror.

Run one timer every ten minutes. Fires/perimeters have an eight-minute fetch gate,
heat 25 minutes, and wind 60 minutes. Wind attempts, including failures, are limited
to one per hour using a separate local attempt record. Concurrent timer invocations
are locked. Successful files are replaced atomically; failures keep the previous copy.

Every mirror has `fetchedAt`, `source` and `data`. Fire and heat payloads are feature
collections. Wind contains a forecast hour, grid axes and east/north km/h components
for a 5×5 grid; the browser interpolates to mission midpoints.

The browser never contacts an agency or forecast provider. A missing/stale fire mirror
uses the dated bundled snapshot. Missing/stale wind means labelled still air.
`?data=snapshot` ignores this directory entirely. See `pipeline/README.md` for operator
configuration and `DATA-SOURCES.md` for attribution and API terms.

Do not populate mirrors during tests: the network gate supplies local recorded fixtures.
