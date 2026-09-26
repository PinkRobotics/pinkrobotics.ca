/* The live data: what the page asks for, how it falls back, and how it becomes model input.
 *
 * Three tiers, in order: this site's own mirror of the public feeds (pipeline/live.py),
 * then the public feeds directly, then the dated snapshot committed to this repository.
 * The mirror exists so that traffic to this page does not become traffic to an emergency
 * service. Whichever tier answers is named on the page — the status line never implies
 * live data it does not have.
 */
import { dropSeg, havKm, insideFire, planTargets } from '../sim/index.js?v=a67fca39';
import { renderDrawer } from './cockpit/panels.js?v=a67fca39';
import { replanAll } from './fleet.js?v=a67fca39';
import { renderStatus } from './main.js?v=a67fca39';
import { FIRES_URL, PERIMS_URL, cachedJSON, fetchJSON, mirrorJSON } from './net.js?v=a67fca39';
import { S } from './store.js?v=a67fca39';

/* REPLAY MODE. `?data=snapshot` pins every external input to the dataset bundled with the
 * repository: the fires, their perimeters, the satellite heat, and the wind (still air, and
 * labelled as such — a wind forecast cannot be replayed honestly from a file, so replay mode
 * declines to pretend). With `?seed=` pinning the plan jitter, a run is fully determined.
 *
 * That buys three things: golden-output tests that compare numbers rather than screenshots,
 * a link that shows another person exactly what you were looking at, and a page that works
 * with no network at all. */
export const REPLAY = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("data") === "snapshot";

export function normalize(firesGJ, perimsGJ) {
  const rings = {};
  for (const f of (perimsGJ && perimsGJ.features) || []) {
    const num = f.properties.FIRE_NUMBER;
    const g = f.geometry; if (!g || !num) continue;
    const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
    let best = null, ba = -1;
    for (const p of polys) {
      const r = p[0];
      let a = 0;
      for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      a = Math.abs(a);
      if (a > ba) { ba = a; best = r; }
    }
    if (best) {
      const step = Math.max(1, Math.floor(best.length / 240));
      rings[num] = best.filter((_, i) => i % step === 0);
      if (!rings[num].allRings) rings[num].allRings = polys.map(p => {
        const r = p[0]; const st = Math.max(1, Math.floor(r.length / 160));
        return r.filter((_, i) => i % st === 0);
      });
    }
  }
  const fires = [];
  for (const f of (firesGJ && firesGJ.features) || []) {
    const p = f.properties, g = f.geometry;
    if (!g || p.FIRE_STATUS === "Out") continue;
    fires.push({
      id: p.FIRE_NUMBER || String(p.OBJECTID),
      name: p.INCIDENT_NAME && p.INCIDENT_NAME !== p.FIRE_NUMBER ? p.INCIDENT_NAME : null,
      geo: p.GEOGRAPHIC_DESCRIPTION || null,
      status: p.FIRE_STATUS, cause: p.FIRE_CAUSE || null,
      sizeHa: p.CURRENT_SIZE || 0,
      ignited: p.IGNITION_DATE ? new Date(p.IGNITION_DATE) : null,
      url: p.FIRE_URL || null,
      note: p.FIRE_STATUS === "Fire of Note" || p.FIRE_OF_NOTE_IND === "Y" || p.FIRE_OF_NOTE_IND === "Yes",
      ll: [g.coordinates[0], g.coordinates[1]],
      ring: rings[p.FIRE_NUMBER] || null,
    });
  }
  fires.sort((a, b) => b.sizeHa - a.sizeHa);
  return fires;
}

/* Which tier is on screen. loadLive sets it, and the status line in main.js says it out
 * loud; nothing else may write it. It is not declared in store.js because this module is
 * the only thing that knows the answer.
 *
 *   "replay"    ?data=snapshot — the visitor asked for the bundled dataset
 *   "mirror"    this site's server-side copy of the public feeds
 *   "direct"    the public feeds, fetched by this browser (or its own cache of them)
 *   "snapshot"  the dataset committed to the repository; the live tiers all failed
 *   "none"      nothing answered and there is nothing to show
 *
 * A refresh that fails with a good picture already on screen changes none of this: the tier
 * and the fetch time stay as they were, because they describe the data the visitor is
 * looking at, and the growing age is what tells them the page has stopped updating.
 *
 * S.dataNote carries the reason in words — "mirror is 63 min old, past its 45 min gate",
 * "timed out after 15 s" — so a visitor who wonders why is not left guessing, and so the
 * two failures that look identical from outside (a feed that hangs and a feed that returns
 * nothing) read differently on the page. S.perimsOk says whether the outlines came with the
 * points, because a live tier can answer with one and not the other. */

