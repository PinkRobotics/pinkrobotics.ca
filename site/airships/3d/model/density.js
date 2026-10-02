/* Structural load-path density field.
 *
 * WHAT THIS IS. A deterministic proxy that makes the drawn structure denser where a real design
 * would plausibly need more material, and thinner where it plausibly would not. It is arithmetic
 * over hand-placed load anchors and a beam-bending shape function. It is NOT a solver result.
 *
 * WHAT IT IS NOT. No finite-element analysis was run. Nothing here is FEA-optimized,
 * ML-optimized, structurally validated, stress-proven or flightworthy. Every view that shows it
 * carries the label "Illustrative stress-informed topology". If you are tempted to relabel it,
 * run a solver first.
 *
 * THE UPGRADE PATH IS THE POINT. Consumers never compute density themselves — they call
 * `field.sample(p)` and `field.member(a, b)`. `proxyField()` and `dataField()` satisfy the same
 * interface, so real analysis output can replace the proxy without touching the geometry, the
 * renderer or the views. `dataField()` already accepts per-node stress, per-element density,
 * displacement vectors, safety factors, a load-case id and damage states, which is the shape a
 * structural run actually emits.
 */

import { clamp01, dist, lerp, sub, len as vlen, dot } from '../core/math.js?v=331c3257';
import { stationT, profileR } from './config.js?v=331c3257';

/**
 * @typedef {object} DensitySample
 * @property {number} density    0..1 relative material density at the point
 * @property {number} safety     illustrative safety-factor proxy (>1 is "comfortable")
 * @property {number[]} [disp]   displacement vector, metres, exaggerated by the caller
 * @property {string} source     'proxy' | 'analysis' — never let a view claim the wrong one
 */

/** The load anchors a class's layout produces. `sigma` is the metres over which the load spreads. */
export function anchorsFor(cls, layout) {
  const A = [];
  const push = (id, p, sigma, weight) => A.push({ id, p, sigma, weight });
  const R = cls.maxRadiusM;

  // Introduced loads: thrust into the structure is the single biggest local demand.
  for (const st of layout.rotorStations) push(st.id, st.p, R * 0.42, 1.00);
  for (const t of layout.mediumThrusters) push(t.id, t.p, R * 0.22, 0.42);
  // Concentrated masses.
  for (const t of layout.waterTanks) push(t.id, t.p, R * 0.30, 0.78);
  for (const t of layout.ln2Tanks) push(t.id, t.p, R * 0.24, 0.55);
  for (const g of layout.generators) push(g.id, g.p, R * 0.20, 0.46);
  for (const b of layout.batteries) push(b.id, b.p, R * 0.16, 0.26);
  for (const c of layout.cryoModules) push(c.id, c.p, R * 0.22, 0.40);
  // Hose reels and pump-pod attachment take the full suspended load plus dynamics.
  for (const h of layout.hoseReels) push(h.id, h.p, R * 0.26, 0.72);
  // Control surfaces feed a long torque arm into the tail.
  for (const t of layout.tailSurfaces) push(t.id, t.p, R * 0.30, 0.60);
  if (layout.tankerDock) push(layout.tankerDock.id, layout.tankerDock.p, R * 0.22, 0.34);
  // Maintenance passages are holes, not loads: they force material around themselves.
  for (const m of layout.corridors) push(m.id, m.p, R * 0.18, -0.30);
  return A;
}

/**
 * The deterministic proxy field.
 *
 * Four contributions, each with a stated reason:
 *   anchor   concentrated introduced loads and masses, as Gaussians about their hardpoints
 *   bending  a whole-body beam term: buoyancy is distributed by section area, weight is not, so
 *            the bending moment peaks near mid-length and the material that resists it wants to
 *            be far from the neutral axis — hence the |z| weighting
 *   shell    macro load paths hug the surface, where a given mass of material buys the most
 *            second moment of area
 *   ends     the nose and tail transitions carry gust and pitching loads into a shrinking section
 */
