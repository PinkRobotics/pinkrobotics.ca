/* The vehicle model — the public entry point.
 *
 * One import, no build step, no external asset:
 *
 *   import { mount } from '/3d/index.js';
 *   const v = mount(document.querySelector('#viewer'), {
 *     classId: 'P100', viewMode: 'cutaway-longitudinal', visualState: myState,
 *   });
 *   v.setProps({ visualState: nextState });
 *   v.dispose();
 *
 * The wildfire monitor should use `mountForMission()` instead, which takes the monitor's own
 * mission and state objects and does the translation. See README.md and adapter/fable.js.
 *
 * Everything below is re-exported so a host page can reach the model without reaching into the
 * file layout: the layout is free to change, this surface is not.
 */

export const VERSION = '1.0.0';

/* ---- the components ------------------------------------------------------------------------- */
export { createViewer, createViewer as AirshipModelViewer, autoQuality, prefersReducedMotion }
  from './scenes/viewer.js?v=331c3257';
export {
  AirshipCutaway, AirshipMissionCycle, AirshipControlAuthority, AirshipScaleComparison,
  AirshipFailureExplorer, AirshipTrajectoryExplorer, AirshipMapModel, AirshipStaticFigure,
  componentPanel,
} from './scenes/scenes.js?v=331c3257';
export { AirshipHUD } from './scenes/hud.js?v=331c3257';

/* ---- the model ------------------------------------------------------------------------------ */
export {
  resolveClass, classes, validateClass, CLASS_IDS, ASSUMPTIONS, setAssumptions,
  HULL_DEFAULT, profileR, sectionScale, hullVolume, radiusForVolume,
} from './model/config.js?v=331c3257';
export { build, buildAll, buildVacuumFill, instanceById, setInstance } from './model/build.js?v=331c3257';
export { buildMetadata, checkMetadata, MASS_SHARE } from './model/metadata.js?v=331c3257';
export { proxyField, dataField, proxyDeflection } from './model/density.js?v=331c3257';
export { buildLayout } from './model/layout.js?v=331c3257';
export { TIERS } from './model/structure.js?v=331c3257';

/* ---- state and physics ------------------------------------------------------------------------ */
export {
  defaultState, sanitizeState, validateState, lerpState, describeState,
  MISSION_PHASES, OFF_CYCLE_PHASES, ALL_PHASES, PHASE_LABELS, isAtSource, hoseIsOut,
} from './physics/state.js?v=331c3257';
export { massState, forceSet, aeroForce, inertia, angularAccelDegS2, RHO_LN2 } from './physics/mass.js?v=331c3257';
export { energyFlows, derivePower, ln2Ledger, pumpPowerMW, CRYO_SEQUENCE } from './physics/energy.js?v=331c3257';

/* ---- control ------------------------------------------------------------------------------------ */
export { buildActuators, idealDiscThrust, idealDiscPower, totalThrustN } from './control/actuators.js?v=331c3257';
export { allocate, clampToEnvelope, demoWrench, WRENCH_LABELS, solve6 } from './control/allocator.js?v=331c3257';

/* ---- animation ------------------------------------------------------------------------------------ */
export {
  demoState, phaseDurations, phaseTimeline, phaseAt, phaseShape, anchorAt, stepPhase, MODES, ALT,
} from './anim/mission.js?v=331c3257';
export { CLIPS, CLIP_BY_ID, CLIP_GROUPS, MASTER_SEQUENCE, resolveClip } from './anim/clips.js?v=331c3257';
export { createDriver, updateDriver, clearFailures, verticalDuty } from './anim/driver.js?v=331c3257';
export { createHose, updateHose, hoseCurve, podDepthM } from './anim/hose.js?v=331c3257';

/* ---- rendering ------------------------------------------------------------------------------------- */
export { VIEW_MODES, VIEW_LABELS, viewStyle, capGeom } from './render/views.js?v=331c3257';
export { PRESETS, PRESET_IDS, createCamera, goToPreset } from './render/camera.js?v=331c3257';
export { TOKENS, CATEGORY_TONE, CLAIM_TONE, MATERIALS, STATE_TONE } from './render/palette.js?v=331c3257';
export { staticFigureSVG, scaleComparisonSVG, FIGURE_VIEWS } from './render/svg.js?v=331c3257';
export { isWebGL2Available } from './render/gl.js?v=331c3257';
export { CSS as STYLES, injectStyles } from './render/styles.js?v=331c3257';
export { CATEGORIES } from './core/nodes.js?v=331c3257';

/* ---- integration -------------------------------------------------------------------------------------- */
export {
  fromMonitorState, adaptMission, adoptAssumptions, describeMapping, checkHostState,
  REQUIRED_HOST_FIELDS, CLASS_MAP,
} from './adapter/fable.js?v=331c3257';

import { createViewer } from './scenes/viewer.js?v=331c3257';
import { adaptMission, adoptAssumptions } from './adapter/fable.js?v=331c3257';
import { sanitizeState } from './physics/state.js?v=331c3257';

/**
 * Mount a viewer. The one call most hosts need.
 * @param {HTMLElement} container
 * @param {object} props Airship3DProps
 */
export function mount(container, props = {}) {
  return createViewer(container, props);
}

/**
 * Mount a viewer driven by the wildfire monitor's own mission state.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {object} opts.mission   the monitor's mission object (has `.cls`)
 * @param {function} opts.stateAt () => the monitor's current stateAt() result
 * @param {object} [opts.cfg]     the monitor's CFG, so assumptions stay shared
 * @param {object} [opts.props]   any Airship3DProps overrides
 * @returns a viewer handle with `.sync()` — call it whenever the monitor's state advances
 */
export function mountForMission(container, opts = {}) {
  if (opts.cfg) adoptAssumptions(opts.cfg);
  const first = adaptMission(opts.mission, opts.stateAt ? opts.stateAt() : null, opts.adapt || {});
  const v = createViewer(container, {
    classId: first.classId,
    visualState: first.state,
    viewMode: 'exterior',
    // The pod depth must reach the DRIVER, not just the adapter's pumpPodDepthM field: the hose
    // animation pays out to the driver's own headM, and without this the two disagreed and the
    // source-filling shot lost the pod off the bottom of the frame.
    //
    // It defaults to the class's REAL hose, because there is now a lake drawn under the ship and
    // a foreshortened hose is a pump hanging in mid-air above it. The monitor used to pass 45 m
    // to keep the spike inside a small panel; that was defensible while there was no water to
    // measure it against and is not any more.
    hoseDepthM: opts.adapt?.headM ?? first.cls.hoseLengthM,
    ...(opts.props || {}),
  });
  let lastClass = first.classId;
  return Object.assign(v, {
    /** Pull the monitor's current state and push it into the model. Cheap; call it per tick. */
    sync(mission = opts.mission, hostState = null) {
      const st = hostState || (opts.stateAt ? opts.stateAt() : null);
      const a = adaptMission(mission, st, { ...(opts.adapt || {}), layout: v.model && v.model.layout });
      const patch = { visualState: sanitizeState(a.state) };
      if (a.classId !== lastClass) { patch.classId = a.classId; lastClass = a.classId; }
      v.setProps(patch);
      return a;
    },
  });
}