/* One short phrase for one failure, for the status line. */
function why(e) {
  return (e && e.message) || "unknown error";
}

/* A feed that parses but carries no fires is a failure of the SOURCE, not of the transport,
 * and the next tier may well have the fires. BC has active fires every day of the season;
 * an empty collection in August is a broken publisher, not a quiet province. It is treated
 * as unusable rather than shown as "0 fires" — but only after every tier has been asked. */
function usable(gj) {
  return !!(gj && Array.isArray(gj.features) && gj.features.length);
}

export async function loadLive() {
  if (REPLAY) {
    const snap = await fetchJSON("data/snapshot.json", 20000);
    S.usingFallback = true; S.fetchedAt = new Date(snap.retrievedAt || Date.now());
    S.snapshotDate = snap.retrievedAt;
    S.tier = "replay"; S.dataNote = ""; S.perimsOk = true;
    return normalize(snap.fires, snap.perimeters);
  }
  // The tiers are tried in order and every failure is recorded, rather than being nested in
  // catch blocks where an early success can still fall past a later tier. The specific hole
  // that shape had: a mirror that answered with a valid timestamp and an empty feature
  // collection satisfied the mirror tier, failed the emptiness test further down, and threw
  // into the outermost catch — which is the SNAPSHOT. A working public feed was skipped.
  const notes = [];
  let got = null, tier = null, perims = null;

  // Tier 1: our own mirror. 45 min covers a few missed refreshes of a job that runs every
  // ten. Perimeters come from the same tier as the fires, so the two layers on screen are
  // always the same vintage from the same publisher; a missing perimeter layer only costs
  // the rings.
  try {
    const fr = await mirrorJSON("fires", 45);
    if (usable(fr.data)) {
      got = fr; tier = "mirror";
      try { perims = await mirrorJSON("perims", 90); }
      catch (e) { notes.push("no perimeters (" + why(e) + ")"); }
    } else notes.push("mirror carried no fires");
  } catch (e) { notes.push("mirror: " + why(e)); }

  // Tier 2: the public feeds, direct from this browser, behind the courtesy cache.
  if (!got) {
    try {
      const fr = await cachedJSON("fires", FIRES_URL, 300000, 15000);
      if (usable(fr.data)) {
        got = fr; tier = "direct";
        try { perims = await cachedJSON("perims", PERIMS_URL, 900000, 15000); }
        catch (e) { notes.push("no perimeters (" + why(e) + ")"); }
      } else notes.push("feed carried no fires");
    } catch (e) { notes.push("feed: " + why(e)); }
  }

  if (got) {
    S.usingFallback = false; S.tier = tier;
    S.fetchedAt = new Date(Date.now() - got.age);
    S.dataNote = notes.join("; ");
    // "Perimeters arrived" has to mean outlines are on the map, not merely that the layer
    // answered: an empty collection draws nothing and must not be described as perimeters.
    S.perimsOk = usable(perims && perims.data);
    return normalize(got.data, perims && perims.data);
  }

  // Tier 3: the dataset committed to the repository. Dated on the page, never called live.
  try {
    const snap = await fetchJSON("data/snapshot.json", 20000);
    S.usingFallback = true; S.tier = "snapshot"; S.fetchedAt = new Date();
    S.snapshotDate = snap.retrievedAt;
    S.dataNote = notes.join("; ");
    S.perimsOk = true;                       // the committed snapshot always carries both
    return normalize(snap.fires, snap.perimeters);
  } catch (e) {
    notes.push("snapshot: " + why(e));
  }

  // Nothing answered at all. The one thing this must not do is throw: an unhandled rejection
  // here would stop boot() before the page had a status line to explain itself with.
  if (S.fires.length) {
    // A refresh failed with a good picture already on screen. Keep that picture AND its
    // provenance — it really did come from the tier it says, at the time it says — and let
    // the age in the status line go on growing, which is the honest signal that the page
    // has stopped being able to update itself.
    S.dataNote = notes.join("; ");
    return S.fires;
  }
  S.usingFallback = true; S.tier = "none"; S.fetchedAt = null;
  S.dataNote = notes.join("; ");
  S.perimsOk = false;
  return [];
}

export function needsShip(f) {
  // The demonstration responds only to fires that are actually out of control (fires of
  // note included — they are the marquee incidents). Held and under-control fires stay on
  // the map as monitored-only: crews have them; the imagined fleet does not pile on.
  return f.status === "Out of Control" || f.status === "Fire of Note";
}

