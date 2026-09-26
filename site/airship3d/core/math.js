/* Minimal linear algebra for the airship model.
 *
 * Column-major mat4 (the layout WebGL wants), plain arrays for vec3. No dependency, no build step
 * — this file is imported unchanged by the browser and by node (figure export, tests).
 *
 * Frame convention, shared by every module here and chosen to match the RideRC wire car:
 *   +x forward (toward the nose)   +y to port (left)   +z up
 * The model origin is the hull's centre of buoyancy, so force and torque arrows are drawn about
 * the point they are actually taken about.
 */

export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { const u = clamp01(t); return u * u * (3 - 2 * u); };
/** Ease used for camera moves: fast out of the old pose, settled into the new one. */
export const easeInOut = (t) => { const u = clamp01(t); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
/** Frame-rate independent exponential approach. `rate` is the fraction closed per second. */
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

/* ---------- vec3 (plain arrays; functions never alias their inputs unless `out` is given) --- */

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function norm(a) {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * Distance from point p to the segment a-b. Exact, not sampled: a maintenance corridor is a
 * continuous 150 m run, and testing a handful of points along it leaves gaps a battery fits in.
 */
export function segPointDist(a, b, p) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t), p[2] - (a[2] + abz * t));
}

/* ---------- mat4, column-major: m[col*4 + row] --------------------------------------------- */

export const m4identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function m4mul(a, b, out = new Float32Array(16)) {
  // out = a * b  (apply b first, then a)
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function m4translate(t, out = m4identity()) {
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2];
  return out;
}

export function m4scale(s, out = m4identity()) {
  const [x, y, z] = Array.isArray(s) ? s : [s, s, s];
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

export function m4rotX(a, out = m4identity()) {
  const c = Math.cos(a), s = Math.sin(a);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}
export function m4rotY(a, out = m4identity()) {
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}
export function m4rotZ(a, out = m4identity()) {
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

/** Rotation taking +x onto the unit vector `d` (used to aim rotors, thrusters and members). */
export function m4aimX(d, out = m4identity()) {
  const f = norm(d);
  // Any stable up: avoid the degenerate case where f is parallel to +z.
  const up = Math.abs(f[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const r = norm(cross(up, f));      // "port" axis of the aimed frame
  const u = cross(f, r);
  out[0] = f[0]; out[1] = f[1]; out[2] = f[2]; out[3] = 0;
  out[4] = r[0]; out[5] = r[1]; out[6] = r[2]; out[7] = 0;
  out[8] = u[0]; out[9] = u[1]; out[10] = u[2]; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

/** Compose translate * rotZ(yaw) * rotY(pitch) * rotX(roll) * scale — the node transform order. */
export function m4compose(p, euler, s, out = new Float32Array(16)) {
  const [rx, ry, rz] = euler;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const [sX, sY, sZ] = Array.isArray(s) ? s : [s, s, s];
  // R = Rz * Ry * Rx
  const m00 = cz * cy, m01 = cz * sy * sx - sz * cx, m02 = cz * sy * cx + sz * sx;
  const m10 = sz * cy, m11 = sz * sy * sx + cz * cx, m12 = sz * sy * cx - cz * sx;
  const m20 = -sy,     m21 = cy * sx,               m22 = cy * cx;
  out[0] = m00 * sX; out[1] = m10 * sX; out[2] = m20 * sX; out[3] = 0;
  out[4] = m01 * sY; out[5] = m11 * sY; out[6] = m21 * sY; out[7] = 0;
  out[8] = m02 * sZ; out[9] = m12 * sZ; out[10] = m22 * sZ; out[11] = 0;
  out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
  return out;
}

export function m4transform(m, p, out = [0, 0, 0]) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/** Direction transform — translation ignored. */
export function m4transformDir(m, p, out = [0, 0, 0]) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

export function m4invert(m, out = new Float32Array(16)) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** Right-handed look-at view matrix. */
export function m4lookAt(eye, target, up = [0, 0, 1], out = new Float32Array(16)) {
  let f = norm(sub(target, eye));
  if (len(f) < 1e-9) f = [1, 0, 0];
  let s = cross(f, up);
  if (len(s) < 1e-9) s = cross(f, Math.abs(f[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]);
  s = norm(s);
  const u = cross(s, f);
  out[0] = s[0]; out[4] = s[1]; out[8] = s[2]; out[12] = -dot(s, eye);
  out[1] = u[0]; out[5] = u[1]; out[9] = u[2]; out[13] = -dot(u, eye);
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = dot(f, eye);
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/** Perspective projection, depth mapped to [-1,1]. `fovY` in radians. */
export function m4perspective(fovY, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[11] = -1;
  out[10] = (far + near) / (near - far);
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** Orthographic projection — the scale-comparison scene uses this so sizes stay comparable. */
export function m4ortho(halfW, halfH, near, far, out = new Float32Array(16)) {
  out.fill(0);
  out[0] = 1 / halfW; out[5] = 1 / halfH;
  out[10] = -2 / (far - near);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}