export function proxyField(cls, layout, opts = {}) {
  const anchors = anchorsFor(cls, layout);
  const R = cls.maxRadiusM;
  const L = cls.lengthM;
  const w = {
    anchor: 1.00, bending: 0.62, shell: 0.55, ends: 0.30, base: 0.16,
    ...(opts.weights || {}),
  };
  /** Damaged regions redistribute load rather than vanishing — see `withDamage`. */
  const damage = opts.damage ? opts.damage.slice() : [];

  function raw(p) {
    const [x, y, z] = p;
    let d = w.base;

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const dx = x - a.p[0], dy = y - a.p[1], dz = z - a.p[2];
      const q = (dx * dx + dy * dy + dz * dz) / (a.sigma * a.sigma);
      if (q < 9) d += w.anchor * a.weight * Math.exp(-q);
    }

    const t = stationT(cls, x);                     // 0 nose … 1 tail
    const rLocal = Math.max(1e-3, profileR(t, cls.hull) * R);

    // Bending: parabolic moment shape along the span, resisted by material off the neutral axis.
    const s = 1 - Math.pow(2 * t - 1, 2);           // 0 at the ends, 1 at mid-length
    const offAxis = Math.min(1, Math.hypot(y, z) / rLocal);
    d += w.bending * s * (0.35 + 0.65 * offAxis * offAxis);

    // Shell band: the outermost ~18% of the local radius carries the macro paths.
    const rel = Math.hypot(y, z) / rLocal;
    d += w.shell * Math.exp(-Math.pow((1 - rel) / 0.18, 2));

    // End transitions.
    const endness = Math.max(0, 1 - Math.min(t, 1 - t) / 0.14);
    d += w.ends * endness * endness;

    for (let i = 0; i < damage.length; i++) {
      const dm = damage[i];
      const q = dist(p, dm.p) / dm.radius;
      if (q < 1) {
        // Inside the damaged volume the member is unavailable; immediately outside it, the load
        // it used to carry has to go somewhere, so the ring around it thickens.
        d *= lerp(0.06, 1, clamp01((q - 0.55) / 0.45));
      } else if (q < 1.9) {
        d *= 1 + 0.85 * (1 - (q - 1) / 0.9);
      }
    }
    return d;
  }

  // Normalise against a sampled maximum so `density` is comparable across classes and the colour
  // ramp means the same thing on a P-100 and a P-10000.
  let hi = 1e-6;
  const NS = 14;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const rl = profileR(t, cls.hull) * R;
    const x = cls.xNose - t * L;
    for (let k = 0; k < 10; k++) {
      const th = (k / 10) * Math.PI * 2;
      for (const f of [0.15, 0.55, 0.92]) {
        hi = Math.max(hi, raw([x, -rl * f * Math.cos(th), rl * f * Math.sin(th)]));
      }
    }
  }

  return {
    source: 'proxy',
    label: 'Illustrative stress-informed topology',
    anchors,
    /** @returns {DensitySample} */
    sample(p) {
      const d = clamp01(raw(p) / hi);
      return { density: d, safety: 1.15 + 1.9 * (1 - d), source: 'proxy' };
    },
    /** Density a member spanning a→b should be drawn with: the midpoint, biased to its hotter end. */
    member(a, b) {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const dm = this.sample(mid).density;
      const da = this.sample(a).density;
      const db = this.sample(b).density;
      return clamp01(0.5 * dm + 0.5 * Math.max(da, db));
    },
    withDamage(regions) {
      return proxyField(cls, layout, { ...opts, damage: regions });
    },
  };
}

/**
 * A field backed by real analysis output.
 *
 * Accepts whatever a structural run produced, in the shapes such runs actually emit:
 *   { nodes: [[x,y,z],…],
 *     stress: [Pa,…]            per node
 *     density: [0..1,…]         per node or per element
 *     displacement: [[dx,dy,dz],…]
 *     safety: [n,…]
 *     loadCase: 'gust-45deg',
 *     damage: [{p,radius,state}] }
 *
 * Interpolation is inverse-distance over a uniform spatial hash — no library, no build step, and
 * fast enough to fill the lattice once at build time. When this is in use, `source` is 'analysis'
 * and the views are free to say so; that is the ONLY circumstance in which they may.
 */
