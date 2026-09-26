/* Geometry, distance and easing. Pure functions of their arguments.
 */
export const R_EARTH = 6371;

export function havKm(a, b) {
  const dLa = (b[1] - a[1]) * Math.PI / 180, dLo = (b[0] - a[0]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

export function moveToward(from, to, km) {
  const d = havKm(from, to);
  if (d < 1e-6) return from.slice();
  const f = km / d;
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
}

export function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
          u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

export function bezBearing(p0, p1, p2, t, lat) {
  const u = 1 - t;
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return Math.atan2(dx * Math.cos(lat * Math.PI / 180), dy);
}

/* Motion profiles. Transit legs fly a trapezoidal speed profile — accelerate, cruise,
   decelerate — and the shorter manoeuvring phases ease in and out, so nothing on the map
   starts or stops instantaneously. Mass flows stay linear; only position is shaped. */
export function easeTrap(p, a) {
  a = a === undefined ? 0.15 : a;
  let d;
  if (p < a) d = p * p / (2 * a);
  else if (p <= 1 - a) d = p - a / 2;
  else { const q = 1 - p; d = (1 - a) - q * q / (2 * a); }
  return d / (1 - a);
}

export function easeSm(p) { return p * p * (3 - 2 * p); }

/* Headings interpolate the short way round, or a ship turning from 350° to 10° swings 340°
   the wrong way — which on a heading-synced camera throws the whole model across the frame. */
export function lerpAng(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function trackBearing(a, b) {          // initial great-circle bearing a->b, degrees from north
  const f1 = a[1] * Math.PI / 180, f2 = b[1] * Math.PI / 180, dl = (b[0] - a[0]) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
