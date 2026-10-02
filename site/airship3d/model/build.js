/* Assemble a complete airship as a scene-graph tree.
 *
 * build(classId, {tier}) -> { cls, layout, field, root, index, metadata, stats, actuators }
 *
 * DRAW CALLS, NOT TRIANGLES, ARE THE BUDGET. A P-10000 has 220 trim fans, 40 water tanks and 32
 * manoeuvring thrusters. As individual nodes that is 300 draw calls before anything interesting
 * is on screen. So repeated machinery is INSTANCED: one geometry, one call, a transform and a
 * tint per instance, and a parallel id list so selection, failure state and the allocator can
 * still address an individual unit. `instanceById()` is how a driver reaches one fan.
 *
 * Anything that has to move independently and is few in number (rotor stations, gimbals, hose,
 * pump pod) stays a real node with its own transform.
 */

import {
  resolveClass, stationX, stationT, hullR, sectionScale, profileR, CLASS_IDS,
  TRIM_FAN_DEPTH_RATIO, HULL_BAND_LIFT,
} from './config.js?v=187e4a51';
import { buildLayout, layoutIndex, inside, insideHull } from './layout.js?v=187e4a51';
import { proxyField } from './density.js?v=187e4a51';
import { buildLattice, buildMacroFrames, buildSectionJoints, buildCellModules, buildLoadPaths, TIERS }
  from './structure.js?v=187e4a51';
import { buildMetadata } from './metadata.js?v=187e4a51';
import {
  latheGeom, tankGeom, boxGeom, discGeom, cylGeom, bladeGeom, sphereGeom, tubeGeom,
  lines, pathSegs, mergeSolids, countOf, featureEdges, transformSegs, solid,
} from './geom.js?v=187e4a51';
import { node, child, addChild, buildIndex, walk, CATEGORIES } from '../core/nodes.js?v=187e4a51';
import { m4compose, segPointDist } from '../core/math.js?v=187e4a51';
import { streamFor } from '../core/prng.js?v=187e4a51';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Euler angles (0, ry, rz) that aim the node's +x axis along `dir`. */
export function aimEuler(dir) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const [x, y, z] = [dir[0] / l, dir[1] / l, dir[2] / l];
  return [0, -Math.asin(Math.max(-1, Math.min(1, z))), Math.atan2(y, x)];
}

/**
 * An instanced node. `records` are {id, p, r, s, tint?} — the transform is baked at build time and
 * can be rewritten later through `setInstance()`.
 */
export function instanceNode(spec, geom, records) {
  const n = records.length;
  const xf = new Float32Array(16 * n);
  const tint = new Float32Array(4 * n);
  const ids = new Array(n);
  const byId = new Map();
  const tmp = new Float32Array(16);
  for (let i = 0; i < n; i++) {
    const r = records[i];
    m4compose(r.p, r.r || [0, 0, 0], r.s === undefined ? 1 : r.s, tmp);
    xf.set(tmp, i * 16);
    tint.set(r.tint || [1, 1, 1, 1], i * 4);
    ids[i] = r.id;
    byId.set(r.id, i);
  }
  // A container of instances is never itself selectable — the instances are. Picking resolves
  // through the instance id, so leaving the container selectable would give every fan on the ship
  // the same identity.
  const nd = node({
    ...spec, geom, selectable: false,
    draw: geom.kind === 'lines' ? 'instancedLines' : 'instanced',
  });
  nd.inst = { xf, tint, ids, byId, count: n, dirty: true, records };
  return nd;
}

/** Rewrite one instance's transform and/or tint. */
export function setInstance(nd, id, { p, r, s, tint } = {}) {
  const i = nd.inst.byId.get(id);
  if (i === undefined) return false;
  const rec = nd.inst.records[i];
  if (p) rec.p = p;
  if (r) rec.r = r;
  if (s !== undefined) rec.s = s;
  const tmp = new Float32Array(16);
  m4compose(rec.p, rec.r || [0, 0, 0], rec.s === undefined ? 1 : rec.s, tmp);
  nd.inst.xf.set(tmp, i * 16);
  if (tint) nd.inst.tint.set(tint, i * 4);
  nd.inst.dirty = true;
  return true;
}

/** Find (node, index) for an instance id anywhere in the tree. */
export function instanceById(root, id) {
  let hit = null;
  walk(root, (n) => {
    if (hit) return false;
    if (n.inst && n.inst.byId.has(id)) hit = { node: n, index: n.inst.byId.get(id) };
    return true;
  });
  return hit;
}

/* ---------- hull surfaces ------------------------------------------------------------------- */

function hullProfile(cls, rings, t0 = 0, t1 = 1, radialScale = 1) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = t0 + ((t1 - t0) * i) / rings;
    prof.push([stationX(cls, t), profileR(t, cls.hull) * cls.maxRadiusM * radialScale]);
  }
  return prof;
}

/**
 * A grid of hull surface between two hull angles, with real APERTURES cut through it.
 *
 * Why apertures. Recessing a ducted unit into the skin does nothing on its own: the fairing is a
 * closed surface, so the unit ends up BEHIND it and what you see filling the port is the hull —
 * or, on the upper half, the solar band drawn just outside the hull. A back cup on the duct does
 * not help, because the duct was never visible in the first place. The hole has to be real.
 *
 * A quad is dropped when its centre falls inside a port. Only ports comparable in size to a grid
 * cell get one: a 1.6 m trim fan is smaller than a single quad, so cutting for it would punch a
 * hole several times too big. Those units are mounted PROUD of the skin instead — see layout.js.
 */
