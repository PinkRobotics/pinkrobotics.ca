/* Allocating sixteen hulls to the fires that most need them — and keeping them off the
 * fires and places the guard holds (sim/guard.js, data/season/2026.guard.json).
 */
import { CLASSES, HULL_NAMES, MODES, PHASES, buildMission, findSource, fmtHa, keepOutsFor, legKmFor, missionBlocked, bindServedMission } from '../sim/index.js?v=816a54f9';
import { renderDrawer } from './cockpit/panels.js?v=816a54f9';
import { renderFires, renderRoster, renderStats, renderTable } from './cockpit/tables.js?v=816a54f9';
import { needsShip } from './feeds.js?v=816a54f9';
import { S } from './store.js?v=816a54f9';
import { renderWorked } from './worked.js?v=816a54f9';

/* The fleet is FIXED: ten P-100s, five P-1000s, one P-10000 — sixteen hulls for the whole
   province, allocated largest-first to the fires that fit them best (priority, class fit,
   and water logistics). Everything that doesn't win a hull waits, visibly. */
export const FLEET = [["P10000", 1], ["P1000", 5], ["P100", 10]];

export async function rebuildMissions() {
  for (const f of S.fires) { f.mission = null; f.heldOut = null; }
  // A record-only day builds no mission objects at all (R1): nothing of the fleet exists
  // on those views — no ships, no tracks, no figures — and deciding that here, before any
  // mission could exist, is what keeps it true everywhere downstream.
  if (S.recordOnly) {
    S.missions = []; S.uncovered = 0; S.regions = [];
    renderRoster(); renderFires();
    return;
  }
  // The day's keep-out regions (R4): a band around every guarded fire that carries a
  // distance, and around any place entry dated this day. Computed once per rebuild;
  // dispatch checks every mission against them, and the page-level gate in tests/guard/
  // samples the ships' own positions against the same regions every frame.
  S.regions = S.exercise ? S.exerciseRegions : keepOutsFor(S.guard, S.fires, { seasonOfNote: S.seasonOfNote }, S.day);
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
  // Refuse the whole route, including release ends, all cycle jitter and the actual bows.
  const forbiddenBy = m => missionBlocked(S.regions, m);
  let open = cand.slice();
  const heldOut = new Set();
  S.missions = [];
  const rankOf = new Map(cand.slice().sort((a, b) => pri(b) - pri(a)).map((f, i) => [f.id, i + 1]));
  for (const [clsId, count] of FLEET) {
    for (let k = 1; k <= count; k++) {
      if (!open.length) open = cand.filter(f => !heldOut.has(f.id));  // more hulls than fires: double up
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
      if (m.targetRefusal) {
        // No usable geometric target: leave the hull free and show the fire's refusal.
        heldOut.add(f.id); f.heldOut = m.targetRefusal;
        k--; // This geometric refusal did not use the hull; try the next candidate.
        continue;
      }
      const noFly = forbiddenBy(m);
      if (noFly) {
        // A fire whose water line or drop line cannot avoid a keep-out distance is not
        // flown, and no hull retries it this rebuild: the map keeps the fire, the panel
        // keeps the reason, and this hull stays free for the next candidate.
        heldOut.add(f.id);
        f.heldOut = "not flown: its water line or drop line would enter the " +
          noFly.rKm.toFixed(0) + " km kept clear around " + noFly.who +
          " (a fire the guard holds)";
        continue;
      }
      m.hullNo = k;
      m.name = (HULL_NAMES[clsId] || [])[k - 1] || CLASSES[clsId].name + " #" + k;
      m.shipId = m.name;                              // unique across the fleet; keys the ledger
      m.why = `${m.name} (${CLASSES[clsId].name}) considered by the fleet allocator: ${fmtHa(f.sizeHa)}` +
        (f.note ? ", a wildfire of note" : ", out of control") +
        `, order ${rankOf.get(f.id)} of ${cand.length} fires it could reach; the selected source is ` +
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
  return planFleet();
}

let planningGeneration = 0;
const yieldToPage = () => new Promise(resolve => setTimeout(resolve, 0));

// Each route is accepted at its exact distance and measured wind. Until then it stays
// out of animation and all totals. CPU timings measure this page's own planning work.
export async function planFleet() {
  const generation = ++planningGeneration, started = performance.now();
  const missions = S.missions.filter(m => m.water && m.cls);
  S.planning = {state: "pending", startedMs: started, firstPlanMs: null, totalMs: null, slowestMissionMs: 0, missions: []};
  for (const m of missions) {
    m.served = true; m.idle = true; m.plan = null; m.planState = "pending";
    m.planReason = "Feasible plans are computing";
  }
  // A rebuild replaces mission objects. Rebind the selected hull before rendering so
  // the pending drawer cannot publish quantities from its retired route.
  if (S.sel?.m && !S.missions.includes(S.sel.m)) {
    const current = missions.find(m => m.shipId === S.sel.m.shipId);
    S.sel = current ? {type: "ship", m: current} : null;
    S.follow = false;
  }
  renderRoster(); renderFires(); renderDrawer();
  for (const m of missions) {
    await yieldToPage();
    if (generation !== planningGeneration) return;
    const before = performance.now();
    m.legKm = legKmFor(m);
    const result = bindServedMission(m, S.modeId);
    m.idle = result.state !== "ready";
    const ms = performance.now() - before;
    S.planning.missions.push({hull: m.name, ms, state: result.state});
    S.planning.slowestMissionMs = Math.max(S.planning.slowestMissionMs, ms);
    if (result.state === "ready" && S.planning.firstPlanMs === null) S.planning.firstPlanMs = performance.now() - started;
    renderRoster(); renderFires();
  }
  if (generation !== planningGeneration) return;
  S.planning.totalMs = performance.now() - started;
  S.planning.state = "settled";
  (S.planningRuns ||= []).push({...S.planning,firstPlanFromNavigationMs: started + S.planning.firstPlanMs});
  renderStats(); renderTable(); renderWorked(); renderDrawer();
}

export function replanAll() {
  S.planningDone = planFleet();
  return S.planningDone;
}
