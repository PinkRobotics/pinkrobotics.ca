export { ANCHOR_DATUM, anchorGeometry } from './config.js?v=01e992e3';

export { sourceStations } from './water.js?v=01e992e3';

/* The simulation, as one import.
 *
 * WHAT THIS IS. A first-order model of a fleet of water-carrying airships working real
 * wildfires: how long a delivery cycle takes, how much water arrives, what that costs in
 * energy, and where a ship is at any moment of its cycle. Every number the site
 * publishes comes out of these files and nowhere else.
 *
 * WHAT IT IS NOT. It is not a design, and it is validated against no built vehicle,
 * because no such vehicle exists. It is arithmetic on stated assumptions. The assumptions
 * are all in `config.js`; the four relations everything rests on are in `physics.js`. If
 * a number here is wrong, it is wrong in a file you can read in an afternoon — which is
 * the entire reason the model is separated out like this.
 *
 * RULES THIS DIRECTORY KEEPS. No DOM, no network, no wall clock, no `location`, no
 * globals. Every function is a function of its arguments plus `CFG`. So the model runs
 * unchanged in a browser, in node and in a test, and any part of it can be executed
 * alone.
 *
 * WHERE TO START. `plan.js` for the published figures. `state.js` for what the ships are
 * doing. `config.js` for what we assumed.
 */

export {
  SOLAR_PROJECTED_FRACTION, capsuleFootprintM2, DEFAULTS, CFG, setConfig, resetConfig, REFERENCE_CLASS,
  CLASSES, CLASS_ORDER, HULL_NAMES, MODES, ALT, ALT_DROP_TOP, VZ_MAX, PHASES, PHASE_TINT,
  TERRAIN_MSL, WORK_ALT_MSL, sourceAltM,
} from './config.js?v=01e992e3';

export {
  ISA, RHO_SL_ISA, isaTemperatureK, isaPressurePa, densityRatio, airDensity, altitudeForDensity,
} from './atmosphere.js?v=01e992e3';

export { SEED, setSeed, hashFrac } from './rng.js?v=01e992e3';

export {
  R_EARTH, havKm, moveToward, bez, bezBearing, easeTrap, easeSm, lerpAng, trackBearing,
} from './geo.js?v=01e992e3';

export { pumpMW, dragMW, diskMW, ledger } from './physics.js?v=01e992e3';
export {
  BUS_CEILING, ROTOR_EFFICIENCY_VALUES, AERO_CL_MAX, AERO_CL_VALUES, AERO_SPAN_EFFICIENCY, VERTICAL_CD, FORCE_TOL, LIMIT_STEPS, HOTEL_FRAC, WINCH_IDLE_FRAC, HOIST_M, WINCH_ETA, WINCH_MPS,
  LETDOWN_FROM, VENT_APPROACH, PLAN_STEPS, LN2_RECOVERY_KWH_PER_T,
  inducedMW, rotorMaxTonnes, ventTph, regenMW, descentBusMW, cryoOnFrac, cycleGeometry,
  altAt, gsAt, loadAt, drawAt, integrateCycle, cycleLimits, aeroGeometry, rotorThrustLimitT,
} from './power.js?v=01e992e3';
export { planCycle } from './plan.js?v=01e992e3';
export { findSource, intakePoint } from './water.js?v=01e992e3';
export { CITIES } from './communities.js?v=01e992e3';

export {
  insideFire, dropSeg, planTargets, tIdx, segAt, legKmFor, stationFor, deliveryPoint,
  arrivalCurve,
} from './targets.js?v=01e992e3';

export { sizeTier, assign } from './assign.js?v=01e992e3';
export {
  loadGuard, loadEvac, mergeEvac, liveEvac, dayKind, fireNumber, guardedFire, missionBlocked, keepOutsFor, pointBlocked,
  pathBlocked, noteKm,
} from './guard.js?v=01e992e3';
export { fmt, fmtHa, fmtMin, fmtT } from './format.js?v=01e992e3';
export { buildMission } from './mission.js?v=01e992e3';
export { anchorHang, stateAt } from './state.js?v=01e992e3';
export { narrate, srcName } from './narrate.js?v=01e992e3';
export { selftest } from './selftest.js?v=01e992e3';

export { MODEL_STATUS, FEASIBILITY_SCOPE } from './energy-label.js?v=01e992e3';
export {energySummary,closureRequirements,ballastRequirement,cheapestFeasible,PROFILE_SEARCH,REQUIREMENT_UNIT,roundRequirement} from './requirements.js?v=01e992e3';

export {energyComparison,cycleEnergyText,feasibilityText} from './energy-view.js?v=01e992e3';

export {VERTICAL_PROFILE_GRID,verticalProfiles,profilePoint} from './profile.js?v=01e992e3';

export {selectServedPlan,bindServedMission,missionReady,auditServedPlan,modelIdentity,servedKey} from "./served-plan.js?v=01e992e3";
export {workedFigures,planStatusText} from "./served-view.js?v=01e992e3";

export {SERVED_RELATIVE_MARGIN,CONTROL_RELATIVE_MARGIN,OPERATING_MARGIN_LIMITS,instantOperatingMargins,hasOperatingMargin} from './operating-margin.js?v=01e992e3';

export {diagnosticNotes} from './energy-notes.js?v=01e992e3';
