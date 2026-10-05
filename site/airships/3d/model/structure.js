/* The volumetric load-bearing structure — the sponge.
 *
 * THE CENTRAL HYPOTHESIS THIS DRAWS. The vehicle is not a thin shell around a cavity. It is a
 * three-dimensional, bone-like structure occupying the whole envelope, filled with many small,
 * independently sealed evacuated cells. The outer surface is a fairing over that structure, not
 * the thing resisting the atmosphere. If a view of this model ever reads as a hollow balloon, the
 * view is wrong.
 *
 * HOW THE LATTICE IS BUILT. Not a cubic voxel grid clipped to the hull — that reads as a chewed
 * block. It is a set of nested shells that follow the body:
 *
 *   shells      nested surfaces at fractions of the local radius (1.00 skin … 0.30 core)
 *   stations    transverse rings spaced at roughly the class's cell pitch along x
 *   azimuths    spaced at roughly the cell pitch AROUND the local circumference, so the member
 *               count per ring falls with the section rather than the members fanning out
 *   members     hoop + longitudinal + radial + diagonal bracing between those nodes
 *
 * Because the azimuth count is set by arc length rather than by a fixed number, the cells stay
 * roughly the same physical size everywhere — which is what makes the structure look manufactured
 * rather than parameterised, and is why the bigger classes read as FINER-grained rather than as
 * enlargements. Cell pitch is a manufacturing constant, not a scaled dimension.
 *
 * WHAT THE DENSITY FIELD DOES HERE. Every member asks the field for the density at its midpoint.
 * That number decides (a) whether a diagonal exists at all, (b) how heavy the line is drawn, and
 * (c) whether an extra brace is added. Swap in a real analysis field and the structure re-grades
 * itself with no other change — that is the whole point of the separation.
 *
 * WHAT IT IS NOT. Illustrative stress-informed topology. No solver was run. See density.js.
 */

import { stationX, hullR, sectionScale, profileR } from './config.js?v=d3e69408';
import { lines, loopSegs, pathSegs, mergeLines } from './geom.js?v=d3e69408';
import { streamFor, jitter } from '../core/prng.js?v=d3e69408';
import { clamp01, dist, lerp, segPointDist } from '../core/math.js?v=d3e69408';

/** Detail tiers. 0 map · 1 distant/inline · 2 medium · 3 close cutaway. */
export const TIERS = [
  { id: 0, pitchMul: 3.2, shells: 2, diagonals: false, cells: 0 },
  { id: 1, pitchMul: 2.0, shells: 3, diagonals: false, cells: 0.25 },
  { id: 2, pitchMul: 1.35, shells: 4, diagonals: true, cells: 0.6 },
  { id: 3, pitchMul: 1.0, shells: 5, diagonals: true, cells: 1.0 },
];

/** Machinery volumes the lattice should route around rather than pass through. */
export function occupancy(cls, layout) {
  const out = [];
  const R = cls.maxRadiusM;
  for (const t of layout.waterTanks) out.push({ p: t.p, r: t.radius * 1.9 });
  for (const t of layout.ln2Tanks) out.push({ p: t.p, r: t.radius * 1.9 });
  for (const g of layout.generators) out.push({ p: g.p, r: g.size * 1.3 });
  for (const c of layout.cryoModules) out.push({ p: c.p, r: c.size * 1.3 });
  // A run is a CAPSULE, not a string of samples. Sampling leaves gaps between the samples, and
  // the gaps are exactly where a cell or a battery ends up.
  const addRun = (path, r) => {
    for (let i = 0; i < path.length - 1; i++) out.push({ a: path[i], b: path[i + 1], r });
  };
  for (const c of layout.corridors) addRun(c.path, c.radius * 1.6);
  for (const m of layout.waterManifolds) addRun(m.path, m.radius * 2.2);
  for (const b of layout.batteries) out.push({ p: b.p, r: b.size * 1.1 });
  for (const m of layout.compute) out.push({ p: m.p, r: m.size * 1.2 });
  void R;
  return out;
}

/** Is a sphere of radius `m` about p wholly inside the hull? */
function insideHullMargin(cls, p, m) {
  const t = (cls.xNose - p[0]) / cls.lengthM;
  if (t < 0 || t > 1) return false;
  const theta = Math.atan2(p[2], -p[1]);
  const skin = hullR(cls, p[0]) * sectionScale(theta, cls.hull);
  if (Math.hypot(p[1], p[2]) + m > skin) return false;
  // and the fore/aft extremes of the sphere must clear the tapering ends too
  for (const dx of [-m, m]) {
    const r2 = hullR(cls, p[0] + dx) * sectionScale(theta, cls.hull);
    if (Math.hypot(p[1], p[2]) > r2) return false;
  }
  return true;
}

