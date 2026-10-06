/* Choosing where the water goes: candidate drop lines across a fire, scored and sequenced.
 */
import { havKm, moveToward, trackBearing } from './geo.js?v=816a54f9';
import { SEED, hashFrac } from './rng.js?v=816a54f9';
import { CITIES } from './communities.js?v=816a54f9';

export function insideFire(fire, pt) {
  if (fire.ring) {
    let inside = false;
    const r = fire.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (((r[i][1] > pt[1]) !== (r[j][1] > pt[1])) &&
          (pt[0] < (r[j][0] - r[i][0]) * (pt[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]))
        inside = !inside;
    }
    return inside;
  }
  return havKm(fire.ll, pt) <= Math.sqrt(Math.max(fire.sizeHa, 10) * 1e4 / Math.PI) / 1000;
}

/* Geometric drop lines have both ends inside the modelled fire, or are refused.
   Detection lines use the detection's location and may extend outside the mapped outline.
   Containment is the model's endpoint predicate, not a surveyed ground-water pattern. */
export function dropSeg(m, center, isHeat) {
  const f = m.fire;
  const kx = 111.32 * Math.cos(center[1] * Math.PI / 180), ky = 110.57;
  // run across the approach direction, so lines rake the fire rather than stitching one axis
  const bDeg = trackBearing(m.intake, center) + 90;
  const ux = Math.sin(bDeg * Math.PI / 180), uy = Math.cos(bDeg * Math.PI / 180);
  const radKm = Math.sqrt(Math.max(f.sizeHa, 10) * 1e4 / Math.PI) / 1000;
  if (isHeat) {
    // A satellite detection IS burning ground, and heat runs ahead of the mapped polygon —
    // centre the line on the detection and clamp its length to the fire's own scale.
    const L = Math.min(m.cls.dropKm, Math.max(0.8, radKm * 1.2));
    const hx = ux * L / 2 / kx, hy = uy * L / 2 / ky;
    return [[center[0] - hx, center[1] - hy], [center[0] + hx, center[1] + hy]];
  }
  // Geometric targets: pull an edge point inward, then try bounded shorter lines.
  // Exhausting these candidates is a refusal, never an unchecked overhang.
  let c = center.slice();
  if (!insideFire(f, c)) c = moveToward(c, f.ll, Math.min(1.5, havKm(c, f.ll) * 0.45));
  for (const frac of [1, 0.7, 0.45, 0.25, 0.12]) {
    const hx = ux * m.cls.dropKm * frac / 2 / kx, hy = uy * m.cls.dropKm * frac / 2 / ky;
    const a = [c[0] - hx, c[1] - hy], b = [c[0] + hx, c[1] + hy];
    if (insideFire(f, a) && insideFire(f, b)) return [a, b];
  }
  const hx = ux * Math.min(m.cls.dropKm, radKm) / 2 / kx, hy = uy * Math.min(m.cls.dropKm, radKm) / 2 / ky;
  const fallback = [[c[0] - hx, c[1] - hy], [c[0] + hx, c[1] + hy]];
  return fallback.every(p => insideFire(f, p)) ? fallback : null;
}

/* The attack plan. Each candidate line is scored: head-fire alignment with the live wind
   (the downwind edge is where the fire is going), nearby detection intensity, and community
   exposure — the page's city list stands in for population data, weighted harder when the
   wind points the fire at a town. Targets are then sequenced so consecutive drops extend a
   line rather than scatter, and nothing repeats until every planned line has been treated.
   First-order triage, honestly labelled — not fire science. */
/**
 * Choose and order the drop lines for one mission.
 *
 * @param {object} m     the mission, mutated in place with `targets`, `segs` and `order`
 * @param {Array}  heat  satellite hotspots `{ll, temp}`; empty means fall back to geometry
 *
 * `heat` is passed in rather than read from a global because it is live external data:
 * the model has to be runnable, and testable, with no feed at all.
 */
export function planTargets(m, heat = []) {
  const f = m.fire, n = m.targets.length;
  if (!n) return;
  m.protect = null;
  const toDir = m.wind ? (m.wind.dir + 180) % 360 : null;
  const scores = [], reasons = [];
  for (let i = 0; i < n; i++) {
    const t = m.targets[i];
    let sc = 0;
    const why = [];
    if (toDir != null) {
      const align = Math.cos((toDir - trackBearing(f.ll, t)) * Math.PI / 180);
      sc += align * 2;
      why.push(align > 0.4 ? "the downwind head" : align < -0.4 ? "the upwind heel" : "a flank");
    } else why.push("a flank");
    if (m.heat && heat.length) {
      let hsum = 0;
      for (const hh of heat) {
        if (Math.abs(hh.ll[1] - t[1]) * 111 > 1.2) continue;
        if (havKm(hh.ll, t) < 1.2) hsum += hh.temp || 20;
      }
      const hn = Math.min(2, hsum / 150);
      sc += hn;
      if (hn > 1.1) why.push("hottest cluster");
    }
    let risk = 0, riskCity = null, riskDw = false;
    for (const ct of CITIES) {
      const d = havKm([ct[0], ct[1]], t);
      if (d > 40) continue;
      // populations first: inside ~10 km a community outranks everything else on the fire
      let rr = (ct[3] === 1 ? 3 : ct[3] === 2 ? 2 : 1) / Math.max(2, d);
      const dw = toDir != null && Math.cos((toDir - trackBearing(t, [ct[0], ct[1]])) * Math.PI / 180) > 0.5;
      if (dw) rr *= 3;
      if (rr > risk) { risk = rr; riskCity = ct; riskDw = dw; }
    }
    sc += Math.min(3.5, risk * 12);
    if (riskCity && risk * 12 > 1) why.push("near " + riskCity[2]);
    if (riskCity) {
      const dK = havKm([riskCity[0], riskCity[1]], t);
      if (!m.protect || risk > m.protect.risk)
        m.protect = { name: riskCity[2], dKm: dK, dw: riskDw, risk };
    }
    scores.push(sc + (hashFrac(f.id + "|" + i + "|" + SEED) - 0.5) * 1.2);
    reasons.push(why.join(" · "));
  }
  const remaining = m.targets.map((_, i) => i);
  const order = [remaining.splice(scores.indexOf(Math.max(...scores)), 1)[0]];
  while (remaining.length) {
    let bi = 0, bs = -Infinity;
    for (let r = 0; r < remaining.length; r++) {
      const i = remaining[r];
      const adj = Math.min(1.5, 1.2 / Math.max(0.5, havKm(m.targets[order[order.length - 1]], m.targets[i])));
      if (scores[i] + adj > bs) { bs = scores[i] + adj; bi = r; }
    }
    order.push(remaining.splice(bi, 1)[0]);
  }
  m.order = order;
  m.whyT = reasons;
}

