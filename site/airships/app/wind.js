/* A coarse, first-party 850 hPa forecast. Interpolate velocity components so 359° and
 * 1° average to north, not south. Coordinates are [longitude, latitude]. */
export const WIND_MAX_AGE_MS = 90 * 60000;

export function readWind(doc, now = Date.now()) {
  const at = Date.parse(doc?.fetchedAt), valid = Date.parse(doc?.data?.forecastAt);
  if (!Number.isFinite(at) || !Number.isFinite(valid)) throw new Error('wind timestamp missing');
  if (now - at < -600000 || now - valid < -600000) throw new Error('wind timestamp in future');
  if (now - at >= WIND_MAX_AGE_MS || now - valid >= 2 * 3600000)
    throw new Error('wind mirror stale');
  const { lats, lons, vectors } = doc.data;
  const axis = a => Array.isArray(a) && a.length >= 2 && a.every((x, i) =>
    Number.isFinite(x) && (!i || x > a[i - 1]));
  if (!axis(lats) || !axis(lons) || !Array.isArray(vectors) ||
      vectors.length !== lats.length * lons.length ||
      !vectors.every(v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)))
    throw new Error('wind grid malformed');
  return { lats, lons, vectors, fetchedAt: at, forecastAt: valid };
}

export function windForMission(grid, mission) {
  const lon = (mission.intake[0] + mission.delivery[0]) / 2;
  const lat = (mission.intake[1] + mission.delivery[1]) / 2;
  function bracket(axis, x) {
    if (!Number.isFinite(x) || x < axis[0] || x > axis.at(-1))
      throw new Error('mission outside wind grid');
    let i = 0;
    while (i < axis.length - 2 && x > axis[i + 1]) i++;
    return [i, (x - axis[i]) / (axis[i + 1] - axis[i])];
  }
  const [x, dx] = bracket(grid.lons, lon), [y, dy] = bracket(grid.lats, lat);
  const vector = [0, 0];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const w = (i ? dx : 1 - dx) * (j ? dy : 1 - dy);
    const v = grid.vectors[(y + j) * grid.lons.length + x + i];
    vector[0] += w * v[0]; vector[1] += w * v[1];
  }
  const spd = Math.hypot(...vector);
  return { spd, dir: spd < 1e-9 ? 0 : (Math.atan2(-vector[0], -vector[1]) * 180 / Math.PI + 360) % 360,
    bearing: mission.bearing };
}
