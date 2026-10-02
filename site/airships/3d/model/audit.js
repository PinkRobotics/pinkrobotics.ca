/* Geometric consistency checks: containment and interference.
 *
 * Shared by scripts/audit.mjs (which prints) and the test suite (which asserts). The model is
 * generated from parameters, so a plausible-looking parameter change can push a tank through a
 * bulkhead or leave a vacuum cell hanging out of the skin — both of which happened, and both of
 * which were spotted by eye rather than by anything automated. This is the automation.
 *
 * Shapes are approximated as CAPSULES (segment + radius) or spheres, chosen to CIRCUMSCRIBE the
 * real geometry. The checks therefore over-report rather than under-report: a clean result means
 * something, and a finding needs reading rather than believing.
 */

import { hullR, sectionScale, CLASS_IDS } from './config.js?v=331c3257';
import { insideHull } from './layout.js?v=331c3257';
import { segPointDist } from '../core/math.js?v=331c3257';

/** Mounted outside the envelope on purpose, so exempt from containment. */
export const EXTERNAL_PREFIXES = [
  'PrimaryRotorStation', 'PrimaryRotorPylon', 'PrimaryRotorGimbal', 'PrimaryRotorA',
  'PrimaryRotorB', 'PrimaryRotorDisc', 'TailSurface', 'Hose_', 'PumpPod', 'TankerDock',
  'MediumThruster', 'LocalTrimFan', 'SensorCluster', 'DropOutlet', 'HoseReel',
  // THE UNDERCARRIAGE (operator, 08-13): water, ballast, power and the mind
  // ride the raft below the keel — outside the envelope BY DOCTRINE. Their
  // being outside is asserted by the layout test; here they are exempt from
  // "breaches the skin", while machinery-vs-machinery interference still
  // applies to them like everything else.
  'WaterTank', 'LN2Tank', 'Generator', 'BatteryModule', 'CryoCompressor',
  'CryoColdBox', 'CryoExpander', 'VehicleMindCompute', 'SafetyKernel',
  'AnchorWinch', 'RaftBar', 'BridleLines',
];
const isExternal = (id) => EXTERNAL_PREFIXES.some((p) => id.startsWith(p));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const capX = (id, p, h, r, kind) =>
  ({ id, kind, a: [p[0] - h, p[1], p[2]], b: [p[0] + h, p[1], p[2]], r });
const ball = (id, p, r, kind) => ({ id, kind, a: p, b: p, r });

/** Closest distance between two segments. */
export function segDist(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r0 = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r0);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return Math.hypot(...r0);
  if (a <= 1e-9) { s = 0; t = clamp01(f / e); } else {
    const c = dot(d1, r0);
    if (e <= 1e-9) { t = 0; s = clamp01(-c / a); } else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den !== 0 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  return Math.hypot(...sub(add(p1, mul(d1, s)), add(p2, mul(d2, t))));
}

/** Circumscribing volumes for everything the audit knows how to check. */
export function shapesFor(b) {
  const L = b.layout, c = b.cls, S = [];
  for (const t of L.waterTanks) {
    S.push(capX(t.id, t.p, (t.radius * 3.1) / 2 - t.radius, t.radius, 'water'));
  }
  for (const t of L.ln2Tanks) {
    S.push(capX(t.id, t.p, (t.radius * 3.4) / 2 - t.radius, t.radius, 'cryo'));
  }
  for (const g of L.generators) S.push(ball(g.id, g.p, g.size * Math.hypot(1.0, 0.55, 0.55), 'power'));
  for (const m of L.batteries) S.push(ball(m.id, m.p, m.size * Math.hypot(0.8, 0.5, 0.35), 'power'));
  for (const m of L.cryoModules) {
    // A ram intake is a flat forward-facing disc: its extent is radial, not spherical.
    S.push(m.flush ? capX(m.id, m.p, 0.2, m.size * 0.8, 'cryo') : ball(m.id, m.p, m.size * 1.1, 'cryo'));
  }
  for (const m of L.compute) S.push(ball(m.id, m.p, m.size * 0.95, 'compute'));
  for (const h of L.hoseReels) {
    S.push(capX(h.id, h.p, Math.max(1.4, c.maxRadiusM * 0.09) / 2, h.radius, 'water'));
  }
  for (const m of L.waterManifolds) {
    for (let i = 0; i < m.path.length - 1; i++) {
      S.push({ id: m.id, kind: 'water', a: m.path[i], b: m.path[i + 1], r: m.radius });
    }
  }
  for (const cor of L.corridors) {
    for (let i = 0; i < cor.path.length - 1; i++) {
      S.push({ id: cor.id, kind: 'maintenance', a: cor.path[i], b: cor.path[i + 1], r: cor.radius });
    }
  }
  for (let i = 0; i < b.cellSites.length; i++) {
    const s = b.cellSites[i];
    S.push(ball(`VacuumCellModule_${String(i).padStart(3, '0')}`, s.p, s.r, 'vacuum'));
  }
  return S;
}

/** Deepest breach of the skin by a volume, in metres (0 if contained). */
export function breachDepth(cls, S) {
  let worst = 0;
  for (let i = 0; i <= 8; i++) {
    const c = add(S.a, mul(sub(S.b, S.a), i / 8));
    for (let k = 0; k < 12; k++) {
      const th = (2 * Math.PI * k) / 12;
      const p = [c[0], c[1] + S.r * Math.cos(th), c[2] + S.r * Math.sin(th)];
      if (insideHull(cls, p)) continue;
      const ang = Math.atan2(p[2], -p[1]);
      const skin = hullR(cls, p[0]) * sectionScale(ang, cls.hull);
      worst = Math.max(worst, Math.hypot(p[1], p[2]) - skin);
    }
  }
  return worst;
}

/**
 * Audit one built class.
 * @returns {{ containment, machinery, cellsVsMachinery, cellToCell, volumes }}
 */
export function auditBuild(b, tol = 0.05) {
  const c = b.cls;
  const S = shapesFor(b);
  const containment = [];
  for (const s of S) {
    if (isExternal(s.id)) continue;
    const d = breachDepth(c, s);
    if (d > tol) containment.push({ id: s.id, kind: s.kind, depth: d });
  }
  const hits = [];
  for (let i = 0; i < S.length; i++) {
    for (let j = i + 1; j < S.length; j++) {
      if (S[i].id === S[j].id) continue;
      const ov = (S[i].r + S[j].r) - segDist(S[i].a, S[i].b, S[j].a, S[j].b);
      if (ov > tol) hits.push({ a: S[i].id, b: S[j].id, ov, ka: S[i].kind, kb: S[j].kind });
    }
  }
  const sortByOv = (x, y) => y.ov - x.ov;
  containment.sort((x, y) => y.depth - x.depth);
  return {
    volumes: S.length,
    containment,
    machinery: hits.filter((h) => h.ka !== 'vacuum' && h.kb !== 'vacuum').sort(sortByOv),
    // Cell-to-cell contact is EXPECTED: representative cells sit in adjacent lattice bays.
    cellsVsMachinery: hits.filter((h) => (h.ka === 'vacuum') !== (h.kb === 'vacuum')).sort(sortByOv),
    cellToCell: hits.filter((h) => h.ka === 'vacuum' && h.kb === 'vacuum').length,
  };
}

export { CLASS_IDS };
