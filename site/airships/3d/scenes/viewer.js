/* AirshipModelViewer — the reusable viewer component.
 *
 * Mounts into a container, owns one canvas and one render loop, and is driven entirely by props.
 * It holds no mission state: `visualState` comes in from outside every frame it changes.
 *
 * THINGS THAT ARE DELIBERATELY IN THE DOM AND NOT IN THE CANVAS: the caption, the legend, the
 * component list, the info panel, the state summary, every label. The canvas is supplementary.
 * Everything it shows is available as text to a screen reader, to a printer, and to a viewer with
 * WebGL disabled — which is also the fallback path.
 *
 * THE LOOP RUNS ONLY WHEN IT HAS TO. Offscreen, hidden tab, or a static view with no animation
 * and no camera transition: no frames. That matters because these viewers are meant to sit
 * several-to-a-page on an explanatory article.
 */

import { build, buildVacuumFill } from '../model/build.js?v=ceaf69ab';
import { hullR } from '../model/config.js?v=ceaf69ab';
import { createRenderer, isWebGL2Available } from '../render/gl.js?v=ceaf69ab';
import {
  createCamera, orbit, dolly, pan, goToPreset, updateCamera, frameAll, avoidInterior,
  PRESETS, PRESET_IDS, viewMatrix, projMatrix, cameraEye,
} from '../render/camera.js?v=ceaf69ab';
import { viewStyle, VIEW_MODES, VIEW_LABELS } from '../render/views.js?v=ceaf69ab';
import { CATEGORY_TONE, CLAIM_TONE, TOKENS, STATE_TONE } from '../render/palette.js?v=ceaf69ab';
import { createDriver, updateDriver, clearFailures } from '../anim/driver.js?v=ceaf69ab';
import { buildActuators } from '../control/actuators.js?v=ceaf69ab';
import { allocate } from '../control/allocator.js?v=ceaf69ab';
import { defaultState, sanitizeState, describeState, PHASE_LABELS } from '../physics/state.js?v=ceaf69ab';
import { massState, forceSet, angularAccelDegS2 } from '../physics/mass.js?v=ceaf69ab';
import { energyFlows } from '../physics/energy.js?v=ceaf69ab';
import { node, addChild, walk } from '../core/nodes.js?v=ceaf69ab';
import { cylGeom, latheGeom, mergeSolids, lines, pathSegs } from '../model/geom.js?v=ceaf69ab';
import { m4compose, m4mul, clamp, clamp01, len, norm, mul, add, sub } from '../core/math.js?v=ceaf69ab';
import { staticFigureSVG } from '../render/svg.js?v=ceaf69ab';
import { injectStyles } from '../render/styles.js?v=ceaf69ab';

const QUALITY_TIER = { low: 1, medium: 2, high: 3 };

