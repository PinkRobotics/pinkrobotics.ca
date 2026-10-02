/* AirshipVisualState — the contract between whatever owns the mission and this model.
 *
 * The model is DETERMINISTIC from this object plus the class id and the view mode. It holds no
 * mission state of its own. There is a demo state machine in anim/mission.js, but it exists only
 * so the standalone lab has something to show; the wildfire page passes its own state and the
 * demo machine never runs.
 *
 * If a scene needs a number, it comes from here or from config. A scene that computes its own
 * mission arithmetic is a bug — that is how two pages start quoting different fill times.
 */

import { clamp01, clamp, lerp } from '../core/math.js?v=5bcbf32c';

/**
 * The mission phases, in cycle order. A superset of the /airships page's six-phase PHASES list:
 * every name the monitor emits is here, plus the phases it folds into its flown ones — the hose
 * work, the climb out, the run in and the letdown. The adapter passes host phase names through
 * unchanged, so the two lists must never disagree about a name they share.
 */
export const MISSION_PHASES = [
  'SOURCE_APPROACH', 'HOSE_DEPLOY', 'WATER_FILL', 'HOSE_RETRACT', 'DEPARTURE_CLIMB',
  'OUTBOUND_TRANSIT', 'FIRE_APPROACH', 'WATER_RELEASE', 'BUOYANCY_ESCAPE', 'RETURN_TRANSIT',
  'CONTROLLED_DESCENT',
];

/** Off-cycle states. These are not part of the loop and must not be interpolated into it. */
export const OFF_CYCLE_PHASES = ['WEATHER_HOLD', 'SAFE_DRIFT', 'TOTAL_POWER_LOSS', 'TANKER_REFUEL'];

export const ALL_PHASES = [...MISSION_PHASES, ...OFF_CYCLE_PHASES];

export const PHASE_LABELS = {
  SOURCE_APPROACH: 'approach the water source',
  HOSE_DEPLOY: 'lower the hose and pump pod',
  WATER_FILL: 'pump water aboard',
  HOSE_RETRACT: 'retract the hose',
  DEPARTURE_CLIMB: 'climb toward the transit layer',
  OUTBOUND_TRANSIT: 'transit to the fire',
  FIRE_APPROACH: 'approach the delivery point',
  WATER_RELEASE: 'release water along the fire line',
  BUOYANCY_ESCAPE: 'escape climb on surplus buoyancy',
  RETURN_TRANSIT: 'return transit, liquefying nitrogen',
  CONTROLLED_DESCENT: 'controlled descent to hose range',
  WEATHER_HOLD: 'hold clear of weather',
  SAFE_DRIFT: 'safe drift on minimal power',
  TOTAL_POWER_LOSS: 'total power loss — passive',
  TANKER_REFUEL: 'cooperative tanker rendezvous',
};

/** A zeroed state. Every field is present so no consumer has to guard for undefined. */
export function defaultState(patch = {}) {
  return {
    phase: 'SOURCE_APPROACH',
    phaseProgress: 0,

    waterFraction: 0,
    ln2Fraction: 0,
    fuelFraction: 1,
    batteryStateOfCharge: 0.8,

    altitudeM: 300,
    airspeedMps: 0,
    groundSpeedMps: 0,
    verticalSpeedMps: 0,

    vacuumBuoyancyN: 0,
    weightN: 0,
    aerodynamicForceN: { x: 0, y: 0, z: 0 },
    desiredWrench: null,

    // null means "the host did not supply this", which is NOT the same as zero. A dead bus really
    // is zero, and `derivePower` must not helpfully substitute a cruise figure for it.
    solarPowerMW: null,
    generatorPowerMW: null,
    batteryPowerMW: null,
    cryogenicPowerMW: null,
    ln2RecoveryPowerMW: null,
    pumpPowerMW: null,
    propulsionPowerMW: null,

    hoseProgress: 0,
    pumpPodDepthM: 0,
    waterReleaseProgress: 0,

    // The descent anchor. `anchorProgress` is how far the cable is paid out, 0 stowed to 1 at the
    // water; `anchorFill` is how much water is in the bag. They are separate because the sequence
    // that matters is dip, FILL, then lift clear — a single number could not express the middle.
    // `overWater` says the surface below is a lake rather than a fire, which is what licenses
    // drawing it and what lets the pod and the bag stop at it instead of passing through.
    anchorProgress: 0,
    anchorFill: 0,
    overWater: false,

    structuralMargin: undefined,
    selectedWindLayerM: undefined,

    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },

    failedComponents: [],
    activeWarnings: [],
    ...patch,
  };
}

