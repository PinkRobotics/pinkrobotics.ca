/* Geometry for the cell explorer — the shapes the physics in model.js is about.
 *
 * Everything here is generated from the same dimensions the analysis publishes: strut
 * lengths from the printer chain, tube radii from the co-critical proportion, cell spans
 * from sqrt(2) x strut. No dimension is typed in that model.js did not produce.
 *
 * Real metres throughout. A strut is 0.251 m long here because it is 0.251 m long.
 *
 * Solid records come from 3d/model/geom.js (the ship model's own primitive builders), so
 * the explorer and the vehicle viewer share one set of buffer conventions.
 */

import {
  solid, lines, mergeSolids, cylGeom, sphereGeom, latheGeom, transformGeom, boxGeom,
} from '../3d/model/geom.js?v=331c3257';
export { boxGeom };
import {
  m4compose, m4mul, m4aimX, m4translate, m4identity, norm, sub, len,
} from '../3d/core/math.js?v=331c3257';

/* ---------- the octet unit cell ----------------------------------------------------------------
 *
 * FCC: 8 corner nodes + 6 face-centre nodes on a cube of edge a. Every edge of the octet —
 * corner-to-face-centre and face-centre-to-face-centre alike — has the SAME length a/sqrt(2),
 * which is why one instanced cylinder draws the whole lattice. 36 physical struts standalone;
 * 24 net once cells share faces. phi = 6*sqrt(2)*pi*(r/l)^2 is exactly this cell's arithmetic.
 */

/** Node positions of one octet cell with cube edge `a`, centred on the origin. */
export function octetNodes(a) {
  const h = a / 2;
  const pts = [];
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) pts.push([x, y, z]);
  for (const s of [-h, h]) pts.push([s, 0, 0], [0, s, 0], [0, 0, s]);
  return pts;   // 8 corners then 6 face centres
}

/** Strut endpoint pairs [i, j] into octetNodes(a) — all 36 of a standalone cell. */
export function octetStruts(a) {
  const pts = octetNodes(a);
  const L = a / Math.SQRT2;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(len(sub(pts[j], pts[i])) - L) < a * 1e-6) out.push([i, j]);
    }
  }
  return out;
}

/**
 * Instance transforms for the octet's struts: one unit-length x-aligned cylinder, aimed and
 * placed per strut. Returns { xf: Float32Array(n*16), count, mids } for a renderer inst record.
 * `geomLen` is the length the instanced cylinder was BUILT at (so xf carries no scale).
 *
 * UNLESS `stretchTo` is given: then each instance's x-axis is scaled by its own
 * pair-distance over that nominal length, so the cylinder's ENDS land exactly on the pair's
 * points. The cell draws its pipes seat to seat with geometry cut to the schedule's own
 * length, but the drawn pitch sits 0.14% off the generator's, and a pipe end hanging even
 * fractionally short of a real joint's cup reads as "not connected" — the old socket cones
 * swallowed that slack, a mesh does not. Radius is untouched — only the length gives.
 */
export function strutInstances(pts, pairs, jitter = 0, stretchTo = 0) {
  const n = pairs.length;
  const xf = new Float32Array(n * 16);
  const mids = [];
  // tr MUST start as identity: m4translate only writes the translation column, and a
  // zeroed Float32Array leaves a zero rotation block — every instance collapses to a point.
  // That is exactly what happened on this file's first day.
  const rot = new Float32Array(16), tr = m4identity();
  for (let k = 0; k < n; k++) {
    const [i, j] = pairs[k];
    const A = pts[i], B = pts[j];
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    if (jitter) for (let q = 0; q < 3; q++) mid[q] += (Math.sin(k * 12.9898 + q) * 0.5) * jitter;
    m4aimX(norm(sub(B, A)), rot);
    if (stretchTo) {
      const s = len(sub(B, A)) / stretchTo;
      for (let q = 0; q < 3; q++) rot[q] *= s;      // column 0: the aimed x-axis
    }
    m4translate(mid, tr);
    const m = m4mul(tr, rot);
    xf.set(m, k * 16);
    mids.push(mid);
  }
  return { xf, count: n, mids };
}

/** Instance transforms for spheres at the given points. */
export function pointInstances(pts) {
  const xf = new Float32Array(pts.length * 16);
  const m = m4identity();               // identity, not zeros — see strutInstances
  for (let k = 0; k < pts.length; k++) {
    m4translate(pts[k], m);
    xf.set(m, k * 16);
  }
  return { xf, count: pts.length };
}

/* ---------- the truncated octahedron (Kelvin cell) ----------------------------------------------
 *
 * The flight-article partition: BCC's Voronoi cell, 6 squares + 8 hexagons, the interlocking
 * near-sphere. Canonical vertices are the 24 permutations of (0, +-1, +-2); opposite square
 * faces are 4 apart, so `span` (across squares) maps to scale span/4.
 */