/** Distance from p to an occupied volume, which may be a sphere or a capsule. */
const occDist = (o, p) => (o.a
  ? segPointDist(o.a, o.b, p)
  : Math.hypot(p[0] - o.p[0], p[1] - o.p[1], p[2] - o.p[2]));

const blocked = (occ, p) => {
  for (let i = 0; i < occ.length; i++) if (occDist(occ[i], p) < occ[i].r) return true;
  return false;
};

/**
 * Build the lattice node grid. Returns { nodes, byShell } where a node is
 * { p, si (shell), ti (station), ai (azimuth), theta, f, density, blocked }.
 */
function latticeNodes(cls, field, occ, tier) {
  const pitch = cls.cellSizeM * tier.pitchMul;
  const nStations = Math.max(6, Math.round(cls.lengthM / pitch));
  const shellFracs = [];
  for (let i = 0; i < tier.shells; i++) {
    shellFracs.push(1 - (0.70 * i) / Math.max(1, tier.shells - 1));   // 1.00 … 0.30
  }
  const rnd = streamFor(cls.structuralSeed, `lattice${tier.id}`);
  const nodes = [];
  const grid = [];   // grid[si][ti] = array of nodes around that ring

  for (let si = 0; si < shellFracs.length; si++) {
    const f = shellFracs[si];
    grid[si] = [];
    for (let ti = 0; ti <= nStations; ti++) {
      const t = ti / nStations;
      const x = stationX(cls, t);
      const rl = hullR(cls, x) * f;
      const ring = [];
      grid[si][ti] = ring;
      if (rl < pitch * 0.35) continue;                      // section too small to hold a ring
      const circumference = 2 * Math.PI * rl;
      const nA = Math.max(4, Math.round(circumference / pitch));
      for (let ai = 0; ai < nA; ai++) {
        // Alternate rings are offset by half a bay, which is what turns a grid into a lattice.
        const theta = (2 * Math.PI * (ai + (ti % 2 ? 0.5 : 0))) / nA;
        const rr = rl * sectionScale(theta, cls.hull);
        const p = [x + jitter(rnd, pitch * 0.05),
          -rr * Math.cos(theta), rr * Math.sin(theta)];
        const n = {
          p, si, ti, ai, nA, theta, f,
          density: field.sample(p).density,
          blocked: blocked(occ, p),
        };
        ring.push(n);
        nodes.push(n);
      }
    }
  }
  return { nodes, grid, nStations, shellFracs, pitch };
}

