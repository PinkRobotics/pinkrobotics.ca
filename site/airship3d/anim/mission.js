/* A demonstration mission state machine — for the STANDALONE LAB ONLY.
 *
 * When the wildfire monitor embeds this model it passes its own state and none of this runs. The
 * model must not own a second mission simulation: two simulations means two answers to "how long
 * does a fill take", and the page and the model would eventually disagree in public.
 *
 * What this does own is the mapping from a phase and a progress fraction to the CONTINUOUS
 * quantities a 3D scene needs and a mission planner does not bother to emit: hose payout, pod
 * depth, release progress, attitude, airspeed, vertical speed. Those are the model's business.
 * `adapter/fable.js` uses exactly the same mapping when it is given a host phase, so a scene looks
 * identical whether the state came from here or from the monitor.
 *
 * Durations are computed from the class configuration — the same fill rate, cruise speed and
 * altitudes the wildfire page reads — so the two cannot drift apart even here.
 */

import { MISSION_PHASES, PHASE_LABELS, defaultState } from '../physics/state.js?v=187e4a51';
import { massState } from '../physics/mass.js?v=187e4a51';
import { derivePower } from '../physics/energy.js?v=187e4a51';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js?v=187e4a51';
import { ASSUMPTIONS } from '../model/config.js?v=187e4a51';

/** Altitudes, in metres. Same three bands the /airships page uses. */
export const ALT = { cruise: 1500, source: 300, drop: 250 };

export const MODES = {
  rapid: { id: 'rapid', label: 'Rapid response', speed: 1.15, hose: 0.85, climb: 1.4, cryoShare: 0.4, fixed: 0.8 },
  balanced: { id: 'balanced', label: 'Balanced', speed: 1.0, hose: 1.0, climb: 1.0, cryoShare: 0.7, fixed: 1.0 },
  endurance: { id: 'endurance', label: 'Endurance', speed: 0.8, hose: 1.15, climb: 0.7, cryoShare: 1.0, fixed: 1.2 },
};

/**
 * Phase durations in minutes, from the class configuration.
 * @param {object} cls resolved class
 * @param {object} mode one of MODES
 * @param {number} oneWayKm
 */
export function phaseDurations(cls, mode = MODES.balanced, oneWayKm = 15) {
  const kph = cls.cruiseKph || 90;
  const fill = Math.max(0.01, cls.fillRateM3s);
  const d = {};
  d.SOURCE_APPROACH = 3 * mode.fixed;
  d.HOSE_DEPLOY = (cls.hoseDeployMin || 4) * mode.hose;
  d.WATER_FILL = cls.payloadTonnes / fill / 60;
  d.HOSE_RETRACT = (cls.hoseRetractMin || 3) * mode.hose;
  d.DEPARTURE_CLIMB = (ALT.cruise - ALT.source) / (2.5 * mode.climb) / 60;
  d.OUTBOUND_TRANSIT = (oneWayKm / (kph * mode.speed)) * 60;
  d.FIRE_APPROACH = 4 * mode.fixed;
  d.WATER_RELEASE = 2.5;
  d.BUOYANCY_ESCAPE = 2.5;
  d.RETURN_TRANSIT = (oneWayKm / (kph * mode.speed)) * 60;
  d.CONTROLLED_DESCENT = (ALT.cruise - ALT.source) / (3.0 * mode.climb) / 60;
  return d;
}

/** Cumulative phase boundaries, as fractions of the whole cycle. */
export function phaseTimeline(cls, mode, oneWayKm) {
  const d = phaseDurations(cls, mode, oneWayKm);
  const total = MISSION_PHASES.reduce((a, p) => a + d[p], 0);
  let acc = 0;
  const bounds = MISSION_PHASES.map((p) => {
    const start = acc / total;
    acc += d[p];
    return { id: p, label: PHASE_LABELS[p], start, end: acc / total, minutes: d[p] };
  });
  return { bounds, totalMinutes: total, durations: d };
}

/** Which phase a normalised cycle position is in. */
export function phaseAt(timeline, u) {
  const t = ((u % 1) + 1) % 1;
  for (const b of timeline.bounds) {
    if (t < b.end || b === timeline.bounds[timeline.bounds.length - 1]) {
      return { phase: b.id, progress: clamp01((t - b.start) / Math.max(1e-9, b.end - b.start)), bound: b };
    }
  }
  return { phase: MISSION_PHASES[0], progress: 0, bound: timeline.bounds[0] };
}