export function tIdx(m, N) {
  const L = m.order ? m.order.length : m.targets ? m.targets.length : 1;
  if (!L) return 0;
  return m.order ? m.order[((N - 1) % L + L) % L] : Math.floor(hashFrac(m.fire.id + ":" + N) * L);
}

/* The drop line for cycle N: attempt the seeded shift. A geometric line keeps the
   shift only when both endpoints remain inside; otherwise use its checked base line. */
export function segAt(m, N) {
  const ti = tIdx(m, N);
  const base = m.segs ? m.segs[ti] : [m.delivery, m.delivery];
  const L = havKm(base[0], base[1]);
  if (L < 0.05) return base;
  const amp = (m.heat ? 0.3 : 0.15) * L;
  const jPerp = (hashFrac(m.fire.id + "~" + N + "~" + SEED) - 0.5) * amp;
  const jPar = (hashFrac(m.fire.id + "^" + N + "^" + SEED) - 0.5) * 0.25 * L;
  const kx = 111.32 * Math.cos(base[0][1] * Math.PI / 180), ky = 110.57;
  const dx = (base[1][0] - base[0][0]) * kx, dy = (base[1][1] - base[0][1]) * ky;
  const ux = dx / L, uy = dy / L;
  const ox = (-uy * jPerp + ux * jPar) / kx, oy = (ux * jPerp + uy * jPar) / ky;
  const shifted = [[base[0][0] + ox, base[0][1] + oy], [base[1][0] + ox, base[1][1] + oy]];
  return m.heat || shifted.every(p => insideFire(m.fire, p)) ? shifted : base;
}

/* Mean flown leg, station -> line head and line tail -> next station, averaged over the
   target rotation. This is what the transit legs are timed against. */
export function legKmFor(m) {
  const n = Math.max(1, m.order ? m.order.length : (m.targets ? m.targets.length : 1));
  let s = 0;
  for (let c = 1; c <= n; c++) {
    const sg = segAt(m, c);
    s += havKm(stationFor(m, c), sg[0]) + havKm(sg[1], stationFor(m, c + 1));
  }
  return Math.max(1.5, s / (2 * n));
}

export function stationFor(m, N) {
  if (!m.stations || m.stations.length < 2 || !m.segs) return m.intake;
  const segN = m.segs[tIdx(m, N)];
  const segP = N > 1 ? m.segs[tIdx(m, N - 1)] : null;
  let best = m.intake, bs = Infinity;
  for (const st of m.stations) {
    const cost = havKm(st, segN[0]) + (segP ? havKm(segP[1], st) : havKm(st, segN[0]));
    if (cost < bs) { bs = cost; best = st; }
  }
  return best;
}

export function deliveryPoint(fire) {
  if (fire.ring) {
    let best = null, bd = Infinity;
    const from = fire.sourceLL || fire.ll;
    for (const p of fire.ring) { const d = havKm(p, from); if (d < bd) { bd = d; best = p; } }
    return best.slice();
  }
  return fire.ll.slice();
}

/* ---------- class assignment ------------------------------------------------------------- */

/* The curve the ship is ARRIVING on: the previous cycle's return leg, rebuilt exactly as that
   cycle built it. The approach flies its last 4% and the fill inherits its final heading, so a
   cycle boundary is a continuation rather than a jump. Both the drop line and the control point
   must come from the previous cycle's own geometry — segAt() jitters the line per cycle, so
   reading this cycle's numbers put the ship on a curve it had never been flying. */
export function arrivalCurve(m, cycN) {
  const P = cycN - 1;
  const segP = segAt(m, P);
  const ikP = stationFor(m, P), ikHere = stationFor(m, cycN);
  const dXp = segP[0][0] - ikP[0], dYp = segP[0][1] - ikP[1];
  return [segP[1],
    [(ikHere[0] + segP[1][0]) / 2 + dYp * 0.09, (ikHere[1] + segP[1][1]) / 2 - dXp * 0.09],
    ikHere];
}
