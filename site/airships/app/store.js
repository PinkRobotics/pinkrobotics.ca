/* S — the application's state, in one object.
 *
 * Everything mutable that is not owned by a single module lives here, so that "what is
 * the page currently showing" has one answer you can print.
 */
export const S = {
  fires: [], missions: [], water: [], outline: [], waterMeta: null,
  usingFallback: false, fetchedAt: null, snapshotDate: null,
  sel: null, hlClass: null,  // {type, m, f} | null; hlClass dims other classes
  follow: false, filter: "all", modeId: "balanced", exampleCls: "P100",
  battByHull: {},   // storage state survives the 15-minute live-feed rebuilds, keyed by hull
  speed: 5, paused: false, simTime: 0, lastFrame: null,
  windOk: null, windAt: null, windNote: "loading mirror", roads: [], heat: [],
  view: { cx: -124.5, cy: -73.5, k: 14 },  // world: x=lon, y=mercator(lat)
  layers: { terrain: true, hot: true, wind: true, places: true, perims: true, water: true, routes: true, labels: false },
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
};
if (S.reduced) { S.paused = true; }
