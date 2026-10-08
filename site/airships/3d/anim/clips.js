/* Named clips.
 *
 * A clip is a named, reusable, state-driven sequence — NOT a baked cinematic. Each one is a
 * function from a normalised time to a patch: some combination of state fields, a camera preset,
 * a view mode, a demanded wrench and a failure list. The renderer, the driver and the allocator
 * do the rest. That is what lets the same clip be scrubbed, paused, stepped, reversed, driven by
 * page scroll, rendered to a static figure, or replaced by host state mid-play.
 *
 * If a clip needed to be re-authored to change the vehicle, it would be the wrong kind of object.
 */

import { MODES, phaseTimeline, phaseAt, demoState } from './mission.js?v=ceaf69ab';
import { sourceAltM } from '../model/config.js?v=ceaf69ab';
import { demoWrench } from '../control/allocator.js?v=ceaf69ab';
import { clamp01, lerp, smoothstep } from '../core/math.js?v=ceaf69ab';

/** Clip groups, in the order the lab lists them. */
export const CLIP_GROUPS = [
  ['inspection', 'Inspection and presentation'],
  ['motion', 'Ordinary vehicle motion'],
  ['source', 'Source and filling cycle'],
  ['delivery', 'Fire delivery cycle'],
  ['authority', 'Control-authority demonstrations'],
  ['failsafe', 'Fail-safe demonstrations'],
  ['containment', 'Failure containment'],
  ['fleet', 'Fleet logistics'],
];

const clip = (id, group, label, seconds, apply, extra = {}) =>
  ({ id, group, label, seconds, apply, loop: true, ...extra });

/** Position within one phase of the demo cycle, as a cycle fraction. */
function atPhase(cls, phaseId, prog, opts = {}) {
  const tl = opts.timeline || phaseTimeline(cls, MODES[opts.modeId || 'balanced'], opts.oneWayKm || 15);
  const b = tl.bounds.find((x) => x.id === phaseId) || tl.bounds[0];
  return b.start + (b.end - b.start) * clamp01(prog);
}