export function dataField(cls, data, opts = {}) {
  const cell = opts.cellM || Math.max(4, cls.maxRadiusM / 6);
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  const idx = (v) => Math.floor(v / cell);
  const nodes = data.nodes || [];

  // Normalise whichever quantity we were given into a 0..1 density per node.
  let dens = data.density;
  if (!dens && data.stress) {
    const mx = Math.max(...data.stress) || 1;
    dens = data.stress.map((s) => clamp01(s / mx));
  }
  if (!dens && data.safety) {
    const mn = Math.min(...data.safety);
    const mx = Math.max(...data.safety) || 1;
    dens = data.safety.map((s) => clamp01(1 - (s - mn) / Math.max(1e-6, mx - mn)));
  }
  if (!dens) dens = nodes.map(() => 0.5);

  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i];
    const k = key(idx(p[0]), idx(p[1]), idx(p[2]));
    let b = grid.get(k);
    if (!b) grid.set(k, (b = []));
    b.push(i);
  }

  function nearest(p, want = 6) {
    const out = [];
    const i0 = idx(p[0]), j0 = idx(p[1]), k0 = idx(p[2]);
    for (let ring = 0; ring <= 2 && out.length < want; ring++) {
      for (let i = i0 - ring; i <= i0 + ring; i++) {
        for (let j = j0 - ring; j <= j0 + ring; j++) {
          for (let k = k0 - ring; k <= k0 + ring; k++) {
            if (ring > 0 && Math.max(Math.abs(i - i0), Math.abs(j - j0), Math.abs(k - k0)) < ring) continue;
            const b = grid.get(key(i, j, k));
            if (b) for (const n of b) out.push(n);
          }
        }
      }
    }
    return out;
  }

  const damage = data.damage || [];

  return {
    source: 'analysis',
    label: data.loadCase ? `Analysis: ${data.loadCase}` : 'Analysis result',
    loadCase: data.loadCase || null,
    anchors: [],
    sample(p) {
      const cand = nearest(p);
      if (!cand.length) return { density: 0.35, safety: 2, source: 'analysis' };
      let wsum = 0, dsum = 0, ssum = 0, dispX = 0, dispY = 0, dispZ = 0;
      for (const i of cand) {
        const d2 = Math.max(1e-3, dist(p, nodes[i]) ** 2);
        const w = 1 / d2;
        wsum += w;
        dsum += w * dens[i];
        ssum += w * (data.safety ? data.safety[i] : 2);
        if (data.displacement) {
          dispX += w * data.displacement[i][0];
          dispY += w * data.displacement[i][1];
          dispZ += w * data.displacement[i][2];
        }
      }
      let d = clamp01(dsum / wsum);
      for (const dm of damage) if (dist(p, dm.p) < dm.radius) d *= 0.06;
      return {
        density: d,
        safety: ssum / wsum,
        disp: data.displacement ? [dispX / wsum, dispY / wsum, dispZ / wsum] : undefined,
        source: 'analysis',
      };
    },
    member(a, b) {
      return clamp01(0.5 * this.sample([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]).density
        + 0.5 * Math.max(this.sample(a).density, this.sample(b).density));
    },
    withDamage(regions) {
      return dataField(cls, { ...data, damage: regions }, opts);
    },
  };
}

/**
 * Illustrative deformed shape for the load-path view. This is a mode shape, not a solution: a
 * first bending mode plus a torsion term, scaled by an exaggeration factor the caller must
 * display ("Deformation exaggerated for visibility"). When a real field carries displacement
 * vectors, `field.sample().disp` supersedes this entirely.
 */
export function proxyDeflection(cls, p, load = { bendZ: 1, bendY: 0, twist: 0 }, exaggeration = 1) {
  const t = stationT(cls, p[0]);
  const shape = Math.sin(Math.PI * clamp01(t));            // pinned-pinned first mode
  const amp = cls.lengthM * 0.004 * exaggeration;
  const tw = (t - 0.5) * 2 * (load.twist || 0) * 0.02 * exaggeration;
  const c = Math.cos(tw), s = Math.sin(tw);
  const y = p[1] * c - p[2] * s;
  const z = p[1] * s + p[2] * c;
  return [p[0], y + amp * shape * (load.bendY || 0), z + amp * shape * (load.bendZ || 0)];
}
