/* Adapter: the wildfire monitor's mission state → AirshipVisualState.
 *
 * THE MONITOR OWNS THE MISSION. This file reads what /airships already computes and translates
 * it. It does not re-plan, re-time or re-derive anything the monitor has decided. Where the model
 * needs something the monitor has no reason to emit — hose payout, pod depth, release progress,
 * attitude, vertical speed — it uses the SAME phase-shape mapping the standalone lab uses
 * (anim/mission.js `phaseShape`), so a scene looks identical either way. The exception is the
 * hose, which the monitor's six-phase cycle overlaps onto phases the model's eleven-phase cycle
 * keeps separate; that difference is resolved here, at the boundary, and nowhere else.
 *
 * WHAT IT READS. The monitor's `stateAt(mission, t)` returns:
 *
 *   { idx, phase, label, prog, ll, bearing, alt, water, ln2, draw{hotel,prop,pumps,winch,
 *     cryo,rotors}, massT, buoyN, weightN, netN, cycleN }
 *
 * with `water` and `ln2` in TONNES (not fractions) and `draw` in megawatts. Those two unit
 * mismatches are the entire reason this file exists as a file rather than a spread.
 *
 * IF THE MONITOR'S SHAPE CHANGES, this is the only place that has to change. `describeMapping()`
 * prints the field-by-field correspondence so a mismatch is findable rather than mysterious.
 */

import { defaultState, sanitizeState, MISSION_PHASES, ALL_PHASES } from '../physics/state.js?v=91301eab';
import { anchorAt, phaseShape } from '../anim/mission.js?v=91301eab';
import { massState } from '../physics/mass.js?v=91301eab';
import { ASSUMPTIONS, setAssumptions, resolveClass, CLASS_IDS } from '../model/config.js?v=91301eab';
import { clamp01 } from '../core/math.js?v=91301eab';

/** Monitor class id → model class id. They already agree; the map makes that checkable. */
export const CLASS_MAP = { P100: 'P100', P1000: 'P1000', P10000: 'P10000' };

/**
 * Adopt the host page's shared assumptions so there is one source of truth at runtime.
 * Call once, with the monitor's CFG object.
 */