function hullGridGeom(cls, tier, opts = {}) {
  const { th0 = 0, th1 = 2 * Math.PI, wrap = false, t0 = 0, t1 = 1,
    lift = 1, apertures = [] } = opts;
  // ONE resolution for the fairing and both bands. Different grids cut different stair-steps in
  // the same port, and the two patterns show through each other.
  const rings = tier.id <= 0 ? 20 : tier.id === 1 ? 34 : 54;
  const seg = tier.id <= 0 ? 20 : tier.id === 1 ? 32 : 52;
  // A half-circle band uses half the columns, so its cells are the same size as the full hull's.
  const span = Math.abs(th1 - th0);
  const segEff = Math.max(4, Math.round((seg * span) / (2 * Math.PI)));
  const cols = wrap ? seg : segEff + 1;
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = t0 + ((t1 - t0) * i) / rings;
    const x = stationX(cls, t);
    const R = hullR(cls, x) * lift;
    for (let j = 0; j < cols; j++) {
      const th = th0 + ((th1 - th0) * j) / (wrap ? seg : segEff);
      const rr = R * sectionScale(th, cls.hull);
      pos.push(x, -rr * Math.cos(th), rr * Math.sin(th));
    }
  }
  /**
   * Drop a quad if ANY OF ITS CORNERS falls inside a port — not if its centre does.
   *
   * Testing the centre leaves quads whose corners poke into the circular opening, and those
   * corners are exactly the blocky artefacts that appeared to intrude on every blower. Testing the
   * corners instead guarantees the remaining skin never enters the aperture circle at all; the
   * hole comes out slightly larger and ragged on the OUTSIDE, which the duct's flange covers.
   */
  // The hole each aperture actually cuts is MEASURED, not estimated. Guessing it from the cell
  // size was wrong every time the grid spacing changed with station, and an under-sized surround
  // leaves a ragged dark crescent that no amount of tuning removes reliably.
  const holeR = apertures.map(() => 0);
  const inAp = (px, py, pz) => {
    for (let k = 0; k < apertures.length; k++) {
      const ap = apertures[k];
      const dx = px - ap.c[0], dy = py - ap.c[1], dz = pz - ap.c[2];
      if (dx * dx + dy * dy + dz * dz < ap.r * ap.r) return k;
    }
    return -1;
  };
  const noteHole = (k, p) => {
    const ap = apertures[k];
    const d2 = Math.hypot(p[0] - ap.c[0], p[1] - ap.c[1], p[2] - ap.c[2]);
    if (d2 > holeR[k]) holeR[k] = d2;
  };
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < (wrap ? cols : cols - 1); j++) {
      const j2 = wrap ? (j + 1) % cols : j + 1;
      const a = i * cols + j, b = i * cols + j2;
      const c = (i + 1) * cols + j, d = (i + 1) * cols + j2;
      const A = P(a), B = P(b), C = P(c), D = P(d);
      // Cells anywhere near an aperture are SUBDIVIDED before the corner test, so the
      // stair-stepped hole edge is a fraction of the duct radius instead of up to a whole
      // grid-cell diagonal past it (BLOWER-PORT-DIAGNOSIS.md, D4 — on the P-10000 a 15 m
      // blower sat in a hole 51 m across). The subdivision is bilinear IN POSITION SPACE:
      // the original quad was flat, the sub-quads tile exactly the same flat quad, and the
      // borders stay straight — so there are no T-junction cracks against untouched
      // neighbours and the ONE-resolution rule across fairing and bands still holds.
      const diag = Math.max(
        Math.hypot(A[0] - D[0], A[1] - D[1], A[2] - D[2]),
        Math.hypot(B[0] - C[0], B[1] - C[1], B[2] - C[2]));
      let kSub = 0;
      for (const ap of apertures) {
        const dm = Math.min(...[A, B, C, D].map((p) =>
          Math.hypot(p[0] - ap.c[0], p[1] - ap.c[1], p[2] - ap.c[2])));
        if (dm < ap.r + diag) kSub = Math.max(kSub, Math.min(14, Math.ceil(diag / (0.30 * ap.r))));
      }
      if (!kSub) {
        // Outward winding. The hull profile runs nose-to-tail, i.e. x DECREASING, which is the
        // opposite of the tank profiles — so the winding that is correct for a tank leaves the
        // whole hull inside-out. Every skin surface was rendering as a backface at 42%
        // brightness, which is what made the model look murky and made the correctly-lit port
        // panels stand out as bright rings against it.
        idx.push(a, d, c, a, b, d);
        continue;
      }
      const m0 = pos.length / 3, w2 = kSub + 1;
      for (let si = 0; si <= kSub; si++) {
        const v = si / kSub;
        for (let sj = 0; sj <= kSub; sj++) {
          const u = sj / kSub;
          for (let ax = 0; ax < 3; ax++) {
            pos.push((1 - v) * ((1 - u) * A[ax] + u * B[ax]) + v * ((1 - u) * C[ax] + u * D[ax]));
          }
        }
      }
      for (let si = 0; si < kSub; si++) {
        for (let sj = 0; sj < kSub; sj++) {
          const sa = m0 + si * w2 + sj, sb = sa + 1, sc = sa + w2, sd = sc + 1;
          // Same rule as ever, at the finer pitch: drop the sub-quad if ANY corner falls
          // inside a port, so the surviving skin never enters the aperture circle; note all
          // four corners of a dropped quad, because the far corners are the hole edge holeR
          // exists to measure.
          let hit = -1;
          for (const v of [sa, sb, sc, sd]) {
            const h = inAp(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            if (h >= 0) { hit = h; break; }
          }
          if (hit >= 0) {
            for (const v of [sa, sb, sc, sd]) noteHole(hit, P(v));
            continue;
          }
          idx.push(sa, sd, sc, sa, sb, sd);
        }
      }
    }
  }
  const g = latheGeom([[0, 0], [0, 0]], 3);            // borrow the solid() record shape
  return { ...g, pos: new Float32Array(pos), nor: normalsFor(pos, idx), idx: new Uint32Array(idx),
    tris: idx.length / 3, holeR };
}

/**
 * Ports big enough to be worth cutting a hole for. A trim fan is smaller than one grid cell, so
 * cutting for it would remove far more skin than the unit occupies.
 */
function aperturesFor(cls, layout, tier) {
  if (tier.id <= 0) return [];                          // the map tier has no ports to see into
  const cell = (2 * Math.PI * cls.maxRadiusM) / 40;
  return layout.mediumThrusters
    .filter((t) => t.diameter > cell * 0.8)
    // Exactly the duct's outer radius: corner-testing guarantees the skin is clear of this
    // circle, and the duct's flange covers the ragged edge outside it.
    .map((t) => ({ c: t.p, r: t.diameter / 2 }));
}

/**
 * The panel around a port: an annulus lying ON the hull surface, covering the ragged edge the quad
 * grid leaves behind.
 *
 * A quad grid cannot cut a clean circle. Dropping quads by corner test guarantees the skin stays
 * out of the port itself, but the surviving edge is stair-stepped up to a cell diagonal beyond it,
 * and those steps are visible as blocks around every blower. A flange big enough to cover them
 * would be a collar twice the duct's diameter.
 *
 * So the hole is covered instead of being made perfect: a surround built in HULL coordinates (so
 * it curves with the body, unlike a flat disc, which would sink in or stand proud by more than a
 * metre over this span) and drawn very slightly out from the layer it patches, so it wins the
 * depth test cleanly rather than z-fighting. Same material as that layer, so the join is invisible
 * and the result reads as a clean circular aperture in an unbroken skin.
 */