export async function fetchWind() {
  if (REPLAY) { S.windOk = false; renderStatus(); return; }   // still air, stated on the page
  const act = S.missions.filter(m => !m.idle);
  if (!act.length) return;
  try {
    const lats = act.map(m => ((m.intake[1] + m.delivery[1]) / 2).toFixed(3)).join(",");
    const lons = act.map(m => ((m.intake[0] + m.delivery[0]) / 2).toFixed(3)).join(",");
    // hourly product: a 20-minute cache is already generous
    const wr = await cachedJSON("wind:" + act.length + ":" + lats.slice(0, 24),
      "https://api.open-meteo.com/v1/forecast?latitude=" + lats +
      "&longitude=" + lons + "&hourly=wind_speed_850hPa,wind_direction_850hPa" +
      "&forecast_hours=1&wind_speed_unit=kmh&timezone=UTC", 1200000, 15000);
    let d = wr.data;
    if (!Array.isArray(d)) d = [d];
    act.forEach((m, i) => {
      const hh = d[i] && d[i].hourly;
      if (hh && hh.wind_speed_850hPa && hh.wind_speed_850hPa[0] != null)
        m.wind = { spd: hh.wind_speed_850hPa[0], dir: hh.wind_direction_850hPa[0], bearing: m.bearing };
    });
    S.windOk = true; S.windAt = new Date();
  } catch (e) { S.windOk = false; }
  // S.heat must be passed: planTargets scores candidate lines partly on how hot the
  // satellite detections along them are, and it takes that data as an argument so the
  // model can run with no feed. Omitting it silently reverts to geometry-only scoring.
  for (const mm of S.missions) if (!mm.idle) planTargets(mm, S.heat);
  replanAll(); renderStatus();
}

export async function fetchHeat() {
  // The same CWFIS detections the heat overlay draws, as readable points: when a fire has
  // them, its drop lines aim at the hottest well-separated detections instead of geometry.
  if (REPLAY) {
    try {
      const snap = await fetchJSON("data/snapshot-heat.json", 20000);
      S.heat = (snap.features || []).map(f => ({ ll: f.geometry.coordinates, temp: f.properties.temp || 0 }));
    } catch (e) { S.heat = []; }
    applyHeat();
    return;
  }
  try {
    // Mirror first; the direct CWFIS query (attribute filter, not a geometry BBOX — the
    // layer's native-CRS envelope over-selects) only as fallback behind its 30-min cache.
    let hr;
    try { hr = await mirrorJSON("heat", 90, 25000); }
    catch (e) {
      hr = await cachedJSON("heat",
        "https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs?service=WFS&version=2.0.0&request=GetFeature" +
        "&typeNames=public%3Ahotspots_last24hrs&outputFormat=application%2Fjson&srsName=EPSG:4326" +
        "&CQL_FILTER=lat%20BETWEEN%2047.5%20AND%2060.6%20AND%20lon%20BETWEEN%20-140%20AND%20-113.3" +
        "&sortBy=temp%20D&count=6000&propertyName=geometry,temp", 1800000, 25000);
    }
    S.heat = (hr.data.features || []).map(f => ({ ll: f.geometry.coordinates, temp: f.properties.temp || 0 }));
  } catch (e) { S.heat = []; }
  applyHeat();
}

export function applyHeat() {
  if (!S.heat || !S.heat.length) return;
  for (const m of S.missions) {
    if (m.idle) continue;
    const f = m.fire;
    const radKm = Math.sqrt(Math.max(f.sizeHa, 10) * 1e4 / Math.PI) / 1000 + 3;
    const cand = [];
    for (const h of S.heat) {
      if (Math.abs(h.ll[1] - f.ll[1]) * 111 > radKm) continue;
      if (havKm(h.ll, f.ll) > radKm) continue;
      if (insideFire(f, h.ll) || havKm(h.ll, f.ll) < radKm * 0.6) cand.push(h);
    }
    if (!cand.length) continue;
    cand.sort((a, b) => b.temp - a.temp);
    const sepKm = Math.max(0.3, m.cls.dropKm * 0.45);
    const picks = [];
    for (const h of cand) {
      if (picks.every(q => havKm(q, h.ll) > sepKm)) picks.push(h.ll.slice());
      if (picks.length >= 8) break;
    }
    if (picks.length >= 1) {
      m.targets = picks;
      m.segs = picks.map(t => dropSeg(m, t, true));
      m.heat = true;
      planTargets(m, S.heat);
    }
  }
  renderDrawer();
}
