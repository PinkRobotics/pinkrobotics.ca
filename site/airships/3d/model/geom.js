/* Geometry primitives and buffer building.
 *
 * Two record kinds, and only two, because the renderer only has two pipelines:
 *
 *   solid  { kind:'solid', pos:Float32Array, nor:Float32Array, idx:Uint32Array, tris }
 *   lines  { kind:'lines', pos:Float32Array, idx:Uint32Array, wid:Float32Array, segs }
 *
 * Lines carry a per-vertex width factor because the structural lattice encodes load-path density
 * as line weight — that is what makes the sponge read as denser around hardpoints without needing
 * a tube mesh per member. Tubes cost ~40x the vertices and buy nothing at the distances these
 * views are seen from; the close-detail inset is the one place that uses real tubes.
 *
 * Everything here is CPU-side and immutable once built. `merge*` exists because draw calls, not
 * triangles, are the budget that actually binds on this content.
 */

import { cross, norm, sub, add, mul } from '../core/math.js?v=ceaf69ab';

/* ---------- solid --------------------------------------------------------------------------- */

/** Build a solid record, computing flat-ish vertex normals from the faces. */
export function solid(pos, idx, opts = {}) {
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
  return { kind: 'solid', pos, nor, idx, tris: idx.length / 3, bbox: bboxOf(pos), ...opts };
}

export function bboxOf(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  return { lo, hi };
}

/** Axis-aligned box centred on the origin. */
export function boxGeom(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const p = [
    -x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z,   // bottom
    -x, -y, z, x, -y, z, x, y, z, -x, y, z,       // top
  ];
  // Split per-face so normals stay crisp.
  const faces = [
    [0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
  ];
  const pos = [], idx = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const v of f) pos.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
    // Wound so the face normal points OUT of the box. The other order leaves every box rendering
    // as a backface, which the shader deliberately darkens to 42% to read as a cut surface.
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/**
 * Surface of revolution about +x from a profile of [x, r] pairs. `caps` closes the ends.
 * This is the workhorse: hull skin, tanks, rotor nacelles, pump pods and the hose all use it.
 */
export function latheGeom(profile, seg = 24, opts = {}) {
  const { caps = true, sectionScale = null, closed = true } = opts;
  const rings = profile.length;
  const pos = [], idx = [];
  const n = seg;
  for (let i = 0; i < rings; i++) {
    const [x, r] = profile[i];
    for (let j = 0; j < n; j++) {
      const th = (2 * Math.PI * j) / n;
      const k = sectionScale ? sectionScale(th, i / (rings - 1)) : 1;
      pos.push(x, -r * k * Math.cos(th), r * k * Math.sin(th));
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n);
      idx.push(a, c, d, a, d, b);
    }
  }
  if (caps) {
    for (const [ri, flip] of [[0, true], [rings - 1, false]]) {
      const [x] = profile[ri];
      const cIdx = pos.length / 3;
      pos.push(x, 0, 0);
      for (let j = 0; j < n; j++) {
        const a = ri * n + j, b = ri * n + ((j + 1) % n);
        if (flip) idx.push(cIdx, b, a); else idx.push(cIdx, a, b);
      }
    }
  }
  void closed;
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/** Cylinder along +x, centred on the origin. */
/* Capped: an open lathe tube shows its bright interior through the open ends — the
   "glowing crescent under every reel/outlet" artifact. Every user is solid machinery. */
export const cylGeom = (length, radius, seg = 16) =>
  latheGeom([[-length / 2, 0.001], [-length / 2, radius],
             [length / 2, radius], [length / 2, 0.001]], seg);

/** Capsule-ish tank: a cylinder with domed ends, along +x. */
export function tankGeom(length, radius, seg = 16, domeRings = 4) {
  const prof = [];
  const cyl = Math.max(0.001, length - 2 * radius * 0.55);
  const dome = radius * 0.55;
  for (let i = 0; i <= domeRings; i++) {
    const t = i / domeRings;
    prof.push([-cyl / 2 - dome * (1 - t), radius * Math.sin((t * Math.PI) / 2)]);
  }
  for (let i = 0; i <= domeRings; i++) {
    const t = i / domeRings;
    prof.push([cyl / 2 + dome * t, radius * Math.cos((t * Math.PI) / 2)]);
  }
  return latheGeom(prof, seg);
}

/** Sphere centred on the origin. */
export function sphereGeom(radius, seg = 20, rings = 12) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    prof.push([-radius * Math.cos(th), radius * Math.sin(th)]);
  }
  return latheGeom(prof, seg, { caps: false });
}

