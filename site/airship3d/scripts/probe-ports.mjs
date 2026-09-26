/* Measure the blower-port surround panels. Read-only; builds the model and inspects geometry.
 *
 *   node scripts/probe-ports.mjs
 *
 * Every number here is measured from the built geometry, not asserted from the source. The three
 * checks correspond to the three defects in BLOWER-PORT-DIAGNOSIS.md; each prints PASS/FAIL and
 * the value it measured, so the same command verifies a fix.
 */

import { build } from '../model/build.js';
import {
  stationX, hullR, sectionScale, DUCT_SEAL_OF_DIAMETER, HULL_BAND_LIFT,
} from '../model/config.js';

/* ductHousingGeom seals the bore with its back cup at `depthRatio * diameter/2` behind the duct
 * centre. A unit mounted proud of the skin by LESS than that has the skin plane crossing its open
 * bore, and you see hull colour inside the ring. See D5 in BLOWER-PORT-DIAGNOSIS.md. These now
 * come from their one home in config.js, so this probe measures against whatever the model
 * actually uses instead of a mirror that can drift. */
const SEAL_OF_DIAMETER = DUCT_SEAL_OF_DIAMETER;
const BAND_LIFT = HULL_BAND_LIFT - 1;              // solar/underside sit this fraction proud

const CLASSES = ['P100', 'P1000', 'P10000'];
const PANELS = ['PortSurrounds', 'SolarPortSurrounds', 'UndersidePortSurrounds'];

const find = (n, id, out = []) => {
  if (n.id === id) out.push(n);
  for (const c of n.children || []) find(c, id, out);
  return out;
};

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
};

/** Per-face orientation against the local outward radial direction. */
function faceStats(geom) {
  const { pos, idx } = geom;
  let out = 0, inward = 0, tangent = 0, degenerate = 0;
  for (let t = 0; t * 3 < idx.length; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) { degenerate++; continue; }
    const cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    const cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    const rl = Math.hypot(cy, cz) || 1;
    const d = (ny * cy + nz * cz) / (L * rl);
    if (d > 0.2) out++; else if (d < -0.2) inward++; else tangent++;
  }
  return { out, inward, tangent, degenerate };
}

/** Mean dot(vertex normal, outward). A patch lying on the hull should be near +1. */
function normalStats(geom) {
  const { pos, nor } = geom;
  let sum = 0, cnt = 0, zero = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const L = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
    if (L < 1e-6) { zero++; continue; }
    const rl = Math.hypot(pos[i + 1], pos[i + 2]) || 1;
    sum += (nor[i + 1] * pos[i + 1] + nor[i + 2] * pos[i + 2]) / (L * rl);
    cnt++;
  }
  return { mean: sum / Math.max(1, cnt), zero, verts: pos.length / 3 };
}

function bounds(geom) {
  const { pos } = geom;
  let x0 = Infinity, x1 = -Infinity, r0 = Infinity, r1 = 0;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
    const r = Math.hypot(pos[i + 1], pos[i + 2]);
    r0 = Math.min(r0, r); r1 = Math.max(r1, r);
  }
  return { x0, x1, r0, r1 };
}

