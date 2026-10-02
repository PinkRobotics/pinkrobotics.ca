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
  DEFAULTS, CFG, setConfig, resetConfig, REFERENCE_CLASS,
  CLASSES, CLASS_ORDER, HULL_NAMES, MODES, ALT, ALT_DROP_TOP, VZ_MAX, PHASES, PHASE_TINT,
  TERRAIN_MSL, WORK_ALT_MSL, sourceAltM,
} from './config.js?v=762fdcfd';

export {
  ISA, RHO_SL_ISA, isaTemperatureK, isaPressurePa, densityRatio, airDensity, altitudeForDensity,
} from './atmosphere.js?v=762fdcfd';

export { SEED, setSeed, hashFrac } from './rng.js?v=762fdcfd';

export {
  R_EARTH, havKm, moveToward, bez, bezBearing, easeTrap, easeSm, lerpAng, trackBearing,
} from './geo.js?v=762fdcfd';

export { pumpMW, dragMW, diskMW, ledger } from './physics.js?v=762fdcfd';
export { planCycle } from './plan.js?v=762fdcfd';
export { findSource, intakePoint } from './water.js?v=762fdcfd';
export { CITIES } from './communities.js?v=762fdcfd';

export {
  insideFire, dropSeg, planTargets, tIdx, segAt, legKmFor, stationFor, deliveryPoint,
  arrivalCurve,
} from './targets.js?v=762fdcfd';

export { sizeTier, assign } from './assign.js?v=762fdcfd';
export {
  loadGuard, loadEvac, mergeEvac, liveEvac, dayKind, fireNumber, guardedFire, missionBlocked, keepOutsFor, pointBlocked,
  pathBlocked, noteKm,
} from './guard.js?v=762fdcfd';
export { fmt, fmtHa, fmtMin, fmtT } from './format.js?v=762fdcfd';
export { buildMission } from './mission.js?v=762fdcfd';
export { anchorHang, stateAt } from './state.js?v=762fdcfd';
export { narrate, srcName } from './narrate.js?v=762fdcfd';
export { selftest } from './selftest.js?v=762fdcfd';

export { ENERGY_NOTE, ENERGY_TAG } from './energy-label.js?v=762fdcfd';