/**
 * The continuous quantities for a phase — the mapping the adapter shares.
 * Returns a partial state; the caller merges it into a full one.
 */
export function phaseShape(cls, phase, prog, opts = {}) {
  const p = clamp01(prog);
  const s = {};
  const cruise = (cls.cruiseKph || 90) / 3.6;
  const ln2Target = opts.ln2Target === undefined ? 0.8 : opts.ln2Target;

  switch (phase) {
    case 'SOURCE_APPROACH':
      s.altitudeM = lerp(ALT.source + 150, ALT.source, smoothstep(p));
      s.airspeedMps = lerp(cruise * 0.35, 2, p);
      s.verticalSpeedMps = -2.0 * (1 - p);
      s.waterFraction = 0; s.ln2Fraction = ln2Target * (1 - 0.3 * p);
      // The monitor has no HOSE_DEPLOY phase: its pod pays out DURING the approach (the
      // schematic HUD draws exactly this ramp), and the approach's duration is set from the
      // class's hoseDeployMin — so riding p here is what makes the winch move at winch speed.
      s.hoseProgress = p;
      s.attitude = { rollRad: 0, pitchRad: -0.012, yawRad: 0 };
      break;
    case 'HOSE_DEPLOY':
      s.altitudeM = ALT.source; s.airspeedMps = 2; s.verticalSpeedMps = 0;
      s.waterFraction = 0; s.ln2Fraction = ln2Target * 0.7;
      s.hoseProgress = smoothstep(p);
      break;
    case 'WATER_FILL':
      s.altitudeM = ALT.source; s.airspeedMps = 1.5; s.verticalSpeedMps = 0;
      s.waterFraction = p;
      s.ln2Fraction = ln2Target * 0.7 * (1 - p);      // ballast given back as water comes aboard
      s.hoseProgress = 1;
      break;
    case 'HOSE_RETRACT':
      s.altitudeM = ALT.source; s.airspeedMps = 2; s.verticalSpeedMps = 0;
      s.waterFraction = 1; s.ln2Fraction = 0;
      // Drain first, then haul in. A hose full of water is tonnes hanging on the winch.
      s.hoseProgress = p < 0.35 ? 1 : 1 - smoothstep((p - 0.35) / 0.65);
      break;
    case 'DEPARTURE_CLIMB':
      s.altitudeM = lerp(ALT.source, ALT.cruise, smoothstep(p));
      s.airspeedMps = lerp(3, cruise * 0.7, p);
      s.verticalSpeedMps = 2.5 * Math.sin(Math.PI * p);
      s.waterFraction = 1; s.ln2Fraction = 0;
      s.attitude = { rollRad: 0, pitchRad: 0.030 * Math.sin(Math.PI * p), yawRad: 0 };
      break;
    case 'OUTBOUND_TRANSIT':
      s.altitudeM = ALT.cruise; s.airspeedMps = cruise; s.verticalSpeedMps = 0;
      s.waterFraction = 1; s.ln2Fraction = 0;
      // Monitor overlap doctrine: the hose winds up over the first stretch of the outbound
      // leg (whose floor is hoseRetractMin), matching the schematic HUD's 18% ramp.
      s.hoseProgress = Math.max(0, 1 - p / 0.18);
      break;
    case 'FIRE_APPROACH':
      s.altitudeM = lerp(ALT.cruise, ALT.drop, smoothstep(p));
      s.airspeedMps = lerp(cruise, cruise * 0.35, p);
      s.verticalSpeedMps = -3.0 * Math.sin(Math.PI * p);
      s.waterFraction = 1; s.ln2Fraction = 0;
      s.attitude = { rollRad: 0, pitchRad: -0.025 * Math.sin(Math.PI * p), yawRad: 0 };
      break;
    case 'WATER_RELEASE':
      s.altitudeM = ALT.drop; s.airspeedMps = cruise * 0.3;
      s.waterFraction = 1 - p;
      s.waterReleaseProgress = p;
      // The ship starts rising during the drop, not after it: mass is leaving continuously.
      s.verticalSpeedMps = 4.5 * p * p;
      break;
    case 'BUOYANCY_ESCAPE':
      s.altitudeM = lerp(ALT.drop, ALT.cruise, smoothstep(p));
      s.airspeedMps = lerp(cruise * 0.3, cruise * 0.8, p);
      s.verticalSpeedMps = lerp(5.5, 1.5, p);
      s.waterFraction = 0; s.ln2Fraction = 0;
      s.attitude = { rollRad: 0, pitchRad: 0.045 * (1 - p), yawRad: 0 };
      break;
    case 'RETURN_TRANSIT':
      s.altitudeM = ALT.cruise; s.airspeedMps = cruise * 0.9; s.verticalSpeedMps = 0;
      s.waterFraction = 0; s.ln2Fraction = ln2Target * p;
      break;
    case 'CONTROLLED_DESCENT':
      s.altitudeM = lerp(ALT.cruise, ALT.source, smoothstep(p));
      s.airspeedMps = lerp(cruise * 0.9, cruise * 0.35, p);
      s.verticalSpeedMps = -3.5 * Math.sin(Math.PI * p);
      s.waterFraction = 0; s.ln2Fraction = ln2Target;
      s.attitude = { rollRad: 0, pitchRad: -0.020, yawRad: 0 };
      break;

    /* --- off-cycle states ------------------------------------------------------------------- */
    case 'SAFE_DRIFT':
      // Mission abandoned, nonessential systems off, weathervaning rather than fighting the wind.
      s.altitudeM = opts.altitudeM || ALT.cruise;
      s.airspeedMps = 4; s.verticalSpeedMps = 0.4;
      s.waterFraction = 0; s.ln2Fraction = clamp01(opts.ln2Fraction || 0.2);
      s.attitude = { rollRad: 0.01 * Math.sin(p * 6), pitchRad: 0.012, yawRad: 0.10 * Math.sin(p * 2) };
      break;
    case 'TOTAL_POWER_LOSS':
      // No active command at all. Whatever the mass state is, is what happens.
      s.altitudeM = opts.altitudeM || ALT.cruise;
      s.airspeedMps = 6; s.verticalSpeedMps = opts.netPositive ? 0.8 : -0.6;
      s.attitude = { rollRad: 0.02 * Math.sin(p * 3), pitchRad: -0.03, yawRad: 0.22 * Math.sin(p * 1.3) };
      break;
    case 'WEATHER_HOLD':
      s.altitudeM = (opts.altitudeM || ALT.cruise) + 300;
      s.airspeedMps = cruise * 0.4; s.verticalSpeedMps = 0;
      break;
    case 'TANKER_REFUEL':
      s.altitudeM = ALT.cruise; s.airspeedMps = cruise * 0.6; s.verticalSpeedMps = 0;
      s.fuelFraction = clamp01(0.25 + 0.7 * p);
      break;
    default:
      break;
  }
  return s;
}

