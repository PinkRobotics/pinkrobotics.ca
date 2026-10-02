/* A demonstration mission state machine — for the STANDALONE LAB ONLY.
 *
 * When the wildfire monitor embeds this model it passes its own state and none of this runs. The
 * model must not own a second mission simulation: two simulations means two answers to "how long
 * does a fill take", and the page and the model would eventually disagree in public.
 *
 * What this does own is the mapping from a phase and a progress fraction to the CONTINUOUS
 * quantities a 3D scene needs and a mission planner does not bother to emit: hose payout, pod
 * depth, release progress, attitude, airspeed, vertical speed. Those are the model's business.
 * `adapter/fable.js` uses this same mapping when it is given a host phase, so a scene looks
 * identical whether the state came from here or from the monitor. The one thing it adds is the
 * hose: the monitor's cycle has six phases and no stopped hose time, so it overlaps the payout and
 * the wind-up onto its flown phases, and this eleven-phase cycle cannot do the same without
 * deploying the hose twice. That overlap is applied there, not here.
 *
 * Durations are computed from the class configuration — the same fill rate, cruise speed and
 * altitudes the wildfire page reads — so the two cannot drift apart even here.
 */

import { MISSION_PHASES, PHASE_LABELS, defaultState } from '../physics/state.js?v=5bcbf32c';
import { massState } from '../physics/mass.js?v=5bcbf32c';
import { derivePower } from '../physics/energy.js?v=5bcbf32c';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js?v=5bcbf32c';
import { ASSUMPTIONS, ALT, ALT_DROP_TOP, MODES, specNumber, sourceAltM } from '../model/config.js?v=5bcbf32c';

// Preserve the public mission-module API; declarations live only in model/config.js.
export { ALT, MODES } from '../model/config.js?v=5bcbf32c';

/** Fastest the hull may be moving with the bag in the water, m/s. */
export const ANCHOR_MAX_DIP_MPS = 2;

/**
 * Phase durations in minutes, from the class configuration.
 * @param {object} cls resolved class
 * @param {object} mode one of MODES
 * @param {number} oneWayKm
 */