function portSurroundGeom(cls, ports, rIn, rOutOf, lift) {
  if (!ports.length) return null;
  const parts = [];
  const RAD = 3, ANG = 22;
  for (const port of ports) {
    const th0 = Math.atan2(port.c[2], -port.c[1]);
    const localR = Math.max(1e-3, hullR(cls, port.c[0]));
    const rOut = rOutOf(port);
    // The fore-and-aft walk happens in METRES of x directly. The old form converted the
    // metre offset to a station fraction and back through stationX — which is nonlinear,
    // so every annulus was squeezed toward the nose and left a crescent of the aperture
    // uncovered on its noseward side. rIn starts 25% inside the hole edge: the aperture
    // radius is measured at the recessed duct plane, and on sloped skin the true surface
    // hole is smaller — overlapping it costs nothing and covers the ragged edge.
    // stationX DECREASES with t: stationX(0.001) is the NOSE (largest x), stationX(0.999) the
    // tail. Clamping with the raw pair was max(nose, min(tail, x)) — a constant — which
    // collapsed every surround vertex onto the nose tip and left every aperture uncovered
    // (BLOWER-PORT-DIAGNOSIS.md, D1). Order the bounds before clamping.
    const xa = stationX(cls, 0.001), xb = stationX(cls, 0.999);
    const xLo = Math.min(xa, xb), xHi = Math.max(xa, xb);
    const rIn0 = rIn * 0.75;
    const pos = [], idx = [];
    for (let i = 0; i <= RAD; i++) {
      const rho = rIn0 + ((rOut - rIn0) * i) / RAD;
      for (let j = 0; j <= ANG; j++) {
        const phi = (2 * Math.PI * j) / ANG;
        const th = th0 + (rho * Math.sin(phi)) / localR;
        const x = Math.max(xLo, Math.min(xHi, port.c[0] - rho * Math.cos(phi)));
        const rr = hullR(cls, x) * sectionScale(th, cls.hull) * lift;
        pos.push(x, -rr * Math.cos(th), rr * Math.sin(th));
      }
    }
    const w = ANG + 1;
    for (let i = 0; i < RAD; i++) {
      for (let j = 0; j < ANG; j++) {
        const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
        // ONE winding, the hull grid's own (see the comment there: the profile runs with x
        // decreasing, which is what makes this order the outward one). The old double-sided
        // push added each face's exact reverse, so solid()'s summed vertex normals cancelled
        // to zero and lit as garbage (D2/D3). Backface dimming is solved by winding the patch
        // correctly, not by winding it both ways.
        idx.push(a, d, c, a, b, d);
      }
    }
    parts.push(solid(new Float32Array(pos), new Uint32Array(idx)));
  }
  return mergeSolids(parts);
}

/** How far the stair-steps can reach past a port: one cell diagonal, plus a margin. */
function surroundOuter(cls, tier) {
  const rings = tier.id <= 0 ? 20 : tier.id === 1 ? 34 : 54;
  const seg = tier.id <= 0 ? 20 : tier.id === 1 ? 32 : 52;
  const cx = cls.lengthM / rings;
  const cy = (2 * Math.PI * cls.maxRadiusM) / seg;
  return Math.hypot(cx, cy) * 1.15;
}

function fairingGeom(cls, tier, apertures) {
  return hullGridGeom(cls, tier, { wrap: true, apertures });
}

/**
 * A longitudinal band of hull surface, drawn slightly proud of the fairing so it reads as a layer
 * over it. Used twice — solar over the whole upper half, high-visibility finish over the whole
 * lower half — so the two meet exactly at the beam line instead of leaving a seam.
 */
function hullBandGeom(cls, tier, th0, th1, apertures) {
  return hullGridGeom(cls, tier, { th0, th1, t0: 0.05, t1: 0.93, lift: HULL_BAND_LIFT, apertures });
}

/** The solar field: the entire upper half of the hull. */
const solarGeom = (cls, tier, ap) => hullBandGeom(cls, tier, 0, Math.PI, ap);

/**
 * The conspicuity finish: the entire lower half, in the estate's pink.
 *
 * This is a VISIBILITY choice, not decoration. A firefighting aircraft working low over terrain is
 * seen from below by other aircraft and from the ground, and a dark underside against dark ground
 * is the hard case. It is the one place on the vehicle where the brand colour is doing a job.
 */
const undersideGeom = (cls, tier, ap) => hullBandGeom(cls, tier, Math.PI, 2 * Math.PI, ap);

function normalsFor(pos, idx) {
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz;
    nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz;
    nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  return nor;
}

/* ---------- rotors ---------------------------------------------------------------------------- */

/**
 * A primary rotor: hub, spinner and blades.
 *
 * Blades are BROAD rather than slender. A real low-disc-loading rotor has a high aspect ratio, but
 * drawn at this scale a slender blade is a hairline, and six of them on each of two closely-spaced
 * counter-rotating discs read as a twelve-pointed asterisk rather than as a rotor. Four broader
 * blades per disc carry the same idea and actually look like a machine.
 */
function rotorGeom(cls, diameter, blades = 4) {
  const r = diameter / 2;
  const parts = [
    cylGeom(r * 0.22, r * 0.15, 12),                       // hub
    latheGeom([[r * 0.11, r * 0.15], [r * 0.30, 0.001]], 12, { caps: false }),   // spinner
  ];
  for (let i = 0; i < blades; i++) {
    const th = (2 * Math.PI * i) / blades;
    const b = bladeGeom(r * 0.94, r * 0.26, r * 0.13, r * 0.035, 16);
    parts.push(transformSolid(b, m4compose([0, 0, 0], [th, 0, 0], 1)));
  }
  return mergeSolids(parts);
}

/**
 * A ducted unit: a real duct RING, a hub, and blades recessed inside it.
 *
 * Two things this gets right that the first version did not. The duct is a closed profile revolved
 * into a shell with WALL THICKNESS — an open zero-thickness cylinder vanishes edge-on, which left
 * only the blades and made every propulsor read as a spiky starburst stuck to the hull. And the
 * blades are short and broad and sit INSIDE the bore rather than reaching past it, so the unit
 * reads as a fan in a duct instead of a windmill.
 *
 * Axis is +x, matching aimEuler().
 */
function ductHousingGeom(diameter, depthRatio = 0.45) {
  const R = diameter / 2;
  const Ri = R * 0.84;
  const h = R * depthRatio;
  // The profile ends in a FLANGE that reaches past the aperture, and a back cup closes the bore so
  // the hull cannot be seen through it.
  const F = R * 1.18;
  const duct = latheGeom([
    [-h, R], [h * 0.72, R], [h, F], [h * 0.80, F], [h * 0.60, R * 0.99],
    [h * 0.55, Ri], [-h, Ri], [-h * 1.04, R * 0.97], [-h, R],
  ], 20, { caps: false });
  const cup = latheGeom([[-h, Ri], [-h * 1.9, Ri * 0.18], [-h * 2.05, 0.001]], 20, { caps: false });
  return mergeSolids([duct, cup]);
}

/**
 * The rotating part of a ducted unit — hub, spinner and blades — as a SEPARATE node.
 *
 * It has to be separate. Spinning a unit whose duct and blades are one merged mesh turns the whole
 * housing, flange and all, which is not what a fan does. Housing and rotor are two instanced
 * containers sharing the same placement; only the second one turns.
 */
function fanRotorGeom(diameter, blades = 4, depthRatio = 0.45) {
  const R = diameter / 2;
  const Ri = R * 0.84;
  const h = R * depthRatio;
  const parts = [cylGeom(h * 1.5, Ri * 0.24, 10)];
  for (let i = 0; i < blades; i++) {
    const b = bladeGeom(Ri * 0.90, h * 1.25, h * 0.75, Ri * 0.07, 20);
    parts.push(transformSolid(b, m4compose([0, 0, 0], [(2 * Math.PI * i) / blades, 0, 0], 1)));
  }
  return mergeSolids(parts);
}

function transformSolid(g, m) {
  const pos = new Float32Array(g.pos.length);
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i], y = g.pos[i + 1], z = g.pos[i + 2];
    pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return { ...g, pos, nor: normalsFor(pos, g.idx) };
}

