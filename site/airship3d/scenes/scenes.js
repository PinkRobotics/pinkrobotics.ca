/* The named scenes.
 *
 * Each is a thin, opinionated configuration of the one viewer plus its own DOM controls. They are
 * thin ON PURPOSE: a scene that forked the viewer would drift from it, and the whole value of this
 * system is that the cutaway, the mission cycle and the failure explorer are the same model in
 * different clothes. If a scene needs something the viewer cannot do, the viewer gains it.
 *
 * All of them take (container, props) and return the viewer handle plus their own extras, so a
 * host page can always reach through to setProps/select/dispose.
 */

import { createViewer, prefersReducedMotion } from './viewer.js?v=187e4a51';
import { resolveClass, CLASS_IDS } from '../model/config.js?v=187e4a51';
import { build } from '../model/build.js?v=187e4a51';
import { demoState, phaseTimeline, MODES, stepPhase } from '../anim/mission.js?v=187e4a51';
import { resolveClip, CLIPS, CLIP_BY_ID, MASTER_SEQUENCE } from '../anim/clips.js?v=187e4a51';
import { demoWrench, WRENCH_LABELS, allocate } from '../control/allocator.js?v=187e4a51';
import { buildActuators } from '../control/actuators.js?v=187e4a51';
import { staticFigureSVG, scaleComparisonSVG } from '../render/svg.js?v=187e4a51';
import { defaultState, PHASE_LABELS, describeState } from '../physics/state.js?v=187e4a51';
import { massState } from '../physics/mass.js?v=187e4a51';
import { CATEGORY_TONE } from '../render/palette.js?v=187e4a51';
import { CATEGORIES } from '../core/nodes.js?v=187e4a51';
import { clamp01 } from '../core/math.js?v=187e4a51';

const el = (t, c, txt) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

/** A play/pause/scrub bar shared by every time-based scene. */
function timeline(onScrub, onPlay, opts = {}) {
  const wrap = el('div', 'a3d-timeline');
  const play = el('button', 'a3d-btn', '❙❙');
  play.type = 'button';
  play.setAttribute('aria-label', 'Pause');
  const prev = el('button', 'a3d-btn', '◀');
  prev.type = 'button'; prev.setAttribute('aria-label', 'Previous phase');
  const next = el('button', 'a3d-btn', '▶');
  next.type = 'button'; next.setAttribute('aria-label', 'Next phase');
  const range = el('input', 'a3d-range');
  range.type = 'range'; range.min = '0'; range.max = '1000'; range.value = '0';
  range.setAttribute('aria-label', opts.label || 'Position in the sequence');
  const speed = el('select', 'a3d-select');
  for (const s of [0.25, 0.5, 1, 2, 4]) {
    const o = el('option', null, `${s}×`);
    o.value = String(s);
    if (s === 1) o.selected = true;
    speed.append(o);
  }
  speed.setAttribute('aria-label', 'Simulation speed');
  const readout = el('span', 'a3d-readout');
  wrap.append(prev, play, next, range, speed, readout);
  let playing = !opts.startPaused;
  play.textContent = playing ? '❙❙' : '▶';
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? '❙❙' : '▶';
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    onPlay(playing);
  };
  range.oninput = () => onScrub(Number(range.value) / 1000, true);
  prev.onclick = () => onScrub(-1, true, -1);
  next.onclick = () => onScrub(-1, true, 1);
  return {
    element: wrap, range, readout, speed,
    get playing() { return playing; },
    set playing(v) { playing = v; play.textContent = v ? '❙❙' : '▶'; },
    get rate() { return Number(speed.value); },
    setPos(u) { range.value = String(Math.round(clamp01(u) * 1000)); },
  };
}

/* ---------- AirshipModelViewer (re-export) ------------------------------------------------------ */
export { createViewer as AirshipModelViewer };

/* ---------- AirshipCutaway ------------------------------------------------------------------------ */

