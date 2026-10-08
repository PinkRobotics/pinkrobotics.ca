/* The data this page shows: which view it is, what it asks for, how it falls back, and how
 * the feeds become model input.
 *
 * DATED AND LIVE VIEWS have three routes, and the guard decides their mode (data/season/2026.guard.json,
 * read through sim/guard.js — the ruling is data, not code):
 *
 *   a dated day   ?day=YYYY-MM-DD — one of the status days in data/season/, loaded through
 *                 the same code path as live data. A day inside a no-fleet window is shown
 *                 as the record alone: the fires and their outlines as published, nothing
 *                 of the fleet. Any other dated day is a fleet day.
 *   the sample    ?data=snapshot, and the live mirror's failure fallback: the latest fleet
 *                 day in the repository, read from the same season day files — there is no
 *                 second copy of the data, and 8 August 2026 is not reachable with a fleet
 *                 by any route.
 *   live          this site's own mirror of the public feeds (pipeline/live.py), when it is
 *                 fresh. Live is a fleet view unless today, in Vancouver, is inside a
 *                 no-fleet window.
 *
 * The mirror exists so that traffic to this page does not become traffic to an emergency
 * service. The separate ?view=exercise route loads invented fires through normalize,
 * with no date, and keeps every historical guard region.
 * Whichever tier answered is named on the page — the status line never implies
 * live data it does not have, and it names the day and the mode in words on every view.
 */
import { dropSeg, dayKind, fireNumber, guardedFire, havKm, insideFire, loadEvac, loadGuard, liveEvac, missionBlocked, noteKm, planTargets } from '../sim/index.js?v=01e992e3';
import { EXERCISE_MODE, EXERCISE_NOTE, loadExercise } from './exercise.js?v=01e992e3';
import { renderFires, renderRoster } from './cockpit/tables.js?v=01e992e3';
import { renderDrawer } from './cockpit/panels.js?v=01e992e3';
import { vancouverClock, vancouverDate } from './dates.js?v=01e992e3';
import { replanAll } from './fleet.js?v=01e992e3';
import { renderStatus } from './main.js?v=01e992e3';
import { fetchJSON, mirrorJSON } from './net.js?v=01e992e3';
import { S } from './store.js?v=01e992e3';
import { windForMission, readWind, WIND_MAX_AGE_MS } from './wind.js?v=01e992e3';


/* REPLAY MODE. `?data=snapshot` pins every external input to a dated copy bundled with the
 * repository — now the latest fleet day in data/season/, with its fires and perimeters and
 * nothing else: no wind (a forecast cannot be replayed honestly from a file, so replay mode
 * declines to pretend) and no satellite heat (a live layer, not part of a status day). With
 * `?seed=` pinning the plan jitter, a run is fully determined.
 *
 * That buys three things: golden-output tests that compare numbers rather than screenshots,
 * a link that shows another person exactly what you were looking at, and a page that works
 * with no network at all. A ?day= parameter wins over it: a link that names a day is asking
 * for that day, not for the sample. */
const QP = new URLSearchParams(location.search);
export const EXERCISE = QP.get("view") === "exercise";
export const DAY = QP.get("day");
export const REPLAY = QP.get("data") === "snapshot" && !DAY;