export const CLIPS = [
  /* --- 14.1 inspection and presentation ---------------------------------------------------- */
  clip('turntable_slow', 'inspection', 'Slow turntable', 48, (t) => ({
    camera: { orbit: t * Math.PI * 2 },
    viewMode: 'exterior',
  }), { reducedMotionStatic: true }),

  clip('exterior_to_ghost', 'inspection', 'Exterior to ghost', 5, (t) => ({
    viewMode: t < 0.5 ? 'exterior' : 'ghost',
    crossfade: smoothstep((t - 0.35) / 0.3),
    cameraPreset: 'three-quarter',
  })),

  clip('ghost_to_cutaway', 'inspection', 'Ghost to cutaway', 6, (t) => ({
    viewMode: t < 0.4 ? 'ghost' : 'cutaway-longitudinal',
    cutFrac: lerp(1, 0.5, smoothstep((t - 0.4) / 0.6)),
    cameraPreset: 'cutaway-long',
  })),

  clip('cutaway_sweep', 'inspection', 'Cutaway sweep', 14, (t) => ({
    viewMode: 'cutaway-transverse',
    cutFrac: 0.06 + 0.88 * (t < 0.5 ? t * 2 : 2 - t * 2),
    cameraPreset: 'cutaway-trans',
  })),

  clip('exploded_components', 'inspection', 'Exploded components', 8, (t) => ({
    viewMode: 'ghost',
    exploded: t < 0.5 ? smoothstep(t * 2) : smoothstep(2 - t * 2),
    cameraPreset: 'three-quarter',
  })),

  clip('structural_density_reveal', 'inspection', 'Structural density reveal', 10, (t) => ({
    viewMode: t < 0.25 ? 'lattice' : 'load-paths',
    densityReveal: smoothstep((t - 0.25) / 0.5),
    cameraPreset: 'side',
  })),

  clip('systems_sequence', 'inspection', 'Systems, one at a time', 28, (t) => {
    const order = ['structure', 'vacuum', 'water', 'cryogenic', 'power', 'propulsion',
      'control', 'sensors', 'compute', 'maintenance'];
    const i = Math.min(order.length - 1, Math.floor(t * order.length));
    return { viewMode: 'systems', systems: [order[i]], cameraPreset: 'three-quarter' };
  }),

  clip('scale_comparison', 'inspection', 'Scale comparison', 20, (t) => ({
    scene: 'scale', scaleFocus: t, cameraPreset: 'scale',
  })),

  /* --- 14.2 ordinary motion ------------------------------------------------------------------ */
  clip('idle_drift', 'motion', 'Idle drift', 24, (t, cls) => ({
    state: {
      phase: 'WEATHER_HOLD', phaseProgress: t, airspeedMps: 4,
      attitude: { rollRad: 0.004 * Math.sin(t * 6.28), pitchRad: 0.006 * Math.sin(t * 4.1), yawRad: 0.05 * Math.sin(t * 2.1) },
    },
    wrench: null, cls,
  })),

  clip('station_keep', 'motion', 'Station keeping', 16, (t, cls) => ({
    state: { phase: 'HOSE_DEPLOY', phaseProgress: t, altitudeM: sourceAltM(cls), airspeedMps: 2 },
    wrenchKind: 'lateral', wrenchScale: 0.25 * Math.sin(t * 6.28),
  })),

  clip('forward_cruise', 'motion', 'Forward cruise', 14, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'OUTBOUND_TRANSIT', t, o),
    wrenchKind: 'forward', wrenchScale: 0.4,
  })),

  clip('buoyant_climb', 'motion', 'Buoyant climb', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'BUOYANCY_ESCAPE', t, o),
    cameraPreset: 'escape-climb',
  })),

  clip('powered_descent', 'motion', 'Powered descent', 14, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'CONTROLLED_DESCENT', t, o),
    wrenchKind: 'down', wrenchScale: 0.7,
  })),

  clip('nose_down_descent', 'motion', 'Nose-down descent', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'CONTROLLED_DESCENT', t, o),
    state: { attitude: { rollRad: 0, pitchRad: -0.06 * Math.sin(Math.PI * t), yawRad: 0 } },
    wrenchKind: 'down', wrenchScale: 0.5,
  })),

  clip('lateral_translation', 'motion', 'Lateral translation', 12, (t) => ({
    wrenchKind: 'lateral', wrenchScale: Math.sin(t * 6.283),
    cameraPreset: 'nose',
  })),

  clip('controlled_yaw', 'motion', 'Controlled yaw', 16, (t) => ({
    wrenchKind: 'yaw', wrenchScale: Math.sin(t * 6.283),
    state: { attitude: { rollRad: 0, pitchRad: 0, yawRad: 0.30 * -Math.cos(t * 6.283) + 0.30 } },
    cameraPreset: 'top',
  })),

  clip('altitude_layer_transition', 'motion', 'Altitude layer transition', 18, (t) => ({
    state: {
      phase: 'OUTBOUND_TRANSIT', phaseProgress: t,
      altitudeM: lerp(900, 2400, smoothstep(t < 0.5 ? t * 2 : 2 - 2 * t)),
      verticalSpeedMps: (t < 0.5 ? 2.4 : -2.4) * Math.sin(Math.PI * (t * 2 % 1)),
    },
    scene: 'trajectory',
  })),

  /* --- 14.3 source and filling --------------------------------------------------------------- */
  clip('source_approach', 'source', 'Source approach', 10, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'SOURCE_APPROACH', t, o), cameraPreset: 'source-filling',
  })),
  clip('hover_over_source', 'source', 'Hover over source', 10, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'HOSE_DEPLOY', t * 0.15, o), cameraPreset: 'source-filling',
  })),
  clip('hose_deploy', 'source', 'Hose deploy', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'HOSE_DEPLOY', t, o), cameraPreset: 'pumpbay',
  })),
  clip('pump_pod_submerge', 'source', 'Pump pod submerges', 8, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'HOSE_DEPLOY', 0.7 + 0.3 * t, o), cameraPreset: 'pumpbay',
  })),
  clip('water_fill', 'source', 'Water fill', 24, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'WATER_FILL', t, o), cameraPreset: 'water', viewMode: 'mass',
  })),
  clip('vehicle_mass_increase', 'source', 'Mass increase during fill', 18, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'WATER_FILL', t, o), viewMode: 'mass', showForces: true,
  })),
  clip('natural_descent_during_fill', 'source', 'Natural descent during fill', 18, (t, cls) => ({
    cyclePos: (cls, o) => atPhase(cls, 'WATER_FILL', t, o),
    state: { altitudeM: lerp(sourceAltM(cls) + 40, sourceAltM(cls), t), verticalSpeedMps: -0.35 },
    showForces: true,
  })),
  clip('hose_drain', 'source', 'Hose drain', 8, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'HOSE_RETRACT', t * 0.35, o), cameraPreset: 'pumpbay',
  })),
  clip('hose_retract', 'source', 'Hose retract', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'HOSE_RETRACT', t, o), cameraPreset: 'pumpbay',
  })),
  clip('departure_climb', 'source', 'Departure climb', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'DEPARTURE_CLIMB', t, o),
  })),

  /* --- 14.4 fire delivery -------------------------------------------------------------------- */
  clip('fire_approach', 'delivery', 'Fire approach', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'FIRE_APPROACH', t, o), cameraPreset: 'fire-approach',
  })),
  clip('drop_alignment', 'delivery', 'Drop alignment', 8, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'FIRE_APPROACH', 0.8 + 0.2 * t, o),
    wrenchKind: 'lateral', wrenchScale: 0.3 * Math.sin(t * 6.28),
  })),
  clip('distributed_water_release', 'delivery', 'Distributed water release', 10, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'WATER_RELEASE', t, o),
    cameraPreset: 'underside', showForces: true,
  })),
  clip('mass_step_change', 'delivery', 'Mass step change', 10, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'WATER_RELEASE', t, o), viewMode: 'mass', showForces: true,
  })),
  clip('buoyancy_escape', 'delivery', 'Buoyancy escape', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'BUOYANCY_ESCAPE', t, o),
    cameraPreset: 'escape-climb', showForces: true,
  })),
  clip('transition_to_return', 'delivery', 'Transition to return', 8, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'RETURN_TRANSIT', t * 0.12, o),
  })),
  clip('cryo_charge_during_return', 'delivery', 'Cryogenic charging on the return', 22, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'RETURN_TRANSIT', t, o),
    viewMode: 'energy', cameraPreset: 'cryo',
  })),
  clip('controlled_descent_to_source', 'delivery', 'Controlled descent to the source', 14, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'CONTROLLED_DESCENT', t, o),
  })),

  /* --- 14.5 control authority ----------------------------------------------------------------- */
  clip('gust_rejection', 'authority', 'Gust rejection', 10, (t) => ({
    wrenchKind: 'gust', wrenchScale: t < 0.15 ? t / 0.15 : Math.exp(-(t - 0.15) * 4),
    showForces: true, cameraPreset: 'nose',
  })),
  clip('crosswind_station_keep', 'authority', 'Crosswind station keeping', 18, (t) => ({
    wrenchKind: 'lateral', wrenchScale: 0.45 + 0.25 * Math.sin(t * 12.6),
    wind: [0, -9, 0], showForces: true,
  })),
  clip('emergency_yaw_arrest', 'authority', 'Emergency yaw arrest', 14, (t) => ({
    wrenchKind: 'yaw', wrenchScale: t < 0.2 ? -1 : -Math.exp(-(t - 0.2) * 3.2),
    state: { attitude: { rollRad: 0, pitchRad: 0, yawRad: 0.18 * (1 - Math.exp(-t * 3)) } },
    showForces: true, cameraPreset: 'top',
  })),
  clip('maximum_lateral_translation', 'authority', 'Maximum lateral translation', 10, () => ({
    wrenchKind: 'lateral', wrenchScale: 1, showForces: true, cameraPreset: 'nose',
  })),
  clip('maximum_downforce', 'authority', 'Maximum downforce', 10, () => ({
    wrenchKind: 'down', wrenchScale: 1, showForces: true, cameraPreset: 'side',
  })),
  clip('rapid_escape_climb', 'authority', 'Rapid escape climb', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'BUOYANCY_ESCAPE', t, o),
    wrenchKind: 'up', wrenchScale: 0.8, showForces: true,
  })),
  clip('rotor_failure_reallocation', 'authority', 'Rotor failure reallocation', 16, (t) => ({
    wrenchKind: 'up', wrenchScale: 0.6,
    failed: t > 0.35 ? ['PrimaryRotorStation_00'] : [],
    showForces: true, viewMode: 'failure',
  })),
  clip('bus_failure_reconfiguration', 'authority', 'Bus failure reconfiguration', 14, (t) => ({
    failed: t > 0.35 ? ['HVDCBus_00', 'Generator_00'] : [],
    viewMode: 'energy',
  })),

  /* --- 14.6 fail-safe -------------------------------------------------------------------------- */
  clip('safe_drift', 'failsafe', 'Safe drift on minimal power', 30, (t) => ({
    state: {
      phase: 'SAFE_DRIFT', phaseProgress: t,
      altitudeM: lerp(1500, 2100, smoothstep(Math.min(1, t * 1.6))),
      verticalSpeedMps: 0.6 * (1 - smoothstep(Math.min(1, t * 1.6))),
      ln2Fraction: 0.2, waterFraction: 0, batteryStateOfCharge: 0.18 + 0.12 * t,
      propulsionPowerMW: 0.02, activeWarnings: ['Mission abandoned', 'Minimal power'],
    },
    wrench: null, viewMode: 'failure', showForces: true,
    note: 'Rotors feathered. Only deterministic safety, communication and energy management run. ' +
      'The vehicle follows its actual mass and buoyancy state and weathervanes rather than ' +
      'fighting the wind. Solar keeps a trickle of charge going.',
  })),
  clip('total_power_loss', 'failsafe', 'Total power loss', 30, (t) => ({
    state: {
      phase: 'TOTAL_POWER_LOSS', phaseProgress: t,
      altitudeM: 1500 + 40 * Math.sin(t * 3),
      verticalSpeedMps: 0.2, waterFraction: 0, ln2Fraction: 0.2,
      batteryStateOfCharge: 0, solarPowerMW: 0, generatorPowerMW: 0, propulsionPowerMW: 0,
      activeWarnings: ['No power', 'No active control'],
    },
    wrench: null, viewMode: 'failure', showForces: true, allActuatorsOff: true,
    note: 'No rotor or fan command at all. Passive aerodynamic stability only; control surfaces ' +
      'sit where they fail to. There is no magical solar orientation and no active climb unless ' +
      'the vehicle actually is positively buoyant. What happens next depends on the mass state ' +
      'and the weather.',
  })),

  /* --- 14.7 failure containment ------------------------------------------------------------------ */
  clip('single_cell_vacuum_loss', 'containment', 'Single cell loses vacuum', 14, (t) => ({
    viewMode: 'lattice',
    cellFailure: t > 0.2 ? { index: 3, progress: clamp01((t - 0.2) / 0.4) } : null,
    cameraPreset: 'cutaway-long',
    note: 'One representative cell loses vacuum and stops contributing lift. Nearby load paths ' +
      'highlight. Nothing implodes. Graceful containment is a design objective here, not ' +
      'demonstrated performance.',
  })),
  clip('local_module_damage', 'containment', 'Local module damage', 14, (t) => ({
    viewMode: 'load-paths',
    damage: t > 0.25 ? [{ t: 0.62, theta: Math.PI * 0.3, radiusFrac: 0.22,
      progress: clamp01((t - 0.25) / 0.35) }] : null,
    cameraPreset: 'side',
  })),
  clip('alternate_load_path', 'containment', 'Alternate load path', 14, (t) => ({
    viewMode: 'load-paths',
    damage: [{ t: 0.62, theta: Math.PI * 0.3, radiusFrac: 0.22, progress: 1 }],
    highlightRerouted: smoothstep(t),
    cameraPreset: 'side',
  })),
  clip('sensor_disagreement', 'containment', 'Sensor disagreement', 12, (t) => ({
    viewMode: 'systems', systems: ['sensors', 'compute'],
    failed: t > 0.3 ? ['SensorCluster_PortQtr'] : [],
    cameraPreset: 'mind',
    note: 'Two sensors disagree. The deterministic safety kernel does not decide which is right; ' +
      'it restricts the envelope until the disagreement resolves.',
  })),
  clip('pump_pod_emergency_release', 'containment', 'Pump-pod emergency release', 12, (t) => ({
    cyclePos: (cls, o) => atPhase(cls, 'WATER_FILL', 0.4, o),
    failed: t > 0.3 ? ['PumpPod_00'] : [],
    cameraPreset: 'pumpbay', showForces: true,
  })),

  /* --- 14.8 fleet logistics ------------------------------------------------------------------------ */
  clip('tanker_approach', 'fleet', 'Tanker approach', 16, (t) => ({
    state: { phase: 'TANKER_REFUEL', phaseProgress: t * 0.3 }, scene: 'tanker',
  })),
  clip('cooperative_rendezvous', 'fleet', 'Cooperative rendezvous', 14, (t) => ({
    state: { phase: 'TANKER_REFUEL', phaseProgress: 0.3 + t * 0.2 }, scene: 'tanker',
  })),
  clip('liquid_fuel_transfer', 'fleet', 'Liquid fuel transfer', 18, (t) => ({
    state: { phase: 'TANKER_REFUEL', phaseProgress: 0.5 + t * 0.35, fuelFraction: 0.25 + 0.7 * t },
    scene: 'tanker', viewMode: 'mass',
  })),
  clip('spare_pump_pod_transfer', 'fleet', 'Spare pump-pod transfer', 14, (t) => ({
    state: { phase: 'TANKER_REFUEL', phaseProgress: 0.5 + t * 0.35 }, scene: 'tanker',
  })),
  clip('tanker_departure', 'fleet', 'Tanker departure', 12, (t) => ({
    state: { phase: 'TANKER_REFUEL', phaseProgress: 0.85 + t * 0.15 }, scene: 'tanker',
  })),
];