/** Guided cutaway: system buttons, a draggable cut plane, and a DOM explanation panel. */
export function AirshipCutaway(container, props = {}) {
  const root = el('div', 'a3d-scene a3d-cutaway');
  const stage = el('div', 'a3d-stage');
  const side = el('div', 'a3d-side');
  root.append(stage, side);
  container.append(root);

  const v = createViewer(stage, {
    viewMode: 'cutaway-longitudinal', showLabels: true, ...props,
  });

  const controls = el('div', 'a3d-controls');
  const axis = el('div', 'a3d-row');
  for (const [mode, label] of [['cutaway-longitudinal', 'Longitudinal'],
    ['cutaway-transverse', 'Transverse'], ['ghost', 'Ghost'], ['lattice', 'Lattice']]) {
    const btn = el('button', 'a3d-btn', label);
    btn.type = 'button';
    btn.onclick = () => {
      v.setProps({ viewMode: mode });
      [...axis.children].forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
    };
    btn.setAttribute('aria-pressed', String(mode === 'cutaway-longitudinal'));
    axis.append(btn);
  }
  const cut = el('input', 'a3d-range');
  cut.type = 'range'; cut.min = '0'; cut.max = '100'; cut.value = '50';
  cut.setAttribute('aria-label', 'Cut-plane position');
  cut.oninput = () => v.setProps({ cutFrac: Number(cut.value) / 100 });

  const sys = el('div', 'a3d-row a3d-systems');
  for (const c of CATEGORIES) {
    const btn = el('button', 'a3d-chip', CATEGORY_TONE[c].label);
    btn.type = 'button';
    btn.style.setProperty('--chip', CATEGORY_TONE[c].color);
    btn.onclick = () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      const active = [...sys.children].filter((x) => x.getAttribute('aria-pressed') === 'true')
        .map((x) => CATEGORIES[[...sys.children].indexOf(x)]);
      v.setProps({ viewMode: active.length ? 'systems' : 'cutaway-longitudinal',
        systems: active.length ? active : null });
    };
    btn.setAttribute('aria-pressed', 'false');
    sys.append(btn);
  }
  controls.append(axis, cut, sys);
  side.append(controls, componentPanel(v));
  return { viewer: v, element: root, dispose: () => v.dispose() };
}

/** The DOM info panel + full component list. This is the accessible spine of every scene. */
export function componentPanel(v) {
  const panel = el('div', 'a3d-panel');
  const title = el('h4', 'a3d-panel-title', 'Components');
  const list = el('div', 'a3d-list');
  const detail = el('div', 'a3d-detail');
  panel.append(title, detail, list);

  function refresh() {
    const b = v.model;
    if (!b) return;
    list.innerHTML = '';
    const groups = new Map();
    for (const id of b.selectableIds) {
      const md = b.metadata.get(id);
      if (!md) continue;
      const key = md.label.replace(/\s+\d+$/, '');
      if (!groups.has(key)) groups.set(key, { md, ids: [] });
      groups.get(key).ids.push(id);
    }
    for (const [key, g] of groups) {
      const row = el('button', 'a3d-list-row');
      row.type = 'button';
      row.style.setProperty('--chip', CATEGORY_TONE[g.md.category].color);
      row.append(el('span', 'a3d-list-name', key),
        el('span', 'a3d-list-count', g.ids.length > 1 ? `×${g.ids.length}` : ''));
      row.onclick = () => { v.select(g.ids[0]); show(g.ids[0]); };
      list.append(row);
    }
  }

  function show(id) {
    const b = v.model;
    const md = id && b ? b.metadata.get(id) : null;
    detail.innerHTML = '';
    if (!md) { detail.append(el('p', 'a3d-hint', 'Select a component in the model or the list.')); return; }
    const h = el('h5', 'a3d-detail-title', md.label);
    const badge = el('span', 'a3d-claim', md.claimLevel.replace(/-/g, ' '));
    badge.dataset.claim = md.claimLevel;
    const cat = el('span', 'a3d-cat', CATEGORY_TONE[md.category].label);
    cat.style.setProperty('--chip', CATEGORY_TONE[md.category].color);
    const p = el('p', 'a3d-detail-body', md.description);
    detail.append(h, cat, badge, p);
    const facts = el('dl', 'a3d-facts');
    if (md.nominalMassTonnes !== undefined) {
      facts.append(el('dt', null, 'Nominal mass allocation'),
        el('dd', null, `${md.nominalMassTonnes} t`));
    }
    if (md.nominalPowerMW !== undefined) {
      facts.append(el('dt', null, 'Nominal power'), el('dd', null, `${md.nominalPowerMW} MW`));
    }
    facts.append(el('dt', null, 'Stable id'), el('dd', null, md.id));
    detail.append(facts);
    const iso = el('button', 'a3d-btn', 'Isolate');
    iso.type = 'button';
    iso.onclick = () => v.isolate(md.id);
    const clr = el('button', 'a3d-btn', 'Show all');
    clr.type = 'button';
    clr.onclick = () => v.isolate(null);
    detail.append(iso, clr);
  }

  v.setProps({ onComponentSelect: (id) => show(id) });
  refresh(); show(null);
  panel.refresh = refresh;
  return panel;
}

