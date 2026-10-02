/* The guard: the days and the fires the simulated fleet must not touch.
 *
 * WHY THIS EXISTS. The monitor flies an imagined fleet over real wildfires, and the 2026
 * season it replays includes days and fires where what happened to people is the only fact
 * that matters. The project's rule is that a tragedy is never replayed with a better
 * ending: so there are days the fleet is not simulated at all, fires it never works no
 * matter their status, and distances it keeps from the fires that forced people out. Those
 * decisions are data, not code: they live in data/season/2026.guard.json, written by hand
 * with a source link per entry, and this module is the one place that reads them.
 *
 * WHAT THIS MODULE IS ALLOWED TO DO. Nothing but arithmetic: no DOM, no fetch, no clock.
 * Every function is a function of its arguments. The page loads the guard file and hands
 * the parsed object to loadGuard(); tests hand it invented objects with the same shape, and
 * deliberately broken ones, because a guard that fails open is worse than no guard.
 *
 * THE WAYS A FIRE IS GUARDED. Two records are read together: the guard file's hand
 * entries, and the derived evacuation record (which fires were ever under an order or
 * alert, by number, from the province's own public layer). Where both hold an entry for
 * one fire, the stricter keep-out wins — the data may tighten a hand entry, never loosen
 * it — and a tie keeps the hand entry, so what was written by hand keeps its own tier and
 * its own words. A fire held by an order takes the file's default distance; a fire held
 * by an alert alone is never worked and claims no air, exactly as the hand list's own
 * alert entries do. Beyond those two records, in this order:
 *   of-note     the day's own data flags it a wildfire of note (`note` on the fire). An
 *               unlisted fire of note gets the file's default distance.
 *   season-note the season record marked it a fire of note then or earlier. The season file
 *               is hindsight, and hindsight is not allowed to send the fleet anywhere —
 *               but it is allowed to refuse. This use only ever subtracts.
 *
 * An order AREA is ground in its own right: every outline the evacuation record carries is
 * a keep-out region on every view, whether or not the fire it belongs to is in view, in
 * addition to the fire's own distance. And the evacuation record is held to the same rule
 * as the guard file: one that cannot be read is a refusal said in words — the fleet stands
 * down — never a quiet emptiness that would fly what it failed to read.
 */
import { bez, havKm } from './geo.js?v=762fdcfd';

/* Dates here are America/Vancouver calendar dates, YYYY-MM-DD, and they ARRIVE as strings:
 * sim/ touches no clock, so the epoch→date conversion (app/dates.js) is the caller's job.
 * The no-fleet window is defined in those dates. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASES = ["loss", "order", "alert", "new"];

function isDate(s) {
  return typeof s === "string" && DATE.test(s);
}

/* A fire number the way every season file writes it: one capital letter, then digits.
 * This is the join key between the evacuation record and everything else the guard
 * knows, so a value that could not match a fire is a refusal, not a shrug. */
export function fireNumber(value) {
  if (typeof value !== "string") return null;
  const n = value.trim().toUpperCase();
  return /^(?:[A-Z][0-9]{5}|[A-Z]{2}[0-9]{4})$/.test(n) ? n : null;
}

/* An outline as the derived record publishes it: a closed ring of lon/lat pairs, at
 * least a triangle plus its closing point, every coordinate a finite number. */
function isRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every((p) => Array.isArray(p)
    && p.length === 2 && typeof p[0] === "number" && isFinite(p[0])
    && typeof p[1] === "number" && isFinite(p[1]))
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1];
}

/**
 * Parse and validate the derived evacuation record (data/season/<year>.evac.json, or the
 * live mirror's reduced copy of the same shape). Returns a state object; check `.ok`
 * first. `byNumber` maps each fire to its entry; `orders` is one {who, ring} per order
 * outline, every ever-order fire's, in record order. The outlines are kept exactly as
 * given — the record's own stated tolerance did the simplifying, and this module does no
 * geometry beyond reading them.
 *
 * A record that fails any check is a refusal in words. An unreadable record must not
 * become "no fires under order": that is the one answer that would fly what it failed
 * to read.
 *
 * @param {object} doc the parsed derived evacuation record
 */