export function normalize(firesGJ, perimsGJ) {
  const close = r => {
    if (!r.length) return r;
    const a = r[0], b = r[r.length - 1];
    return a[0] === b[0] && a[1] === b[1] ? r : r.concat([a.slice()]);
  };
  const rings = {}, footprints = {};
  // Drawing may be thinned; clearance always receives every supplied outer part.
  // Separate perimeter features for the same fire also contribute to the footprint.
  for (const f of (perimsGJ && perimsGJ.features) || []) {
    const num = fireNumber(f.properties.FIRE_NUMBER) || f.properties.FIRE_NUMBER;
    const g = f.geometry; if (!g || !num) continue;
    const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
    footprints[num] = (footprints[num] || []).concat(polys.map(p => close(p[0].map(q => q.slice()))));
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
      rings[num] = close(best.filter((_, i) => i % step === 0));
      if (!rings[num].allRings) rings[num].allRings = polys.map(p => {
        const r = p[0]; const st = Math.max(1, Math.floor(r.length / 160));
        return close(r.filter((_, i) => i % st === 0));
      });
    }
  }
  const fires = [];
  for (const f of (firesGJ && firesGJ.features) || []) {
    const p = f.properties, g = f.geometry;
    if (!g || p.FIRE_STATUS === "Out") continue;
    fires.push({
      id: fireNumber(p.FIRE_NUMBER) || p.FIRE_NUMBER || null,
      exercise: S.exercise && p.EXERCISE === true,
      name: S.exercise && p.EXERCISE === true ? p.INCIDENT_NAME : fireNumber(p.FIRE_NUMBER),
      geo: p.GEOGRAPHIC_DESCRIPTION || null,
      status: p.FIRE_STATUS, cause: p.FIRE_CAUSE || null,
      sizeHa: p.CURRENT_SIZE || 0,
      ignited: p.IGNITION_DATE ? new Date(p.IGNITION_DATE) : null,
      url: p.FIRE_URL || null,
      note: p.FIRE_STATUS === "Fire of Note" || p.FIRE_OF_NOTE_IND === "Y" || p.FIRE_OF_NOTE_IND === "Yes",
      ll: [g.coordinates[0], g.coordinates[1]],
      ring: rings[fireNumber(p.FIRE_NUMBER) || p.FIRE_NUMBER] || null,
      footprint: footprints[fireNumber(p.FIRE_NUMBER) || p.FIRE_NUMBER] || null,
    });
  }
  fires.sort((a, b) => b.sizeHa - a.sizeHa);
  return fires;
}

/* Which tier is on screen. loadLive sets it, and the status line in main.js says it out
 * loud; nothing else may write it. It is not declared in store.js because this module is
 * the only thing that knows the answer.
 *
 *   "replay"    ?data=snapshot — the visitor asked for the bundled sample (a fleet day)
 *   "day"       ?day=YYYY-MM-DD — a dated status day, record-only or fleet as the guard says
 *   "mirror"    this site's server-side copy of the public feeds
 *   "snapshot"  the bundled sample; the mirror failed
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

/* ---------- the season record and the guard -------------------------------------------------- */

/* The season index, the season record and the guard file, read once per view. Everything
 * else in this module waits on them: which fires the fleet may work, and whether it flies
 * at all, are the guard's call — and a guard that cannot be read stands the fleet down
 * (R6) rather than being skipped.
 *
 * A failure here is not a blank page: the words go into S.seasonNote and the view degrades
 * to whatever it can still load honestly. The season record's numbers are handed to
 * loadGuard only when the record actually loaded, so a missing season file degrades the
 * hindsight checks without taking the guard itself down. */
let seasonOnce = null;
export function loadSeason() {
  if (seasonOnce) return seasonOnce;
  seasonOnce = (async () => {
    const fail = [];
    let daysIdx = null, guardDoc = null, seasonDoc = null, evacDoc = null;
    try { daysIdx = await fetchJSON("data/season/2026.days.json", 20000); }
    catch (e) { fail.push("season index: " + why(e)); }
    try { guardDoc = await fetchJSON("data/season/2026.guard.json", 20000); }
    catch (e) { fail.push("guard file: " + why(e)); }
    try { seasonDoc = await fetchJSON("data/season/2026.json", 30000); }
    catch (e) { fail.push("season record: " + why(e)); }
    // The derived evacuation record is guard data like the guard file itself: read by
    // loadEvac, which fails closed in words. A fetch that failed hands loadEvac a null doc,
    // which refuses — a missing record is not "no fires under order".
    try { evacDoc = await fetchJSON("data/season/2026.evac.json", 20000); }
    catch (e) { fail.push("evacuation record: " + why(e)); }
    const seasonNumbers = new Set(), seasonOfNote = new Set();
    if (seasonDoc && Array.isArray(seasonDoc.fires))
      for (const f of seasonDoc.fires) {
        if (typeof f.fire !== "string") continue;
        seasonNumbers.add(f.fire);
        if (f.fireOfNote || f.wasFireOfNote) seasonOfNote.add(f.fire);
      }
    S.seasonNumbers = seasonNumbers;
    S.seasonOfNote = seasonOfNote;
    S.dayList = daysIdx && Array.isArray(daysIdx.days)
      ? daysIdx.days.filter(d => d && typeof d.date === "string" && d.fires && d.fires.file && d.perims && d.perims.file)
      : [];
    S.evacSeason = loadEvac(evacDoc);
    S.evacFrom = "season";
    S.guardDoc = guardDoc;
    S.guardCtx = seasonDoc ? { seasonNumbers, seasonOfNote } : {};
    // loadGuard never throws: a malformed or missing file becomes {ok:false, reason} in
    // words, and every caller below reads that as "the fleet stands down".
    S.guard = loadGuard(guardDoc, { ...S.guardCtx, evac: S.evacSeason });
    S.seasonNote = fail.length ? fail.join("; ") : null;
  })();
  return seasonOnce;
}