/* ---------- AirshipMissionCycle ------------------------------------------------------------------ */

/** The scrubbable, loopable master cycle. */
export function AirshipMissionCycle(container, props = {}) {
  const root = el('div', 'a3d-scene a3d-mission');
  const stage = el('div', 'a3d-stage');
  const bar = el('div', 'a3d-bar');
  const info = el('div', 'a3d-info');
  root.append(stage, bar, info);
  container.append(root);

  const reduced = props.reducedMotion !== undefined ? props.reducedMotion : prefersReducedMotion();
  const v = createViewer(stage, { viewMode: 'exterior', showForces: true, reducedMotion: reduced, ...props });
  let modeId = props.modeId || 'balanced';
  let u = 0;
  let tl = phaseTimeline(v.model.cls, MODES[modeId], props.oneWayKm || 15);

  const modeRow = el('div', 'a3d-row');
  for (const m of Object.values(MODES)) {
    const btn = el('button', 'a3d-btn', m.label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(m.id === modeId));
    btn.onclick = () => {
      modeId = m.id;
      tl = phaseTimeline(v.model.cls, MODES[modeId], props.oneWayKm || 15);
      [...modeRow.children].forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
      apply();
    };
    modeRow.append(btn);
  }

  const t = timeline((val, fromUser, step) => {
    if (step) u = stepPhase(tl, u, step);
    else u = val;
    t.setPos(u);
    apply();
  }, () => {}, { startPaused: reduced, label: 'Position in the mission cycle' });

  bar.append(modeRow, t.element);

  function apply() {
    const d = demoState(v.model.cls, u, { modeId, layout: v.model.layout, timeline: tl });
    v.setProps({ visualState: d.state });
    const b = tl.bounds.find((x) => x.id === d.state.phase) || tl.bounds[0];
    t.readout.textContent =
      `${PHASE_LABELS[d.state.phase]} · ${(d.state.phaseProgress * 100).toFixed(0)}% · ` +
      `${b.minutes.toFixed(1)} min of a ${tl.totalMinutes.toFixed(0)} min cycle`;
    info.textContent = describeState(d.state, v.model.cls) +
      ` Net static buoyancy ${d.mass.netTonnes >= 0 ? '+' : ''}${d.mass.netTonnes.toFixed(0)} t.`;
    t.setPos(u);
  }

  let raf = 0, last = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!t.playing || reduced) return;
    u = (u + (dt / (tl.totalMinutes * 60)) * 60 * t.rate) % 1;
    apply();
  }
  if (!reduced) raf = requestAnimationFrame(loop);
  apply();

  return {
    viewer: v, element: root, timeline: t,
    setPosition(x) { u = clamp01(x); apply(); },
    dispose() { if (raf) cancelAnimationFrame(raf); v.dispose(); },
  };
}

/* ---------- AirshipControlAuthority --------------------------------------------------------------- */