export function loadEvac(doc) {
  const bad = (reason) => ({ ok: false, reason, byNumber: new Map(), orders: [] });
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    return bad("the evacuation record is missing or not an object");
  if (!Array.isArray(doc.fires)) return bad("the evacuation record has no fires list");
  const byNumber = new Map(), orders = [];
  for (let f of doc.fires) {
    if (!f || typeof f !== "object") return bad("an evacuation entry is not an object");
    if (!fireNumber(f.fire))
      return bad(`an evacuation entry's number ${JSON.stringify(f.fire) ?? ""} is not a fire number`);
    f = { ...f, fire: fireNumber(f.fire) };
    if (byNumber.has(f.fire)) return bad(`${f.fire}: listed twice`);
    if (typeof f.everOrder !== "boolean" || typeof f.everAlert !== "boolean")
      return bad(`${f.fire}: everOrder and everAlert must each be true or false`);
    if (!f.everOrder && !f.everAlert)
      return bad(`${f.fire}: under neither an order nor an alert, so no record holds it`);
    if (!isDate(f.firstSeen) || !isDate(f.lastSeen) || f.firstSeen > f.lastSeen)
      return bad(`${f.fire}: firstSeen and lastSeen must be dates, in order`);
    if (!Array.isArray(f.orderOutlines))
      return bad(`${f.fire}: orderOutlines is missing`);
    if (!f.everOrder && f.orderOutlines.length)
      return bad(`${f.fire}: carries order outlines without ever being under an order`);
    for (const ring of f.orderOutlines)
      if (!isRing(ring))
        return bad(`${f.fire}: an order outline is not a closed ring of at least four points`);
    byNumber.set(f.fire, { fire: f.fire, everOrder: f.everOrder, everAlert: f.everAlert,
                           firstSeen: f.firstSeen, lastSeen: f.lastSeen,
                           orderOutlines: f.orderOutlines });
    for (const ring of f.orderOutlines)
      orders.push({ who: `${f.fire}'s evacuation order area`, ring });
  }
  return { ok: true, reason: null, byNumber, orders };
}

/** The union of two evacuation states — the season's ever-record widened by the live
 *  mirror's copy. EVER only grows: a rescinded order cannot un-order a fire the captured
 *  days already hold, so nothing narrows and nothing is dropped. Rings the two records
 *  carry identically are kept once; a ring only one holds is kept on its own. A state
 *  that is not ok is returned untouched: the refusal stands and merges with nothing. */
export function mergeEvac(base, add) {
  if (!base || !base.ok) return base;
  if (!add || !add.ok) return add;
  const byNumber = new Map();
  const put = (f) => {
    const have = byNumber.get(f.fire);
    if (!have) { byNumber.set(f.fire, f); return; }
    have.everOrder = have.everOrder || f.everOrder;
    have.everAlert = have.everAlert || f.everAlert;
    if (f.firstSeen < have.firstSeen) have.firstSeen = f.firstSeen;
    if (f.lastSeen > have.lastSeen) have.lastSeen = f.lastSeen;
    for (const ring of f.orderOutlines)
      if (!have.orderOutlines.some((r) => JSON.stringify(r) === JSON.stringify(ring)))
        have.orderOutlines = have.orderOutlines.concat([ring]);
  };
  for (const f of base.byNumber.values()) put({ ...f, orderOutlines: f.orderOutlines.slice() });
  for (const f of add.byNumber.values()) put({ ...f, orderOutlines: f.orderOutlines.slice() });
  const orders = [];
  for (const f of byNumber.values())
    for (const ring of f.orderOutlines) orders.push({ who: `${f.fire}'s evacuation order area`, ring });
  return { ok: true, reason: null, byNumber, orders };
}

