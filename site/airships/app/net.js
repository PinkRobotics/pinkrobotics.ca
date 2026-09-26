/* Fetching, with a cache and a timeout. Knows about HTTP; knows nothing about fires.
 */
/* ============================================================================================
 * Application: data, map, interface. Everything below is presentation; the model is above.
 * ============================================================================================ */

export const FIRES_URL = "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/FeatureServer/0/query" +
  "?where=" + encodeURIComponent("FIRE_STATUS <> 'Out'") +
  "&outFields=FIRE_NUMBER,FIRE_STATUS,FIRE_CAUSE,INCIDENT_NAME,GEOGRAPHIC_DESCRIPTION,CURRENT_SIZE,IGNITION_DATE,FIRE_URL,FIRE_OF_NOTE_IND,RESPONSE_TYPE_DESC" +
  "&returnGeometry=true&outSR=4326&f=geojson";

export const PERIMS_URL = "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_FirePerimeters_PublicView/FeatureServer/0/query" +
  "?where=" + encodeURIComponent("FIRE_STATUS <> 'Out'") +
  "&outFields=FIRE_NUMBER,FIRE_STATUS,FIRE_SIZE_HECTARES,TRACK_DATE&returnGeometry=true&outSR=4326&maxAllowableOffset=0.002&f=geojson";

/* Every failure this can produce is tagged, because the caller has to tell them apart: a
 * feed that timed out may be worth retrying at the next tier, a feed that answered with
 * something that is not JSON will answer the same way in five minutes, and the visitor is
 * owed the difference in words. An untagged rejection is a transport failure — DNS, offline,
 * CORS, connection reset — and carries the browser's own message.
 *
 *   e.timeout    we aborted it ourselves after `ms`
 *   e.http       the server answered with a non-2xx status (the number is on the tag)
 *   e.malformed  it answered, but the body did not parse as JSON
 */
export async function fetchJSON(url, ms) {
  const lim = ms || 15000;
  const ctl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctl.abort(); }, lim);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { http: r.status });
    try {
      return await r.json();
    } catch (e) {
      // An abort during the body read is a timeout, not a malformed body; only decide it
      // is malformed once we know we did not cut it off ourselves.
      if (timedOut) throw e;
      throw Object.assign(new Error("malformed body"), { malformed: true });
    }
  } catch (e) {
    if (timedOut) {
      throw Object.assign(new Error("timed out after " + Math.round(lim / 1000) + " s"),
        { timeout: true });
    }
    throw e;
  } finally { clearTimeout(t); }
}

/* localStorage, treated as the convenience it is.
 *
 * Both reading and writing it THROW rather than return null in ordinary browsers: a Safari
 * or Firefox private window, any browser set to block site storage, an origin whose quota is
 * full, and — in Chromium — merely touching the `localStorage` global with third-party
 * storage blocked. One unguarded getItem during boot is therefore a blank page for a visitor
 * whose only unusual act was opening a private window. Nothing on this page needs storage:
 * without it the visitor gets the whole monitor and simply is not remembered.
 *
 * These two functions are the only place the page touches it. A failed read means "nothing
 * stored", a failed write means "this will not be remembered", and neither is worth
 * interrupting anyone over. */
export function storeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

export function storeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

/* Courtesy cache. These are emergency-services feeds under real load; this page must not
   add to it meaningfully. Every remote source is cached in localStorage with a TTL matched
   to how often the source actually updates — reloads and extra tabs cost the origin nothing
   until the data could actually have changed. Ages stay honest: a cached fire feed shows
   its true fetch time, not the reload time, whether it is served fresh, from within the TTL,
   or — when the feed has gone away entirely — from an expired entry. */
export async function cachedJSON(key, url, ttlMs, timeoutMs) {
  const K = "fleet:" + key;
  let cached = null;
  try {
    const raw = storeGet(K);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && typeof c.t === "number" && c.d != null) cached = c;
    }
  } catch (e) { /* unparseable cache entry: treat it as absent */ }
  if (cached && Date.now() - cached.t < ttlMs) return { data: cached.d, age: Date.now() - cached.t };
  try {
    const d = await fetchJSON(url, timeoutMs);
    storeSet(K, JSON.stringify({ t: Date.now(), d }));
    return { data: d, age: 0 };
  } catch (e) {
    // The feed is unreachable and the cache has expired. An expired copy of the real feed
    // still beats the committed snapshot, which is months old by the time anyone reads this
    // — but only while it is a picture of the same fire situation, and only because its
    // true age travels with it and reaches the status line. Six hours is the judgement
    // call: past that, a fire map can be wrong in ways the age alone does not convey, and
    // the snapshot at least says on its face that it is a snapshot.
    if (cached && Date.now() - cached.t < 21600000) return { data: cached.d, age: Date.now() - cached.t };
    throw e;
  }
}

/* The FIRST-PARTY mirror: pipeline/live.py fetches the emergency feeds on a timer,
 * server-side, and publishes them under data/live/ as {fetchedAt, data}. Visitors read the
 * mirror, so page traffic never multiplies load on the BC Wildfire Service or CWFIS — one
 * fetch per interval total, not one per viewer. The direct feed remains only as a fallback
 * for when the mirror is missing or has gone stale (the refresh job died), so honesty about
 * data age survives either path. The ?ts bucket busts any intermediate HTTP cache politely
 * — one new URL per five minutes. */
export async function mirrorJSON(name, maxAgeMin, timeoutMs) {
  const j = await fetchJSON("data/live/" + name + ".json?ts=" + Math.floor(Date.now() / 300000),
    timeoutMs || 12000);
  // A mirror file that is present but wrong is the likeliest failure here, not an absent
  // one: a half-written file, a 404 page served as JSON, a refresh job that wrote an error
  // document. Each is a DIFFERENT thing to tell the visitor, so each gets its own error
  // rather than all of them arriving as "stale" — which is what an unguarded Date.parse of
  // a missing field produces, since NaN fails the window test below.
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    throw Object.assign(new Error("mirror is not a mirror document"), { malformed: true });
  }
  const at = Date.parse(j.fetchedAt);
  if (!Number.isFinite(at)) {
    throw Object.assign(new Error("mirror has no usable fetchedAt"), { malformed: true });
  }
  const d = j.data;
  if (!d || typeof d !== "object" || !Array.isArray(d.features)) {
    throw Object.assign(new Error("mirror carries no feature collection"), { malformed: true });
  }
  const age = Date.now() - at;
  // Ten minutes of tolerance for a clock ahead of ours; further ahead than that is a broken
  // clock somewhere, and an age we cannot state is an age we must not show.
  if (age < -600000) {
    throw Object.assign(new Error("mirror is timestamped " + Math.round(-age / 60000) +
      " min in the future"), { malformed: true });
  }
  if (age >= maxAgeMin * 60000) {
    throw Object.assign(new Error("mirror is " + Math.round(age / 60000) + " min old, past its " +
      maxAgeMin + " min gate"), { stale: true, ageMs: age });
  }
  return { data: d, age: Math.max(0, age) };
}