/** Desired wrench in, allocation out, with failure toggles. */
export function AirshipControlAuthority(container, props = {}) {
  const root = el('div', 'a3d-scene a3d-authority');
  const stage = el('div', 'a3d-stage');
  const side = el('div', 'a3d-side');
  root.append(stage, side);
  container.append(root);

  const v = createViewer(stage, { viewMode: 'exterior', showForces: true, ...props });
  const cls = v.model.cls;
  const acts = buildActuators(cls, v.model.layout);
  let kind = 'up', scale = 1;
  const failed = new Set();

  const row = el('div', 'a3d-row');
  for (const k of Object.keys(WRENCH_LABELS)) {
    const btn = el('button', 'a3d-btn', WRENCH_LABELS[k]);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(k === kind));
    btn.onclick = () => {
      kind = k;
      [...row.children].forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
      apply();
    };
    row.append(btn);
  }
  const mag = el('input', 'a3d-range');
  mag.type = 'range'; mag.min = '0'; mag.max = '100'; mag.value = '100';
  mag.setAttribute('aria-label', 'Demand magnitude');
  mag.oninput = () => { scale = Number(mag.value) / 100; apply(); };

  const failRow = el('div', 'a3d-row');
  for (const st of v.model.layout.rotorStations.slice(0, 6)) {
    const btn = el('button', 'a3d-chip', `Fail ${st.id.slice(-2)}`);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.onclick = () => {
      const on = !failed.has(st.id);
      if (on) failed.add(st.id); else failed.delete(st.id);
      btn.setAttribute('aria-pressed', String(on));
      apply();
    };
    failRow.append(btn);
  }
  const out = el('div', 'a3d-readout-block');
  side.append(row, mag, failRow, out);

  function apply() {
    const m = massState(cls, defaultState({ waterFraction: 1 }), v.model.layout);
    const w = demoWrench(kind, cls, m.totalTonnes * 1000).map((x) => x * scale);
    for (const a of acts) a.enabled = !failed.has(a.id);
    const r = allocate(acts, w, { densityAt: (p) => v.model.field.sample(p).density },
      { weightN: m.weightN, armM: cls.lengthM / 2 });
    v.setProps({
      wrench: w,
      visualState: defaultState({ waterFraction: 1, failedComponents: [...failed], airspeedMps: 12 }),
    });
    out.innerHTML = '';
    const rows = [
      ['Requested force', `${(r.demand.forceN / 1e6).toFixed(2)} MN`],
      ['Achieved force', `${(Math.hypot(r.achieved[0], r.achieved[1], r.achieved[2]) / 1e6).toFixed(2)} MN`],
      ['Requested torque', `${(r.demand.torqueNm / 1e6).toFixed(1)} MN·m`],
      ['Achieved torque', `${(Math.hypot(r.achieved[3], r.achieved[4], r.achieved[5]) / 1e6).toFixed(1)} MN·m`],
      ['Shortfall', r.shortfall.force !== null
        ? `${(r.shortfall.force * 100).toFixed(1)}% of the demand`
        : `${(r.shortfall.torque * 100).toFixed(1)}% of the demand`],
      ['Unwanted output', r.crossAxis
        ? `${(r.crossAxis.forceFracOfWeight * 100).toFixed(2)}% of weight`
        : '—'],
      ['Actuators saturated', `${r.saturated.length} of ${acts.filter((a) => a.enabled).length}`],
      ['Electrical demand', `${r.powerMW.toFixed(1)} MW`],
      ['Failed', failed.size ? [...failed].join(', ') : 'none'],
    ];
    const dl = el('dl', 'a3d-facts');
    for (const [k, val] of rows) { dl.append(el('dt', null, k), el('dd', null, val)); }
    out.append(dl);
    out.append(el('p', 'a3d-hint',
      'Simulated force allocation — not a certified flight-control system.'));
  }
  apply();
  return { viewer: v, element: root, dispose: () => v.dispose() };
}

/* ---------- AirshipScaleComparison ----------------------------------------------------------------- */

/**
 * All three classes in one real-metre coordinate system. This is an SVG scene, not a WebGL one:
 * the whole point is exact comparable dimensions, and a vector figure gives that for free, prints,
 * and needs no GPU.
 */
export function AirshipScaleComparison(container, props = {}) {
  const root = el('div', 'a3d-scene a3d-scale');
  const classes = CLASS_IDS.map((id) => resolveClass(id));
  root.innerHTML = scaleComparisonSVG(classes, { width: props.width || 880 });
  const table = el('table', 'a3d-table');
  table.innerHTML = '<caption>Configured dimensions — the figure above is drawn from these.</caption>' +
    '<thead><tr><th>Class</th><th>Water payload</th><th>Displacement</th><th>Length</th>' +
    '<th>Max diameter</th><th>Fineness</th><th>Payload cube</th></tr></thead><tbody>' +
    classes.map((c) => `<tr><th scope="row">${c.name}</th>` +
      `<td>${c.payloadTonnes.toLocaleString()} t</td>` +
      `<td>${c.displacementM3.toLocaleString()} m³</td>` +
      `<td>${c.lengthM} m</td><td>${c.diameterM.toFixed(1)} m</td>` +
      `<td>${c.finenessRatio.toFixed(2)}:1</td>` +
      `<td>${c.payloadCubeEdgeM.toFixed(1)} m cube</td></tr>`).join('') +
    '</tbody>';
  root.append(table);
  root.append(el('p', 'a3d-hint',
    'Map symbols elsewhere on the site are enlarged for visibility. This viewer shows physical ' +
    'dimensions. Illustrative same-proportion scale; not completed structural designs.'));
  container.append(root);
  return { element: root, classes, dispose() { root.remove(); } };
}

