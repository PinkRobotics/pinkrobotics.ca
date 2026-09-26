/* Adapter: the wildfire monitor's mission state → AirshipVisualState.
 *
 * THE MONITOR OWNS THE MISSION. This file reads what /airships already computes and translates
 * it. It does not re-plan, re-time or re-derive anything the monitor has decided. Where the model
 * needs something the monitor has no reason to emit — hose payout, pod depth, release progress,
 * attitude, vertical speed — it uses the SAME phase-shape mapping the standalone lab uses
 * (anim/mission.js `phaseShape`), so a scene looks identical either way.
 *
 * WHAT IT READS. The monitor's `stateAt(mission, t)` returns:
 *
 *   { idx, phase, label, prog, ll, bearing, alt, water, ln2, draw{hotel,prop,pumps,winch,fans,
 *     cryo,rotors}, massT, buoyN, weightN, netN, cycleN }
 *
 * with `water` and `ln2` in TONNES (not fractions) and `draw` in megawatts. Those two unit
 * mismatches are the entire reason this file exists as a file rather than a spread.
 *
 * IF THE MONITOR'S SHAPE CHANGES, this is the only place that has to change. `describeMapping()`
 * prints the field-by-field correspondence so a mismatch is findable rather than mysterious.
 */

import { defaultState, sanitizeState, MISSION_PHASES, ALL_PHASES } from '../physics/state.js?v=41bc1f51';
import { phaseShape } from '../anim/mission.js?v=41bc1f51';
import { massState } from '../physics/mass.js?v=41bc1f51';
import { setAssumptions, resolveClass, CLASS_IDS } from '../model/config.js?v=41bc1f51';
import { clamp01 } from '../core/math.js?v=41bc1f51';

/** Monitor class id → model class id. They already agree; the map makes that checkable. */
export const CLASS_MAP = { P100: 'P100', P1000: 'P1000', P10000: 'P10000' };

/**
 * Adopt the host page's shared assumptions so there is one source of truth at runtime.
 * Call once, with the monitor's CFG object.
 */
export function adoptAssumptions(hostCfg) {
  if (!hostCfg) return null;
  return setAssumptions({
    eLN2: hostCfg.eLN2, rtLN2: hostCfg.rtLN2, hoseHead: hostCfg.hoseHead,
    pumpEta: hostCfg.pumpEta, propEta: hostCfg.propEta, Cd: hostCfg.Cd,
    rhoAir: hostCfg.rhoAir, rhoSL: hostCfg.rhoSL,
  });
}

/**
 * Translate one monitor state into an AirshipVisualState.
 *
 * @param {object} hostState what `stateAt()` returned
 * @param {object} hostClass the monitor's CLASSES[id] record (for payloadT, cryoMW, …)
 * @param {object} cls       the model's resolved class
 * @param {object} [opts]    { layout, failed, mode, ln2CapacityT }
 */
export function fromMonitorState(hostState, hostClass, cls, opts = {}) {
  if (!hostState) return defaultState();

  // Idle missions have no phase in the cycle. Treat them as a weather hold rather than inventing
  // a mission position — the monitor's "no suitable source" is a real state, not a gap.
  const rawPhase = hostState.phase === 'NO_SUITABLE_SOURCE' ? 'WEATHER_HOLD' : hostState.phase;
  const phase = ALL_PHASES.includes(rawPhase) ? rawPhase : 'WEATHER_HOLD';
  const prog = clamp01(hostState.prog === undefined ? 0 : hostState.prog);

  // Tonnes → fractions. The monitor's ln2 is against its own plan target, not a tank capacity, so
  // the fraction is taken against the model's configured tank capacity and clamped.
  //
  // WHY THE MODEL'S CAPACITY AND NOT hostClass.ln2CapT. Every consumer of ln2Fraction multiplies
  // it back by cls.ln2TankCapacityTonnes (massState's tonnes, the drawn tank volumes in layout.js,
  // the fill levels in anim/driver.js), so dividing by the model bank is the only choice that
  // conserves the monitor's tonnes end to end. The numbers, for the record: the model bank is
  // 30 / 150 / 700 t (P100/P1000/P10000) versus the monitor's ln2CapT of 50 / 500 / 5000 t —
  // dividing by ln2CapT would shrink every fill a further 1.7-7x AND make massState report 0.6x
  // of the tonnes the monitor said were aboard. The reason fills used to look empty was never
  // this denominator: the monitor's ln2 peaks at plan.ln2MakeT, which is cryo-rate-limited to a
  // few tonnes on a typical return leg (P-100: ~4.2 MW ÷ 0.45 kWh/kg ≈ 9.3 t/h for ~10 min), a
  // few percent of any capacity — the display now concentrates it tank-by-tank (see driver.js).
  const payloadT = (hostClass && hostClass.payloadT) || cls.payloadTonnes;
  const ln2CapT = opts.ln2CapacityT || cls.ln2TankCapacityTonnes;
  const waterFraction = clamp01((hostState.water || 0) / Math.max(1e-6, payloadT));
  const ln2Fraction = clamp01((hostState.ln2 || 0) / Math.max(1e-6, ln2CapT));

  // The continuous quantities the monitor has no reason to carry.
  const shape = phaseShape(cls, phase, prog, { ln2Target: ln2Fraction });

  const draw = hostState.draw || {};
  const s = defaultState({
    phase,
    phaseProgress: prog,

    waterFraction,
    ln2Fraction,
    fuelFraction: clamp01(opts.fuelFraction === undefined ? 0.8 : opts.fuelFraction),
    batteryStateOfCharge: clamp01(opts.batteryStateOfCharge === undefined ? 0.72
      : opts.batteryStateOfCharge),

    // Altitude is the monitor's; speeds are the model's phase shape unless the monitor gave them.
    altitudeM: hostState.alt === undefined ? shape.altitudeM : hostState.alt,
    airspeedMps: shape.airspeedMps || 0,
    groundSpeedMps: shape.airspeedMps || 0,
    verticalSpeedMps: shape.verticalSpeedMps || 0,

    vacuumBuoyancyN: hostState.buoyN || 0,
    weightN: hostState.weightN || 0,
    // The monitor's own vertical-duty number (<= 0, rotors hold the hull DOWN). Passing it
    // rather than recomputing keeps the model, the schematic avatar and the power bars in
    // agreement about which way the rotors are pushing at any instant.
    verticalDuty: Number.isFinite(hostState.vert) ? hostState.vert : undefined,

    // draw{} is already megawatts, and its keys are the monitor's own vocabulary.
    propulsionPowerMW: (draw.prop || 0) + (draw.fans || 0) + (draw.rotors || 0),
    cryogenicPowerMW: draw.cryo || 0,
    pumpPowerMW: draw.pumps || 0,
    generatorPowerMW: 0,
    batteryPowerMW: 0,
    solarPowerMW: 0,
    ln2RecoveryPowerMW: 0,

    hoseProgress: shape.hoseProgress || 0,
    waterReleaseProgress: shape.waterReleaseProgress || 0,
    pumpPodDepthM: (shape.hoseProgress || 0) * (opts.headM || 250),

    attitude: shape.attitude || { rollRad: 0, pitchRad: 0, yawRad: 0 },
    failedComponents: opts.failed || [],
    activeWarnings: opts.warnings || [],
  });

  // The monitor's hotel load is the only generator signal it emits; split the rest so the energy
  // view balances instead of showing an unexplained deficit.
  const demand = s.propulsionPowerMW + s.cryogenicPowerMW + s.pumpPowerMW +
    (draw.winch || 0) + (draw.hotel || 0);
  const genCap = cls.generatorContinuousPowerMW;
  s.generatorPowerMW = Math.min(genCap, demand);
  s.batteryPowerMW = demand - s.generatorPowerMW;
  s.solarPowerMW = (cls.solarAreaM2 * 200) / 1e6;

  return sanitizeState(s);
}