/* The live evacuation mirror. pipeline/live.py writes it in the mirror's wrapping but
 * reduced — {fetchedAt, source, data: {fires: [...]}} — so it is read here with the same
 * staleness gate as the other mirrors (net.mirrorJSON guards a feature collection; this
 * copy is not one). Any failure of the ENVELOPE — not answering, stale, not a mirror
 * document — is the fall-back case: the season's captured record keeps governing and the
 * guard note says which copy was read. A copy that parses but cannot be READ (loadEvac's
 * own checks) is a refusal, not a fall-back. */
async function mirrorEvac(maxAgeMin) {
  const j = await fetchJSON("data/live/evac.json?ts=" + Math.floor(Date.now() / 300000), 12000);
  if (!j || typeof j !== "object" || Array.isArray(j) || !j.data || typeof j.data !== "object")
    throw new Error("the evacuation mirror is not a mirror document");
  const at = Date.parse(j.fetchedAt);
  const age = Date.now() - at;
  if (!Number.isFinite(at) || age < -600000)
    throw new Error("the evacuation mirror has no usable fetchedAt");
  if (age >= maxAgeMin * 60000)
    throw new Error("the evacuation mirror is " + Math.round(age / 60000) + " min old, past its " + maxAgeMin + " min gate");
  return j.data;
}

/* R3 on one line: mark every guarded fire in view. f.guarded is the reason object exactly
 * when the fleet may never work that fire; needsShip, the map, the tables and the cockpit
 * all read it, so the reason shown is the reason enforced. */
export function applyGuard(fires) {
  if (S.guard && S.guard.ok) {
    const checked = loadGuard(S.guard.doc, { viewFires: fires });
    if (!checked.ok) { S.guard = checked; setView(S.day, checked.reason); }
  }
  for (const f of fires) {
    const g = guardedFire(S.guard, f, { seasonOfNote: S.seasonOfNote });
    if (g && (g.why === "invalid-fire" || g.why === "invalid-geometry")) setView(S.day, g.reason);
    if (f) f.guarded = g;
  }
  return fires.filter(Boolean);
}

/* Is this date inside a no-fleet window? (dayKind answers the same question with the
 * reason attached; this is the boolean for choosing which sentence the page says.) */
function inWindow(G, date) {
  return !!(G && G.ok && (G.noFleet || []).some(w => date >= w.from && date <= w.to));
}

/* The newest dated day the guard allows a fleet on. ?data=snapshot and the mirror's
 * failure fallback both resolve to this, so the bundled sample is always a fleet day and
 * the old 8 August snapshot is never shown with a fleet. Null when no day qualifies — a
 * guard that failed to load says no to every date. */
export function latestFleetDay() {
  const days = S.dayList.map(d => d.date).slice().sort();
  for (let i = days.length - 1; i >= 0; i--)
    if (dayKind(S.guard, days[i]).fleet) return days[i];
  return null;
}

/* Set the view's mode once its date is known. Everything downstream — the fleet, the map,
 * the panels — reads S.recordOnly. A forcedWhy (R6: the guard file unreadable, the day's
 * own files failed, nothing could be read) stands the fleet down whatever the calendar
 * says, and the reason in words is owed to the visitor. */
function setView(date, forcedWhy) {
  S.day = typeof date === "string" ? date : vancouverDate(Date.now());
  const k = dayKind(S.guard, S.day);
  S.recordOnly = !k.fleet || !!forcedWhy;
  S.recordWindow = !forcedWhy && inWindow(S.guard, S.day);
  S.standDown = S.recordOnly ? (forcedWhy || k.reason) : null;
}

/* One day's files, checked against the season index before they are trusted (R6: a day
 * file that fails its own checks stands the fleet down, never "fly anyway"). The index
 * pins each file's sha256, byte count and fetchedAt; the page compares the fetchedAt and
 * the feature count always, and the digest too wherever crypto.subtle exists — which is
 * every context this page is normally read in (https, localhost). */
