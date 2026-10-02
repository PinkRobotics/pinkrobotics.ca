/* AirshipHUD — the compact panel view, for the wildfire monitor's cockpit.
 *
 * A DROP-IN REPLACEMENT for the `#shipviz` schematic on /airships. It keeps that element's id,
 * class and CSS box, and it exposes the same `draw(hostState, mission)` call the monitor's frame
 * loop already makes, so adopting it is one line:
 *
 *     const shipViz = AirshipHUD(document.getElementById('shipviz'));
 *     // …unchanged: shipViz.draw(st, m);
 *
 * WHAT "SIMPLIFIED" MEANS HERE, and why each choice is what it is:
 *
 *   - EXTERIOR ONLY. A 300 px panel cannot show a lattice; at that size the cutaway is grey mush.
 *     The interior belongs in the explanatory viewers, which have room for it.
 *   - LOW DETAIL TIER. 50 draw calls and 86,584 triangles a frame in a 300 x 150 panel, measured
 *     on a P-100. The interior is BUILT and not drawn: tier 1 constructs 96,140 triangles and the
 *     exterior view hides the ones it does not need. Nothing here skips geometry construction.
 *   - NO RENDER LOOP OF ITS OWN. The monitor already runs a frame loop for the map; this renders
 *     synchronously from `draw()`. Two loops on one page is two lots of scheduling for one screen.
 *   - PAUSES WHEN HIDDEN. The panel is `hidden` until a ship is selected, and a hidden element has
 *     no box, so the viewer's IntersectionObserver stops it. `draw()` also no-ops when unmounted.
 *   - FALLS BACK. The monitor page already holds a large map canvas; if a WebGL context cannot be
 *     had, this shows the static SVG silhouette instead of an empty box.
 *
 * The force vectors are the ones the placeholder's aria-label promises — buoyancy up, weight down,
 * net force, aerodynamic force — drawn from the monitor's own buoyN/weightN.
 */

import { createViewer, prefersReducedMotion } from './viewer.js?v=331c3257';
import { adaptMission, adoptAssumptions } from '../adapter/fable.js?v=331c3257';
import { staticFigureSVG } from '../render/svg.js?v=331c3257';
import { build } from '../model/build.js?v=331c3257';
import { orbit, dolly } from '../render/camera.js?v=331c3257';
import { injectStyles } from '../render/styles.js?v=331c3257';
import { describeState } from '../physics/state.js?v=331c3257';

/** Seconds of no interaction before the slow turntable resumes after a drag. */
const RESUME_AFTER = 4;
/** Radians per second of idle rotation. Slow: this is an 800 m machine, not a spinning logo. */
const SPIN_RATE = 0.12;

/**
 * @param {HTMLElement} el      the existing `#shipviz` canvas, or any container
 * @param {object} [props]      { classId, quality, spin, showForces, cfg, reducedMotion }
 * @returns {{ draw, sync, viewer, element, dispose }}
 */
export function AirshipHUD(el, props = {}) {
  if (!el) return { draw() {}, sync() {}, viewer: null, element: null, dispose() {} };
  injectStyles();
  if (props.cfg) adoptAssumptions(props.cfg);

  // Take over the placeholder's box: same id, same class, same CSS. The viewer builds its own
  // canvas inside, so a <canvas> placeholder is swapped for a <div> that keeps its identity.
  let host = el;
  if (el.tagName === 'CANVAS') {
    host = document.createElement('div');
    host.id = el.id;
    host.className = el.className;
    if (el.getAttribute('aria-label')) host.dataset.label = el.getAttribute('aria-label');
    el.parentNode.insertBefore(host, el);
    el.remove();
  }
  // The cockpit panel already draws its own border and background; a second one inside it reads
  // as a box in a box.
  host.style.border = '0';
  host.style.background = 'transparent';
  host.style.borderRadius = '0';
  host.style.minHeight = '0';

  const reduced = props.reducedMotion !== undefined ? props.reducedMotion : prefersReducedMotion();
  let classId = props.classId || 'P100';
  let spin = props.spin !== false && !reduced;
  let sinceInput = RESUME_AFTER;
  let lastT = 0;
  let disposed = false;
  let ok = true;

  let viewer = null;
  try {
    viewer = createViewer(host, {
      classId,
      quality: props.quality || 'low',
      viewMode: 'exterior',
      // The light shell is on here by default: at 300 px a bare solid hull is a dark blob, and the
      // meridians and station rings are what make it read as a machine rather than a shape.
      shellWire: props.shellWire !== false,
      showForces: props.showForces !== false,
      interactive: true,
      reducedMotion: reduced,
    });
    ok = viewer.available;
  } catch (e) {
    ok = false;
  }

  if (!ok) {
    // No context to be had — the map canvas may already hold the budget. Show the silhouette.
    host.innerHTML = staticFigureSVG(build(classId, { tier: 0 }), {
      view: 'three-quarter', mode: 'exterior', width: 340, height: 280,
      background: 'transparent',
    });
  } else {
    // Any interaction pauses the turntable; it resumes once the panel is left alone.
    for (const ev of ['pointerdown', 'wheel', 'keydown']) {
      viewer.canvas.addEventListener(ev, () => { sinceInput = 0; }, { passive: true });
    }
    viewer.goToPreset('three-quarter');
    // Pull back a little: the force overlay reaches about a third of the hull length above the
    // ship, and the default framing is for a viewer with no arrows in it.
    dolly(viewer.camera, 1.2);
  }

  /** Point the model at a class without rebuilding when it has not changed. */
  function setClass(id) {
    if (!ok || !id || id === classId) return;
    classId = id;
    viewer.setProps({ classId });
  }

  /**
   * Drive the panel. Signature matches the placeholder it replaces: (state, mission).
   * Both orders are accepted, because getting them the wrong way round is otherwise a silent
   * blank panel rather than an error.
   */
  function draw(a, b) {
    if (disposed || !ok) return;
    const hostState = a && a.phase !== undefined ? a : b;
    const mission = a && a.cls ? a : b;
    if (!hostState || !mission || mission.idle) return;

    const adapted = adaptMission(mission, hostState, { layout: viewer.model && viewer.model.layout });
    setClass(adapted.classId);
    viewer.setProps({ visualState: adapted.state });

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = lastT ? Math.min(0.1, now - lastT) : 1 / 60;
    lastT = now;
    sinceInput += dt;
    if (spin && sinceInput >= RESUME_AFTER) orbit(viewer.camera, SPIN_RATE * dt, 0);
    viewer.tick(dt);
  }

  return {
    draw,
    /** Alias, for hosts that prefer the adapter's vocabulary. */
    sync: (mission, hostState) => draw(hostState, mission),
    setClass,
    get viewer() { return viewer; },
    get available() { return ok; },
    element: host,
    /** The text a screen reader gets, if the host wants to mirror it into its own live region. */
    describe: () => (ok && viewer.model
      ? describeState(viewer.getState().visualState, viewer.model.cls) : ''),
    set spin(v) { spin = v && !reduced; },
    get spin() { return spin; },
    dispose() {
      disposed = true;
      if (viewer) viewer.dispose();
    },
  };
}