/* ---------- the build ------------------------------------------------------------------------- */

/**
 * @param {string} classId 'P100' | 'P1000' | 'P10000'
 * @param {object} [opts] { tier, overrides, field }
 */
export function build(classId, opts = {}) {
  const tierId = opts.tier === undefined ? 2 : opts.tier;
  const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, tierId))];
  const cls = resolveClass(classId, opts.overrides || {});
  const layout = buildLayout(cls);
  layout._index = layoutIndex(layout);
  const field = opts.field || proxyField(cls, layout);
  const R = cls.maxRadiusM;

  const root = node({ id: 'AirshipRoot', category: 'structure', selectable: false });

  /* --- skin ------------------------------------------------------------------------------- */
  const apertures = aperturesFor(cls, layout, tier);
  const fairingG = fairingGeom(cls, tier, apertures);
  const solarG = solarGeom(cls, tier, apertures);
  const undersideG = undersideGeom(cls, tier, apertures);
  // The widest hole any layer cut for a given port, plus a margin, is what the panel must cover.
  const measured = apertures.map((ap, i) => Math.max(
    ap.r, (fairingG.holeR || [])[i] || 0, (solarG.holeR || [])[i] || 0,
    (undersideG.holeR || [])[i] || 0) + Math.max(0.6, ap.r * 0.12));
  const outerOf = (ap) => measured[apertures.indexOf(ap)] || ap.r * 2;
  child(root, {
    id: 'OuterFairing', category: 'structure', geom: fairingG, material: 'fairing',
  });
  if (apertures.length) {
    const sg = portSurroundGeom(cls, apertures, apertures[0].r, outerOf, 1.0015);
    if (sg) {
      child(root, {
        id: 'PortSurrounds', category: 'structure', geom: sg, material: 'fairing',
        selectable: false, lod: 1,
      });
    }
    // The bands are cut by the same apertures, so each needs its own patch in its own colour.
    for (const [id, mat, upper] of [['SolarPortSurrounds', 'solar', true],
      ['UndersidePortSurrounds', 'underside', false]]) {
      const half = apertures.filter((ap) => (ap.c[2] >= 0) === upper);
      if (!half.length) continue;
      const g2 = portSurroundGeom(cls, half, half[0].r, outerOf, 1.0055);
      if (g2) {
        child(root, {
          id, category: upper ? 'power' : 'structure', geom: g2, material: mat,
          selectable: false, lod: 1,
        });
      }
    }
  }
  child(root, {
    id: 'SolarSkin', category: 'power', geom: solarG, material: 'solar', lod: 1,
  });
  child(root, {
    id: 'HullUnderside', category: 'structure', geom: undersideG, material: 'underside', lod: 1,
  });

  /* --- structure -------------------------------------------------------------------------- */
  const struct = child(root, { id: 'VacuumStructure', category: 'vacuum', selectable: true });
  const lat = buildLattice(cls, field, layout, tierId);
  child(struct, {
    id: 'VacuumLattice', category: 'vacuum', geom: lat.geom, material: 'lattice', lod: 1,
    selectable: false,
  });
  child(struct, {
    id: 'MacroFrames', category: 'structure', geom: buildMacroFrames(cls, field, tierId),
    material: 'frame', lod: 1, selectable: false,
  });
  child(struct, {
    id: 'SectionJoints', category: 'structure', geom: buildSectionJoints(cls, layout),
    material: 'joint', lod: 2, selectable: false,
  });
  if (lat.cellSites.length) {
    child(struct, {
      id: 'VacuumCellModules', category: 'vacuum', geom: buildCellModules(cls, lat.cellSites),
      material: 'cell', lod: 2, selectable: false,
    });
  }
  const lp = child(struct, {
    id: 'LoadPaths', category: 'structure', geom: buildLoadPaths(cls, field, layout),
    material: 'loadpath', lod: 2, selectable: false,
  });
  // NB: no `lp.visible = false` here. `node.visible` is the DRIVER's channel and the renderer
  // honours it before the view mode is consulted, so hiding a view layer this way makes it
  // unreachable — which is exactly what happened: the load-path view never drew its load paths.
  // Visibility of view layers belongs to render/views.js.

  // Individually addressable representative cells — the failure scenes need a handful of cells
  // that can change state without rebuilding the merged buffer.
  const focusCells = lat.cellSites.slice(0, Math.min(16, lat.cellSites.length));
  if (focusCells.length) {
    addChild(struct, instanceNode(
      { id: 'VacuumCellFocus', category: 'vacuum', material: 'cellFocus', lod: 2, selectable: false },
      sphereGeom(1, 10, 6),
      focusCells.map((c, i) => ({ id: `VacuumCellModule_${pad(i)}`, p: c.p, s: c.r })),
    ));
  }

  /* --- water ------------------------------------------------------------------------------ */
  const water = child(root, { id: 'WaterSystem', category: 'water', selectable: false });
  {
    const tankR = layout.waterTanks[0] ? layout.waterTanks[0].radius : R * 0.135;
    const shell = tankGeom(tankR * 3.1, tankR, tier.id <= 1 ? 10 : 16);
    addChild(water, instanceNode(
      { id: 'WaterTanks', category: 'water', material: 'tankShell' },
      shell,
      layout.waterTanks.map((t) => ({ id: t.id, p: t.p, r: [0, 0, 0], s: 1 })),
    ));
    // The fill body: the same shape scaled down in z, so a tank reads as part-full at a glance.
    addChild(water, instanceNode(
      { id: 'WaterTankFill', category: 'water', material: 'water', selectable: false },
      shell,
      layout.waterTanks.map((t) => ({ id: `${t.id}_Fill`, p: t.p, s: [0.98, 0.98, 0.001] })),
    ));
    for (const m of layout.waterManifolds) {
      child(water, {
        id: m.id, category: 'water', material: 'pipe', lod: 2,
        geom: tubeGeom(m.path, m.radius, 8),
      });
    }
    // The interconnects: reels feed the manifolds, tanks and drop outlets tap them. Merged
    // into one node — plumbing is context, not selectable machinery.
    if (layout.waterPipes.length) {
      child(water, {
        id: 'WaterPiping', category: 'water', material: 'pipe', lod: 2, selectable: false,
        geom: mergeSolids(layout.waterPipes.map((pp) => tubeGeom(pp.path, pp.radius, 6))),
      });
      // Flow through the BRANCHES too: risers while filling, tank feeds both ways, outlet
      // stubs while releasing — so the water animates the whole route, pump to end point.
      const recs2 = [];
      layout.waterPipes.forEach((pp, i) => {
        for (let k = 0; k < 2; k++) {
          recs2.push({ id: `Pipe_${i}_${k}`, p: pp.path[0], s: [0.0001, 0.0001, 0.0001] });
        }
      });
      addChild(water, instanceNode(
        { id: 'PipeFlow', category: 'water', material: 'water', lod: 2, selectable: false },
        sphereGeom(Math.max(0.45, layout.waterPipes[0].radius * 1.6), 6), recs2));
    }
    // Flow made visible: bright slugs that march along each manifold while water is moving —
    // toward the tanks during a fill, toward the outlets during a release. Pure display;
    // anim/driver.js positions them along the manifold paths and hides them otherwise.
    if (layout.waterManifolds.length) {
      const slugR = Math.max(0.5, layout.waterManifolds[0].radius * 1.5);
      const recs = [];
      const perRun = 5;
      for (const m of layout.waterManifolds) {
        for (let k = 0; k < perRun; k++) {
          recs.push({ id: `${m.id}_Slug${k}`, p: m.p, s: [0.0001, 0.0001, 0.0001] });
        }
      }
      const slugs = addChild(water, instanceNode(
        { id: 'FlowSlugs', category: 'water', material: 'water', lod: 2, selectable: false },
        sphereGeom(slugR, 8), recs,
      ));
      slugs.slugsPerRun = perRun;
    }
    addChild(water, instanceNode(
      { id: 'DropOutlets', category: 'water', material: 'outlet', lod: 1 },
      cylGeom(Math.max(0.8, R * 0.05), layout.dropOutlets[0] ? layout.dropOutlets[0].radius : 1, 8),
      layout.dropOutlets.map((o) => ({ id: o.id, p: o.p, r: [0, Math.PI / 2, 0] })),
    ));
    // Release water as SPRAY: a curtain of stretched droplets per outlet, repositioned every
    // frame by anim/driver.js — accelerating, fanning out, streaking longer as they speed up.
    // One instanced draw for the whole curtain. The fall span is display shorthand (the real
    // drop altitude is hundreds of metres), the same convention as the panel-scale hose.
    if (layout.dropOutlets.length) {
      const spanM = Math.max(10, R * 1.1);
      const dropR = Math.max(0.16, R * 0.011);
      const PER = 14;
      const recs = [];
      for (const o of layout.dropOutlets) {
        for (let k = 0; k < PER; k++) {
          recs.push({ id: `${o.id}_Drop${k}`, p: o.p, s: [0.0001, 0.0001, 0.0001] });
        }
      }
      const spray = addChild(water, instanceNode(
        { id: 'DropSpray', category: 'water', material: 'spray', lod: 1, selectable: false },
        sphereGeom(dropR, 6), recs));
      spray.sprayPer = PER;
      spray.spanM = spanM;
    }
    addChild(water, instanceNode(
      { id: 'HoseReels', category: 'water', material: 'machine' },
      cylGeom(Math.max(1.4, R * 0.09), layout.hoseReels[0] ? layout.hoseReels[0].radius : 2, 12),
      layout.hoseReels.map((h) => ({ id: h.id, p: h.p, r: [0, 0, Math.PI / 2] })),
    ));
    // Water RISING in the intake hose: bright slugs that climb the hose curve from the pump
    // pod to the reel while the pumps run. anim/driver.js positions them along the live
    // catenary every frame; hidden unless deployed and pumping.
    if (layout.hoseReels.length) {
      const upR = Math.max(0.35, R * 0.014);
      const PER = 7;
      const recs = [];
      for (const hr of layout.hoseReels) {
        for (let k = 0; k < PER; k++) {
          recs.push({ id: `HoseFlow_${pad(hr.index)}_${k}`, p: hr.p, s: [0.0001, 0.0001, 0.0001] });
        }
      }
      const hf = addChild(water, instanceNode(
        { id: 'HoseFlow', category: 'water', material: 'water', lod: 1, selectable: false },
        sphereGeom(upR, 6), recs));
      hf.flowPer = PER;
    }
    // Hose and pod are dynamic: real nodes, rebuilt by the hose driver.
    for (const h of layout.hoseReels) {
      const i = h.index;
      const hose = child(water, {
        id: `Hose_${pad(i)}`, category: 'water', material: 'hose',
        geom: tubeGeom([[h.p[0], h.p[1], h.p[2]], [h.p[0], h.p[1], h.p[2] - 1]],
          Math.max(0.3, R * 0.012), 6),
      });
      hose.visible = false;
      hose.dynamic = { kind: 'hose', reel: h.id, seg: 24, radius: Math.max(0.3, R * 0.012) };
      const pod = layout.pumpPods[i];
      const podNode = child(water, {
        id: pod.id, category: 'water', material: 'machine',
        p: [h.p[0], h.p[1], h.p[2] - 2],
        geom: mergeSolids([
          tankGeom(pod.length, pod.radius, 10),
          transformSolid(discGeom(pod.radius * 0.9, 12), m4compose([-pod.length / 2 - 0.1, 0, 0], [0, 0, 0], 1)),
        ]),
      });
      podNode.visible = false;
    }
  }

  /* --- cryogenic --------------------------------------------------------------------------- */
  const cryo = child(root, { id: 'CryogenicSystem', category: 'cryogenic', selectable: false });
  {
    const lr = layout.ln2Tanks[0] ? layout.ln2Tanks[0].radius : R * 0.10;
    const shell = tankGeom(lr * 3.4, lr, tier.id <= 1 ? 10 : 14);
    addChild(cryo, instanceNode(
      { id: 'LN2Tanks', category: 'cryogenic', material: 'cryoShell' },
      shell,
      layout.ln2Tanks.map((t) => ({ id: t.id, p: t.p })),
    ));
    addChild(cryo, instanceNode(
      { id: 'LN2TankFill', category: 'cryogenic', material: 'cryo', selectable: false },
      shell,
      layout.ln2Tanks.map((t) => ({ id: `${t.id}_Fill`, p: t.p, s: [0.97, 0.97, 0.001] })),
    ));
    // Every tank runs back to a cryogenic train — the nitrogen loop as visible plumbing.
    if (layout.ln2Pipes.length) {
      child(cryo, {
        id: 'LN2Piping', category: 'cryogenic', material: 'pipe', lod: 2, selectable: false,
        geom: mergeSolids(layout.ln2Pipes.map((pp) => tubeGeom(pp.path, pp.radius, 6))),
      });
    }
    for (const role of ['intake', 'compress', 'coldbox', 'expand']) {
      const mods = layout.cryoModules.filter((m) => m.role === role);
      if (!mods.length) continue;
      const s = mods[0].size;
      const g = role === 'intake' ? discGeom(s * 0.8, 12)
        : role === 'coldbox' ? boxGeom(s * 2.2, s * 1.2, s * 1.6)
          : cylGeom(s * 1.6, s * 0.6, 12);
      addChild(cryo, instanceNode(
        { id: `Cryo_${role}`, category: 'cryogenic', material: 'machine', lod: 2 },
        g,
        mods.map((m) => ({ id: m.id, p: m.p })),
      ));
    }
  }

  /* --- power ------------------------------------------------------------------------------- */
  const power = child(root, { id: 'PowerSystem', category: 'power', selectable: false });
  {
    const gs = layout.generators[0] ? layout.generators[0].size : R * 0.115;
    addChild(power, instanceNode(
      { id: 'Generators', category: 'power', material: 'machine' },
      boxGeom(gs * 2.0, gs * 1.1, gs * 1.1),
      layout.generators.map((g) => ({ id: g.id, p: g.p })),
    ));
    const bs = layout.batteries[0] ? layout.batteries[0].size : R * 0.075;
    addChild(power, instanceNode(
      { id: 'BatteryModules', category: 'power', material: 'battery', lod: 1 },
      boxGeom(bs * 1.6, bs * 1.0, bs * 0.7),
      layout.batteries.map((b) => ({ id: b.id, p: b.p })),
    ));
    const busSegs = [], busW = [];
    for (const b of layout.hvdcBuses) {
      for (const s of pathSegs(b.path)) { busSegs.push(s); busW.push(0.8); }
    }
    child(power, {
      id: 'HVDCBuses', category: 'power', geom: lines(busSegs, busW), material: 'bus', lod: 2,
      selectable: false,
    });
    child(power, {
      id: 'BlackStart', category: 'power', material: 'machine', lod: 3,
      p: inside(cls, 0.52, Math.PI * 1.32, 0.45),
      geom: boxGeom(R * 0.10, R * 0.07, R * 0.07),
    });
  }

  /* --- propulsion --------------------------------------------------------------------------- */
  const prop = child(root, { id: 'Propulsion', category: 'propulsion', selectable: false });
  {
    const rotG = rotorGeom(cls, cls.primaryRotorDiameterM, 4);
    const discG = discGeom(cls.primaryRotorDiameterM / 2, tier.id <= 1 ? 12 : 24);
    for (const st of layout.rotorStations) {
      const s = child(prop, { id: st.id, category: 'propulsion', p: st.p });
      const pylonLen = st.pylonLength;
      child(s, {
        id: `PrimaryRotorPylon_${pad(st.index)}`, category: 'propulsion', material: 'machine',
        p: [0, -st.side * pylonLen * 0.5, 0], r: [0, 0, Math.PI / 2],
        geom: cylGeom(pylonLen, Math.max(0.8, R * 0.035), 10), selectable: false,
      });
      const gim = child(s, {
        id: `PrimaryRotorGimbal_${pad(st.index)}`, category: 'propulsion',
        r: aimEuler(st.nominal), selectable: true,
      });
      // Enough separation that the counter-rotating pair reads as TWO discs. At 0.16 the
      // blade sets overlap into one mess.
      const sep = cls.primaryRotorDiameterM * 0.30;
      for (const [tag, off] of [['A', -sep / 2], ['B', sep / 2]]) {
        const rn = child(gim, {
          id: `PrimaryRotor${tag}_${pad(st.index)}`, category: 'propulsion',
          p: [off, 0, 0], material: 'rotor', geom: rotG,
        });
        rn.spin = { rate: 0, dir: tag === 'A' ? 1 : -1 };
        const d = child(gim, {
          id: `PrimaryRotorDisc${tag}_${pad(st.index)}`, category: 'propulsion',
          p: [off, 0, 0], material: 'thrustDisc', geom: discG,
          selectable: false, lod: 1,
        });
        d.opacity = 0;
        // The disc is drawn DOWNSTREAM of its rotor, and the driver moves it to the other side
        // when thrust reverses. `rotorX` is the rotor's own station on the gimbal axis, kept here
        // so the driver never has to reverse-engineer it from the current position.
        d.rotorX = off;
        d.leadM = Math.max(0.8, cls.primaryRotorDiameterM * 0.05);
      }
    }

    const mt = layout.mediumThrusters;
    if (mt.length) {
      const d = mt[0].diameter;
      const recs = mt.map((t) => ({ id: t.id, p: t.p, r: aimEuler(t.outward) }));
      addChild(prop, instanceNode(
        { id: 'MediumThrusters', category: 'propulsion', material: 'machine', lod: 1 },
        ductHousingGeom(d, 0.62), recs,
      ));
      addChild(prop, instanceNode(
        { id: 'MediumThrusterFans', category: 'propulsion', material: 'fan', lod: 1 },
        fanRotorGeom(d, 5, 0.62),
        recs.map((r) => ({ ...r, id: `${r.id}_Fan` })),
      ));
    }
    const fans = layout.trimFans;
    if (fans.length) {
      const d = fans[0].diameter;
      const frecs = fans.map((f) => ({ id: f.id, p: f.p, r: aimEuler(f.outward) }));
      addChild(prop, instanceNode(
        { id: 'LocalTrimFans', category: 'propulsion', material: 'machine', lod: 2 },
        ductHousingGeom(d, TRIM_FAN_DEPTH_RATIO), frecs,
      ));
      addChild(prop, instanceNode(
        { id: 'LocalTrimFanBlades', category: 'propulsion', material: 'fan', lod: 2 },
        fanRotorGeom(d, 3, TRIM_FAN_DEPTH_RATIO),
        frecs.map((r) => ({ ...r, id: `${r.id}_Fan` })),
      ));
    }
    // WASH streaks: faint stretched particles that stream through the working units, because
    // a smoothly-spinning rotor at panel size reads as stationary and a working blower reads
    // as dead. Positions and directions come from anim/driver.js every frame; one instanced
    // draw covers every rotor station and every medium thruster.
    {
      const recs = [];
      const PER_R = 6, PER_T = 3;
      for (const st of layout.rotorStations) {
        for (let k = 0; k < PER_R; k++) {
          recs.push({ id: `${st.id}_Wash${k}`, p: st.p, s: [0.0001, 0.0001, 0.0001] });
        }
      }
      for (const mt of layout.mediumThrusters) {
        for (let k = 0; k < PER_T; k++) {
          recs.push({ id: `${mt.id}_Wash${k}`, p: mt.p, s: [0.0001, 0.0001, 0.0001] });
        }
      }
      if (recs.length) {
        const streaks = addChild(prop, instanceNode(
          { id: 'AirStreaks', category: 'propulsion', material: 'airflow', lod: 1, selectable: false },
          sphereGeom(Math.max(0.25, R * 0.014), 6), recs));
        streaks.washPerRotor = PER_R;
        streaks.washPerThruster = PER_T;
      }
      // Ship MOVEMENT reads as speed lines slipping past the hull; ambient WIND as a
      // separate family of streaks crossing the scene along the true wind; and the small
      // trim fans announce themselves with scattered reactive puffs when gusts demand
      // work. All driver-positioned, all one instanced draw each.
      addChild(prop, instanceNode(
        { id: 'MotionLines', category: 'propulsion', material: 'motionline', lod: 1, selectable: false },
        sphereGeom(Math.max(0.3, R * 0.016), 6),
        Array.from({ length: 12 }, (_, k) => ({ id: `Motion_${k}`, p: [0, 0, 0], s: [0.0001, 0.0001, 0.0001] }))));
      addChild(prop, instanceNode(
        { id: 'WindLines', category: 'propulsion', material: 'windline', lod: 1, selectable: false },
        sphereGeom(Math.max(0.3, R * 0.016), 6),
        Array.from({ length: 10 }, (_, k) => ({ id: `Wind_${k}`, p: [0, 0, 0], s: [0.0001, 0.0001, 0.0001] }))));
      if (layout.trimFans.length) {
        addChild(prop, instanceNode(
          { id: 'GustPuffs', category: 'propulsion', material: 'airflow', lod: 1, selectable: false },
          sphereGeom(Math.max(0.22, R * 0.012), 6),
          Array.from({ length: 18 }, (_, k) => ({ id: `Puff_${k}`, p: [0, 0, 0], s: [0.0001, 0.0001, 0.0001] }))));
      }
    }
  }

  /* --- control surfaces ---------------------------------------------------------------------- */
  const ctrl = child(root, { id: 'ControlSurfaces', category: 'control', selectable: false });
  for (const ts of layout.tailSurfaces) {
    // A fin is a HINGE, so it is two nodes.
    //
    // The mount carries the placement: the blade geometry spans +y, and Rx(a) maps +y to
    // (0, cos a, sin a), while radially outward at hull angle th is (0, -cos th, sin th). So the
    // mount angle is PI - th. It is NOT th + PI/2 — that expression happens to be right at 45 and
    // 225 degrees and points the fin INWARD at 135 and 315, and is 90 degrees out for every fin of
    // a 'plus' tail.
    //
    // The surface is a child so its deflection rotates about ITS OWN span. Setting the deflection
    // on the mount would rotate it about the hull's Y axis instead, which means the same commanded
    // deflection does something different to each fin depending on where it sits.
    const mount = child(ctrl, {
      id: `TailSurfaceMount_${pad(ts.index)}`, category: 'control', p: ts.p,
      r: [Math.PI - ts.theta, 0, 0], selectable: false,
    });
    const n = child(mount, {
      id: ts.id, category: 'control', material: 'surface',
      geom: bladeGeom(ts.span, ts.chord, ts.chord * 0.55, Math.max(0.5, R * 0.02)),
    });
    n.hinge = { theta: ts.theta, deflect: 0, station: ts.p[0], radius: Math.hypot(ts.p[1], ts.p[2]) };
  }

  /* --- sensing, compute, maintenance ----------------------------------------------------------- */
  const sense = child(root, { id: 'Perception', category: 'sensors', selectable: false });
  addChild(sense, instanceNode(
    { id: 'SensorClusters', category: 'sensors', material: 'sensor', lod: 1 },
    boxGeom(layout.sensors[0].size * 1.6, layout.sensors[0].size, layout.sensors[0].size * 0.7),
    layout.sensors.map((s) => ({ id: s.id, p: s.p })),
  ));
  const mind = child(root, { id: 'MindAndSafety', category: 'compute', selectable: false });
  for (const m of layout.compute) {
    child(mind, {
      id: m.id, category: 'compute', p: m.p, material: m.id === 'SafetyKernel' ? 'safety' : 'compute',
      geom: boxGeom(m.size * 1.5, m.size, m.size * 0.8), lod: 2,
    });
  }
  const maint = child(root, { id: 'Maintenance', category: 'maintenance', selectable: false });
  {
    // Corridors follow their routed path rather than being one straight cylinder: a straight tube
    // at a fixed radius pokes out through the hull wherever the section narrows, which is most of
    // the nose and all of the tail.
    for (const c of layout.corridors) {
      child(maint, {
        id: c.id, category: 'maintenance', material: 'corridor', lod: 2,
        geom: tubeGeom(c.path, c.radius, 8),
      });
    }
    if (layout.tankerDock) {
      child(maint, {
        id: layout.tankerDock.id, category: 'maintenance', p: layout.tankerDock.p,
        material: 'machine', lod: 2,
        geom: cylGeom(layout.tankerDock.size * 0.5, layout.tankerDock.size * 0.8, 10),
      });
    }
  }

  /* --- the wire layer ---------------------------------------------------------------------------
   * The "true wire" view is not a triangle wireframe. It is (a) hull meridians and station rings,
   * which are the lines a draughtsman would actually draw on a body of revolution, and (b) the
   * FEATURE edges of every component — creases and boundaries, not tessellation. Both are baked
   * into world space here so the whole wire view is two draw calls, and hidden-line removal comes
   * from a depth prepass of the fairing rather than from a CPU visibility pass. */
  {
    const segs = [], wts = [];
    const nMer = tier.id <= 1 ? 8 : 16;
    const nStn = tier.id <= 1 ? 40 : 72;
    for (let k = 0; k < nMer; k++) {
      const th = (2 * Math.PI * k) / nMer;
      const path = [];
      for (let i = 0; i <= nStn; i++) {
        const t = i / nStn;
        const x = stationX(cls, t);
        const rr = hullR(cls, x) * sectionScale(th, cls.hull);
        path.push([x, -rr * Math.cos(th), rr * Math.sin(th)]);
      }
      for (const s of pathSegs(path)) { segs.push(s); wts.push(k % 4 === 0 ? 0.85 : 0.5); }
    }
    for (let i = 0; i <= 14; i++) {
      const t = 0.02 + (0.96 * i) / 14;
      const x = stationX(cls, t);
      const R = hullR(cls, x);
      const ring = [];
      for (let j = 0; j < 40; j++) {
        const th = (2 * Math.PI * j) / 40;
        const rr = R * sectionScale(th, cls.hull);
        ring.push([x, -rr * Math.cos(th), rr * Math.sin(th)]);
      }
      for (let j = 0; j < ring.length; j++) {
        segs.push([ring[j], ring[(j + 1) % ring.length]]);
        wts.push(0.45);
      }
    }
    child(root, {
      id: 'HullWire', category: 'structure', geom: lines(segs, wts), material: 'frame',
      selectable: false, lod: 1,
    });

    const eseg = [], ewt = [];
    const cache = new Map();
    walk(root, (n) => {
      if (!n.geom || n.geom.kind !== 'solid') return true;
      if (n.id === 'OuterFairing' || n.id === 'SolarSkin') return true;
      // The hose changes SHAPE every frame, so it cannot be baked. Rotors and control surfaces
      // only change POSE, and a technical wire drawing with no rotors in it is a worse lie than a
      // wire drawing whose rotors do not spin — so they are baked at rest and the wire view is
      // documented as showing them static.
      if (n.dynamic) return true;
      let e = cache.get(n.geom);
      if (!e) { e = featureEdges(n.geom, 26); cache.set(n.geom, e); }
      if (!e.length) return true;
      if (n.inst) {
        const m = new Float32Array(16);
        for (let i = 0; i < n.inst.count; i++) {
          m.set(n.inst.xf.subarray(i * 16, i * 16 + 16));
          for (const s of transformSegs(e, m)) { eseg.push(s); ewt.push(0.7); }
        }
      } else {
        const m = m4compose(n.p, n.r, n.s);
        for (const s of transformSegs(e, m)) { eseg.push(s); ewt.push(0.7); }
      }
      return true;
    });
    if (eseg.length) {
      child(root, {
        id: 'ComponentEdges', category: 'structure', geom: lines(eseg, ewt), material: 'lattice',
        selectable: false, lod: 2,
      });
    }
  }

  /* --- index, metadata, stats ------------------------------------------------------------------ */
  const index = buildIndex(root);
  // Instance ids participate in selection and metadata too.
  const allIds = [];
  walk(root, (n) => {
    if (n.selectable) allIds.push(n.id);
    if (n.inst) {
      for (const id of n.inst.ids) {
        if (!id.endsWith('_Fill') && !id.endsWith('_Fan')) allIds.push(id);
      }
    }
  });
  const metadata = buildMetadata(cls, layout, allIds);

  let tris = 0, segs = 0, calls = 0;
  walk(root, (n) => {
    if (!n.geom) return;
    const c = countOf(n.geom);
    const mult = n.inst ? n.inst.count : 1;
    tris += c.tris * mult;
    segs += c.segs * mult;
    calls += 1;
  });

  return {
    cls, layout, field, root, index, metadata,
    cellSites: lat.cellSites,
    selectableIds: allIds,
    stats: {
      tier: tier.id, triangles: tris, segments: segs, drawCalls: calls,
      latticeMembers: lat.memberCount, latticeNodes: lat.nodeCount,
      nodes: index.size, instances: countInstances(root),
    },
  };
}