/** Pick a detail tier from the device, unless the caller pinned one. */
export function autoQuality() {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;
  if (cores <= 4 || mem <= 2 || small) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

/**
 * @param {HTMLElement} container
 * @param {object} props Airship3DProps
 */
export function createViewer(container, props = {}) {
  const state = {
    classId: props.classId || 'P100',
    quality: props.quality || 'auto',
    viewMode: props.viewMode || 'exterior',
    interactive: props.interactive !== false,
    showLabels: !!props.showLabels,
    showForces: !!props.showForces,
    showEnergyFlow: !!props.showEnergyFlow,
    showScale: !!props.showScale,
    selectedComponentId: props.selectedComponentId || null,
    isolate: null,
    reducedMotion: props.reducedMotion !== undefined ? props.reducedMotion : prefersReducedMotion(),
    visualState: sanitizeState(props.visualState || defaultState()),
    cutFrac: 0.5,
    systems: null,
    wrench: null,
    env: {},
    showCells: true,
    shellWire: props.shellWire !== undefined ? props.shellWire : false,
    // Full pod depth in metres. The monitor passes its displayed 45 m through mountForMission;
    // the standalone default is the pumping-head assumption. This must reach the DRIVER (the
    // hose pays out to it) and the source-filling camera preset (which frames for it).
    hoseDepthM: props.hoseDepthM,
  };

  /* ---- DOM ------------------------------------------------------------------------------------ */
  injectStyles();
  container.classList.add('a3d');
  container.innerHTML = '';
  const canvas = el('canvas', 'a3d-canvas');
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = state.interactive ? 0 : -1;
  const overlay = el('div', 'a3d-overlay');
  const caption = el('div', 'a3d-caption');
  const legend = el('div', 'a3d-legend');
  const labels = el('div', 'a3d-labels');
  const live = el('div', 'a3d-live');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');
  const fallback = el('div', 'a3d-fallback');
  fallback.hidden = true;
  container.append(canvas, overlay, fallback);
  overlay.append(labels, legend, caption, live);

  /* ---- model --------------------------------------------------------------------------------- */
  let b = null, driver = null, actuators = null, cam = null, renderer = null;
  let ok = false;
  let capNode = null;
  let overlayRoot = null;
  const listeners = { select: props.onComponentSelect || null, ready: props.onReady || null };

  function tierFor(q) {
    const eff = q === 'auto' ? autoQuality() : q;
    return QUALITY_TIER[eff] === undefined ? 2 : QUALITY_TIER[eff];
  }

  function buildModel() {
    const tier = tierFor(state.quality);
    b = build(state.classId, { tier });
    actuators = buildActuators(b.cls, b.layout);
    driver = createDriver(b, { reduced: state.reducedMotion, headM: state.hoseDepthM });
    overlayRoot = node({ id: 'Overlays', category: 'structure', selectable: false });
    addChild(b.root, overlayRoot);
    if (state.viewMode === 'vacuum') ensureVacuumFill();
    const radius = Math.max(b.cls.lengthM, b.cls.diameterM) * 0.55;
    const keepCam = cam;
    cam = createCamera({ radius });
    if (keepCam) {
      cam.azimuth = keepCam.azimuth;
      cam.elevation = keepCam.elevation;
      cam.distance = radius * (keepCam.distance / keepCam.radius);
    }
    renderLegend();
    renderCaption();
    dirty = true;
  }

  /**
   * The full vacuum fill is built LAZILY on first entry to the 'vacuum' view: a few thousand
   * placement tests against every layout obstacle are cheap, but not so cheap that every viewer
   * on an article page should pay for them at mount.
   */
  function ensureVacuumFill() {
    // Retired (operator, 08-13): the vacuum view draws VacuumVoid — one black
    // volume built with the model — so the lazy ball field never builds.
    return;
    // eslint-disable-next-line no-unreachable
    if (!b || b.index.get('VacuumFillBalls')) return;
    const n = buildVacuumFill(b, { tier: tierFor(state.quality) });
    addChild(b.root, n);
    b.index.set(n.id, n);
    if (typeof console !== 'undefined') {
      console.info(`airship3d: vacuum fill for ${b.cls.id}: ${n.vacuumFill.count} cells, ` +
        `r=${n.vacuumFill.radiusM.toFixed(2)} m, pitch=${n.vacuumFill.pitchM.toFixed(2)} m`);
    }
  }

  /** Viewport aspect for camera fitting — the fit should use the space that is really there. */
  function viewportAspect() {
    const rect = container.getBoundingClientRect();
    return rect.height > 4 ? clamp(rect.width / rect.height, 0.7, 2.4) : 1.6;
  }

  function presetOpts(extra = {}) {
    return {
      immediate: state.reducedMotion,
      layout: b ? b.layout : null,
      aspect: viewportAspect(),
      hoseDepthM: state.hoseDepthM,
      ...extra,
    };
  }

  function init() {
    if (!isWebGL2Available()) {
      showFallback('WebGL 2 is not available in this browser.');
      return;
    }
    renderer = createRenderer(canvas, {
      maxPixelRatio: state.reducedMotion ? 1.5 : 2,
      onContextLost: () => showFallback('The 3D context was lost. Reload to restore it.'),
    });
    if (!renderer) { showFallback('WebGL 2 could not be initialised.'); return; }
    buildModel();
    ok = true;
    if (listeners.ready) listeners.ready();
  }

  function showFallback(reason) {
    ok = false;
    canvas.style.display = 'none';
    fallback.hidden = false;
    try {
      const bb = b || build(state.classId, { tier: 1 });
      fallback.innerHTML = staticFigureSVG(bb, {
        view: 'three-quarter', mode: state.viewMode === 'exterior' ? 'exterior' : 'wire',
        width: 880, height: 380,
      });
    } catch (e) {
      fallback.textContent = '';
    }
    const p = el('p', 'a3d-fallback-note');
    p.textContent = `${reason} A static line figure is shown instead; all the information in the ` +
      'viewer is available in the component list and the state summary below.';
    fallback.append(p);
  }

  /* ---- interaction ----------------------------------------------------------------------------- */
  let drag = null, pinch = null;
  let dirty = true;

  function onPointerDown(e) {
    if (!state.interactive || !ok) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, button: e.button, moved: 0, id: e.pointerId };
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    const rect = canvas.getBoundingClientRect();
    if (drag.button === 2 || e.shiftKey) pan(cam, dx, dy, rect.height);
    else orbit(cam, -dx * 0.006, dy * 0.006);
    dirty = true;
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const wasClick = drag.moved < 5;
    const sx = e.clientX, sy = e.clientY;
    drag = null;
    if (wasClick && ok) {
      const rect = canvas.getBoundingClientRect();
      const id = renderer.pick(sceneDesc(), sx - rect.left, sy - rect.top);
      selectComponent(id);
    }
  }
  function onWheel(e) {
    if (!state.interactive || !ok) return;
    e.preventDefault();
    dolly(cam, Math.exp(e.deltaY * 0.0012));
    dirty = true;
  }
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinch = touchDist(e);
    }
  }
  function onTouchMove(e) {
    if (e.touches.length === 2 && pinch) {
      e.preventDefault();
      const d = touchDist(e);
      dolly(cam, pinch / Math.max(1, d));
      pinch = d;
      dirty = true;
    }
  }
  function onTouchEnd() { pinch = null; }
  const touchDist = (e) => Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY);

  function onKey(e) {
    if (!state.interactive || !ok) return;
    const step = e.shiftKey ? 0.16 : 0.06;
    let used = true;
    switch (e.key) {
      case 'ArrowLeft': orbit(cam, -step, 0); break;
      case 'ArrowRight': orbit(cam, step, 0); break;
      case 'ArrowUp': orbit(cam, 0, step); break;
      case 'ArrowDown': orbit(cam, 0, -step); break;
      case '+': case '=': dolly(cam, 0.88); break;
      case '-': case '_': dolly(cam, 1.14); break;
      case '0': frameAll(cam, cam.radius); break;
      case 'Escape': selectComponent(null); setIsolate(null); break;
      default:
        // 1..9 pick camera presets — keyboard access to every preset the buttons offer.
        if (/^[1-9]$/.test(e.key)) {
          const id = PRESET_IDS[Number(e.key) - 1];
          if (id) goToPreset(cam, id, b.cls, presetOpts());
        } else used = false;
    }
    if (used) { e.preventDefault(); dirty = true; }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---- selection -------------------------------------------------------------------------------- */
  function selectComponent(id) {
    state.selectedComponentId = id || null;
    if (listeners.select) listeners.select(state.selectedComponentId);
    renderCaption();
    dirty = true;
  }
  function setIsolate(id) { state.isolate = id || null; dirty = true; }

  /* ---- overlays ---------------------------------------------------------------------------------- */
  /** Every node this makes is flagged `overlay`, which exempts it from view-mode filtering. */
  function rebuildOverlays() {
    overlayRoot.children.length = 0;
    overlayRoot.overlay = true;
    const cls = b.cls;
    const m = massState(cls, state.visualState, b.layout);

    if (state.showForces) {
      const fs = forceSet(cls, state.visualState, b.layout, null);
      const scale = cls.lengthM * 0.32 / Math.max(1, m.buoyancyN);
      for (const key of ['buoyancy', 'weight', 'aero', 'net']) {
        const f = fs[key];
        const L = len(f.vec) * scale;
        if (L < cls.lengthM * 0.006) continue;
        addChild(overlayRoot, flagOverlay(node({
          id: `Force_${key}`, category: 'structure', selectable: false,
          material: key === 'net' ? 'arrow' : key === 'buoyancy' ? 'water' : 'cellFocus',
          geom: arrowGeom(L, cls.maxRadiusM * 0.035),
          p: f.at, r: aimEulerLocal(f.vec),
        })));
      }
      // Centre of mass and centre of buoyancy markers — they must be visibly different points.
      addChild(overlayRoot, flagOverlay(node({
        id: 'MarkerCoM', category: 'structure', selectable: false, material: 'arrow',
        geom: crossGeom(cls.maxRadiusM * 0.22), p: m.centreOfMass,
      })));
      addChild(overlayRoot, flagOverlay(node({
        id: 'MarkerCoB', category: 'structure', selectable: false, material: 'water',
        geom: crossGeom(cls.maxRadiusM * 0.18), p: [0, 0, 0],
      })));
    }

    if (state.showScale) {
      addChild(overlayRoot, flagOverlay(node({
        id: 'ScaleBar', category: 'structure', selectable: false, material: 'frame',
        geom: scaleBarGeom(cls),
      })));
    }
  }

  /* ---- frame ------------------------------------------------------------------------------------- */
  function sceneDesc() {
    const rect = container.getBoundingClientRect();
    const vs = viewStyle(b, state.viewMode, {
      cutFrac: state.cutFrac,
      cameraAzimuth: cam.azimuth,
      selectedId: state.selectedComponentId,
      isolate: state.isolate,
      failed: state.visualState.failedComponents,
      systems: state.systems,
      showCells: state.showCells,
      shellWire: state.shellWire,
    });
    // The analytic cut cap is a transient node: attach it for this frame only.
    if (capNode && capNode.parent) {
      const i = capNode.parent.children.indexOf(capNode);
      if (i >= 0) capNode.parent.children.splice(i, 1);
    }
    capNode = null;
    for (const n of vs.extraNodes) {
      if (!n) continue;
      capNode = n;
      addChild(b.root, n);
    }
    return {
      root: b.root, camera: cam, clips: vs.clips, styleFor: vs.styleFor,
      depthPrepass: vs.depthPrepass,
      width: Math.max(1, rect.width), height: Math.max(1, rect.height),
      dpr: typeof devicePixelRatio === 'undefined' ? 1 : devicePixelRatio,
      background: TOKENS.bg, transparent: true,
      lineWidth: state.reducedMotion ? 1 : 1,
      _vs: vs,
    };
  }

  let last = 0, raf = 0, visible = true, running = false;

  function frame(now) {
    raf = 0;
    if (!ok) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;

    const moving = updateCamera(cam, dt);
    avoidInterior(cam, b.cls, hullR, b.cls.maxRadiusM * 0.06);

    // Allocation: only when something asked for a wrench.
    let alloc = null;
    if (state.wrench) {
      for (const a of actuators) a.enabled = !(state.visualState.failedComponents || []).includes(a.id);
      const m = massState(b.cls, state.visualState, b.layout);
      alloc = allocate(actuators, state.wrench,
        { densityAt: (p) => b.field.sample(p).density },
        { weightN: m.weightN, armM: b.cls.lengthM / 2 });
    }

    updateDriver(driver, dt, state.visualState, alloc, state.env);
    rebuildOverlays();

    const sc = sceneDesc();
    renderer.render(sc);
    if (state.showLabels) positionLabels(sc);

    const animating = !state.reducedMotion && (moving || state.wrench ||
      state.visualState.hoseProgress > 0.001 ||
      driver.hoses.some((h) => h.deployed > 0.001));
    dirty = false;
    if (visible && (animating || moving)) schedule();
    else running = false;
  }

  function schedule() {
    if (raf || !visible) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function invalidate() { dirty = true; last = 0; schedule(); }

  /* ---- visibility ---------------------------------------------------------------------------------- */
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) invalidate();
      else if (raf) { cancelAnimationFrame(raf); raf = 0; running = false; }
    }, { rootMargin: '120px' })
    : null;
  if (io) io.observe(container);
  const onVis = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; running = false; }
    } else invalidate();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => invalidate()) : null;
  if (ro) ro.observe(container);

  /* ---- DOM rendering ------------------------------------------------------------------------------- */
  function renderCaption() {
    if (!b) return;
    const vs = viewStyle(b, state.viewMode,
      { cutFrac: state.cutFrac, cameraAzimuth: cam ? cam.azimuth : 0 });
    caption.textContent = vs.caption;
    const md = state.selectedComponentId ? b.metadata.get(state.selectedComponentId) : null;
    canvas.setAttribute('aria-label',
      `${b.cls.name} conceptual airship, ${VIEW_LABELS[state.viewMode] || state.viewMode} view. ` +
      describeState(state.visualState, b.cls) +
      (md ? ` Selected: ${md.label}. ${md.description}` : ''));
    live.textContent = describeState(state.visualState, b.cls);
  }

  function renderLegend() {
    if (!b) return;
    const vs = viewStyle(b, state.viewMode, { systems: state.systems });
    legend.innerHTML = '';
    if (!vs.legend) { legend.hidden = true; return; }
    legend.hidden = false;
    for (const row of vs.legend) {
      const d = el('span', 'a3d-legend-row');
      const sw = el('i', 'a3d-swatch');
      sw.style.background = row.color;
      if (row.dash) sw.style.backgroundImage =
        `repeating-linear-gradient(90deg, ${row.color} 0 ${row.dash[0]}px, transparent ${row.dash[0]}px ${row.dash[0] + row.dash[1]}px)`;
      d.append(sw, document.createTextNode(row.label));
      legend.append(d);
    }
  }

  function positionLabels(sc) {
    labels.innerHTML = '';
    const wanted = state.selectedComponentId ? [state.selectedComponentId] : [];
    if (!wanted.length) return;
    const view = viewMatrix(cam);
    const proj = projMatrix(cam, sc.width / sc.height);
    const vp = m4mul(proj, view);
    for (const id of wanted) {
      const n = b.index.get(id);
      const p = n ? [n.world[12], n.world[13], n.world[14]] : instancePos(b, id);
      if (!p) continue;
      const c = [
        vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12],
        vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13],
        vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14],
        vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15],
      ];
      if (c[3] <= 0) continue;
      const md = b.metadata.get(id);
      const tag = el('span', 'a3d-label');
      tag.textContent = md ? md.label : id;
      tag.style.left = `${((c[0] / c[3]) * 0.5 + 0.5) * 100}%`;
      tag.style.top = `${(0.5 - (c[1] / c[3]) * 0.5) * 100}%`;
      labels.append(tag);
    }
  }

  /* ---- public API ------------------------------------------------------------------------------------ */
  init();

  const api = {
    get element() { return container; },
    get canvas() { return canvas; },
    get model() { return b; },
    get camera() { return cam; },
    get available() { return ok; },
    get stats() { return renderer ? renderer.stats : null; },
    get driver() { return driver; },
    get actuators() { return actuators; },

    setProps(p) {
      let rebuild = false;
      if (p.classId && p.classId !== state.classId) { state.classId = p.classId; rebuild = true; }
      if (p.quality && p.quality !== state.quality) { state.quality = p.quality; rebuild = true; }
      if (p.visualState) state.visualState = sanitizeState(p.visualState);
      if (p.viewMode && VIEW_MODES.includes(p.viewMode)) state.viewMode = p.viewMode;
      if (p.hoseDepthM !== undefined && p.hoseDepthM !== state.hoseDepthM) {
        state.hoseDepthM = p.hoseDepthM;
        // The hoses bake headM at creation; a new depth needs a fresh driver (hose state resets,
        // which is correct — the old payout was against a different depth).
        if (ok && b) driver = createDriver(b, { reduced: state.reducedMotion, headM: state.hoseDepthM });
      }
      for (const k of ['showLabels', 'showForces', 'showEnergyFlow', 'showScale', 'interactive',
        'reducedMotion', 'showCells', 'shellWire']) {
        if (p[k] !== undefined) state[k] = p[k];
      }
      if (p.cutFrac !== undefined) state.cutFrac = clamp01(p.cutFrac);
      if (p.systems !== undefined) state.systems = p.systems ? new Set(p.systems) : null;
      if (p.wrench !== undefined) state.wrench = p.wrench;
      if (p.env) state.env = p.env;
      if (p.selectedComponentId !== undefined) state.selectedComponentId = p.selectedComponentId;
      if (p.isolate !== undefined) state.isolate = p.isolate;
      if (p.onComponentSelect !== undefined) listeners.select = p.onComponentSelect;
      if (rebuild && ok) buildModel();
      if (ok && state.viewMode === 'vacuum') ensureVacuumFill();
      if (driver) driver.reduced = state.reducedMotion;
      renderLegend();
      renderCaption();
      invalidate();
      return api;
    },

    getState: () => ({ ...state }),
    select: selectComponent,
    isolate: setIsolate,
    goToPreset: (id) => {
      goToPreset(cam, id, b.cls, presetOpts());
      invalidate();
    },
    frameAll: () => { frameAll(cam, cam.radius); invalidate(); },
    clearFailures: () => { clearFailures(b); invalidate(); },
    invalidate,

    /** Everything the DOM panels need, without them reaching into the model. */
    describe() {
      const cls = b.cls;
      const m = massState(cls, state.visualState, b.layout);
      const e = energyFlows(cls, state.visualState);
      return {
        cls, mass: m, energy: e,
        selected: state.selectedComponentId ? b.metadata.get(state.selectedComponentId) : null,
        stats: b.stats,
        text: describeState(state.visualState, cls),
        angularAccel: state.wrench
          ? angularAccelDegS2(cls, m.totalTonnes, [state.wrench[3], state.wrench[4], state.wrench[5]])
          : null,
      };
    },

    /**
     * Advance and draw exactly one frame, synchronously, with a caller-supplied timestep.
     *
     * The render loop is deliberately lazy — it stops the moment nothing is animating, and a
     * backgrounded tab throttles requestAnimationFrame to about 1 Hz. Anything that needs a
     * deterministic frame (a test, a figure export, a scroll-driven story stepping to a fixed
     * position) must not wait for the loop to happen to run. This is that entry point.
     */
    tick(dt = 1 / 60) {
      if (!ok) return null;
      updateCamera(cam, dt);
      let alloc = null;
      if (state.wrench) {
        for (const a of actuators) {
          a.enabled = !(state.visualState.failedComponents || []).includes(a.id);
        }
        const m = massState(b.cls, state.visualState, b.layout);
        alloc = allocate(actuators, state.wrench,
          { densityAt: (p) => b.field.sample(p).density },
          { weightN: m.weightN, armM: b.cls.lengthM / 2 });
      }
      updateDriver(driver, dt, state.visualState, alloc, state.env);
      rebuildOverlays();
      renderer.render(sceneDesc());
      return renderer.stats;
    },

    /** A PNG data URL of the current frame. Used by the figure export and by "save image". */
    snapshot() {
      if (!ok) return null;
      renderer.render(sceneDesc());
      return canvas.toDataURL('image/png');
    },

    dispose() {
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('keydown', onKey);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      if (renderer) renderer.dispose();
      renderer = null; b = null; driver = null; actuators = null;
      container.innerHTML = '';
    },
  };

  invalidate();
  return api;
}