for (const cid of CLASSES) {
  const b = build(cid, { tier: 2 });
  const cls = b.cls;
  console.log(`\n=== ${cls.name} ===`);

  /* D1 — the station clamp. stationX DECREASES with t, so stationX(0.001) is the NOSE and
   * stationX(0.999) the TAIL: clamping with the raw pair is the constant `nose`, which collapsed
   * every surround onto the nose tip. The fix sorts the bounds at the use site, so the probe
   * checks the OUTCOME: each panel's x-span must actually cover its ports (a collapsed panel
   * spans a point at the nose and cannot). The raw values stay printed as documentation. */
  const xA = stationX(cls, 0.001), xB = stationX(cls, 0.999);
  console.log(`  D1  stationX(0.001)=${xA.toFixed(1)} stationX(0.999)=${xB.toFixed(1)}` +
    ' (descending by design; the clamp must sort them)');

  /* Where the panels actually sit, against where the ports are. */
  const cell = (2 * Math.PI * cls.maxRadiusM) / 40;
  const ports = b.layout.mediumThrusters.filter((t) => t.diameter > cell * 0.8);
  if (ports.length) {
    const px = ports.map((p) => p.p[0]);
    const pr = ports.map((p) => Math.hypot(p.p[1], p.p[2]));
    console.log(`  ports: ${ports.length}  x=[${Math.min(...px).toFixed(1)}..${Math.max(...px).toFixed(1)}]` +
      `  radius=[${Math.min(...pr).toFixed(1)}..${Math.max(...pr).toFixed(1)}] m`);
  }

  for (const id of PANELS) {
    const n = find(b.root, id)[0];
    if (!n) { console.log(`  ${id}: absent`); continue; }
    const bb = bounds(n.geom);
    const fs = faceStats(n.geom);
    const ns = normalStats(n.geom);
    console.log(`  ${id}  tris=${n.geom.idx.length / 3} verts=${ns.verts}` +
      `  x=[${bb.x0.toFixed(1)}..${bb.x1.toFixed(1)}] radius=[${bb.r0.toFixed(1)}..${bb.r1.toFixed(1)}] m`);
    check(bb.r1 > cls.maxRadiusM * 0.3, 'panel sits out near the hull, not on the axis',
      `max radius ${bb.r1.toFixed(1)} m vs hull ${cls.maxRadiusM.toFixed(1)} m`);
    if (ports.length) {
      const px = ports.map((p) => p.p[0]);
      check(bb.x0 <= Math.max(...px) && bb.x1 >= Math.min(...px),
        'D1 panel x-span covers its ports',
        `panel x=[${bb.x0.toFixed(1)}..${bb.x1.toFixed(1)}] vs ports x=[${Math.min(...px).toFixed(1)}..${Math.max(...px).toFixed(1)}]`);
    }
    check(fs.out > 0 && fs.inward === 0 && fs.tangent === 0, 'D2 every face winds outward',
      `outward=${fs.out} inward=${fs.inward} tangent=${fs.tangent} degenerate=${fs.degenerate}`);
    check(ns.mean > 0.8, 'D3 vertex normals point outward',
      `mean dot=${ns.mean.toFixed(4)} (fairing measures ~0.94), zero-length=${ns.zero}`);
  }

  /* D4 — how much bigger than the duct is the hole the grid actually cut? */
  const fair = find(b.root, 'OuterFairing')[0];
  if (fair && fair.geom.holeR && ports.length) {
    const rings = 54, seg = 52;                       // tier 2, from hullGridGeom
    const diag = Math.hypot(cls.lengthM / rings, (2 * Math.PI * cls.maxRadiusM) / seg);
    const worst = Math.max(...fair.geom.holeR);
    const r = ports[0].diameter / 2;
    console.log(`  D4  duct r=${r.toFixed(2)} m  grid cell diagonal=${diag.toFixed(2)} m` +
      `  widest hole cut=${worst.toFixed(2)} m`);
    check(worst < r * 1.4, 'aperture is close to the duct it is cut for',
      `hole is ${(worst / r).toFixed(2)}x the duct radius; the duct flange reaches 1.18x`);
  }

  /* D5 — the small blowers. No aperture is cut for a trim fan; it is mounted proud instead, so
   * the ONLY thing hiding the hull from its bore is the duct's own back cup. That works only if
   * the fan stands proud by more than the cup is deep. */
  const fans = b.layout.trimFans || [];
  if (fans.length) {
    let worstFan = Infinity, bad = 0;
    for (const f of fans) {
      const t = Math.min(0.97, Math.max(0.03, f.t));
      const localRf = hullR(cls, stationX(cls, t)) * sectionScale(f.theta, cls.hull);
      const proud = Math.hypot(f.p[1], f.p[2]) - localRf;
      const clearance = proud - f.diameter * SEAL_OF_DIAMETER - localRf * BAND_LIFT;
      if (clearance < 0) bad++;
      if (clearance < worstFan) worstFan = clearance;
    }
    const d0 = fans[0].diameter;
    console.log(`  D5  trim fans: ${fans.length}  dia=${d0.toFixed(2)} m` +
      `  cup seals ${(d0 * SEAL_OF_DIAMETER).toFixed(2)} m behind the duct centre`);
    check(bad === 0, 'trim fan stands proud of its own cup',
      `${bad} of ${fans.length} have the skin inside the open bore; worst clearance ` +
      `${worstFan >= 0 ? '+' : ''}${worstFan.toFixed(3)} m`);
  }

  /* D6 — a proud-mounted trim fan must not intersect the large blowers or the other skin
   * equipment (sensor clusters, hose-reel drums, drop outlets, fin roots, tanker dock). */
  if (fans.length) {
    const keepOut = [];
    for (const mt of b.layout.mediumThrusters) keepOut.push([mt.p, mt.diameter / 2 * 1.18, mt.id]);
    for (const s of b.layout.sensors) keepOut.push([s.p, s.size * 1.6, s.id]);
    for (const h of b.layout.hoseReels) keepOut.push([h.p, h.radius * 1.3, h.id]);
    for (const o of b.layout.dropOutlets) keepOut.push([o.p, o.radius * 1.6, o.id]);
    if (b.layout.tankerDock) keepOut.push([b.layout.tankerDock.p, b.layout.tankerDock.size, 'TankerDock']);
    let overlaps = 0, worst = Infinity, worstPair = '';
    for (const f of fans) {
      for (const [p, r, id] of keepOut) {
        const gap = Math.hypot(f.p[0] - p[0], f.p[1] - p[1], f.p[2] - p[2]) - r - f.diameter / 2;
        if (gap < 0) overlaps++;
        if (gap < worst) { worst = gap; worstPair = `${f.id} vs ${id}`; }
      }
    }
    check(overlaps === 0, 'D6 trim fans clear of ports and skin equipment',
      `${overlaps} overlap(s); tightest ${worst >= 0 ? '+' : ''}${worst.toFixed(2)} m (${worstPair})`);
  }
}

console.log(`\n${failures === 0 ? 'probe-ports: clean' : `probe-ports: ${failures} failing check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