async function fetchDayFile(rel, pin) {
  const url = "data/season/" + rel;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  let text = "";
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    text = await r.text();
  } catch (e) {
    throw new Error(rel + " did not answer (" + ((e && e.message) || e) + ")");
  } finally { clearTimeout(t); }
  let doc = null;
  try { doc = JSON.parse(text); } catch (e) { /* checked below */ }
  if (!doc || typeof doc !== "object" || !doc.data || !Array.isArray(doc.data.features))
    throw new Error(rel + " is not a day document");
  if (pin.count != null && doc.data.features.length !== pin.count)
    throw new Error(rel + " carries " + doc.data.features.length + " features; the season index pins " + pin.count);
  if (pin.fetchedAt && doc.fetchedAt !== pin.fetchedAt)
    throw new Error(rel + " was fetched at " + doc.fetchedAt + "; the season index pins " + pin.fetchedAt);
  if (pin.sha256 && typeof crypto !== "undefined" && crypto.subtle) {
    const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(dig), b => b.toString(16).padStart(2, "0")).join("");
    if (hex !== pin.sha256) throw new Error(rel + " does not match the digest pinned in the season index");
  }
  return doc;
}

/* Load one dated day (fires + perimeters) and set the view to it. Returns the normalized,
 * guard-marked fires. Throws only in ways the caller has decided how to say. */
async function loadDayView(d, tier, notes) {
  const fres = await fetchDayFile(d.fires.file, d.fires);
  if (!usable(fres.data)) throw new Error(d.fires.file + " carries no fires");
  let perims = null;
  try { perims = await fetchDayFile(d.perims.file, d.perims); }
  catch (e) { notes.push("no perimeters (" + why(e) + ")"); }
  S.usingFallback = true; S.tier = tier;
  S.fetchedAt = new Date(fres.fetchedAt);
  S.snapshotDate = fres.fetchedAt;
  S.dataNote = notes.join("; ");
  S.perimsOk = !!(perims && usable(perims.data));
  S.unknownDay = null;
  setView(d.date, null);
  return applyGuard(normalize(fres.data, perims && perims.data));
}

/* The built-in sample: the latest fleet day in the repository, whichever route asked for
 * it (?data=snapshot, or the live mirror failing). If no season day can be read — the
 * index or the guard is down — the committed snapshot is the last resort, dated by its own
 * retrievedAt and shown as the guard rules its day: its day is 8 August 2026, inside the
 * window, so the fleet stays down by the guard's own rule and not by accident. */
async function loadSample(tier, notes) {
  const date = latestFleetDay();
  if (date) {
    const d = S.dayList.find(x => x.date === date);
    S.daySource = "sample";
    try { return await loadDayView(d, tier, notes); }
    catch (e) { notes.push("season day " + date + ": " + why(e)); }
  }
  try {
    const snap = await fetchJSON("data/snapshot.json", 20000);
    S.usingFallback = true; S.tier = tier; S.daySource = "sample";
    S.fetchedAt = new Date(snap.retrievedAt || Date.now());
    S.snapshotDate = snap.retrievedAt;
    S.perimsOk = true; S.unknownDay = null;
    notes.push("shown from the committed snapshot; the season days could not be read");
    S.dataNote = notes.join("; ");
    setView(vancouverDate(S.fetchedAt.getTime()), null);
    return applyGuard(normalize(snap.fires, snap.perimeters));
  } catch (e) {
    notes.push("snapshot: " + why(e));
  }
  S.usingFallback = true; S.tier = "none"; S.fetchedAt = null;
  S.dataNote = notes.join("; "); S.perimsOk = false;
  setView(null, "nothing could be read: " + notes.join("; "));
  return [];
}