/* ---------- helpers ---------------------------------------------------------------------------- */

const flagOverlay = (n) => { n.overlay = true; return n; };

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Arrow along +x: shaft plus a cone head. */
export function arrowGeom(length, radius) {
  const head = Math.min(length * 0.30, radius * 5);
  const shaft = Math.max(0.001, length - head);
  const parts = [
    transformSolidLocal(cylGeom(shaft, radius, 10), [shaft / 2, 0, 0]),
    transformSolidLocal(latheGeom([[0, radius * 2.1], [head, 0.001]], 12), [shaft, 0, 0]),
  ];
  return mergeSolids(parts);
}

function transformSolidLocal(g, p) {
  const pos = new Float32Array(g.pos.length);
  for (let i = 0; i < g.pos.length; i += 3) {
    pos[i] = g.pos[i] + p[0];
    pos[i + 1] = g.pos[i + 1] + p[1];
    pos[i + 2] = g.pos[i + 2] + p[2];
  }
  return { ...g, pos };
}

function aimEulerLocal(dir) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const z = clamp(dir[2] / l, -1, 1);
  return [0, -Math.asin(z), Math.atan2(dir[1] / l, dir[0] / l)];
}

/** A three-axis cross marker, for the centre of mass and the centre of buoyancy. */
export function crossGeom(size) {
  const s = size;
  return lines([
    [[-s, 0, 0], [s, 0, 0]], [[0, -s, 0], [0, s, 0]], [[0, 0, -s], [0, 0, s]],
  ], [1, 1, 1]);
}

/** A 100 m graduated bar under the hull. Real configured metres, never a symbolic size. */
export function scaleBarGeom(cls) {
  const z = -cls.maxRadiusM * 1.35;
  const x0 = cls.xTail + cls.lengthM * 0.06;
  const unit = cls.lengthM > 500 ? 200 : 100;
  const n = Math.floor((cls.lengthM * 0.7) / unit);
  const segs = [[[x0, 0, z], [x0 + n * unit, 0, z]]];
  const w = [1];
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * unit;
    segs.push([[x, 0, z], [x, 0, z - cls.maxRadiusM * 0.06]]);
    w.push(1);
  }
  return lines(segs, w);
}

function instancePos(b, id) {
  let p = null;
  walk(b.root, (n) => {
    if (p || !n.inst) return true;
    const i = n.inst.byId.get(id);
    if (i === undefined) return true;
    p = [n.inst.xf[i * 16 + 12], n.inst.xf[i * 16 + 13], n.inst.xf[i * 16 + 14]];
    return false;
  });
  return p;
}

void PRESETS; void CATEGORY_TONE; void CLAIM_TONE; void STATE_TONE; void PHASE_LABELS;
void m4compose; void norm; void mul; void add; void sub; void pathSegs; void cameraEye;
