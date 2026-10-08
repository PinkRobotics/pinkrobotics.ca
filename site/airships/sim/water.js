/* Choosing where to draw water, and where over that water to hover.
 */
import { havKm } from './geo.js?v=01e992e3';

// One station generator serves selection and mission construction. Only these in-radius
// stations are offered to the cycle planner; mapped area still proves neither depth nor access.
export function sourceStations(w, fireLL, maxKm) {
  const stations = [];
  const intake = intakePoint(w, fireLL, stations);
  if (!stations.length) stations.push(intake);
  return stations.filter(st => havKm(st, fireLL) <= maxKm);
}

export function findSource(fireLL, cls, water, minHaOv, maxKmOv) {
  // Retain the size preference as an explicit heuristic, now over reachable drafting
  // stations rather than banks. It is not a bathymetric or permission assessment.
  let best = null, bestScore = Infinity;
  const minHa = minHaOv || cls.minSourceHa, maxKm = maxKmOv || cls.searchKm;
  for (let i = 0; i < water.length; i++) {
    const w = water[i];
    if (w[2] < minHa) continue;
    const dLat = Math.abs(w[1] - fireLL[1]) * 111;
    if (dLat - (w.spanKm || 0) > maxKm) continue;
    const stations = sourceStations(w, fireLL, maxKm);
    if (!stations.length) continue;
    const km = Math.min(...stations.map(st => havKm(st, fireLL)));
    const score = km / Math.min(12, Math.pow(w[2] / minHa, 0.35));
    if (score < bestScore) { best = { idx: i, km, stations }; bestScore = score; }
  }
  return best;
}

export function intakePoint(w, fireLL, outStations) {
  // The hose goes down in the MIDDLE of the lake, across its width: the intake sits on the
  // long-axis centerline (principal axis of the outline), at the along-axis station nearest
  // the fire, pulled 20% in from either end. Mid-width water is where depth and clearance
  // are most plausible — still a visualization aid, not a hydrological claim.
  const c = [w[0], w[1]];
  if (!w[5] || w[5].length < 6) return c;          // no outline: the centroid is mid-lake
  const kx = 111.32 * Math.cos(c[1] * Math.PI / 180), ky = 110.57;   // deg -> km, locally
  const pts = w[5].map(q => [(q[0] - c[0]) * kx, (q[1] - c[1]) * ky]);
  let mx = 0, my = 0;
  for (const q of pts) { mx += q[0]; my += q[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of pts) {
    const dx = q[0] - mx, dy = q[1] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // principal (long) axis
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let tmin = Infinity, tmax = -Infinity;
  for (const q of pts) {
    const t = (q[0] - mx) * ux + (q[1] - my) * uy;
    if (t < tmin) tmin = t; if (t > tmax) tmax = t;
  }
  const tf0 = ((fireLL[0] - c[0]) * kx - mx) * ux + ((fireLL[1] - c[1]) * ky - my) * uy;
  const mg = Math.min(0.2 * (tmax - tmin), 2.0);      // km — stay off the ends, but no farther
  const lo = tmin + mg, hi = tmax - mg;
  const tf = Math.max(lo, Math.min(hi, tf0));
  // A straight centerline leaves the water on bent or branching lakes, so every candidate
  // is verified against the outline in local coordinates, walking toward mid-lake until wet.
  const inLocal = q => {
    let ins = false;
    for (let i2 = 0, j2 = pts.length - 1; i2 < pts.length; j2 = i2++) {
      if (((pts[i2][1] > q[1]) !== (pts[j2][1] > q[1])) &&
          (q[0] < (pts[j2][0] - pts[i2][0]) * (q[1] - pts[i2][1]) / (pts[j2][1] - pts[i2][1]) + pts[i2][0]))
        ins = !ins;
    }
    return ins;
  };
  const tc = (tmin + tmax) / 2;
  // At each candidate station, take the cross-lake chord and stand in the middle of it:
  // literally halfway across the lake, never hugging a bank the straight axis drifts toward.
  const chordMid = t0 => {
    const P = [mx + ux * t0, my + uy * t0];
    const vx = -uy, vy = ux;
    const ss = [];
    for (let i2 = 0, j2 = pts.length - 1; i2 < pts.length; j2 = i2++) {
      const A = pts[j2], Bq = pts[i2];
      const ex = Bq[0] - A[0], ey = Bq[1] - A[1];
      const den = ex * vy - ey * vx;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((P[0] - A[0]) * vy - (P[1] - A[1]) * vx) / den;
      if (u < 0 || u >= 1) continue;
      ss.push(Math.abs(vx) > Math.abs(vy)
        ? (A[0] + u * ex - P[0]) / vx
        : (A[1] + u * ey - P[1]) / vy);
    }
    ss.sort((a, b) => a - b);
    let best = null;
    for (let i2 = 0; i2 + 1 < ss.length; i2 += 2) {
      const midv = { s: (ss[i2] + ss[i2 + 1]) / 2, w: ss[i2 + 1] - ss[i2] };
      if (ss[i2] <= 0 && 0 <= ss[i2 + 1]) return midv;      // the arm the axis runs through
      if (!best || midv.w > best.w) best = midv;
    }
    return best;
  };
  const stationAt = t => {
    const ch = chordMid(t);
    if (!ch || ch.w <= 0.25) return null;
    const q = [mx + ux * t - uy * ch.s, my + uy * t + ux * ch.s];
    return inLocal(q) ? [c[0] + q[0] / kx, c[1] + q[1] / ky] : null;
  };
  if (outStations) {
    // alternate hose stations along the axis: the Mind picks per cycle to shorten the
    // triangle drop-end -> water -> next drop
    for (const dt of [-6, -3, 3, 6]) {
      const st = stationAt(Math.max(lo, Math.min(hi, tf + dt)));
      if (st && outStations.every(q => havKm(q, st) > 1)) outStations.push(st);
    }
  }
  for (let sStep = 0; sStep <= 24; sStep++) {
    const t = tf + (tc - tf) * (sStep / 24);
    const st = stationAt(t);
    if (st) { if (outStations) outStations.unshift(st); return st; }
  }
  // Last resort: the midpoint of the widest horizontal chord through the outline —
  // inside by construction for any simple polygon.
  const xs = [];
  for (let i2 = 0, j2 = pts.length - 1; i2 < pts.length; j2 = i2++) {
    if ((pts[i2][1] > my) !== (pts[j2][1] > my))
      xs.push(pts[i2][0] + (pts[j2][0] - pts[i2][0]) * (my - pts[i2][1]) / (pts[j2][1] - pts[i2][1]));
  }
  xs.sort((a, b) => a - b);
  let bi = -1, bw2 = -1;
  for (let i2 = 0; i2 + 1 < xs.length; i2 += 2)
    if (xs[i2 + 1] - xs[i2] > bw2) { bw2 = xs[i2 + 1] - xs[i2]; bi = i2; }
  if (bi >= 0) return [c[0] + (xs[bi] + xs[bi + 1]) / 2 / kx, c[1] + my / ky];
  return c;
}