/** The evacuation state a LIVE view guards by: the season's ever-record, widened by the
 *  live mirror's copy when that answered — the mirror sees orders the captured days have
 *  not, and the captured days hold orders the mirror has since seen rescinded. A mirror
 *  copy that is missing does not narrow the season record, still less does it become "no
 *  orders": the view keeps what it has and `from` says which record it is showing, so the
 *  page can say so. A copy that is present but unreadable is not an operational silence
 *  to fall back from but a corrupted record: the refusal comes back and the fleet stands
 *  down by it. */
export function liveEvac(base, doc) {
  if (doc == null) return { state: base, from: "season" };
  const live = loadEvac(doc);
  if (!live.ok) return { state: live, from: "unreadable" };
  return { state: mergeEvac(base, live), from: "live" };
}

/**
 * Parse and validate the guard file. Returns a state object; check `.ok` first.
 *
 * @param {object}  doc  the parsed data/season/2026.guard.json
 * @param {object?} ctx  {seasonNumbers?, seasonOfNote?, viewFires?, evac?} — the season
 *                       record's fire numbers, the numbers it flags as fires of note, and
 *                       the fires in view, so an entry that resolves to no fire at all can
 *                       be named (without seasonNumbers that check is skipped, in tests);
 *                       and `evac`, loadEvac's state for the derived evacuation record,
 *                       carried on the guard state for guardedFire and keepOutsFor. An
 *                       `evac` that did not load fails the whole guard: see above.
 */