export const CLIP_BY_ID = new Map(CLIPS.map((c) => [c.id, c]));

/** The full master mission sequence — the one polished, scrubbable, loopable cycle. */
export const MASTER_SEQUENCE = {
  id: 'mission_cycle',
  label: 'Full mission cycle',
  seconds: 90,
  loop: true,
  apply: (t) => ({ cyclePos: () => t, scene: 'mission' }),
};

/**
 * Resolve a clip at time t into a concrete instruction set.
 * @returns {{state, viewMode, cameraPreset, wrench, failed, ...}}
 */
export function resolveClip(clipId, t, cls, opts = {}) {
  const c = clipId === MASTER_SEQUENCE.id ? MASTER_SEQUENCE : CLIP_BY_ID.get(clipId);
  if (!c) return null;
  const out = c.apply(clamp01(t), cls, opts) || {};
  const res = { clip: c, ...out };

  if (out.cyclePos) {
    const u = out.cyclePos(cls, opts);
    const d = demoState(cls, u, opts);
    res.state = { ...d.state, ...(out.state || {}) };
    res.mass = d.mass;
    res.timeline = d.timeline;
    res.cyclePosition = u;
  } else if (out.state) {
    const d = demoState(cls, 0, opts);
    res.state = { ...d.state, ...out.state };
    res.mass = d.mass;
    res.timeline = d.timeline;
  }

  if (out.wrenchKind) {
    const massKg = ((res.mass && res.mass.totalTonnes) ||
      (cls.structureAllowanceTonnes + cls.payloadTonnes)) * 1000;
    const base = demoWrench(out.wrenchKind, cls, massKg);
    const k = out.wrenchScale === undefined ? 1 : out.wrenchScale;
    res.wrench = base.map((v) => v * k);
  }
  return res;
}

void phaseAt;