/**
 * Clamp a state into legality and report what had to be fixed. Used by the adapter and by the
 * lab, so a host page passing nonsense gets a warning rather than a silently wrong picture.
 */
export function validateState(s) {
  const errs = [];
  if (!ALL_PHASES.includes(s.phase)) errs.push(`unknown phase "${s.phase}"`);
  for (const k of ['phaseProgress', 'waterFraction', 'ln2Fraction', 'fuelFraction',
    'batteryStateOfCharge', 'hoseProgress', 'waterReleaseProgress']) {
    const v = s[k];
    if (typeof v !== 'number' || !isFinite(v)) errs.push(`${k} is not a finite number`);
    else if (v < -1e-6 || v > 1 + 1e-6) errs.push(`${k} = ${v} outside 0..1`);
  }
  if (s.altitudeM < 0) errs.push('altitudeM is negative');
  if (s.pumpPodDepthM < 0) errs.push('pumpPodDepthM is negative');
  return errs;
}

/** Force a state into legality (does not warn — pair with validateState when you want to know). */
export function sanitizeState(s) {
  const o = defaultState(s);
  o.phaseProgress = clamp01(o.phaseProgress);
  for (const k of ['waterFraction', 'ln2Fraction', 'fuelFraction', 'batteryStateOfCharge',
    'hoseProgress', 'waterReleaseProgress', 'anchorProgress', 'anchorFill']) o[k] = clamp01(o[k]);
  o.overWater = !!o.overWater;
  o.altitudeM = Math.max(0, o.altitudeM || 0);
  o.pumpPodDepthM = Math.max(0, o.pumpPodDepthM || 0);
  if (!ALL_PHASES.includes(o.phase)) o.phase = 'SOURCE_APPROACH';
  if (!Array.isArray(o.failedComponents)) o.failedComponents = [];
  if (!Array.isArray(o.activeWarnings)) o.activeWarnings = [];
  return o;
}

/**
 * Interpolate between two states. Phases are DISCRETE: the result takes b's phase past the
 * halfway point and never blends the names, because a half-WATER_FILL half-HOSE_RETRACT phase is
 * not a thing that can happen and any consumer switching on `phase` would do something absurd
 * with it. Continuous quantities blend; the failure list takes the destination's.
 */