function countInstances(root) {
  let n = 0;
  walk(root, (x) => { if (x.inst) n += x.inst.count; });
  return n;
}

/** Build all three classes at a tier — the scale-comparison scene wants them together. */
export const buildAll = (tier = 1) => CLASS_IDS.map((id) => build(id, { tier }));

/* ---------- the full vacuum fill (the 'vacuum' view) ------------------------------------------ */

/**
 * Pack the ENTIRE free interior with spheres for the 'vacuum' view — one instanced node, one draw
 * call, built LAZILY on first entry to the view so buildAll stays cheap for every page that never
 * opens it.
 *
 * This is deliberately not the representative-cells mechanism (VacuumCellModules, showCells): that
 * one samples a few hundred sites so a cutaway stays legible; this one is the "the hull is mostly
 * vacuum" picture, so it fills the whole volume at a display pitch chosen per class to keep the
 * instance count in the low thousands. Placement rules:
 *
 *   - HCP-ish lattice with pitch derived from the class volume and a target count
 *   - a ball's centre must be inside the hull by (ball radius + skin band), so nothing pokes out
 *   - a ball must clear every layout obstacle — tanks (as capsules), machinery bays, cryo plant,
 *     compute, hose reels, pump pods, corridors and manifolds (as swept segments) — by a
 *     conservative margin, so the machinery reads as sitting in carved-out pockets
 *
 * @param {object} b    build() result
 * @param {object} opts { tier, targetCount }
 * @returns instanced node 'VacuumFillBalls' with `.vacuumFill = { count, radiusM, pitchM }`
 */
