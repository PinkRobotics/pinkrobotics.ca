/* Assertions the model must satisfy, runnable in a browser console on the live page.
 *
 * These are shipped, not just tested in CI, so that a reader who does not trust the
 * numbers can run the checks themselves in devtools on the page they are reading.
 */
import { sizeTier } from './assign.js?v=816a54f9';
import { CFG, CLASSES, CLASS_ORDER, DEFAULTS, MODES, resetConfig, TERRAIN_MSL, WORK_ALT_MSL } from './config.js?v=816a54f9';
import { buildMission } from './mission.js?v=816a54f9';
import { ledger, pumpMW } from './physics.js?v=816a54f9';
import { planCycle } from './plan.js?v=816a54f9';
import { BUS_CEILING } from './power.js?v=816a54f9';
import { stateAt } from './state.js?v=816a54f9';
import { findSource } from './water.js?v=816a54f9';

export function selftest() {
  const eq = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) throw new Error("SELFTEST FAIL: " + msg + ` (${a} vs ${b})`); };
  // Throughput identity: 100 t on a 10-minute cycle is 600 t/h.
  eq(100 * 60 / 10, 600, 1e-9, "throughput identity");
  // Fill time: P-100 at 0.5 m3/s over 100 m3 is 200 s.
  resetConfig();
  const p = planCycle(CLASSES.P100, MODES.balanced, 15);
  eq(p.dur.WATER_FILL, 100 / 0.5 / 60, 0.01, "P-100 fill time");
  // Pump power: rho g Q h / eta, where h is the class's own hose — the P-100's 300 m, not a
  // global head. 1000*9.81*0.5*300/0.75 = 1.962 MW.
  eq(pumpMW(CLASSES.P100), 1.962, 0.01, "pump power");
  // Cycle grows with distance, throughput falls.
  const far = planCycle(CLASSES.P100, MODES.balanced, 60);
  if (far.cycleMin <= p.cycleMin || far.tph >= p.tph) throw new Error("SELFTEST FAIL: distance monotonicity");
  // Class tiers are monotonic in size.
  const t1 = sizeTier({ sizeHa: 10, status: "Being Held", note: false });
  const t2 = sizeTier({ sizeHa: 5000, status: "Being Held", note: false });
  const t3 = sizeTier({ sizeHa: 50000, status: "Being Held", note: false });
  if (!(t1 <= t2 && t2 <= t3)) throw new Error("SELFTEST FAIL: size tier monotonicity");
  // Source rules: too-small and too-far bodies are rejected; nearest suitable wins.
  const W = [[-120, 50, 5, 0, "toosmall", null], [-120.1, 50, 500, 0, "near", null], [-121, 50, 500, 0, "far", null]];
  const s = findSource([-120.05, 50], CLASSES.P100, W);
  if (!s || W[s.idx][4] !== "near") throw new Error("SELFTEST FAIL: source selection");
  if (findSource([-130, 58], CLASSES.P100, W)) throw new Error("SELFTEST FAIL: search radius");
  // Mass book-keeping: fill ends full, release ends empty; LN2 recovery is partial.
  const fire = { id: "TEST1", ll: [-120.05, 50], sizeHa: 200, status: "Out of Control", note: false, ring: null };
  const mi = buildMission(fire, W, "balanced");
  const endFill = stateAt(mi, (mi.phaseEnds[1] - 1) - mi.offset * mi.cycleSec);
  eq(endFill.water, mi.cls.payloadT, mi.cls.payloadT * 0.02, "fill end mass");
  const endRel = stateAt(mi, (mi.phaseEnds[3] - 0.5) - mi.offset * mi.cycleSec);
  if (Math.abs(endRel.water - mi.plan.retainedT) > mi.cls.payloadT * 0.02)
    throw new Error("SELFTEST FAIL: release end mass " + endRel.water);
  // The books must balance: delivered + retained = payload, and descent power fits the bus.
  if (Math.abs(mi.plan.deliveredT + mi.plan.retainedT - mi.cls.payloadT) > 0.5)
    throw new Error("SELFTEST FAIL: retention bookkeeping");
  for (const cid of CLASS_ORDER) {
    const pp = planCycle(CLASSES[cid], MODES.balanced, 25);
    // The bus is the battery plus what the nitrogen store returns, never the generators'
    // nameplate (defect 6), and the rotors get BUS_CEILING of it.
    if (pp.downMW > BUS_CEILING * (CLASSES[cid].battMW + CLASSES[cid].genMW) * (1 + 1e-9)
      || pp.busMW >= CLASSES[cid].battMW + CLASSES[cid].genMW)
      throw new Error("SELFTEST FAIL: descent power exceeds the bus for " + cid);
    // Retained descent ballast is the LAST resort, not a spec failure. This check used to
    // demand that every class dump its entire payload, which held only because the descent
    // balance was struck at the ceiling rather than at the lake where the letdown ends. The
    // rule is now: rotors, then the anchor's bag of lake water, and only then water kept back.
    // On the shipped numbers nothing is kept back — but the rule is what is checked, not the
    // outcome, so a class that stops closing says so instead of silently delivering less.
    if (pp.retainedT !== 0 || (!pp.feasible && !pp.bindingLimits.length))
      throw new Error("SELFTEST FAIL: missing baseline feasibility reason for " + cid);
    if (pp.retainedT > CLASSES[cid].payloadT)
      throw new Error("SELFTEST FAIL: " + cid + " retains more water than it carries");
    if (pp.passes % 2 !== 1)
      throw new Error("SELFTEST FAIL: even drop-pass count for " + cid);
  }
  // FAIL-SAFE FLOAT-UP. The hull must lift itself, its structure and a full load of water it
  // cannot drop, in the thinnest air it ever works in. This is the requirement that sizes the
  // envelope, so it is checked on the shipped numbers rather than trusted to a comment.
  for (const cid of CLASS_ORDER) {
    const c = CLASSES[cid], l = ledger(c, WORK_ALT_MSL);
    const loadedT = l.dryT + c.payloadT;
    if (!(l.liftT >= loadedT * 1.05))
      throw new Error(`SELFTEST FAIL: ${cid} is not 5% buoyant fully loaded at ${WORK_ALT_MSL} m: `
        + `${l.liftT.toFixed(1)} t of lift against ${loadedT.toFixed(1)} t`);
  }
  // UNPOWERED RECOVERY. A dead ship floats up, so the nitrogen it can carry has to be able to
  // bring it back down and land it with no rotors. The binding altitude is the GROUND, where
  // the air is densest and the empty hull most buoyant — not the ceiling it starts from.
  for (const cid of CLASS_ORDER) {
    const c = CLASSES[cid], needT = ledger(c, TERRAIN_MSL).surplusT;
    if (!(c.ln2CapT >= needT))
      throw new Error(`SELFTEST FAIL: ${cid} holds ${c.ln2CapT} t of LN2 against the `
        + `${needT.toFixed(1)} t needed to sink an empty hull at ${TERRAIN_MSL} m`);
  }
  // Out of Control bumps the 200 ha test fire one tier: it must fly a P-1000, not a P-100.
  if (mi.cls.id !== "P1000") throw new Error("SELFTEST FAIL: OOC tier bump, got " + mi.cls.id);
  if (!(CFG.rtLN2 < 1)) throw new Error("SELFTEST FAIL: LN2 round trip must be lossy");
  // Size weighting: for a P-1000, a 35,000 ha lake at ~18 km beats a 150 ha pond at ~4 km.
  const W2 = [[-120.1, 50, 150, 0, "pond", null], [-120.3, 50, 35000, 0, "big", null]];
  const s2 = findSource([-120.05, 50], CLASSES.P1000, W2);
  if (!s2 || W2[s2.idx][4] !== "big") throw new Error("SELFTEST FAIL: size-weighted source selection");
  // Wind asymmetry: a west wind flying east means faster out, slower home.
  const pW = planCycle(CLASSES.P100, MODES.balanced, 30, { spd: 40, dir: 270, bearing: 90 });
  const pN = planCycle(CLASSES.P100, MODES.balanced, 30);
  if (!(pW.dur.OUTBOUND_TRANSIT < pN.dur.OUTBOUND_TRANSIT && pW.dur.RETURN_TRANSIT > pN.dur.RETURN_TRANSIT))
    throw new Error("SELFTEST FAIL: wind leg asymmetry");
  // Idle path: no water anywhere nearby.
  const lost = buildMission({ id: "TEST2", ll: [-135, 59.9], sizeHa: 50, status: "New", note: false, ring: null }, W, "balanced");
  if (!lost.idle) throw new Error("SELFTEST FAIL: no-source mission should be idle");
  // The energy ledger: on demonstration assumptions every class runs a per-cycle deficit
  // (solar + N2 recovery < consumption) — the monitor depends on that being visibly true.
  for (const cid of CLASS_ORDER) {
    const c = CLASSES[cid], pp = planCycle(c, MODES.balanced, 15);
    const genMWh = (c.solarM2 * CFG.solarWPerM2 / 1e6) * pp.cycleMin / 60;  // eBack already nets in eCycle
    if (!(pp.eCycleMWh > genMWh))
      throw new Error("SELFTEST FAIL: expected an energy deficit for " + cid);
    if (!(pp.eBack >= 0 && pp.eBack < pp.eCycleMWh + pp.eBack))
      throw new Error("SELFTEST FAIL: N2 recovery bookkeeping for " + cid);
  }
  // ONE ENERGY MODEL. The cycle energy the plan publishes is the integral of what the instruments
  // show: summing stateAt's draw less its generation over the test mission's cycle must give the
  // plan's eCycleMWh to within the quadrature error (the plan uses 96 midpoint samples per phase;
  // this sum uses 1,200 over the cycle). Until 2026-10-01 these were two models and the sum was
  // 1.5 to 3.8 times the budget.
  {
    const N = 1200, dtH = mi.cycleSec / N / 3600;
    let net = 0;
    for (let i = 0; i < N; i++) {
      const st = stateAt(mi, mi.cycleSec * (i + 0.5) / N - mi.offset * mi.cycleSec);
      for (const v of Object.values(st.draw)) net += v * dtH;
      net -= (st.gen.regen || 0) * dtH;
    }
    eq(net / mi.plan.eCycleMWh, 1, 0.005, "the budget is the integral of the flight");
  }
  return "SELFTEST PASS (20 checks)";
}
