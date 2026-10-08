/* Which class of ship a fire gets, and why.
 */
import { CLASSES, CLASS_ORDER } from './config.js?v=01e992e3';
import { fmtHa } from './format.js?v=01e992e3';
import { findSource } from './water.js?v=01e992e3';

export function sizeTier(fire) {
  let t = 0;
  if (fire.sizeHa >= 1000 || fire.note) t = 1;
  if (fire.sizeHa >= 10000) t = 2;
  if (fire.status === "Out of Control" && t < 2) t += 1;
  return t;
}

export function assign(fire, water) {
  const base = (fire.sizeHa >= 10000) ? 2 : (fire.sizeHa >= 1000 || fire.note) ? 1 : 0;
  let tier = base;
  if (fire.status === "Out of Control" && tier < 2) tier++;
  const scan = t0 => {
    for (let t = t0; t < CLASS_ORDER.length; t++) {
      const cls = CLASSES[CLASS_ORDER[t]];
      const src = findSource(fire.ll, cls, water);
      if (src) return { t, cls, src };
    }
    return null;
  };
  let pick = scan(tier);
  let note = "";
  // The out-of-control bump is a preference. This distance heuristic prefers the smaller
  // class when the selected larger-class station is beyond 40 km and three times the
  // smaller-class station distance. It compares no accepted-plan delivery rates.
  if (pick && tier > base) {
    const alt = scan(base);
    if (alt && alt.t < pick.t && pick.src.km > Math.max(40, alt.src.km * 3)) {
      note = ` A ${pick.cls.name} was indicated by the out-of-control status. Its selected source's ` +
        `nearest qualifying drafting station is ${pick.src.km.toFixed(0)} km from the incident point; ` +
        `the ${alt.cls.name} station is ${alt.src.km.toFixed(1)} km away. The distance rule prefers ` +
        `the smaller class because the larger-class station is beyond 40 km and three times ` +
        `the smaller-class distance. Accepted-plan delivery rates are not compared.`;
      pick = alt;
    }
  }
  if (!pick) return { cls: null, src: null, why: "No mapped definite lake or reservoir satisfies any class's " +
    "size-and-distance rule for this fire. The mission is shown idle rather than inventing water." };
  // Long haul with modest water nearby? A third of the size at under a third of the distance
  // wins — the source card carries the repeated-draw caveat either way.
  let relaxed = false;
  if (pick.src.km > 30) {
    const small = findSource(fire.ll, pick.cls, water, pick.cls.minSourceHa / 3, pick.src.km / 3);
    if (small) {
      note += ` Smaller-than-preferred water accepted for proximity: ${small.km.toFixed(1)} km ` +
        `instead of ${pick.src.km.toFixed(0)} km.`;
      pick = { t: pick.t, cls: pick.cls, src: small };
      relaxed = true;
    }
  }
  const startTier = Math.min(tier, pick.t);
  let why;
  if (pick.t === startTier || relaxed) {
    why = `${pick.cls.name} selected: the incident is ${fmtHa(fire.sizeHa)}` +
      (fire.note ? ", a fire of note," : fire.status === "Out of Control" ? ", out of control," : "") +
      ` and the selected source's nearest qualifying drafting station is ${pick.src.km.toFixed(1)} km from the incident point.`;
  } else {
    why = `${pick.cls.name} selected: a ${CLASSES[CLASS_ORDER[startTier]].name} was indicated by size, ` +
      `but no generated station on water meeting its ${CLASSES[CLASS_ORDER[startTier]].minSourceHa} ha intake rule lies within ` +
      `${CLASSES[CLASS_ORDER[startTier]].searchKm} km — the larger class reaches ${pick.src.km.toFixed(1)} km.`;
  }
  return { cls: pick.cls, src: pick.src, why: why + note, relaxed };
}

/* ---------- formatting ------------------------------------------------------------------- */