export function adoptAssumptions(hostCfg) {
  if (!hostCfg) return null;
  // hoseHead is deliberately absent: the monitor stopped carrying one global head on 2026-08-09,
  // because the hose length is a property of the class (sim/config.js CLASSES[*].hoseM) and the
  // multiplier that scales it has no meaning on this side. Passing hostCfg.hoseHead here copied
  // `undefined` into the assumption block for one commit.
  return setAssumptions({
    eLN2: hostCfg.eLN2, rtLN2: hostCfg.rtLN2,
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

  // Tonnes → fractions. The monitor's ln2 is a mass; every consumer here wants a fill level.
  //
  // WHY THE MODEL'S CAPACITY AND NOT hostClass.ln2CapT. Every consumer of ln2Fraction multiplies
  // it back by cls.ln2TankCapacityTonnes (massState's tonnes, the drawn tank volumes in layout.js,
  // the fill levels in anim/driver.js), so dividing by the model bank is the only denominator that
  // conserves the monitor's tonnes end to end. That was load-bearing while the two banks differed:
  // 30 / 150 / 700 t here against the monitor's 50 / 500 / 5000 t, where dividing by ln2CapT would
  // have made massState report 0.6x of the tonnes the monitor said were aboard.
  //
  // SINCE 2026-08-09 THE TWO BANKS ARE THE SAME NUMBER — 155 / 1,550 / 15,500 t — because the tank
  // stopped being a round figure and became a requirement: hold enough nitrogen to sink an empty
  // hull at ground level with no rotor authority (sim/config.js). Both were arbitrary before and
  // only one of them can be right, so tests/cases/spec-parity.cases.js compares them now instead
  // of excusing them. The line below is unchanged and still the correct one: it divides by the
  // bank its own consumers multiply by, which is the invariant, not the literal.
  //
  // Fills still look sparse and the denominator was never the reason: the monitor's ln2 peaks at
  // plan.ln2MakeT, which is cryo-rate-limited to a few tonnes on a typical return leg (P-100:
  // ~4.2 MW ÷ 0.45 kWh/kg ≈ 9.3 t/h for ~10 min) — a fraction of a percent of a bank sized for
  // unpowered recovery. The display concentrates it tank-by-tank instead (see driver.js).
  const payloadT = (hostClass && hostClass.payloadT) || cls.payloadTonnes;
  const ln2CapT = opts.ln2CapacityT || cls.ln2TankCapacityTonnes;
  const waterFraction = clamp01((hostState.water || 0) / Math.max(1e-6, payloadT));
  const ln2Fraction = clamp01((hostState.ln2 || 0) / Math.max(1e-6, ln2CapT));

  // The continuous quantities the monitor has no reason to carry.
  const shape = phaseShape(cls, phase, prog, { ln2Target: ln2Fraction });

  // THE HOSE, WHERE THE TWO CYCLES DIFFER. The monitor's six phases give the hose no stopped time
  // of its own (sim/config.js PHASES): the pod pays out through the flown SOURCE_APPROACH, whose
  // duration is hoseDeployMin/2, and winds up over the first 18% of OUTBOUND_TRANSIT, whose floor
  // is hoseRetractMin — both drawing winch power in sim/state.js, both labelled as such on the
  // dial. The model's own cycle has HOSE_DEPLOY and HOSE_RETRACT instead, so phaseShape leaves the
  // flown phases alone and the overlap is applied here, against a host phase we know came from a
  // six-phase cycle. Riding `prog` is what makes the winch move at winch speed.
  const hoseProgress = phase === 'SOURCE_APPROACH' ? prog
    : phase === 'OUTBOUND_TRANSIT' ? Math.max(0, 1 - prog / 0.18)
      : (shape.hoseProgress || 0);

  /* THE DESCENT ANCHOR, WHERE THE TWO CYCLES DIFFER AGAIN. The model's own cycle has a
   * CONTROLLED_DESCENT phase and does the whole dip-fill-lift there. The monitor's six phases
   * have no descent of their own — the letdown rides the tail of RETURN_TRANSIT (sim/state.js) —
   * so the sequence is applied against the host phase here, exactly as the hose overlap is.
   *
   * The bag's FULL is the monitor's own number: plan.anchorT over the class's bag, so a hull
   * whose descent needs less than the bag holds draws less than a full bag. Same rule as the
   * nitrogen above — divide by the capacity the consumers multiply back. */
  const bagCapT = cls.anchorBagTonnes;
  const anchorFull = bagCapT > 0
    ? clamp01((opts.anchorT === undefined ? bagCapT : opts.anchorT) / bagCapT) : 0;
  // The cable and the bag come from the ALTITUDE, not from the phase — see anchorAt(). The
  // monitor's own flight profile now levels the return leg off ABOVE the band where the rotors
  // cannot hold the hull down (sim/plan.js anchorFromAglM, sim/state.js holdAgl) and flies the
  // rest of the way down during the slow approach, which is the only part of the cycle where
  // dipping a bag is a thing a ship could do.
  const air = anchorAt(cls, Math.max(0, hostState.alt || 0), anchorFull,
    (hostState.gs || 0) / 3.6);          // the monitor's ground speed is km/h
  let anchorProgress = air.anchorProgress, anchorFill = air.anchorFill, overWater = false;
  if (phase === 'SOURCE_APPROACH') {
    overWater = true;
  } else if (phase === 'RETURN_TRANSIT') {
    // Only the very tail of the leg is over the lake — at 0.94 the ship is a few hundred metres
    // out, levelling off and braking. Before that it is over the valley and there is no water to
    // draw, so the cable stays stowed whatever the altitude says.
    overWater = prog > 0.94;
    if (!overWater) { anchorProgress = 0; anchorFill = 0; }
  } else if (phase === 'WATER_FILL') {
    // Dumped as soon as the tanks hold more than the descent needed; the empty cable follows.
    overWater = true;
    anchorFill = anchorFull * (1 - clamp01(prog / 0.30));
    anchorProgress = 1 - clamp01((prog - 0.25) / 0.35);
  } else if (phase === 'OUTBOUND_TRANSIT') {
    overWater = prog < 0.18;                      // still over the lake while the hose winds up
    anchorProgress = 0; anchorFill = 0;
  } else {
    anchorProgress = 0; anchorFill = 0;
  }

  const draw = hostState.draw || {};
  const s = defaultState({
    phase,
    phaseProgress: prog,

    waterFraction,
    ln2Fraction,
    fuelFraction: clamp01(opts.fuelFraction === undefined ? 0.8 : opts.fuelFraction),
    batteryStateOfCharge: clamp01(opts.batteryStateOfCharge === undefined ? 0.72
      : opts.batteryStateOfCharge),

    // Altitude AND SPEED are the monitor's when it has them; the phase shape is the fallback for
    // standalone figures with no host. Taking speed from the shape regardless was why the escape
    // climb looked like a sprint: the shape ramps 0.3 to 0.8 of cruise from the first frame,
    // while the monitor's own ground speed starts at zero — the ship comes off the drop line
    // barely moving and accelerates as it rises. Motion lines that disagree with the speed dial
    // beside them are worse than no motion lines.
    altitudeM: hostState.alt === undefined ? shape.altitudeM : hostState.alt,
    airspeedMps: Number.isFinite(hostState.gs) ? hostState.gs / 3.6 : (shape.airspeedMps || 0),
    groundSpeedMps: Number.isFinite(hostState.gs) ? hostState.gs / 3.6 : (shape.airspeedMps || 0),
    verticalSpeedMps: shape.verticalSpeedMps || 0,

    vacuumBuoyancyN: hostState.buoyN || 0,
    weightN: hostState.weightN || 0,
    // The monitor's own vertical-duty number (<= 0, rotors hold the hull DOWN). Passing it
    // rather than recomputing keeps the model, the schematic avatar and the power bars in
    // agreement about which way the rotors are pushing at any instant.
    verticalDuty: Number.isFinite(hostState.vert) ? hostState.vert : undefined,

    // draw{} is already megawatts, and its keys are the monitor's own vocabulary.
    propulsionPowerMW: (draw.prop || 0) + (draw.rotors || 0),
    cryogenicPowerMW: draw.cryo || 0,
    pumpPowerMW: draw.pumps || 0,
    generatorPowerMW: 0,
    batteryPowerMW: 0,
    solarPowerMW: 0,
    ln2RecoveryPowerMW: 0,

    hoseProgress,
    anchorProgress,
    anchorFill,
    overWater,
    waterReleaseProgress: shape.waterReleaseProgress || 0,
    pumpPodDepthM: hoseProgress * (opts.headM ?? cls.hoseLengthM),

    attitude: shape.attitude || { rollRad: 0, pitchRad: 0, yawRad: 0 },
    failedComponents: opts.failed || [],
    activeWarnings: opts.warnings || [],
  });

  // Read the supplied model channels. This is graph grouping, with no capacity or phase model.
  const gen = hostState.gen || {};
  s.winchPowerMW = draw.winch || 0;
  s.hotelPowerMW = draw.hotel || 0;
  s.generatorPowerMW = hostState.gen ? 0 : null;
  s.ln2RecoveryPowerMW = hostState.gen ? gen.regen || 0 : null;
  s.solarPowerMW = hostState.gen ? gen.solar || 0 : null;
  s.batteryPowerMW = hostState.gen ? Object.values(draw).reduce((a,b)=>a+b,0) - Object.values(gen).reduce((a,b)=>a+b,0) : null;
  if (hostState.electrical) Object.assign(s, hostState.electrical);
  s.energyBasis = hostState.basis || null;
  s.energyFeasible = hostState.feasible ?? null;
  if (Number.isFinite(hostState.anchorT)) {
    s.anchorFill = hostState.anchorT / Math.max(1, opts.anchorT ?? hostCls.anchorBagT);
    s.anchorProgress = hostState.anchorCableOut ?? 0;
  }

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
  // How much of the bag this mission's descent actually needs is a PLAN figure, not a class one:
  // a short hop and a long haul make different amounts of nitrogen and so leave the anchor a
  // different job. Read it off the mission rather than making the caller thread it through.
  const planAnchorT = hostMission && hostMission.plan ? hostMission.plan.anchorT : undefined;
  const state = fromMonitorState(hostState, hostCls, cls,
    { anchorT: planAnchorT, ...opts });
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
    ['stateAt().draw.prop+rotors', 'propulsionPowerMW', 'MW, summed'],
    ['stateAt().draw.cryo', 'cryogenicPowerMW', 'megawatts, used verbatim'],
    ['stateAt().draw.pumps', 'pumpPowerMW', 'megawatts, used verbatim'],
    ['(derived)', 'waterReleaseProgress / attitude / speeds',
      'from anim/mission.js phaseShape — the monitor does not carry these'],
    ['(derived)', 'hoseProgress / pumpPodDepthM',
      'phaseShape, plus the overlap the monitor applies: paying out through SOURCE_APPROACH, ' +
      'winding up over the first 18% of OUTBOUND_TRANSIT'],
    ['CLASSES[id]', 'classId', 'P100 / P1000 / P10000, identical ids'],
    ['CFG', 'ASSUMPTIONS', 'adoptAssumptions() copies eLN2, rtLN2, pumpEta, Cd, rho'],
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