export function phaseDurations(cls, mode = MODES.balanced, oneWayKm = 15) {
  const kph = specNumber(cls, 'cruiseKph');
  const fill = specNumber(cls, 'fillRateM3s');
  const d = {};
  d.SOURCE_APPROACH = 3 * mode.fixed;
  d.HOSE_DEPLOY = specNumber(cls, 'hoseDeployMin') * mode.hose;
  d.WATER_FILL = cls.payloadTonnes / fill / 60;
  d.HOSE_RETRACT = specNumber(cls, 'hoseRetractMin') * mode.hose;
  d.DEPARTURE_CLIMB = (ALT.cruise - sourceAltM(cls)) / (2.5 * mode.climb) / 60;
  d.OUTBOUND_TRANSIT = (oneWayKm / (kph * mode.speed)) * 60;
  d.FIRE_APPROACH = 4 * mode.fixed;
  d.WATER_RELEASE = 2.5;
  d.BUOYANCY_ESCAPE = 2.5;
  d.RETURN_TRANSIT = (oneWayKm / (kph * mode.speed)) * 60;
  d.CONTROLLED_DESCENT = (ALT.cruise - sourceAltM(cls)) / (3.0 * mode.climb) / 60;
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
/**
 * The descent anchor's state at a given altitude — DERIVED, not drawn.
 *
 * The first version of this was a hand-authored curve against phase progress, and it was wrong in
 * the way hand-authored curves are wrong: it asked for a full cable at 1,500 m and 130 km/h, where
 * the water is 760 m past the end of the rope and the bag would be a sea anchor in the sky. What
 * the anchor does is not a function of how far through a phase the ship is. It is a function of
 * how far away the water is.
 *
 * So the cable pays out as the surface comes within reach of it, and the bag fills over the
 * stretch of descent below first contact. Both fall out of the altitude the ship is actually at,
 * which makes it impossible to ask for an anchor the ship could not have used. The winch sits on
 * the keel, one hull radius below the point `altitudeM` refers to, which is why that radius
 * appears here and is not a fudge factor.
 *
 * @param {object} cls        resolved class
 * @param {number} altitudeM  the hull's height above the water
 * @param {number} [full]     the fill this mission's descent needs, as a fraction of the bag
 */
export function anchorAt(cls, altitudeM, full = 1, groundSpeedMps = 0) {
  const cable = specNumber(cls, 'anchorCableM');
  if (cable <= 0) return { anchorProgress: 0, anchorFill: 0 };
  // NOT WHILE MOVING. A bag of several thousand tonnes dipped at 20 km/h is a bad time and at
  // 40 it is an unsurvivable one, so the cable does not leave the winch until the ship is
  // station-keeping. 2 m/s is 7 km/h — drift, not travel. The flight profile now brakes to a
  // stop before it descends into the band that needs the anchor (sim/state.js), so this gate
  // is a guard on the choreography rather than the thing that shapes it.
  if (groundSpeedMps > ANCHOR_MAX_DIP_MPS) return { anchorProgress: 0, anchorFill: 0 };
  // The PUBLISHED diameter, not the derived maxRadiusM: app/anchorview.js has to compute the
  // same altitude from the monitor's class record, and the monitor publishes a diameter. The two
  // differ by half a metre — enough to put the bag's fill a percent apart between the model and
  // the avatar, which anchor-parity.cases.js caught. The driver still uses the real keel height
  // for the geometry; this is the choreography, and it only has to agree with the other copy.
  const reachAlt = Math.max(0, cable - cls.nominalDiameterM / 2);   // altitude at first contact
  // Start lowering a quarter of a cable before it can touch, so the bag is ready when the ship
  // reaches the band it cannot hold itself in rather than being thrown after it.
  if (altitudeM > reachAlt + cable * 0.25) return { anchorProgress: 0, anchorFill: 0 };
  return {
    anchorProgress: 1,
    anchorFill: full * clamp01((reachAlt - altitudeM) / Math.max(1, cable * 0.14)),
  };
}

export function phaseShape(cls, phase, prog, opts = {}) {
  const p = clamp01(prog);
  const s = {};
  const mode = MODES[opts.modeId || 'balanced'];
  if (!mode) throw new Error(`unknown mission mode: ${opts.modeId}`);
  const cruise = specNumber(cls, 'cruiseKph') * mode.speed / 3.6;
  /* THE NITROGEN BANK IS A RESERVE, NOT A CONSUMABLE.
   *
   * `ln2Target` is the standing level the tanks sit at. `ln2Swing` is how much of that a
   * routine cycle actually moves — a few percent — because the tanks are sized by UNPOWERED
   * RECOVERY (1.55 payloads: enough nitrogen to sink a dead hull at ground level with no
   * rotors) and not by anything the delivery cycle does. A P-100 makes about 1.8 t on a return
   * leg against a 155 t bank.
   *
   * This used to drain 0.7 of the whole bank into the fill and refill it on the way home, which
   * was survivable while the tanks held 30 t and became nonsense when they were sized properly
   * on 2026-08-09: a filling P-100 took on 100 t of water while shedding 124 t of nitrogen, so
   * the ship got LIGHTER as it filled. The node suite caught it, which is what it is for.
   */
  const ln2Target = opts.ln2Target === undefined ? 0.8 : opts.ln2Target;
  const ln2Swing = opts.ln2Swing === undefined ? 0.05 : opts.ln2Swing;
  const ln2Low = Math.max(0, ln2Target - ln2Swing);

  switch (phase) {
    case 'SOURCE_APPROACH':
      s.altitudeM = lerp(sourceAltM(cls) + 150, sourceAltM(cls), smoothstep(p));
      s.overWater = true;
      Object.assign(s, anchorAt(cls, s.altitudeM,
        opts.anchorFull === undefined ? 1 : opts.anchorFull, s.airspeedMps || 0));
      s.airspeedMps = lerp(cruise * 0.35, 2, p);
      s.verticalSpeedMps = -2.0 * (1 - p);
      s.waterFraction = 0; s.ln2Fraction = ln2Target;
      // The hose stays stowed through the approach. The monitor pays it out here because its
      // six-phase cycle has no HOSE_DEPLOY; this cycle has one, lasting hoseDeployMin, and doing
      // both paid the hose out over the 3-minute approach and then snapped it back to stowed to
      // pay it out again. The monitor's overlap lives in adapter/fable.js, which is the only
      // place that knows it is looking at a host cycle.
      s.attitude = { rollRad: 0, pitchRad: -0.012, yawRad: 0 };
      break;
    case 'HOSE_DEPLOY':
      s.altitudeM = sourceAltM(cls); s.airspeedMps = 2; s.verticalSpeedMps = 0;
      s.overWater = true;
      Object.assign(s, anchorAt(cls, s.altitudeM,
        opts.anchorFull === undefined ? 1 : opts.anchorFull, s.airspeedMps || 0));
      s.waterFraction = 0; s.ln2Fraction = ln2Target;
      s.hoseProgress = smoothstep(p);
      break;
    case 'WATER_FILL':
      s.altitudeM = sourceAltM(cls); s.airspeedMps = 1.5; s.verticalSpeedMps = 0;
      // The bag is dumped as soon as the tanks hold more than the descent needed, and the empty
      // cable follows it up. Both finish well before the fill does, which is why neither costs
      // the cycle any time.
      s.overWater = true;
      s.anchorFill = 1 - clamp01(p / 0.30);
      s.anchorProgress = 1 - clamp01((p - 0.25) / 0.35);
      s.waterFraction = p;
      // Ballast given back as water comes aboard — a few percent of the bank, not the bank.
      s.ln2Fraction = lerp(ln2Target, ln2Low, p);
      s.hoseProgress = 1;
      break;
    case 'HOSE_RETRACT':
      s.altitudeM = sourceAltM(cls); s.airspeedMps = 2; s.verticalSpeedMps = 0;
      s.overWater = true;                          // still over the lake, anchor already stowed
      s.waterFraction = 1; s.ln2Fraction = ln2Low;
      // Drain first, then haul in. A hose full of water is tonnes hanging on the winch.
      s.hoseProgress = p < 0.35 ? 1 : 1 - smoothstep((p - 0.35) / 0.65);
      break;
    case 'DEPARTURE_CLIMB':
      s.altitudeM = lerp(sourceAltM(cls), ALT.cruise, smoothstep(p));
      s.airspeedMps = lerp(3, cruise * 0.7, p);
      s.verticalSpeedMps = 2.5 * Math.sin(Math.PI * p);
      s.waterFraction = 1; s.ln2Fraction = ln2Low;
      s.attitude = { rollRad: 0, pitchRad: 0.030 * Math.sin(Math.PI * p), yawRad: 0 };
      break;
    case 'OUTBOUND_TRANSIT':
      s.altitudeM = ALT.cruise; s.airspeedMps = cruise; s.verticalSpeedMps = 0;
      s.waterFraction = 1; s.ln2Fraction = ln2Low;
      // No hose here either, for the same reason and with a worse symptom: HOSE_RETRACT has
      // already wound it in and DEPARTURE_CLIMB has flown to 1,500 m, so re-running the
      // monitor's wind-up ramp hung 250 m of hose and a pump pod under a ship at transit
      // altitude for the first 1.8 minutes of the leg.
      break;
    case 'FIRE_APPROACH':
      s.altitudeM = lerp(ALT.cruise, ALT.drop, smoothstep(p));
      s.airspeedMps = lerp(cruise, cruise * 0.35, p);
      s.verticalSpeedMps = -3.0 * Math.sin(Math.PI * p);
      s.waterFraction = 1; s.ln2Fraction = ln2Low;
      s.attitude = { rollRad: 0, pitchRad: -0.025 * Math.sin(Math.PI * p), yawRad: 0 };
      break;
    case 'WATER_RELEASE':
      // Match the model's rise off the line during the final 15% of release.
      s.altitudeM = lerp(ALT.drop, ALT_DROP_TOP, Math.max(0, (p - 0.85) / 0.15));
      s.airspeedMps = cruise * 0.3;
      s.waterFraction = 1 - p;
      s.ln2Fraction = ln2Low;                         // the reserve rides along; only water leaves
      s.waterReleaseProgress = p;
      // The ship starts rising during the drop, not after it: mass is leaving continuously.
      s.verticalSpeedMps = 4.5 * p * p;
      break;
    case 'BUOYANCY_ESCAPE':
      s.altitudeM = lerp(ALT_DROP_TOP, ALT.cruise, smoothstep(p));
      s.airspeedMps = lerp(cruise * 0.3, cruise * 0.8, p);
      s.verticalSpeedMps = lerp(5.5, 1.5, p);
      s.waterFraction = 0; s.ln2Fraction = ln2Low;
      // NOSE UP, VISIBLY. This is the one moment in the cycle the hull is being thrown rather
      // than flown, and 2.6 degrees of pitch did not read as anything at all against an 876 m
      // body. 6 degrees at the moment of release, easing off as the climb is arrested — still
      // inside what a hull this size would do, and now legible.
      s.attitude = { rollRad: 0, pitchRad: 0.105 * Math.pow(1 - p, 0.7), yawRad: 0 };
      break;
    case 'RETURN_TRANSIT':
      s.altitudeM = ALT.cruise; s.airspeedMps = cruise * 0.9; s.verticalSpeedMps = 0;
      s.waterFraction = 0; s.ln2Fraction = lerp(ln2Low, ln2Target, p);   // the plant tops it back up
      break;
    case 'CONTROLLED_DESCENT': {
      // Brake first, then come down — the same order the monitor's own profile flies, and for
      // the same reason: the anchor cannot go in the water until the ship has stopped.
      const brake = smoothstep(Math.min(1, p / 0.40));
      const sink = smoothstep(Math.max(0, (p - 0.40) / 0.60));
      s.altitudeM = lerp(ALT.cruise, sourceAltM(cls), sink);
      s.airspeedMps = lerp(cruise * 0.9, 0, brake);
      s.verticalSpeedMps = -3.5 * Math.sin(Math.PI * sink);
      // THE ANCHOR'S PHASE. The hull comes down on rotors while the air is thin; the cable goes
      // out once the water is within reach AND the ship has stopped, the bag dips, fills, and is
      // winched clear. From there the lake does the holding and the rotors only trim. Derived
      // from the altitude and the speed the two lines above just set — in that order, because
      // reading them before they are written asks the anchor about the previous frame.
      s.overWater = true;
      Object.assign(s, anchorAt(cls, s.altitudeM,
        opts.anchorFull === undefined ? 1 : opts.anchorFull, s.airspeedMps));
      s.waterFraction = 0; s.ln2Fraction = ln2Target;
      s.attitude = { rollRad: 0, pitchRad: -0.020, yawRad: 0 };
      break;
    }

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
  s.pumpPodDepthM = s.hoseProgress * (opts.headM ?? sourceAltM(cls));

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