/** Nearest node in a ring by azimuth — used to connect rings whose counts differ. */
function nearestByTheta(ring, theta) {
  if (!ring || !ring.length) return null;
  let best = null, bd = Infinity;
  for (const n of ring) {
    let d = Math.abs(n.theta - theta);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/**
 * Generate the cellular lattice.
 * @returns {{ geom, memberCount, cellSites, nodeCount }}
 */
export function buildLattice(cls, field, layout, tierId = 2) {
  const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, tierId))];
  const occ = occupancy(cls, layout);
  const { nodes, grid, nStations, shellFracs, pitch } = latticeNodes(cls, field, occ, tier);
  const rnd = streamFor(cls.structuralSeed, `members${tier.id}`);

  const segs = [], wts = [];
  const push = (a, b) => {
    if (a.blocked || b.blocked) return;
    const d = field.member(a.p, b.p);
    segs.push([a.p, b.p]);
    wts.push(d);
  };
  /** Keep test: low-density regions lose their optional bracing first. */
  const keep = (a, b, bias) => {
    const d = 0.5 * (a.density + b.density);
    return rnd() < clamp01(d * 1.55 + bias);
  };

  for (let si = 0; si < grid.length; si++) {
    for (let ti = 0; ti <= nStations; ti++) {
      const ring = grid[si][ti];
      if (!ring || !ring.length) continue;

      // hoop members — the ring itself. Always present: this is the section's shape.
      for (let i = 0; i < ring.length; i++) push(ring[i], ring[(i + 1) % ring.length]);

      const next = grid[si][ti + 1];
      if (next && next.length) {
        for (const n of ring) {
          const m = nearestByTheta(next, n.theta);
          if (!m) continue;
          push(n, m);                                        // longitudinal
          if (tier.diagonals) {
            // Diagonal bracing, biased so hot regions get both diagonals and cold ones get none.
            const j = next.indexOf(m);
            const m2 = next[(j + 1) % next.length];
            const m3 = next[(j - 1 + next.length) % next.length];
            if (m2 && keep(n, m2, -0.28)) push(n, m2);
            if (m3 && keep(n, m3, -0.42)) push(n, m3);
          }
        }
      }

      // radial members to the next shell in
      const inner = grid[si + 1] && grid[si + 1][ti];
      if (inner && inner.length) {
        for (const n of ring) {
          const m = nearestByTheta(inner, n.theta);
          if (m && keep(n, m, 0.10)) push(n, m);
        }
      }
    }
  }

  // Representative sealed vacuum cells: closed boundaries drawn at a sample of lattice bays,
  // preferentially where the structure is light (that is where the cells are the volume).
  //
  // A CELL IS A VOLUME, NOT A POINT. The outermost lattice shell sits ON the skin, so a cell
  // centred on one of those nodes hangs half-way out of the aircraft; and machinery placed after
  // the lattice was generated can leave a cell drawn straight through a tank. Both were visible
  // on screen. So a site is only used if the whole cell fits: inside the hull, and clear of the
  // occupied volumes.
  const cellSites = [];
  if (tier.cells > 0) {
    const want = Math.round(cls.visualDetail.closeCellModules * tier.cells);
    const cellR = pitch * 0.34;
    const fits = (p) => {
      if (!insideHullMargin(cls, p, cellR)) return false;
      for (let i = 0; i < occ.length; i++) if (occDist(occ[i], p) < occ[i].r + cellR) return false;
      return true;
    };
    const cand = nodes.filter((n) => !n.blocked && n.si > 0 && fits(n.p));
    const cr = streamFor(cls.structuralSeed, `cells${tier.id}`);
    for (let i = 0; i < cand.length && cellSites.length < want; i++) {
      const n = cand[(i * 7919) % cand.length];
      // A cell is more likely where material is thin — the sponge's voids are its lift.
      if (cr() > 0.35 + 0.55 * (1 - n.density)) continue;
      cellSites.push({ p: n.p, r: cellR, density: n.density, si: n.si, ti: n.ti });
    }
  }

  return {
    geom: lines(segs, wts),
    memberCount: segs.length,
    nodeCount: nodes.length,
    cellSites,
    pitch,
    tier: tier.id,
  };
}

/** Geometry for the representative sealed cells: a cuboctahedral outline per site. */
export function buildCellModules(cls, cellSites) {
  const segs = [], wts = [];
  // Unit cell outline: an octahedron plus its equatorial square. Reads as a sealed void, cheap.
  const oct = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const edges = [[0, 2], [2, 1], [1, 3], [3, 0], [0, 4], [2, 4], [1, 4], [3, 4],
    [0, 5], [2, 5], [1, 5], [3, 5]];
  for (const s of cellSites) {
    const v = oct.map((u) => [s.p[0] + u[0] * s.r, s.p[1] + u[1] * s.r, s.p[2] + u[2] * s.r]);
    for (const [a, b] of edges) { segs.push([v[a], v[b]]); wts.push(0.55); }
  }
  return lines(segs, wts);
}

/**
 * Macro structure: ring frames, longerons and section joints. These are the members a reader
 * should be able to trace with a finger — the lattice is the texture between them.
 */