export async function loadLive() {
  await loadSeason();
  if (EXERCISE) return loadExercise(normalize, fetchDayFile);

  /* A dated status day, through the same code path as live data. */
  if (DAY) {
    S.daySource = "day";
    if (!S.dayList.length) {
      S.tier = "none"; S.usingFallback = true; S.fetchedAt = null; S.perimsOk = false;
      S.dataNote = "the season index did not load" + (S.seasonNote ? " (" + S.seasonNote + ")" : "");
      S.fires = [];
      setView(DAY, "the season index did not load, so no dated day can be read");
      return [];
    }
    const d = S.dayList.find(x => x.date === DAY);
    if (!d) {
      S.tier = "none"; S.usingFallback = true; S.fetchedAt = null; S.perimsOk = false;
      S.dataNote = ""; S.fires = [];
      S.unknownDay = DAY;
      setView(DAY, "no dated copy of " + DAY + " is in this repository");
      return [];
    }
    try {
      return await loadDayView(d, "day", []);
    } catch (e) {
      // R6: a day file that fails its own checks is not flown around, and the visitor is
      // told which check failed rather than being handed a silent blank map.
      S.tier = "none"; S.usingFallback = true; S.fetchedAt = null; S.perimsOk = false;
      S.dataNote = why(e); S.fires = [];
      setView(d.date, "the day's own files failed their checks (" + why(e) + ")");
      return [];
    }
  }

  if (REPLAY) return await loadSample("replay", []);

  // Live: our own mirror first. Every mirror failure is recorded before anything falls back.
  const notes = [];
  let got = null, perims = null;
  try {
    const fr = await mirrorJSON("fires", 45);
    if (usable(fr.data)) {
      got = fr;
      try { perims = await mirrorJSON("perims", 90); }
      catch (e) { notes.push("no perimeters (" + why(e) + ")"); }
    } else notes.push("mirror carried no fires");
  } catch (e) { notes.push("mirror: " + why(e)); }

  if (got) {
    S.usingFallback = false; S.tier = "mirror"; S.daySource = "live";
    S.fetchedAt = new Date(Date.now() - got.age);
    S.dataNote = notes.join("; ");
    // "Perimeters arrived" has to mean outlines are on the map, not merely that the layer
    // answered: an empty collection draws nothing and must not be described as perimeters.
    S.perimsOk = usable(perims && perims.data);
    S.unknownDay = null;
    // The evacuation record a live view is guarded by: the season's ever-record, widened by
    // the mirror's copy when it answered (V4). A mirror copy that is missing or stale keeps
    // the season's record and the note says so; a copy that answered but cannot be read
    // stands the whole guard down, by loadEvac's own words.
    let evacDoc = null;
    try { evacDoc = await mirrorEvac(90); } catch (e) { /* the season's copy answers */ }
    const joined = liveEvac(S.evacSeason, evacDoc);
    S.evacFrom = joined.from;
    S.guard = loadGuard(S.guardDoc, { ...S.guardCtx, evac: joined.state });
    // R2: live is a fleet view unless today, in Vancouver, is inside a no-fleet window.
    setView(null, null);
    return applyGuard(normalize(got.data, perims && perims.data));
  }

  // A refresh that failed with a good live picture already on screen keeps that picture
  // AND its provenance — it really did come from the mirror, at the time it says — and the
  // age in the status line goes on growing, the honest signal that the page has stopped
  // being able to update itself. Switching to the sample mid-view would be a mode change
  // the visitor did not ask for.
  if (S.daySource === "live" && S.fires.length) {
    S.dataNote = notes.join("; ");
    return S.fires;
  }

  // The mirror did not answer: the latest fleet day in the repository, dated on the page
  // and never called live.
  return await loadSample("snapshot", notes.concat(["mirror unavailable"]));
}

export function needsShip(f) {
  // The guard decides first (R3): a fire that was a wildfire of note, or that led to
  // evacuation orders or alerts, is never a candidate whatever its status — those fires are
  // about people, and the page does not replay them with a fleet in the picture. Beyond
  // that, the demonstration responds only to fires actually out of control; held and
  // under-control fires stay on the map with no simulated allocation.
  if (!f || f.guarded) return false;
  return f.status === "Out of Control";
}

/* The mode sentence, in the words the ruling fixed (R7: only the braces are filled). One
 * place writes it so the status line, the tests and the fallback generator all quote the
 * same source. The record-day sentence names the window in the guard file's own dates. */
export function modeWords() {
  // An exercise that did not load shows nothing, and says so instead of describing a map.
  if (S.exercise)
    return S.recordOnly ? "No exercise is shown, because " + nothingWhy() + ". No fleet is simulated."
      : EXERCISE_MODE;
  if (S.unknownDay)
    return S.unknownDay + " has no dated copy in this repository: nothing is shown for that " +
      "day, and no fleet is simulated for it.";
  // Nothing was read at all: there is no record on screen for the record sentence to name.
  if (S.tier === "none")
    return "No fire data is shown, because " + nothingWhy() + ". No fleet is simulated.";
  const date = S.day || vancouverDate(Date.now());
  const time = S.fetchedAt ? vancouverClock(S.fetchedAt.getTime()) : "an unstated time";
  if (S.recordOnly) {
    const open = date + ": the fires as British Columbia published them at " + time + ". ";
    if (S.recordWindow)
      return open + "No fleet is simulated for 8 to 27 August 2026. The province was under a " +
        "state of emergency, and this page does not replay those days with a different ending.";
    return open + "No fleet is simulated for this view: " + S.standDown + ".";
  }
  // "Live" only when the mirror answered; every dated view is a replay of its day.
  const lead = S.daySource === "live" ? "Live " + date : "Replay of " + date;
  return lead + ": the fires as British Columbia published them at " + time + ". The fleet is " +
    "simulated and never flew. Its drops are water released, not water arrived, and " +
    "nothing here says any fire would have burned differently.";
}