/**
 * A complete demo state at cycle position u in [0,1).
 * @param {object} cls
 * @param {number} u
 * @param {object} opts { mode, oneWayKm, failed, batteryStateOfCharge }
 */
export function demoState(cls, u, opts = {}) {
  const mode = MODES[opts.modeId || 'balanced'] || MODES.balanced;
  const tl = opts.timeline || phaseTimeline(cls, mode, opts.oneWayKm || 15);
  const { phase, progress } = phaseAt(tl, u);
  const shape = phaseShape(cls, phase, progress, opts);

  const s = defaultState({
    phase, phaseProgress: progress,
    fuelFraction: clamp01(opts.fuelFraction === undefined ? 0.8 : opts.fuelFraction),
    batteryStateOfCharge: clamp01(opts.batteryStateOfCharge === undefined ? 0.72 : opts.batteryStateOfCharge),
    failedComponents: opts.failed || [],
    ...shape,
  });
  s.groundSpeedMps = s.airspeedMps;

  const m = massState(cls, s, opts.layout || null);
  s.vacuumBuoyancyN = m.buoyancyN;
  s.weightN = m.weightN;
  Object.assign(s, derivePower(cls, s, opts.assumptions || ASSUMPTIONS));
  s.pumpPodDepthM = s.hoseProgress * (opts.headM || ASSUMPTIONS.hoseHead);

  if (m.netTonnes > 0 && phase === 'WATER_FILL') s.activeWarnings = [];
  return { state: s, mass: m, timeline: tl };
}

/** Step to the previous/next phase boundary — the keyboard controls. */
export function stepPhase(timeline, u, dir) {
  const bounds = timeline.bounds;
  const t = ((u % 1) + 1) % 1;
  if (dir > 0) {
    for (const b of bounds) if (b.start > t + 1e-6) return b.start;
    return bounds[0].start;
  }
  for (let i = bounds.length - 1; i >= 0; i--) {
    if (bounds[i].start < t - 1e-6) return bounds[i].start;
  }
  return bounds[bounds.length - 1].start;
}

void clamp;