/* ---------- AirshipFailureExplorer ------------------------------------------------------------------- */

export function AirshipFailureExplorer(container, props = {}) {
  const root = el('div', 'a3d-scene a3d-failure');
  const stage = el('div', 'a3d-stage');
  const side = el('div', 'a3d-side');
  root.append(stage, side);
  container.append(root);
  const v = createViewer(stage, { viewMode: 'failure', showForces: true, ...props });

  const scenarios = [
    'single_cell_vacuum_loss', 'local_module_damage', 'alternate_load_path',
    'rotor_failure_reallocation', 'bus_failure_reconfiguration',
    'pump_pod_emergency_release', 'sensor_disagreement', 'safe_drift', 'total_power_loss',
  ];
  let current = scenarios[0], t = 0, raf = 0, last = 0, playing = true;
  const note = el('p', 'a3d-note');
  const row = el('div', 'a3d-row');
  for (const id of scenarios) {
    const c = CLIP_BY_ID.get(id);
    const btn = el('button', 'a3d-btn', c ? c.label : id);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(id === current));
    btn.onclick = () => {
      current = id; t = 0;
      [...row.children].forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
      v.clearFailures();
      step();
    };
    row.append(btn);
  }
  const reset = el('button', 'a3d-btn', 'Reset');
  reset.type = 'button';
  reset.onclick = () => { v.clearFailures(); t = 0; step(); };
  side.append(row, reset, note);

  function step() {
    const r = resolveClip(current, t, v.model.cls, { layout: v.model.layout });
    if (!r) return;
    const p = { visualState: r.state || defaultState() };
    if (r.viewMode) p.viewMode = r.viewMode;
    if (r.failed) p.visualState = { ...(r.state || defaultState()), failedComponents: r.failed };
    if (r.wrench !== undefined) p.wrench = r.wrench;
    v.setProps(p);
    if (r.cameraPreset) v.goToPreset(r.cameraPreset);
    note.textContent = r.note || (CLIP_BY_ID.get(current) || {}).label || '';
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!playing) return;
    const c = CLIP_BY_ID.get(current);
    t = (t + dt / ((c && c.seconds) || 12)) % 1;
    step();
  }
  raf = requestAnimationFrame(loop);
  step();
  return {
    viewer: v, element: root,
    set playing(v2) { playing = v2; },
    dispose() { if (raf) cancelAnimationFrame(raf); v.dispose(); },
  };
}

/* ---------- AirshipMapModel ---------------------------------------------------------------------------- */

/**
 * A tiny class-specific representation for a map marker or a selected-aircraft chip. Returns an
 * SVG string, not a canvas: at map zoom this is a few hundred bytes and needs no GPU at all.
 */
export function AirshipMapModel(classId, opts = {}) {
  const b = build(classId, { tier: 0 });
  return staticFigureSVG(b, {
    view: opts.view || 'side', mode: 'silhouette',
    width: opts.width || 160, height: opts.height || 44,
    background: 'transparent', caption: null,
    alt: `${b.cls.name} outline`,
  });
}

/* ---------- AirshipStaticFigure ------------------------------------------------------------------------- */

/** Deterministic camera-angle figure. Same model, same projection, no WebGL. */
export function AirshipStaticFigure(classId, opts = {}) {
  const b = build(classId, { tier: opts.tier === undefined ? 1 : opts.tier });
  return staticFigureSVG(b, opts);
}

/* ---------- AirshipTrajectoryExplorer -------------------------------------------------------------------- */

/**
 * Altitude bands, an illustrative wind field, candidate routes and the selected one.
 *
 * When no weather data is connected the field is labelled ILLUSTRATIVE and is generated from a
 * fixed seed. It never invents a live value. `props.windSamples` lets a host pass real samples.
 */
