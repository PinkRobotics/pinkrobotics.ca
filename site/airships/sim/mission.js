/* Assembling one mission: a fire, a water source, a plan and a set of drop lines.
 */
import { assign } from './assign.js?v=26282d19';
import { CLASSES, MODES, PHASES } from './config.js?v=26282d19';
import { fmt } from './format.js?v=26282d19';
import { havKm, trackBearing } from './geo.js?v=26282d19';
import { planCycle } from './plan.js?v=26282d19';
import { hashFrac } from './rng.js?v=26282d19';
import { deliveryPoint, dropSeg, legKmFor, planTargets } from './targets.js?v=26282d19';
import { intakePoint } from './water.js?v=26282d19';

export function buildMission(fire, water, modeId, forceClsId, forceSrc, heat = []) {
  const a = forceClsId
    ? { cls: CLASSES[forceClsId], src: forceSrc ? forceSrc.src : null,
        relaxed: forceSrc ? forceSrc.relaxed : false, why: "" }
    : assign(fire, water);
  const m = {
    fire, cls: a.cls, why: a.why, mode: MODES[modeId],
    offset: hashFrac(fire.id + (forceClsId || "")),
  };
  if (!a.cls || !a.src) { m.idle = true; return m; }
  const w = water[a.src.idx];
  m.water = w; m.waterIdx = a.src.idx;
  m.stations = [];
  m.intake = intakePoint(w, fire.ll, m.stations);
  if (!m.stations.length) m.stations = [m.intake];
  fire.sourceLL = m.intake;
  m.delivery = deliveryPoint(fire);
  m.oneWayKm = Math.max(1.5, havKm(m.intake, m.delivery));
  // A gentle S: outbound bows one way, return the other, so both legs stay visible.
  const mid = [(m.intake[0] + m.delivery[0]) / 2, (m.intake[1] + m.delivery[1]) / 2];
  const dx = m.delivery[0] - m.intake[0], dy = m.delivery[1] - m.intake[1];
  const off = 0.09;
  m.ctlOut = [mid[0] - dy * off, mid[1] + dx * off];
  m.ctlRet = [mid[0] + dy * off, mid[1] - dx * off];
  // Each cycle attacks a different point on the near side of the fire: real work is laid
  // along a line, not dropped on one pixel. Targets are ring vertices around the one facing
  // the source (or deterministic jitter inside the mapped radius when no perimeter exists);
  // the cycle number picks among them, so the pattern is stable across reloads.
  m.targets = [m.delivery];
  if (fire.ring && fire.ring.length > 8) {
    let ni = 0, bd = Infinity;
    fire.ring.forEach((q, i) => { const d = havKm(q, m.intake); if (d < bd) { bd = d; ni = i; } });
    const L = fire.ring.length, span = Math.max(1, Math.round(L * 0.05));
    for (let k = -3; k <= 3; k++) {
      if (!k) continue;
      m.targets.push(fire.ring[((ni + k * span) % L + L) % L].slice());
    }
  } else {
    const rKm = Math.sqrt(Math.max(fire.sizeHa, 10) * 1e4 / Math.PI) / 1000;
    const kx = 111.32 * Math.cos(m.delivery[1] * Math.PI / 180), ky = 110.57;
    for (let k = 1; k <= 6; k++) {
      const a = hashFrac(fire.id + "#" + k) * 2 * Math.PI;
      const d = rKm * (0.25 + 0.5 * hashFrac(fire.id + "@" + k));
      m.targets.push([m.delivery[0] + Math.cos(a) * d / kx, m.delivery[1] + Math.sin(a) * d / ky]);
    }
  }
  m.bearing = trackBearing(m.intake, m.delivery);
  if (m.wind) m.wind.bearing = m.bearing;
  m.segs = m.targets.map(t => dropSeg(m, t));
  planTargets(m, heat);
  // The plan has to time the leg the ship actually FLIES. oneWayKm is source centre to fire
  // centre, but a hull leaves a hose STATION and arrives at the head of a drop LINE offset
  // from the fire — routinely 40% farther. Timing the short version made the map move at
  // nearly twice the speed the ground-speed dial was reporting. Average the real legs over
  // the target rotation, since each cycle works a different line.
  m.legKm = legKmFor(m);
  m.plan = planCycle(m.cls, m.mode, m.legKm, m.wind);
  m.cycleSec = m.plan.cycleMin * 60;
  m.phaseEnds = [];
  let acc = 0;
  for (const [id] of PHASES) { acc += m.plan.dur[id] * 60; m.phaseEnds.push(acc); }
  m.srcWhy = `${w[4] || "An unnamed " + (w[3] ? "reservoir" : "lake")} selected: ` +
    (a.relaxed
      ? `smaller than the class prefers (${fmt(w[2])} ha) but only ${a.src.km.toFixed(1)} km from the fire — proximity beat the long haul. `
      : `best mapped ${w[3] ? "definite reservoir" : "definite lake"} of at least ${m.cls.minSourceHa} ha within ` +
        `${m.cls.searchKm} km — size-weighted, so larger water beats a just-qualifying pond unless it is much ` +
        `farther (${fmt(w[2])} ha, ${a.src.km.toFixed(1)} km from the fire). `) +
    `Surface area is a proxy — depth, ecology, access and permission are not established.`;
  return m;
}

/* Where a mission is and what it is doing, cycleSec into its loop. */