export function buildMacroFrames(cls, field, tierId = 2) {
  const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, tierId))];
  const segs = [], wts = [];
  const nFrames = Math.max(4, Math.round(cls.macroFrameCount / (tier.pitchMul > 2 ? 2 : 1)));
  const seg = tier.id <= 1 ? 16 : 28;

  for (let i = 0; i <= nFrames; i++) {
    const t = 0.06 + (0.88 * i) / nFrames;
    const x = stationX(cls, t);
    const R = hullR(cls, x);
    if (R < cls.maxRadiusM * 0.06) continue;
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      const rr = R * sectionScale(th, cls.hull);
      ring.push([x, -rr * Math.cos(th), rr * Math.sin(th)]);
    }
    for (const s of loopSegs(ring)) { segs.push(s); wts.push(0.95); }
    // Inner ring + spokes: the frame is a deep section, not a hoop of wire.
    const innerF = 0.62;
    const inner = ring.map((p) => [p[0], p[1] * innerF, p[2] * innerF]);
    for (const s of loopSegs(inner)) { segs.push(s); wts.push(0.7); }
    for (let j = 0; j < seg; j += 2) {
      segs.push([ring[j], inner[j]]);
      wts.push(clamp01(0.6 + 0.4 * field.sample(ring[j]).density));
    }
    // A shear web across the section on the heaviest frames.
    if (i % 2 === 0) {
      segs.push([inner[0], inner[Math.floor(seg / 2)]]);
      wts.push(0.8);
      segs.push([inner[Math.floor(seg / 4)], inner[Math.floor((3 * seg) / 4)]]);
      wts.push(0.8);
    }
  }

  // Longerons: continuous fore-aft members just inside the skin, at fixed azimuths.
  const nL = tier.id <= 1 ? Math.max(6, Math.round(cls.longerons / 2)) : cls.longerons;
  const nStn = tier.id <= 1 ? 24 : 48;
  for (let k = 0; k < nL; k++) {
    const th = (2 * Math.PI * k) / nL;
    const path = [];
    for (let i = 0; i <= nStn; i++) {
      const t = 0.03 + (0.94 * i) / nStn;
      const x = stationX(cls, t);
      const rr = hullR(cls, x) * 0.93 * sectionScale(th, cls.hull);
      path.push([x, -rr * Math.cos(th), rr * Math.sin(th)]);
    }
    for (const s of pathSegs(path)) {
      segs.push(s);
      wts.push(clamp01(0.55 + 0.45 * field.member(s[0], s[1])));
    }
  }

  // The keel: the heaviest single run, carrying the water gear, the reels and the drop manifolds.
  {
    const path = [];
    for (let i = 0; i <= nStn; i++) {
      const t = 0.06 + (0.88 * i) / nStn;
      const x = stationX(cls, t);
      const rr = hullR(cls, x) * 0.88 * sectionScale(Math.PI * 1.5, cls.hull);
      path.push([x, 0, -rr]);
    }
    for (const s of pathSegs(path)) { segs.push(s); wts.push(1.0); }
  }

  return lines(segs, wts);
}

/** Section joints: the boundaries of the replaceable structural districts. */
export function buildSectionJoints(cls, layout) {
  const segs = [], wts = [];
  for (const j of layout.sectionJoints) {
    const x = j.p[0];
    const R = hullR(cls, x);
    for (const f of [1.0, 0.66, 0.34]) {
      for (const s of circleAt(cls, x, R * f, 32)) { segs.push(s); wts.push(f === 1 ? 0.9 : 0.6); }
    }
    for (let k = 0; k < 8; k++) {
      const th = (2 * Math.PI * k) / 8;
      const rr = R * sectionScale(th, cls.hull);
      segs.push([[x, -rr * 0.34 * Math.cos(th), rr * 0.34 * Math.sin(th)],
        [x, -rr * Math.cos(th), rr * Math.sin(th)]]);
      wts.push(0.75);
    }
  }
  return lines(segs, wts);
}

function circleAt(cls, x, r, seg) {
  const pts = [];
  for (let j = 0; j < seg; j++) {
    const th = (2 * Math.PI * j) / seg;
    const rr = r * sectionScale(th, cls.hull);
    pts.push([x, -rr * Math.cos(th), rr * Math.sin(th)]);
  }
  return loopSegs(pts);
}

/**
 * Load-path highlight: the members carrying the most, drawn as a separate overlay so the
 * load-path view can show them over a dimmed structure without rebuilding the lattice.
 */
export function buildLoadPaths(cls, field, layout) {
  const segs = [], wts = [];
  // From each major hardpoint, trace outward to the nearest macro frames — an illustration of
  // load introduction, not a computed path.
  const R = cls.maxRadiusM;
  const anchors = [...layout.rotorStations, ...layout.waterTanks, ...layout.hoseReels];
  for (const a of anchors) {
    const x = a.p[0];
    for (const dx of [-1, 1]) {
      const x2 = x + dx * cls.lengthM * 0.055;
      const th = Math.atan2(a.p[2], -a.p[1]);
      const r2 = hullR(cls, x2) * 0.93 * sectionScale(th, cls.hull);
      const p2 = [x2, -r2 * Math.cos(th), r2 * Math.sin(th)];
      segs.push([a.p, p2]);
      wts.push(clamp01(0.7 + 0.3 * field.member(a.p, p2)));
      // and a hoop run around the section, which is how a local load becomes a global one
      const p3 = [x2, -r2 * Math.cos(th + 0.5), r2 * Math.sin(th + 0.5)];
      segs.push([p2, p3]);
      wts.push(0.7);
    }
  }
  void R; void dist; void lerp; void profileR; void mergeLines;
  return lines(segs, wts);
}