/** Flat disc in the y-z plane facing +x — rotor discs, intake screens, outlet mouths. */
export function discGeom(radius, seg = 24, inner = 0) {
  const pos = [], idx = [];
  if (inner <= 0) {
    pos.push(0, 0, 0);
    for (let j = 0; j <= seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      pos.push(0, -radius * Math.cos(th), radius * Math.sin(th));
    }
    for (let j = 1; j <= seg; j++) idx.push(0, j, j + 1);
  } else {
    for (let j = 0; j <= seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      const c = -Math.cos(th), s = Math.sin(th);
      pos.push(0, inner * c, inner * s, 0, radius * c, radius * s);
    }
    for (let j = 0; j < seg; j++) {
      const a = j * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/** A tapered plate — control surfaces, fins, rotor blades. Spans +y, thickness in z. */
export function bladeGeom(span, rootChord, tipChord, thick, twistDeg = 0) {
  const pos = [], idx = [];
  const N = 5;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = span * t;
    const c = rootChord + (tipChord - rootChord) * t;
    const th = (twistDeg * (1 - t) * Math.PI) / 180;
    const ct = Math.cos(th), st = Math.sin(th);
    // four corners of the section, rotated by the local twist
    const sec = [[-c / 2, -thick / 2], [c / 2, -thick / 2], [c / 2, thick / 2], [-c / 2, thick / 2]];
    for (const [a, b] of sec) pos.push(a * ct - b * st, y, a * st + b * ct);
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 4; j++) {
      const a = i * 4 + j, b = i * 4 + ((j + 1) % 4);
      const c = (i + 1) * 4 + j, d = (i + 1) * 4 + ((j + 1) % 4);
      idx.push(a, c, d, a, d, b);
    }
  }
  const capA = pos.length / 3;
  for (let j = 0; j < 4; j++) pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
  idx.push(capA, capA + 2, capA + 1, capA, capA + 3, capA + 2);
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/** A tube swept along a polyline — the hose, cable runs, the thick macro members. */
export function tubeGeom(points, radius, seg = 8) {
  const pos = [], idx = [];
  const N = points.length;
  if (N < 2) return solid(new Float32Array(0), new Uint32Array(0));
  let prevUp = [0, 0, 1];
  for (let i = 0; i < N; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(N - 1, i + 1)];
    const f = norm(sub(b, a));
    let r = cross(prevUp, f);
    if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = cross([1, 0, 0], f);
    r = norm(r);
    const u = cross(f, r);
    prevUp = u;
    const rad = typeof radius === 'function' ? radius(i / (N - 1)) : radius;
    for (let j = 0; j < seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      const c = Math.cos(th) * rad, s = Math.sin(th) * rad;
      pos.push(points[i][0] + r[0] * c + u[0] * s,
        points[i][1] + r[1] * c + u[1] * s,
        points[i][2] + r[2] * c + u[2] * s);
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, d, c, a, b, d);          // outward-facing winding
    }
  }
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/* ---------- lines --------------------------------------------------------------------------- */

/**
 * Build a line record from an array of segments [[a,b],…] with an optional per-segment weight in
 * 0..1. Weight becomes screen-space width in the renderer and grey level in the SVG export, so
 * one number carries load-path density through every representation.
 */
export function lines(segments, weights = null) {
  const n = segments.length;
  const pos = new Float32Array(n * 6);
  const wid = new Float32Array(n * 2);
  const idx = new Uint32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [a, b] = segments[i];
    pos[i * 6] = a[0]; pos[i * 6 + 1] = a[1]; pos[i * 6 + 2] = a[2];
    pos[i * 6 + 3] = b[0]; pos[i * 6 + 4] = b[1]; pos[i * 6 + 5] = b[2];
    const w = weights ? weights[i] : 1;
    wid[i * 2] = w; wid[i * 2 + 1] = w;
    idx[i * 2] = i * 2; idx[i * 2 + 1] = i * 2 + 1;
  }
  return { kind: 'lines', pos, wid, idx, segs: n, bbox: bboxOf(pos) };
}