export function loadGuard(doc, ctx = {}) {
  const bad = (reason) => ({ ok: false, reason, fires: [], places: [], noFleet: [] });
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return bad("the guard file is not an object");
  if (typeof doc.defaultKeepOutKm !== "number" || !(doc.defaultKeepOutKm > 0))
    return bad("defaultKeepOutKm is missing or not a positive distance");

  if (!Array.isArray(doc.noFleet)) return bad("noFleet is missing");
  const noFleet = [];
  for (const w of doc.noFleet) {
    if (!w || typeof w !== "object" || !isDate(w.from) || !isDate(w.to) || w.from > w.to
        || typeof w.basis !== "string" || !w.basis || typeof w.source !== "string"
        || !/^https?:\/\//.test(w.source))
      return bad(`a no-fleet window is not {from, to, basis, source} with a link`);
    noFleet.push({ from: w.from, to: w.to, basis: w.basis, source: w.source });
  }

  if (!Array.isArray(doc.fires)) return bad("fires is missing");
  const seasonNumbers = ctx.seasonNumbers ? new Set([...ctx.seasonNumbers].map(fireNumber)) : null;
  const viewIds = new Set((ctx.viewFires || []).map((f) => fireNumber(f && f.id)));
  const byNumber = new Map(), fires = [];
  for (let e of doc.fires) {
    if (!e || typeof e !== "object") return bad("a fire entry is not an object");
    const number = fireNumber(e.fire);
    if (!number) return bad("a fire entry has no valid fire number (one letter and five digits, or two letters and four digits)");
    e = { ...e, fire: number };
    if (typeof e.name !== "string" || !e.name) return bad("a fire entry has no name");
    if (![1, 2, 3].includes(e.tier)) return bad(`${e.name}: tier must be 1, 2 or 3`);
    if (!BASES.includes(e.basis)) return bad(`${e.name}: basis must be one of ${BASES.join(", ")}`);
    if (typeof e.keepOutKm !== "number" || e.keepOutKm < 0) return bad(`${e.name}: keepOutKm is not a distance`);
    if (typeof e.source !== "string" || !/^https?:\/\//.test(e.source))
      return bad(`${e.name}: no source link`);
    if (byNumber.has(e.fire)) return bad(`${e.fire}: listed twice`);
    byNumber.set(e.fire, e);
    if (seasonNumbers && !seasonNumbers.has(e.fire) && !viewIds.has(e.fire))
      return bad(`${e.fire} (${e.name}) is in no season record and no view: it cannot be resolved`);
    fires.push(e);
  }

  if (!Array.isArray(doc.places)) return bad("places is missing");
  const places = [];
  for (const p of doc.places) {
    if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name
        || !isDate(p.date) || typeof p.keepOutKm !== "number" || p.keepOutKm < 0
        || !Array.isArray(p.ll) || p.ll.length !== 2
        || typeof p.ll[0] !== "number" || typeof p.ll[1] !== "number"
        || !BASES.includes(p.basis) || typeof p.source !== "string"
        || !/^https?:\/\//.test(p.source))
      return bad(`a place entry is not {name, ll, date, basis, keepOutKm, source}`);
    places.push(p);
  }

  // The derived evacuation record rides with the guard file (loadEvac's state, not the
  // raw doc): present but unreadable, it stands the whole guard down — a malformed
  // evacuation record is a refusal said in words, not a fleet over unread ground. Absent
  // (no ctx.evac), the guard is exactly what it was: the hand list and the day's flags.
  let evac = null;
  if ("evac" in ctx) {
    evac = ctx.evac;
    if (!evac || typeof evac !== "object" || typeof evac.ok !== "boolean")
      return bad("ctx.evac is not an evacuation record state (loadEvac's result)");
    if (!evac.ok) return bad(`the evacuation record cannot be read: ${evac.reason}`);
  }

  return {
    ok: true, reason: null, doc,
    defaultKeepOutKm: doc.defaultKeepOutKm, noFleet, fires, places, byNumber, evac,
    seasonOfNote: ctx.seasonOfNote ? new Set([...ctx.seasonOfNote].map(fireNumber)) : null,
  };
}

/** Is the fleet simulated on this date? A guard state that failed to load stands the fleet
 *  down everywhere, and says why in words — the caller owes the page that sentence. */
export function dayKind(G, date) {
  if (!G || !G.ok) return { fleet: false, reason: G && G.reason ? G.reason : "the guard file did not load" };
  if (!isDate(date)) return { fleet: false, reason: `${date} is not a date` };
  for (const w of G.noFleet)
    if (date >= w.from && date <= w.to)
      return { fleet: false, reason: `${date} is inside the no-fleet window ${w.from} to ${w.to}` };
  return { fleet: true, reason: null };
}

/** Why a fire in view is guarded, or null if it is not. `fire` is a normalized fire: id,
 *  name, note (the day's own of-note flag), ring and sizeHa carry the geometry. */
export function guardedFire(G, fire, ctx = {}) {
  if (!G || !G.ok) return { why: "guard-down", tier: null, basis: null, keepOutKm: 0 };
  const id = fireNumber(fire && fire.id);
  // Invented identifiers are accepted only on a fire explicitly marked as an exercise.
  if (!id && !(fire && fire.exercise === true && /^EX[0-9]{3}$/.test(fire.id)))
    return { why: "invalid-fire", reason: "a fire number is missing or is not one letter and five digits, or two letters and four digits",
             tier: null, basis: null, keepOutKm: 0 };
  const e = G.byNumber.get(id) || null;
  // The derived evacuation record, by number only. An order carries the file's default
  // distance; an alert alone holds the fire and claims no air. Where a hand entry and the
  // record both speak, the stricter keep-out wins (data tightens the hand list, never
  // loosens it), and a tie keeps the hand entry so a hand-written tier and basis stand.
  const d = id && G.evac ? G.evac.byNumber.get(id) || null : null;
  const dKm = d ? (d.everOrder ? G.defaultKeepOutKm : 0) : -1;
  if (e && e.keepOutKm >= dKm)
    return { why: "listed", tier: e.tier, basis: e.basis, keepOutKm: e.keepOutKm, entry: e };
  if (d)
    return { why: "evac", tier: d.everOrder ? 2 : 3, basis: d.everOrder ? "order" : "alert",
             keepOutKm: dKm, entry: d };
  if (fire.note)
    return { why: "of-note", tier: null, basis: "of note", keepOutKm: G.defaultKeepOutKm };
  // Coerced rather than trusted: a caller handing an array here (a test, a future page)
  // would otherwise crash on .has, and a crash in this function is a refusal that forgot
  // to say so. Sets pass through untouched.
  const season = new Set([...(ctx.seasonOfNote || G.seasonOfNote || [])].map(fireNumber));
  if (id && season.has(id))
    return { why: "season-of-note", tier: null, basis: "of note", keepOutKm: G.defaultKeepOutKm };
  return null;
}

/** The fires' own radius, in km, the way the model draws them (targets.js insideFire). */
function fireRadiusKm(fire) {
  return Math.sqrt(Math.max(fire.sizeHa || 0, 10) * 1e4 / Math.PI) / 1000;
}

/* A perimeter edge is generalised, so a single edge can run for kilometres: sample each
   edge at ~2 km so "within X of the outline" is measured against the line, not only the
   vertices. Pure arithmetic on lon/lat; good to well inside the 25 km scales here. */
function ringPoints(ring, stepKm = 2) {
  const pts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const d = havKm(a, b);
    const n = Math.max(1, Math.ceil(d / stepKm));
    for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  pts.push(ring[ring.length - 1]);
  return pts;
}

function insideRing(ring, pt) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (((ring[i][1] > pt[1]) !== (ring[j][1] > pt[1])) &&
        (pt[0] < (ring[j][0] - ring[i][0]) * (pt[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]))
      inside = !inside;
  }
  return inside;
}

/**
 * The keep-out regions for one view: every guarded fire in it that carries a distance,
 * every place entry whose date this is, and every order area the evacuation record
 * carries. A guarded fire with keepOutKm 0 guards against being worked but claims no air.
 * A fire flagged of note by the day itself and missing from the file gets the default
 * distance (R4's default rule). The order areas answer to no view and no date: the record
 * is of orders the season itself saw, so each outline is keep-out ground on every view —
 * and the outline is the boundary, no buffer beyond it (rKm 0).
 *
 * @param {object}  G     the guard state
 * @param {Array}   fires the normalized fires in view
 * @param {object?} ctx   {seasonOfNote?}
 * @param {string?} date  the view's date, for place entries
 */
export function keepOutsFor(G, fires, ctx = {}, date = null) {
  if (!G || !G.ok) return [];
  const out = [];
  for (const f of fires) {
    const g = guardedFire(G, f, ctx);
    if (!g || !(g.keepOutKm > 0)) continue;
    const region = { kind: "fire", who: f.id || f.name, why: g.why, rKm: g.keepOutKm,
                     ll: f.ll, edge: null, ring: null };
    if (f.ring && f.ring.length > 2) {
      region.ring = f.ring;
      region.edge = ringPoints(f.ring);
    } else {
      region.rKm = g.keepOutKm + fireRadiusKm(f);
    }
    out.push(region);
  }
  if (date)
    for (const p of G.places)
      if (p.date === date && p.keepOutKm > 0)
        out.push({ kind: "place", who: p.name, why: "place", rKm: p.keepOutKm,
                   ll: p.ll.slice(), edge: null, ring: null });
  if (G.evac)
    for (const o of G.evac.orders)
      out.push({ kind: "evac-order", who: o.who, why: "evac-order", rKm: 0,
                 ll: null, ring: o.ring, edge: ringPoints(o.ring) });
  return out;
}

/** Is this point inside a keep-out region? Returns the region (for the message) or null. */
export function pointBlocked(regions, pt) {
  for (const r of regions) {
    if (r.ring && insideRing(r.ring, pt)) return r;
    const pts = r.edge || [r.ll];
    for (let i = 0; i < pts.length; i++)
      if (havKm(pts[i], pt) <= r.rKm) return r;
  }
  return null;
}

/** Does the straight path a→b enter a keep-out region? Sampled every `stepKm` (the drawn
 *  dispatch uses missionBlocked below for the actual bowed track and release line). */
export function pathBlocked(regions, a, b, stepKm = 1) {
  const d = havKm(a, b), n = Math.max(2, Math.ceil(d / stepKm) + 1);
  for (let k = 0; k < n; k++) {
    const pt = [a[0] + (b[0] - a[0]) * k / (n - 1), a[1] + (b[1] - a[1]) * k / (n - 1)];
    const hit = pointBlocked(regions, pt);
    if (hit) return hit;
  }
  return null;
}

/** The distance the layers-panel note names: the widest keep-out among entries that exist
 *  because people were forced out (a loss, an order). Falls back to the file default. */
export function noteKm(G) {
  let km = G && G.ok ? G.defaultKeepOutKm : 0;
  for (const e of (G && G.fires) || [])
    if ((e.basis === "loss" || e.basis === "order") && e.keepOutKm > km) km = e.keepOutKm;
  for (const p of (G && G.places) || [])
    if ((p.basis === "loss" || p.basis === "order") && p.keepOutKm > km) km = p.keepOutKm;
  return km;
}

/** Refuse a complete mission, without changing its geometry. stateAt flies two quadratic
 * curves per release line. Check every line with every possible current/next station;
 * never rely on a few observed cycles to cover the seeded jitter in segAt.
 *
 * Each curve is sampled at most 0.5 km apart in a deliberately overestimated metric
 * (112 km per degree on either axis). The region is expanded by half that gap, plus
 * the entire jitter envelope (including its effect on the bow controls), and by 1.1 km
 * for a polygon's sampled 2 km edge. This is conservative: a near miss may be refused.
 * Neither a path nor a policy distance is clipped, nudged or rewritten.
 */
export function missionBlocked(regions, m) {
  if (!regions.length || m.idle) return null;
  const stations = m.stations && m.stations.length ? m.stations : [m.intake];
  const metric = (a, b) => 112 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (const [a, b] of m.segs || [[m.delivery, m.delivery]]) {
    // Same coordinate transform as segAt, with both independent offsets at their bounds.
    const L = havKm(a, b), kx = 111.32 * Math.cos(a[1] * Math.PI / 180), ky = 110.57;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    let jitter = 0;
    if (L >= 0.05) for (const perp of [-1, 1]) for (const par of [-1, 1]) {
      const jp = perp * (m.heat ? .15 : .075) * L, ja = par * .125 * L;
      jitter = Math.max(jitter, 112 * Math.hypot((-dy * jp + dx * ja) / L / kx,
                                               (dx * jp + dy * ja) / L / ky));
    }
    // A control moves at most (0.5 + 0.09) times the endpoint displacement;
    // the convex quadratic weights keep the entire curve within this padded envelope.
    const padded = regions.map(r => ({ ...r, rKm: r.rKm + jitter * 1.2 + .25 + (r.edge ? 1.1 : 0) }));
    const curve = (p, c, q) => {
      const lengthBound = metric(p,c) + metric(c,q);
      const near = padded.filter(r => r.ring || havKm(p,r.ll) <= r.rKm + lengthBound);
      if (!near.length) return null;
      const n = Math.max(2, Math.ceil(4 * Math.max(metric(p, c), metric(c, q))));
      for (let i = 0; i <= n; i++) {
        const hit = pointBlocked(near, bez(p, c, q, i / n));
        if (hit) return regions[padded.indexOf(hit)];
      }
      return null;
    };
    let hit = curve(a, [(a[0]+b[0])/2, (a[1]+b[1])/2], b);
    if (hit) return hit;
    for (const st of stations) {
      const dX = a[0] - st[0], dY = a[1] - st[1];
      const out = [(st[0]+a[0])/2 - .09*dY, (st[1]+a[1])/2 + .09*dX];
      hit = curve(st, out, a);
      if (hit) return hit;
      for (const next of stations) {
        const back = [(next[0]+b[0])/2 + .09*dY, (next[1]+b[1])/2 - .09*dX];
        hit = curve(b, back, next);
        if (hit) return hit;
      }
    }
  }
  return null;
}
