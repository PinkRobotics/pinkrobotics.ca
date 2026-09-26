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
} from './config.js?v=a67fca39';

export {
  ISA, RHO_SL_ISA, isaTemperatureK, isaPressurePa, densityRatio, airDensity, altitudeForDensity,
} from './atmosphere.js?v=a67fca39';

export { SEED, setSeed, hashFrac } from './rng.js?v=a67fca39';

export {
  R_EARTH, havKm, moveToward, bez, bezBearing, easeTrap, easeSm, lerpAng, trackBearing,
} from './geo.js?v=a67fca39';

export { pumpMW, dragMW, diskMW, ledger } from './physics.js?v=a67fca39';
export { planCycle } from './plan.js?v=a67fca39';
export { findSource, intakePoint } from './water.js?v=a67fca39';
export { CITIES } from './communities.js?v=a67fca39';

export {
  insideFire, dropSeg, planTargets, tIdx, segAt, legKmFor, stationFor, deliveryPoint,
  arrivalCurve,
} from './targets.js?v=a67fca39';

export { sizeTier, assign } from './assign.js?v=a67fca39';
export { fmt, fmtHa, fmtMin, fmtT } from './format.js?v=a67fca39';
export { buildMission } from './mission.js?v=a67fca39';
export { anchorHang, stateAt } from './state.js?v=a67fca39';
export { narrate, srcName } from './narrate.js?v=a67fca39';
export { selftest } from './selftest.js?v=a67fca39';