/** Segments of a closed polygon. */
export function loopSegs(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) out.push([points[i], points[(i + 1) % points.length]]);
  return out;
}

/** Segments of an open polyline. */
export function pathSegs(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) out.push([points[i], points[i + 1]]);
  return out;
}

/** Wire box centred on the origin — component outlines in the wire and lattice views. */
export function boxSegs(sx, sy, sz, centre = [0, 0, 0]) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const c = centre;
  const v = [
    [c[0] - x, c[1] - y, c[2] - z], [c[0] + x, c[1] - y, c[2] - z],
    [c[0] + x, c[1] + y, c[2] - z], [c[0] - x, c[1] + y, c[2] - z],
    [c[0] - x, c[1] - y, c[2] + z], [c[0] + x, c[1] - y, c[2] + z],
    [c[0] + x, c[1] + y, c[2] + z], [c[0] - x, c[1] + y, c[2] + z],
  ];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]];
  return e.map(([a, b]) => [v[a], v[b]]);
}

/** Circle in the plane whose normal is `axis` ('x'|'y'|'z'), centred on `c`. */
export function circleSegs(radius, seg, axis = 'x', c = [0, 0, 0], scaleFn = null) {
  const pts = [];
  for (let j = 0; j < seg; j++) {
    const th = (2 * Math.PI * j) / seg;
    const k = scaleFn ? scaleFn(th) : 1;
    const a = radius * k * Math.cos(th), b = radius * k * Math.sin(th);
    if (axis === 'x') pts.push([c[0], c[1] - a, c[2] + b]);
    else if (axis === 'y') pts.push([c[0] + a, c[1], c[2] + b]);
    else pts.push([c[0] + a, c[1] + b, c[2]]);
  }
  return loopSegs(pts);
}

/* ---------- batching ------------------------------------------------------------------------ */

/** Concatenate solid records into one buffer. Draw calls are the budget; this is how it is met. */
export function mergeSolids(list) {
  let np = 0, ni = 0;
  for (const g of list) { np += g.pos.length; ni += g.idx.length; }
  const pos = new Float32Array(np), nor = new Float32Array(np), idx = new Uint32Array(ni);
  let po = 0, io = 0, base = 0;
  for (const g of list) {
    pos.set(g.pos, po); nor.set(g.nor, po);
    for (let i = 0; i < g.idx.length; i++) idx[io + i] = g.idx[i] + base;
    base += g.pos.length / 3; po += g.pos.length; io += g.idx.length;
  }
  return { kind: 'solid', pos, nor, idx, tris: ni / 3, bbox: bboxOf(pos) };
}

/** Concatenate line records into one buffer. */
export function mergeLines(list) {
  let np = 0;
  for (const g of list) np += g.pos.length;
  const pos = new Float32Array(np), wid = new Float32Array(np / 3), idx = new Uint32Array(np / 3);
  let po = 0, wo = 0;
  for (const g of list) {
    pos.set(g.pos, po);
    wid.set(g.wid, wo);
    po += g.pos.length; wo += g.wid.length;
  }
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return { kind: 'lines', pos, wid, idx, segs: idx.length / 2, bbox: bboxOf(pos) };
}