function kelvinVerts(span) {
  const s = span / 4;
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const seen = new Set();
  for (const [a, b, c] of perms) {
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      const v = [0, 0, 0];
      v[a] = 0; v[b] = sb * s; v[c] = 2 * sc * s;
      const key = v.map(x => x.toFixed(9)).join(',');
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    }
  }
  return out;   // 24 vertices
}

/** Order a face's vertex indices into a convex loop about the face normal. */
function orderLoop(verts, idxs, normal) {
  const c = [0, 0, 0];
  for (const i of idxs) { c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2]; }
  for (let q = 0; q < 3; q++) c[q] /= idxs.length;
  const ref = norm(sub(verts[idxs[0]], c));
  const up = norm(normal);
  const side = [up[1] * ref[2] - up[2] * ref[1], up[2] * ref[0] - up[0] * ref[2],
    up[0] * ref[1] - up[1] * ref[0]];
  return idxs.slice().sort((ia, ib) => {
    const angle = (i) => {
      const d = sub(verts[i], c);
      return Math.atan2(d[0] * side[0] + d[1] * side[1] + d[2] * side[2],
        d[0] * ref[0] + d[1] * ref[1] + d[2] * ref[2]);
    };
    return angle(ia) - angle(ib);
  });
}

/** Faces of the Kelvin cell as ordered vertex loops: { squares: [...], hexes: [...] }. */
export function kelvinFaces(span) {
  const verts = kelvinVerts(span);
  const s = span / 4;
  const squares = [], hexes = [];
  for (const axis of [0, 1, 2]) {
    for (const sign of [-1, 1]) {
      const idxs = [];
      for (let i = 0; i < verts.length; i++) {
        if (Math.abs(verts[i][axis] - sign * 2 * s) < 1e-9 * span) idxs.push(i);
      }
      const nrm = [0, 0, 0]; nrm[axis] = sign;
      squares.push({ loop: orderLoop(verts, idxs, nrm), normal: nrm });
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const idxs = [];
    for (let i = 0; i < verts.length; i++) {
      const d = sx * verts[i][0] + sy * verts[i][1] + sz * verts[i][2];
      if (Math.abs(d - 3 * s) < 1e-9 * span) idxs.push(i);
    }
    const nrm = norm([sx, sy, sz]);
    hexes.push({ loop: orderLoop(verts, idxs, nrm), normal: nrm });
  }
  return { verts, squares, hexes };
}

/** The Kelvin cell as one solid record (all 14 faces, fan-triangulated, outward wound). */
export function kelvinGeom(span) {
  const { verts, squares, hexes } = kelvinFaces(span);
  const pos = [], idx = [];
  for (const f of [...squares, ...hexes]) {
    const base = pos.length / 3;
    const c = [0, 0, 0];
    for (const i of f.loop) { c[0] += verts[i][0]; c[1] += verts[i][1]; c[2] += verts[i][2]; }
    for (let q = 0; q < 3; q++) c[q] /= f.loop.length;
    pos.push(c[0], c[1], c[2]);
    for (const i of f.loop) pos.push(verts[i][0], verts[i][1], verts[i][2]);
    const n = f.loop.length;
    for (let k = 0; k < n; k++) {
      const a = base + 1 + k, b = base + 1 + ((k + 1) % n);
      // Wind so the normal faces OUT (loop is ordered about the outward normal).
      idx.push(base, a, b);
    }
  }
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/** The Kelvin cell's 36 edges as line segments. */
export function kelvinEdges(span) {
  const { verts, squares, hexes } = kelvinFaces(span);
  const seen = new Set(), segs = [];
  for (const f of [...squares, ...hexes]) {
    const n = f.loop.length;
    for (let k = 0; k < n; k++) {
      const a = f.loop[k], b = f.loop[(k + 1) % n];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segs.push([verts[a], verts[b]]);
    }
  }
  return segs;
}

/** Point-inside test for the Kelvin cell centred at the origin: six square faces at
 * span/2 on the axes, eight hexagonal faces at |x|+|y|+|z| = 3*span/4. */
export function insideKelvin(p, span) {
  const ax = Math.abs(p[0]), ay = Math.abs(p[1]), az = Math.abs(p[2]);
  return Math.max(ax, ay, az) <= span / 2 + 1e-9 &&
         ax + ay + az <= 0.75 * span + 1e-9;
}

/** Octet lattice linework CLIPPED to a Kelvin cell: sub-cells at half the span, segments
 * kept only when both ends are inside. A raw cubic octet cell drawn inside a Kelvin
 * membrane pokes through the hexagons — a cube's corners always do. At HALF PITCH,
 * though, the grid meshes with the surface exactly: sub-cell corners (S/4, S/4, S/4)-type
 * land on the hexagon planes (|x|+|y|+|z| = 3S/4) and axis nodes land on the square
 * planes (S/2) — Kelvin is BCC's Voronoi cell and the half-pitch octet grid contains the
 * BCC points, so the membrane is node-supported on a regular grid. That fact is the
 * answer to "how do the balls mesh with the skin", and kelvinBoundaryNodes returns them. */
export function kelvinLatticeSegs(span, pitchFrac = 0.5) {
  const pitch = span * pitchFrac;
  const segs = [];
  const cells = Math.ceil(span / pitch / 2) + 1;
  for (let i = -cells; i < cells; i++) {
    for (let j = -cells; j < cells; j++) {
      for (let k = -cells; k < cells; k++) {
        const c = [(i + 0.5) * pitch, (j + 0.5) * pitch, (k + 0.5) * pitch];
        const pts = octetNodes(pitch);
        for (const [ia, ib] of octetStruts(pitch)) {
          const A = [pts[ia][0] + c[0], pts[ia][1] + c[1], pts[ia][2] + c[2]];
          const B = [pts[ib][0] + c[0], pts[ib][1] + c[1], pts[ib][2] + c[2]];
          if (insideKelvin(A, span) && insideKelvin(B, span)) segs.push([A, B]);
        }
      }
    }
  }
  return segs;
}

/** The lattice points that lie exactly IN the Kelvin surface — where the membrane is
 * bonded to the structure that carries it. Square-face nodes on the axis planes, hexagon
 * nodes at the (S/4,S/4,S/4)-type sub-cell corners. */
export function kelvinBoundaryNodes(span, pitchFrac = 0.5) {
  const pitch = span * pitchFrac;
  const eps = span * 1e-6;
  const seen = new Set(), out = [];
  const cells = Math.ceil(span / pitch / 2) + 1;
  for (let i = -cells; i < cells; i++) {
    for (let j = -cells; j < cells; j++) {
      for (let k = -cells; k < cells; k++) {
        const c = [(i + 0.5) * pitch, (j + 0.5) * pitch, (k + 0.5) * pitch];
        for (const q of octetNodes(pitch)) {
          const p = [q[0] + c[0], q[1] + c[1], q[2] + c[2]];
          if (!insideKelvin(p, span)) continue;
          const ax = Math.abs(p[0]), ay = Math.abs(p[1]), az = Math.abs(p[2]);
          const onSquare = Math.abs(Math.max(ax, ay, az) - span / 2) < eps;
          const onHex = Math.abs(ax + ay + az - 0.75 * span) < eps;
          if (!onSquare && !onHex) continue;
          const key = p.map(v => v.toFixed(7)).join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(p);
        }
      }
    }
  }
  return out;
}

/** BCC packing offsets for a block of Kelvin cells: corner sublattice + body-centre sublattice. */
export function kelvinArrayCentres(span, nx, ny, nz) {
  const out = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    out.push({ p: [i * span, j * span, k * span], sub: 0 });
  }
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) for (let k = 0; k < nz - 1; k++) {
    out.push({ p: [(i + 0.5) * span, (j + 0.5) * span, (k + 0.5) * span], sub: 1 });
  }
  const cx = (nx - 1) * span / 2, cy = (ny - 1) * span / 2, cz = (nz - 1) * span / 2;
  for (const c of out) { c.p[0] -= cx; c.p[1] -= cy; c.p[2] -= cz; }
  return out;
}