/* True when no fire record is on screen at all: a day this repository holds no copy of, or
 * a view where nothing could be read. Every sentence that describes "the record" asks this
 * first, because an empty map has no record to describe. */
export function nothingShown() {
  // The exercise has one stand-down, in exercise.js: it could not be read.
  return S.exercise ? S.recordOnly : !!S.unknownDay || S.tier === "none";
}

/* Why nothing is shown, as a clause that ends a sentence. */
export function nothingWhy() {
  return S.unknownDay ? "this repository holds no dated copy of " + S.unknownDay
    : S.standDown || "nothing could be read";
}

/* What the view calls itself outside the map: the header strip, the tab title and the
 * description tags. Written here, from the same state as the chip and the mode sentence,
 * so that a replay never wears the live label, a view with no fleet never promises one and
 * an empty view never names a record. The static head in index.html names no one view: a
 * link preview and a reader without scripts get it on every address. */
/* The first-visit screen's phrases that name the view. It opens only where a fleet is
 * simulated, so there are three cases: the exercise, the live feed, a dated replay. */
export function introWords() {
  if (S.exercise)
    return { tap: "Invented fires · a simulated fleet", mapHead: "The map · exercise",
      mapBody: "Every fire is invented. Real terrain and lakes; a simulated fleet. Drag, zoom, select an exercise fire.",
      fires: "the invented exercise fires" };
  if (S.daySource === "live")
    return { tap: "Live BC fires · a simulated fleet drawn over them", mapHead: "The map · live",
      mapBody: "Today's real BC fires and satellite heat. The moving ships are simulated. Drag, zoom, click anything for its record.",
      fires: "the live fires" };
  return { tap: "BC fires of " + S.day + " · a simulated fleet drawn over them", mapHead: "The map · " + S.day,
    mapBody: "The real BC fires of " + S.day + ", as published. The moving ships are simulated. Drag, zoom, click anything for its record.",
    fires: "the fires of " + S.day };
}

export function viewLabels() {
  const site = "Pink Robotics fleet monitor";
  const mode = modeWords();
  if (S.exercise && !S.recordOnly)
    return { fires: "exercise · invented fires", fleet: "simulated fleet",
      title: "Exercise · invented fires · " + site,
      ogTitle: "Exercise: invented fires, real terrain, a simulated fleet.",
      description: mode, ogDescription: mode };
  if (nothingShown()) {
    const what = S.exercise ? "exercise unavailable"
      : S.unknownDay ? "no dated copy of " + S.unknownDay : "no fire data";
    const What = what[0].toUpperCase() + what.slice(1);
    return { fires: what, fleet: "no fleet simulated", title: What + " · " + site,
      ogTitle: What + ". Nothing is shown.", description: mode, ogDescription: mode };
  }
  const live = S.daySource === "live";
  const fires = live ? "live BC fires" : "BC fires of " + S.day;
  if (S.recordOnly)
    return { fires, fleet: "no fleet simulated",
      title: (live ? "Live BC fires" : fires) + " · no fleet simulated · " + site,
      ogTitle: (live ? "Live BC fires" : "The fires of " + S.day) + ", as published. No fleet is simulated.",
      description: mode, ogDescription: mode };
  if (live)
    return { fires, fleet: "simulated fleet",
      title: "Pink Robotics — autonomous fleet monitor: live BC fires, a simulated fleet, every number computed",
      ogTitle: "Live fires. A simulated fleet. Arithmetic you can check.",
      description: "Current BC wildfire data paired with a simulated fleet of sixteen vacuum airships shared across the largest out-of-control fires, with the physics, the energy budgets and the limits of the idea computed in the open. The fires are real; the fleet is simulated.",
      ogDescription: "Current BC wildfires from public data; a simulated fleet of autonomous vacuum airships cycling water onto them. The monitor shows what the proposed machines are modelled to do and what each cycle would cost — not a promise that any fire goes out." };
  return { fires, fleet: "simulated fleet", title: fires + " · simulated fleet · " + site,
    ogTitle: "The fires of " + S.day + ". A simulated fleet. Arithmetic you can check.",
    description: mode, ogDescription: mode };
}