export function buildVacuumFill(b, opts = {}) {
  const cls = b.cls, layout = b.layout;
  const target = opts.targetCount || 2800;
  const shell = Math.max(0.6, cls.maxRadiusM * 0.045);   // same band the cutaway cap draws

  // Obstacles, conservatively inflated once up front.
  const spheres = [], capsules = [];
  const sph = (p, r) => spheres.push({ p, r });
  const seg = (a, bb, r) => capsules.push({ a, b: bb, r });
  for (const t of layout.waterTanks.concat(layout.ln2Tanks)) {
    const h = Math.max(0, t.length / 2 - t.radius);
    seg([t.p[0] - h, t.p[1], t.p[2]], [t.p[0] + h, t.p[1], t.p[2]], t.radius * 1.1);
  }
  for (const g of layout.generators) sph(g.p, g.size * 1.35);
  for (const bt of layout.batteries) sph(bt.p, bt.size * 1.1);
  for (const m of layout.cryoModules) sph(m.p, m.size * 1.6);
  for (const c of layout.compute) sph(c.p, c.size * 1.2);
  for (const h of layout.hoseReels) sph(h.p, h.radius * 1.5);
  for (const pp of layout.pumpPods) sph(pp.p, pp.length * 0.7);
  if (layout.tankerDock) sph(layout.tankerDock.p, layout.tankerDock.size * 1.2);
  for (const c of layout.corridors) {
    for (let i = 0; i < c.path.length - 1; i++) seg(c.path[i], c.path[i + 1], c.radius * 1.2);
  }
  for (const m of layout.waterManifolds) {
    for (let i = 0; i < m.path.length - 1; i++) seg(m.path[i], m.path[i + 1], m.radius * 1.3);
  }

  const generate = (pitch) => {
    const r = pitch * 0.46;
    const margin = r + shell;
    const clear = r + Math.max(0.3, r * 0.25);
    const recs = [];
    const dy = pitch * 0.8660, dz = pitch * 0.8165;
    const R = cls.maxRadiusM;
    let layer = 0;
    for (let z = -R + dz / 2; z < R; z += dz, layer++) {
      const lx = (layer % 2) * pitch * 0.5;
      const ly = (layer % 2) * dy / 3;
      let row = 0;
      for (let y = -R + dy / 2 + ly; y < R; y += dy, row++) {
        const ox = lx + (row % 2) * pitch * 0.5;
        // Cheap radial prune before the exact hull test.
        const rho = Math.hypot(y, z);
        if (rho > R - margin) continue;
        for (let x = cls.xTail + ox + pitch / 2; x < cls.xNose; x += pitch) {
          const p = [x, y, z];
          if (!insideHull(cls, p, margin)) continue;
          let ok = true;
          for (const o of spheres) {
            const dx = p[0] - o.p[0], dyy = p[1] - o.p[1], dzz = p[2] - o.p[2];
            if (dx * dx + dyy * dyy + dzz * dzz < (o.r + clear) * (o.r + clear)) { ok = false; break; }
          }
          if (ok) {
            for (const o of capsules) {
              if (segPointDist(o.a, o.b, p) < o.r + clear) { ok = false; break; }
            }
          }
          if (ok) recs.push(p);
        }
      }
    }
    return { recs, r, pitch };
  };

  // Aim for the target count; the free volume differs per class, so one correction pass.
  let pitch = Math.cbrt(cls.volumeM3 / target);
  let out = generate(pitch);
  for (let i = 0; i < 3 && (out.recs.length > target * 1.7 || out.recs.length < target * 0.5); i++) {
    pitch *= Math.cbrt(Math.max(0.05, out.recs.length / target));
    out = generate(pitch);
  }

  const tier = opts.tier === undefined ? 2 : opts.tier;
  const geom = sphereGeom(out.r, tier >= 3 ? 12 : 8, tier >= 3 ? 8 : 6);
  const rnd = streamFor(cls.structuralSeed, 'vacuumFill');
  const records = out.recs.map((p, i) => {
    const k = 0.82 + 0.34 * rnd();   // slight per-ball brightness variation carries the depth
    return { id: `VacuumBall_${pad(i, 4)}`, p, tint: [k, k, k, 1] };
  });
  const n = instanceNode(
    { id: 'VacuumFillBalls', category: 'vacuum', material: 'vacuumFill', selectable: false },
    geom, records);
  n.vacuumFill = { count: records.length, radiusM: out.r, pitchM: out.pitch };
  return n;
}

export { CATEGORIES };
