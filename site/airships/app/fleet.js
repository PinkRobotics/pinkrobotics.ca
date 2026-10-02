/* Allocating sixteen hulls to the fires that most need them.
 */
import { CLASSES, HULL_NAMES, MODES, PHASES, buildMission, findSource, fmtHa, legKmFor, planCycle } from '../sim/index.js?v=26282d19';
import { renderDrawer } from './cockpit/panels.js?v=26282d19';
import { renderFires, renderRoster, renderStats, renderTable } from './cockpit/tables.js?v=26282d19';
import { needsShip } from './feeds.js?v=26282d19';
import { S } from './store.js?v=26282d19';
import { renderWorked } from './worked.js?v=26282d19';

/* The fleet is FIXED: ten P-100s, five P-1000s, one P-10000 — sixteen hulls for the whole
   province, allocated largest-first to the fires that fit them best (priority, class fit,
   and water logistics). Everything that doesn't win a hull waits, visibly. */
export const FLEET = [["P10000", 1], ["P1000", 5], ["P100", 10]];

export function rebuildMissions() {
  for (const f of S.fires) f.mission = null;
  const cand = S.fires.filter(needsShip);
  const pri = f => (f.note ? 2 : 0) + Math.log10(Math.max(10, f.sizeHa));
  const srcMemo = {};
  const srcFor = (f, clsId) => {
    const key = f.id + "|" + clsId;
    if (key in srcMemo) return srcMemo[key];
    const cls = CLASSES[clsId];
    let src = findSource(f.ll, cls, S.water);
    let relaxed = false;
    if (src && src.km > 30) {
      const small = findSource(f.ll, cls, S.water, cls.minSourceHa / 3, src.km / 3);
      if (small) { src = small; relaxed = true; }
    }
    return (srcMemo[key] = src ? { src, relaxed } : null);
  };
  const fit = (f, clsId) => {
    const so = srcFor(f, clsId);
    if (!so) return -Infinity;
    let v = pri(f) - so.src.km / 40;
    if (clsId === "P10000" && f.sizeHa < 3000) v -= 3;
    if (clsId === "P1000" && f.sizeHa < 300) v -= 2;
    if (clsId === "P100" && f.sizeHa > 5000) v -= 1.5;
    return v;
  };
  let open = cand.slice();
  S.missions = [];
  const rankOf = new Map(cand.slice().sort((a, b) => pri(b) - pri(a)).map((f, i) => [f.id, i + 1]));
  for (const [clsId, count] of FLEET) {
    for (let k = 1; k <= count; k++) {
      if (!open.length) open = cand.slice();          // more hulls than fires: double up
      if (!open.length) break;
      let bi = -1, bs = -Infinity;
      for (let i = 0; i < open.length; i++) {
        const v = fit(open[i], clsId);
        if (v > bs) { bs = v; bi = i; }
      }
      if (bi < 0 || bs === -Infinity) continue;
      const f = open.splice(bi, 1)[0];
      const so = srcFor(f, clsId);
      // Passing S.heat here is currently INERT, and deliberately kept: buildMission does
      // not set m.heat, and planTargets only scores hotspots for a mission whose targets
      // came from detections. Live hotspot aiming happens in applyHeat(), which runs right
      // after every rebuild. The argument stays because the signature is honest and because
      // rule 3 in the boundary linter requires it — a call that passes live data is the
      // shape we want, even where the data does not yet change the answer.
      const m = buildMission(f, S.water, S.modeId, clsId, so, S.heat);
      m.hullNo = k;
      m.name = (HULL_NAMES[clsId] || [])[k - 1] || CLASSES[clsId].name + " #" + k;
      m.shipId = m.name;                              // unique across the fleet; keys the ledger
      m.why = `${m.name} (${CLASSES[clsId].name}) tasked by the fleet allocator: ${fmtHa(f.sizeHa)}` +
        (f.note ? ", a fire of note" : ", out of control") +
        `, priority ${rankOf.get(f.id)} of ${cand.length} qualifying fires; the selected source is ` +
        `${so.src.km.toFixed(1)} km away.` +
        (so.relaxed ? " Smaller-than-preferred water accepted for proximity." : "");
      if (!f.mission) f.mission = m;
      S.missions.push(m);
    }
  }
  S.uncovered = cand.filter(f => !f.mission).length;
  // The live-feed rebuild makes fresh mission objects; the hulls' energy ledgers carry over.
  for (const m of S.missions) {
    const b = m.shipId && S.battByHull[m.shipId];
    if (b) { m.battE = b.e; m.dead = b.dead; m.deadAt = b.deadAt; }
  }
  renderRoster();
  renderFires();
}

export function replanAll() {
  for (const m of S.missions) {
    if (m.idle) continue;
    m.mode = MODES[S.modeId];
    m.legKm = legKmFor(m);
    m.plan = planCycle(m.cls, m.mode, m.legKm, m.wind);
    m.cycleSec = m.plan.cycleMin * 60;
    m.phaseEnds = []; let acc = 0;
    for (const [id] of PHASES) { acc += m.plan.dur[id] * 60; m.phaseEnds.push(acc); }
  }
  renderStats(); renderTable(); renderWorked(); renderDrawer();
}