/**
 * Convenience: everything a viewer needs from one monitor mission.
 * @returns {{ classId, state, mass }}
 */
export function adaptMission(hostMission, hostState, opts = {}) {
  const hostCls = hostMission && hostMission.cls ? hostMission.cls : null;
  const classId = CLASS_MAP[hostCls ? hostCls.id : 'P100'] || 'P100';
  const cls = opts.resolved || resolveClass(classId);
  const state = fromMonitorState(hostState, hostCls, cls, opts);
  return { classId, cls, state, mass: massState(cls, state, opts.layout || null) };
}

/**
 * The field-by-field mapping, as data. The lab prints this, and the integration test asserts that
 * every monitor field this adapter reads is still present on a sample monitor state — so a change
 * on the monitor side fails loudly here instead of silently zeroing an arrow.
 */
export function describeMapping() {
  return [
    ['stateAt().phase', 'phase', 'NO_SUITABLE_SOURCE is remapped to WEATHER_HOLD'],
    ['stateAt().prog', 'phaseProgress', '0..1 within the phase'],
    ['stateAt().water', 'waterFraction', 'TONNES → fraction of the class payload'],
    ['stateAt().ln2', 'ln2Fraction', 'TONNES → fraction of the configured tank capacity'],
    ['stateAt().alt', 'altitudeM', 'used verbatim'],
    ['stateAt().buoyN', 'vacuumBuoyancyN', 'used verbatim'],
    ['stateAt().weightN', 'weightN', 'used verbatim'],
    ['stateAt().draw.prop+fans+rotors', 'propulsionPowerMW', 'MW, summed'],
    ['stateAt().draw.cryo', 'cryogenicPowerMW', 'megawatts, used verbatim'],
    ['stateAt().draw.pumps', 'pumpPowerMW', 'megawatts, used verbatim'],
    ['(derived)', 'hoseProgress / pumpPodDepthM / waterReleaseProgress / attitude / speeds',
      'from anim/mission.js phaseShape — the monitor does not carry these'],
    ['CLASSES[id]', 'classId', 'P100 / P1000 / P10000, identical ids'],
    ['CFG', 'ASSUMPTIONS', 'adoptAssumptions() copies eLN2, rtLN2, hoseHead, pumpEta, Cd, rho'],
  ];
}

/** The monitor fields this adapter depends on. Used by the integration test. */
export const REQUIRED_HOST_FIELDS = ['phase', 'prog', 'water', 'ln2', 'alt', 'buoyN', 'weightN', 'draw'];

/** Check a host state object carries what the adapter needs. Returns a list of problems. */
export function checkHostState(hostState) {
  const errs = [];
  if (!hostState || typeof hostState !== 'object') return ['host state is not an object'];
  for (const f of REQUIRED_HOST_FIELDS) {
    if (!(f in hostState)) errs.push(`host state is missing "${f}"`);
  }
  if (hostState.phase && !ALL_PHASES.includes(hostState.phase) &&
    hostState.phase !== 'NO_SUITABLE_SOURCE') {
    errs.push(`host phase "${hostState.phase}" is not one this model knows`);
  }
  return errs;
}

void MISSION_PHASES; void CLASS_IDS;