/** Apply a 4x4 to a copy of a geometry record — used when baking a component into a batch. */
export function transformGeom(g, m) {
  const pos = new Float32Array(g.pos.length);
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i], y = g.pos[i + 1], z = g.pos[i + 2];
    pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  if (g.kind === 'lines') return { ...g, pos, bbox: bboxOf(pos) };
  return solid(pos, g.idx);
}

/** Triangle and segment tallies for the performance panel. */
export function countOf(g) {
  if (!g) return { tris: 0, segs: 0 };
  return { tris: g.kind === 'solid' ? g.tris : 0, segs: g.kind === 'lines' ? g.segs : 0 };
}

void add; void mul;

/* ---------- feature edges (the "true wire" view) ---------------------------------------------- */

/**
 * Extract the edges worth drawing: silhouette-forming creases and open boundaries.
 *
 * An ordinary triangle wireframe exposes tessellation — a 44-segment lathe drawn that way is 44
 * meaningless meridians. What reads as design is the set of edges where the surface actually
 * turns: shared edges whose two faces differ by more than `angleDeg`, plus any edge belonging to
 * one face only (an open boundary). That is what this returns.
 *
 * Vertices are welded on a quantised grid first, because the primitive builders duplicate corner
 * vertices to keep normals crisp and unwelded geometry has no shared edges to compare.
 */
export function featureEdges(g, angleDeg = 24, weldEps = 1e-4) {
  if (!g || g.kind !== 'solid' || !g.idx.length) return [];
  const scale = 1 / Math.max(weldEps, 1e-9);
  const key = (i) => `${Math.round(g.pos[i * 3] * scale)},${Math.round(g.pos[i * 3 + 1] * scale)},${Math.round(g.pos[i * 3 + 2] * scale)}`;
  const weld = new Map();
  const rep = new Int32Array(g.pos.length / 3);
  for (let i = 0; i < rep.length; i++) {
    const k = key(i);
    if (!weld.has(k)) weld.set(k, i);
    rep[i] = weld.get(k);
  }

  const faceN = [];
  const edges = new Map();
  for (let f = 0; f < g.idx.length; f += 3) {
    const a = rep[g.idx[f]], b = rep[g.idx[f + 1]], c = rep[g.idx[f + 2]];
    const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
    const ux = g.pos[b * 3] - ax, uy = g.pos[b * 3 + 1] - ay, uz = g.pos[b * 3 + 2] - az;
    const vx = g.pos[c * 3] - ax, vy = g.pos[c * 3 + 1] - ay, vz = g.pos[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const fi = faceN.length;
    faceN.push([nx / l, ny / l, nz / l]);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const ek = p < q ? `${p}_${q}` : `${q}_${p}`;
      const e = edges.get(ek);
      if (e) e.f.push(fi);
      else edges.set(ek, { p: Math.min(p, q), q: Math.max(p, q), f: [fi] });
    }
  }

  const cosLim = Math.cos((angleDeg * Math.PI) / 180);
  const out = [];
  for (const e of edges.values()) {
    let keep = e.f.length === 1;                      // open boundary
    if (!keep && e.f.length >= 2) {
      const n0 = faceN[e.f[0]], n1 = faceN[e.f[1]];
      keep = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < cosLim;
    }
    if (!keep) continue;
    out.push([
      [g.pos[e.p * 3], g.pos[e.p * 3 + 1], g.pos[e.p * 3 + 2]],
      [g.pos[e.q * 3], g.pos[e.q * 3 + 1], g.pos[e.q * 3 + 2]],
    ]);
  }
  return out;
}

/** Transform a list of [a,b] segments by a 4x4. */
export function transformSegs(segs, m) {
  const tp = (p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
  return segs.map(([a, b]) => [tp(a), tp(b)]);
}