/* ---------- membranes and films ------------------------------------------------------------------ */

/**
 * A shallow spherical cap over a circular span, bulging along -z (into the vacuum: the
 * atmosphere pushes the film INWARD). `bulge` is h/a — the analysis's contested 0.25, or the
 * strain-reachable 0.07. Centred so the rim sits at z = 0.
 */
export function filmDomeGeom(spanM, bulge = 0.25, seg = 28, rings = 6) {
  const a = spanM / 2;
  const h = bulge * a;
  const R = (a * a + h * h) / (2 * h);
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = a * t;
    const z = -(h - (R - Math.sqrt(Math.max(0, R * R - r * r))));
    prof.push([z, Math.max(r, 1e-5 * spanM)]);
  }
  // latheGeom revolves about +x with profile [x, r]; rotate so the dome axis is +z.
  const g = latheGeom(prof, seg, { caps: false });
  const rot = m4compose([0, 0, 0], [0, -Math.PI / 2, 0], 1);
  return transformGeom(g, rot);
}

/* ---------- the print track ----------------------------------------------------------------------
 *
 * A stack of extruded beads: two perimeters wide, several layers tall — the 1.2 mm wall as
 * the printer actually lays it. Bead cross-section is a squashed ellipse (width w, height
 * layer h), the standard FDM idealisation; the necked contact between layers is what the
 * Z-direction numbers are about.
 */