export function lerpState(a, b, t) {
  const u = clamp01(t);
  const out = defaultState();
  const num = ['phaseProgress', 'waterFraction', 'ln2Fraction', 'fuelFraction',
    'batteryStateOfCharge', 'altitudeM', 'airspeedMps', 'groundSpeedMps', 'verticalSpeedMps',
    'vacuumBuoyancyN', 'weightN',
    'hoseProgress', 'pumpPodDepthM', 'waterReleaseProgress',
    'anchorProgress', 'anchorFill'];
  for (const k of num) out[k] = lerp(a[k] || 0, b[k] || 0, u);
  // Boolean, so it takes the destination's past halfway rather than blending: half over water
  // is not a thing, and a consumer switching on it would draw half a lake.
  out.overWater = u < 0.5 ? !!a.overWater : !!b.overWater;
  // Power fields keep their null-means-unsupplied semantics through an interpolation: blending
  // null with a number would invent a supply the host never claimed.
  for (const k of ['solarPowerMW', 'generatorPowerMW', 'batteryPowerMW', 'cryogenicPowerMW',
    'ln2RecoveryPowerMW', 'pumpPowerMW', 'propulsionPowerMW']) {
    const av = a[k], bv = b[k];
    out[k] = (typeof av === 'number' && typeof bv === 'number') ? lerp(av, bv, u)
      : (u < 0.5 ? av : bv);
  }
  for (const k of ['x', 'y', 'z']) {
    out.aerodynamicForceN[k] = lerp(
      (a.aerodynamicForceN && a.aerodynamicForceN[k]) || 0,
      (b.aerodynamicForceN && b.aerodynamicForceN[k]) || 0, u);
  }
  out.attitude = {
    rollRad: lerp(a.attitude ? a.attitude.rollRad : 0, b.attitude ? b.attitude.rollRad : 0, u),
    pitchRad: lerp(a.attitude ? a.attitude.pitchRad : 0, b.attitude ? b.attitude.pitchRad : 0, u),
    yawRad: lerpAngle(a.attitude ? a.attitude.yawRad : 0, b.attitude ? b.attitude.yawRad : 0, u),
  };
  out.phase = u < 0.5 ? a.phase : b.phase;
  out.failedComponents = (u < 0.5 ? a.failedComponents : b.failedComponents) || [];
  out.activeWarnings = (u < 0.5 ? a.activeWarnings : b.activeWarnings) || [];
  out.desiredWrench = u < 0.5 ? a.desiredWrench : b.desiredWrench;
  out.structuralMargin = lerp(
    a.structuralMargin === undefined ? 1 : a.structuralMargin,
    b.structuralMargin === undefined ? 1 : b.structuralMargin, u);
  return out;
}

/** Shortest-path angular interpolation, so a heading crossing north does not spin the model. */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * clamp01(t);
}

/** Is this phase one where the ship is working over the water source? */
export const isAtSource = (p) =>
  p === 'SOURCE_APPROACH' || p === 'HOSE_DEPLOY' || p === 'WATER_FILL' || p === 'HOSE_RETRACT';

/**
 * Can the hose be out in this phase?
 *
 * Five phases, not three, because this phase space is shared with the monitor and the two cycles
 * divide the hose work differently. The monitor has six phases and gives the hose no stopped time
 * of its own (sim/config.js PHASES): the pod pays out during the flown SOURCE_APPROACH — labelled
 * "final approach — hose paying out", and drawing winch power in sim/state.js — and winds up over
 * the first stretch of OUTBOUND_TRANSIT. This model splits that work into HOSE_DEPLOY and
 * HOSE_RETRACT and leaves the flown phases alone. `adapter/fable.js` maps monitor phases straight
 * into these names, so a predicate that excluded SOURCE_APPROACH answered "no" while an adapted
 * state had 250 m of hose in the water.
 */
export const hoseIsOut = (p) => p === 'SOURCE_APPROACH' || p === 'HOSE_DEPLOY' ||
  p === 'WATER_FILL' || p === 'HOSE_RETRACT' || p === 'OUTBOUND_TRANSIT';

/** A one-line text alternative for the current state — the accessible caption for any scene. */
export function describeState(s, cls) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const bits = [
    `${cls ? cls.name : 'Airship'}: ${PHASE_LABELS[s.phase] || s.phase}`,
    `${pct(s.phaseProgress)} through the phase`,
    `water ${pct(s.waterFraction)}`,
    `liquid nitrogen ${pct(s.ln2Fraction)}`,
    `battery ${pct(s.batteryStateOfCharge)}`,
    `altitude ${Math.round(s.altitudeM).toLocaleString()} m`,
  ];
  if (s.failedComponents && s.failedComponents.length) {
    bits.push(`${s.failedComponents.length} component${s.failedComponents.length > 1 ? 's' : ''} failed`);
  }
  return `${bits.join('; ')}.`;
}

void clamp;