/* The guard note (R7), in the words the ruling fixed: the layers panel carries it beside
 * the data note, and the cockpit gives a guarded fire this same reason — never "queued",
 * never "the allocator gave this fire no ship", because neither is true. The evacuation
 * sentence names the province's own public record as the reason those fires are held out
 * (V5: one sentence, plain words, no community named); on a live view reading the season's
 * captured copy because the mirror's is missing or stale, the sentence says that too. */
export function guardNoteWords() {
  if (S.exercise) return EXERCISE_NOTE;
  const clause = S.daySource === "live" && S.evacFrom !== "live"
    ? ", read here from the season's captured copy because the live copy is missing or stale"
    : "";
  return "The simulated fleet never works a fire that was a wildfire of note or led to an " +
    "evacuation order or alert, and it keeps " + noteKm(S.guard) + " km from those that " +
    "forced people out. Fires under an evacuation order or alert on any captured day are " +
    "held out by the province's own public record of orders and alerts" + clause +
    ". The list and its sources are in data/season/2026.guard.json.";
}

export async function fetchWind() {
  clearTimeout(fetchWind._expiry);
  const act = S.missions.filter(m => m.water && m.cls);
  // Clear the previous forecast even on a failed refresh: missing wind is labelled, and the plan uses still air.
  for (const m of act) m.wind = null;
  S.windOk = false; S.windAt = null;
  // The wind mirror describes today's air. A dated day has no forecast to replay honestly
  // and no fleet to carry one, so day and sample views fly in still air, labelled as such.
  S.windNote = S.daySource === "live" ? (act.length ? "loading mirror" : "mirror unavailable")
    : S.exercise ? "exercise; no forecast is invented"
    : S.recordOnly ? "no fleet is simulated" : "a dated day replays no forecast";
  renderStatus();
  if (S.daySource !== "live" || !act.length) return;
  try {
    const grid = readWind(await fetchJSON("data/live/wind.json?ts=" +
      Math.floor(Date.now() / 300000), 12000));
    const winds = act.map(m => windForMission(grid, m));
    act.forEach((m, i) => { m.wind = winds[i]; });
    S.windOk = true; S.windAt = new Date(grid.fetchedAt); S.windNote = "";
    fetchWind._expiry = setTimeout(fetchWind, Math.max(1, Math.min(
      grid.fetchedAt + WIND_MAX_AGE_MS, grid.forecastAt + 2 * 3600000) - Date.now() + 1));
  } catch (e) { S.windNote = why(e); }
  // S.heat must be passed: planTargets scores candidate lines partly on how hot the
  // satellite detections along them are, and it takes that data as an argument so the
  // model can run with no feed. Omitting it silently reverts to geometry-only scoring.
  for (const mm of S.missions) if (!mm.idle) planTargets(mm, S.heat);
  replanAll(); renderStatus();
}

export async function fetchHeat() {
  // The satellite detections the heat overlay draws are a live layer. A status day is the
  // published record of one date and carries none, so day and sample views load no heat —
  // and yesterday's detections must never guide missions on another day's fires anyway.
  if (S.daySource !== "live") { S.heat = []; applyHeat(); return; }
  try {
    const hr = await mirrorJSON("heat", 90, 25000);
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
      m.refusedTargets = []; // These are detection targets, with a different footprint rule.
      m.segs = picks.map(t => dropSeg(m, t, true));
      m.heat = true;
      planTargets(m, S.heat);
      const hit = missionBlocked(S.regions, m);
      if (hit) {
        m.refused = true;
        f.heldOut = "not flown: the heat-refined release line or track enters the keep-out around " + hit.who;
      }
    }
  }
  if (S.sel?.m?.refused) S.sel = {type:"fire", f:S.sel.m.fire};
  S.missions = S.missions.filter(m => !m.refused);
  for (const f of S.fires) f.mission = S.missions.find(m => m.fire === f) || null;
  S.uncovered = S.fires.filter(f => needsShip(f) && !f.mission).length;
  renderRoster(); renderFires(); replanAll();
}