export function AirshipTrajectoryExplorer(container, props = {}) {
  const root = el('div', 'a3d-scene a3d-trajectory');
  const svgHost = el('div', 'a3d-stage');
  const info = el('div', 'a3d-info');
  root.append(svgHost, info);
  container.append(root);

  const W = props.width || 880, H = props.height || 340;
  const bands = props.bands || [400, 900, 1500, 2200, 3000];
  const live = !!props.windSamples;
  const wind = props.windSamples || bands.map((a, i) => ({
    altitudeM: a, speedMps: 6 + 4 * Math.sin(i * 1.3), bearingDeg: 40 + 55 * Math.sin(i * 0.8),
  }));

  const routes = props.routes || [
    { id: 'low', label: 'Low and direct', alt: 900, energy: 1.00, minutes: 42, risk: 'higher turbulence' },
    { id: 'mid', label: 'Mid band, tailwind out', alt: 1500, energy: 0.82, minutes: 38, risk: 'nominal' },
    { id: 'high', label: 'High, solar-favourable', alt: 2600, energy: 0.91, minutes: 46, risk: 'longer climb' },
  ];
  const selected = props.selected || 'mid';

  const y = (a) => H - 44 - (a / 3200) * (H - 90);
  const parts = [`<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="Candidate routes between the water source and the fire across five ` +
    `altitude bands, with the selected route highlighted.">`];
  parts.push(`<rect width="${W}" height="${H}" fill="#0a0a0c"/>`);
  for (let i = 0; i < bands.length; i++) {
    const a = bands[i], w = wind[i];
    parts.push(`<line x1="60" y1="${y(a).toFixed(1)}" x2="${W - 120}" y2="${y(a).toFixed(1)}" ` +
      `stroke="#232329"/>`);
    parts.push(`<text x="8" y="${(y(a) + 3.5).toFixed(1)}" fill="#74747f" font-size="10.5" ` +
      `font-family="ui-monospace,monospace">${a} m</text>`);
    const ang = (w.bearingDeg * Math.PI) / 180;
    const L = 8 + w.speedMps * 2.2;
    for (let k = 0; k < 6; k++) {
      const x = 120 + k * ((W - 260) / 5);
      parts.push(`<line x1="${x}" y1="${y(a).toFixed(1)}" x2="${(x + Math.cos(ang) * L).toFixed(1)}" ` +
        `y2="${(y(a) - Math.sin(ang) * L * 0.4).toFixed(1)}" stroke="#7aa2c8" stroke-opacity=".55"/>`);
    }
  }
  for (const r of routes) {
    const on = r.id === selected;
    parts.push(`<path d="M70 ${y(300).toFixed(1)} C${W * 0.3} ${y(r.alt).toFixed(1)}, ` +
      `${W * 0.7} ${y(r.alt).toFixed(1)}, ${W - 130} ${y(280).toFixed(1)}" fill="none" ` +
      `stroke="${on ? '#ff4fa3' : '#74747f'}" stroke-width="${on ? 2.2 : 1}" ` +
      `stroke-opacity="${on ? 1 : 0.5}" ${on ? '' : 'stroke-dasharray="5 4"'}/>`);
  }
  parts.push(`<text x="70" y="${H - 22}" fill="#7aa2c8" font-size="11" ` +
    `font-family="ui-monospace,monospace">water source</text>`);
  parts.push(`<text x="${W - 190}" y="${H - 22}" fill="#d98b80" font-size="11" ` +
    `font-family="ui-monospace,monospace">fire perimeter</text>`);
  parts.push(`<text x="8" y="16" fill="#74747f" font-size="10" ` +
    `font-family="ui-monospace,monospace">${live ? 'Wind samples supplied by the host page'
      : 'Illustrative atmospheric field — no live weather is connected'}</text>`);
  parts.push('</svg>');
  svgHost.innerHTML = parts.join('');

  const dl = el('dl', 'a3d-facts');
  for (const r of routes) {
    dl.append(el('dt', null, `${r.label}${r.id === selected ? ' — selected' : ''}`),
      el('dd', null, `${r.alt} m · ${r.minutes} min · relative energy ${r.energy.toFixed(2)} · ${r.risk}`));
  }
  info.append(el('p', 'a3d-question',
    'Which three-dimensional atmospheric trajectory costs the least energy while keeping this ' +
    'aircraft within its structural envelope?'), dl);
  return { element: root, dispose() { root.remove(); } };
}

void CLIPS; void MASTER_SEQUENCE; void clamp01;