export function beadGeom(lengthM, widthM, heightM, seg = 14) {
  const g = cylGeom(lengthM, 0.5, seg);
  const m = m4compose([0, 0, 0], [0, 0, 0], [1, widthM, heightM]);
  return transformGeom(g, m);
}

/** Instance transforms for a 2-perimeter x nLayers wall sample. */
export function wallStack(nLayers, widthM, heightM, gapFrac = 0.04) {
  const xf = [];
  const m = m4identity();               // identity, not zeros — see strutInstances
  for (let l = 0; l < nLayers; l++) {
    for (let p = 0; p < 2; p++) {
      m4translate([0, (p - 0.5) * widthM * (1 + gapFrac), (l + 0.5) * heightM * (1 + gapFrac)], m);
      xf.push(...m);
    }
  }
  return { xf: new Float32Array(xf), count: nLayers * 2 };
}

/* ---------- tube wall arc --------------------------------------------------------------------------
 *
 * A slice of the strut tube at true R/t, plus the same wall latticed (the level-2 preview).
 * Both are built from the analysis proportions: radius r, wall t, arc about 100 degrees.
 */
export function tubeArcGeom(rOuter, t, lengthM, arcDeg = 100, seg = 40) {
  const a0 = -arcDeg / 2 * Math.PI / 180, a1 = arcDeg / 2 * Math.PI / 180;
  const rIn = rOuter - t;
  const pos = [], idx = [];
  const half = lengthM / 2;
  for (const x of [-half, half]) {
    for (let i = 0; i <= seg; i++) {
      const th = a0 + (a1 - a0) * i / seg;
      pos.push(x, rOuter * Math.cos(th), rOuter * Math.sin(th));
      pos.push(x, rIn * Math.cos(th), rIn * Math.sin(th));
    }
  }
  const row = (seg + 1) * 2;
  for (let i = 0; i < seg; i++) {
    const o0 = i * 2, o1 = (i + 1) * 2;
    // outer surface
    idx.push(o0, o1, row + o1, o0, row + o1, row + o0);
    // inner surface (wound the other way)
    idx.push(o0 + 1, row + o1 + 1, o1 + 1, o0 + 1, row + o0 + 1, row + o1 + 1);
  }
  // Arc end faces — but not for a closed tube: at 360 degrees the two faces are coincident
  // coplanar quads at the seam, which is a guaranteed z-fight on real GPUs.
  if (arcDeg < 360) {
    for (const i of [0, seg]) {
      const o = i * 2, flip = i === 0;
      if (flip) idx.push(o, row + o, row + o + 1, o, row + o + 1, o + 1);
      else idx.push(o, row + o + 1, row + o, o, o + 1, row + o + 1);
    }
  }
  for (const end of [0, row]) {
    for (let i = 0; i < seg; i++) {
      const o0 = end + i * 2, o1 = end + (i + 1) * 2;
      if (end === 0) idx.push(o0, o0 + 1, o1 + 1, o0, o1 + 1, o1);
      else idx.push(o0, o1 + 1, o0 + 1, o0, o1, o1 + 1);
    }
  }
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/* ---------- hull profile ---------------------------------------------------------------------------- */

/** The P-100 hull as a lathe, from the ship model's own profile function. Real metres. */
export function hullGeom(cls, profileR, sectionScale, rings = 60, seg = 48) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    prof.push([cls.xNose - t * cls.lengthM, Math.max(profileR(t) * cls.maxRadiusM, 0.01)]);
  }
  return latheGeom(prof, seg, { sectionScale: (th) => sectionScale(th) });
}

/** Station rings + meridians for the hull, as light linework. */
export function hullWire(cls, profileR, sectionScale, nRings = 9, nMer = 12, seg = 48) {
  const segs = [];
  for (let iR = 1; iR < nRings; iR++) {
    const t = iR / nRings;
    const x = cls.xNose - t * cls.lengthM;
    const r = profileR(t) * cls.maxRadiusM;
    let prev = null;
    for (let i = 0; i <= seg; i++) {
      const th = 2 * Math.PI * i / seg;
      const k = sectionScale(th);
      const p = [x, -r * k * Math.cos(th), r * k * Math.sin(th)];
      if (prev) segs.push([prev, p]);
      prev = p;
    }
  }
  for (let iM = 0; iM < nMer; iM++) {
    const th = 2 * Math.PI * iM / nMer;
    const k = sectionScale(th);
    let prev = null;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const r = profileR(t) * cls.maxRadiusM * k;
      const p = [cls.xNose - t * cls.lengthM, -r * Math.cos(th), r * Math.sin(th)];
      if (prev) segs.push([prev, p]);
      prev = p;
    }
  }
  return segs;
}

export { solid, lines, mergeSolids, cylGeom, sphereGeom, transformGeom };
