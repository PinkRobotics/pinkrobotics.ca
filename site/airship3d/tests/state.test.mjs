/* State, mission, clips, the driver, the view modes, the SVG export and the Fable adapter. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveClass, CLASS_IDS, ASSUMPTIONS, setAssumptions } from '../model/config.js?v=187e4a51';
import { build } from '../model/build.js?v=187e4a51';
import {
  defaultState, sanitizeState, validateState, lerpState, describeState,
  MISSION_PHASES, ALL_PHASES, PHASE_LABELS, isAtSource, hoseIsOut,
} from '../physics/state.js?v=187e4a51';
import {
  demoState, phaseTimeline, phaseAt, phaseShape, stepPhase, MODES,
} from '../anim/mission.js?v=187e4a51';
import { CLIPS, CLIP_BY_ID, MASTER_SEQUENCE, resolveClip, CLIP_GROUPS } from '../anim/clips.js?v=187e4a51';
import { buildActuators } from '../control/actuators.js?v=187e4a51';
import { allocate, demoWrench } from '../control/allocator.js?v=187e4a51';
import { massState } from '../physics/mass.js?v=187e4a51';
import { createDriver, updateDriver, clearFailures } from '../anim/driver.js?v=187e4a51';
import { createHose, updateHose, hoseCurve, podDepthM } from '../anim/hose.js?v=187e4a51';
import { viewStyle, VIEW_MODES, VIEW_LABELS, capGeom } from '../render/views.js?v=187e4a51';
import { staticFigureSVG, scaleComparisonSVG, FIGURE_VIEWS } from '../render/svg.js?v=187e4a51';
import { CATEGORY_TONE, MATERIALS, CLAIM_TONE } from '../render/palette.js?v=187e4a51';
import { CSS } from '../render/styles.js?v=187e4a51';
import {
  fromMonitorState, adaptMission, adoptAssumptions, describeMapping, checkHostState,
  REQUIRED_HOST_FIELDS,
} from '../adapter/fable.js?v=187e4a51';
import { walk } from '../core/nodes.js?v=187e4a51';
import { PRESETS, PRESET_IDS, createCamera, goToPreset, updateCamera, orbit, cameraEye } from '../render/camera.js?v=187e4a51';

/* ---------- state -------------------------------------------------------------------------- */

test('sanitizeState clamps everything into legality', () => {
  const s = sanitizeState({ phase: 'NOT_A_PHASE', waterFraction: 4, ln2Fraction: -2,
    altitudeM: -100, phaseProgress: 9, failedComponents: 'nope' });
  assert.equal(s.phase, 'SOURCE_APPROACH');
  assert.equal(s.waterFraction, 1);
  assert.equal(s.ln2Fraction, 0);
  assert.equal(s.altitudeM, 0);
  assert.equal(s.phaseProgress, 1);
  assert.deepEqual(s.failedComponents, []);
  assert.deepEqual(validateState(s), []);
});

test('validateState reports what sanitize would have fixed', () => {
  const errs = validateState({ ...defaultState(), phase: 'X', waterFraction: 2, altitudeM: -1 });
  assert.ok(errs.length >= 3, errs.join('; '));
});

test('phases never blend across an interpolation', () => {
  const a = defaultState({ phase: 'WATER_FILL', waterFraction: 0.2, altitudeM: 300 });
  const b = defaultState({ phase: 'HOSE_RETRACT', waterFraction: 1.0, altitudeM: 400 });
  for (const t of [0, 0.25, 0.49, 0.5, 0.75, 1]) {
    const m = lerpState(a, b, t);
    assert.ok(ALL_PHASES.includes(m.phase));
    assert.ok(m.phase === 'WATER_FILL' || m.phase === 'HOSE_RETRACT');
  }
  const mid = lerpState(a, b, 0.5);
  assert.ok(Math.abs(mid.waterFraction - 0.6) < 1e-9);
  assert.ok(Math.abs(mid.altitudeM - 350) < 1e-9);
});

test('every phase has a label and the helpers agree with the list', () => {
  for (const p of ALL_PHASES) assert.ok(PHASE_LABELS[p], `no label for ${p}`);
  assert.ok(isAtSource('WATER_FILL') && !isAtSource('OUTBOUND_TRANSIT'));
  assert.ok(hoseIsOut('HOSE_DEPLOY') && !hoseIsOut('DEPARTURE_CLIMB'));
});

test('the state summary is a usable text alternative', () => {
  const cls = resolveClass('P100');
  const txt = describeState(defaultState({ waterFraction: 0.5, failedComponents: ['x'] }), cls);
  assert.match(txt, /P-100/);
  assert.match(txt, /water 50%/);
  assert.match(txt, /1 component failed/);
});

/* ---------- mission ------------------------------------------------------------------------- */

test('the demo timeline covers the whole cycle exactly once', () => {
  for (const id of CLASS_IDS) {
    const cls = resolveClass(id);
    const tl = phaseTimeline(cls, MODES.balanced, 15);
    assert.equal(tl.bounds.length, MISSION_PHASES.length);
    assert.ok(Math.abs(tl.bounds[0].start) < 1e-12);
    assert.ok(Math.abs(tl.bounds[tl.bounds.length - 1].end - 1) < 1e-12);
    for (let i = 1; i < tl.bounds.length; i++) {
      assert.ok(Math.abs(tl.bounds[i].start - tl.bounds[i - 1].end) < 1e-12, 'gap in the timeline');
    }
    assert.ok(tl.totalMinutes > 0);
  }
});

test('fill duration follows the configured fill rate', () => {
  const cls = resolveClass('P100');
  const tl = phaseTimeline(cls, MODES.balanced, 15);
  const fill = tl.bounds.find((b) => b.id === 'WATER_FILL');
  // 100 t at 0.5 m3/s is 200 s = 3.33 min. Same identity the /airships page self-tests.
  assert.ok(Math.abs(fill.minutes - 100 / 0.5 / 60) < 1e-9, `${fill.minutes} min`);
});

test('the three modes give three different cycles', () => {
  const cls = resolveClass('P1000');
  const t = Object.values(MODES).map((m) => phaseTimeline(cls, m, 40).totalMinutes);
  assert.ok(t[0] < t[1] && t[1] < t[2], `rapid ${t[0]}, balanced ${t[1]}, endurance ${t[2]}`);
});

test('phaseAt lands in the right phase everywhere in the cycle', () => {
  const cls = resolveClass('P100');
  const tl = phaseTimeline(cls, MODES.balanced, 15);
  for (const b of tl.bounds) {
    const mid = (b.start + b.end) / 2;
    const at = phaseAt(tl, mid);
    assert.equal(at.phase, b.id);
    assert.ok(at.progress > 0.4 && at.progress < 0.6);
  }
});

test('stepPhase moves to boundaries in both directions and wraps', () => {
  const cls = resolveClass('P100');
  const tl = phaseTimeline(cls, MODES.balanced, 15);
  const starts = tl.bounds.map((b) => b.start);
  let u = 0.0;
  for (let i = 1; i < starts.length; i++) {
    u = stepPhase(tl, u, 1);
    assert.ok(Math.abs(u - starts[i]) < 1e-9, `forward step ${i}`);
  }
  u = stepPhase(tl, u, 1);
  assert.ok(Math.abs(u - starts[0]) < 1e-9, 'forward wraps to the start');
});

test('the mission cycle obeys the physical consistency rules', () => {
  const cls = resolveClass('P100');
  const layout = build('P100', { tier: 0 }).layout;
  const tl = phaseTimeline(cls, MODES.balanced, 15);
  const samples = [];
  for (let i = 0; i < 400; i++) samples.push(demoState(cls, i / 400, { layout, timeline: tl }));

  for (const { state: s } of samples) {
    assert.ok(s.altitudeM > 100, `the ship must never approach the surface (${s.altitudeM} m)`);
    assert.ok(s.waterFraction >= 0 && s.waterFraction <= 1);
    if (s.phase === 'OUTBOUND_TRANSIT') assert.ok(s.waterFraction > 0.99, 'outbound must be laden');
    if (s.phase === 'RETURN_TRANSIT') assert.ok(s.waterFraction < 0.01, 'return must be light');
    if (!hoseIsOut(s.phase)) assert.ok(s.hoseProgress < 0.02, `hose out during ${s.phase}`);
  }
  // Water release lowers weight and raises net buoyancy, monotonically.
  const drop = samples.filter((x) => x.state.phase === 'WATER_RELEASE');
  for (let i = 1; i < drop.length; i++) {
    assert.ok(drop[i].mass.totalTonnes <= drop[i - 1].mass.totalTonnes + 1e-9, 'mass must fall');
    assert.ok(drop[i].mass.netTonnes >= drop[i - 1].mass.netTonnes - 1e-9, 'net buoyancy must rise');
  }
  // Filling raises weight.
  const fill = samples.filter((x) => x.state.phase === 'WATER_FILL');
  assert.ok(fill[fill.length - 1].mass.totalTonnes > fill[0].mass.totalTonnes + 50);
});

test('the hose drains before it retracts', () => {
  const cls = resolveClass('P100');
  const early = phaseShape(cls, 'HOSE_RETRACT', 0.1).hoseProgress;
  const late = phaseShape(cls, 'HOSE_RETRACT', 0.9).hoseProgress;
  const done = phaseShape(cls, 'HOSE_RETRACT', 1).hoseProgress;
  assert.ok(early > 0.99, 'the hose is still out while it drains');
  assert.ok(late < 0.1, `and mostly hauled in afterwards (${late.toFixed(3)})`);
  assert.ok(done < 1e-9, 'and fully in by the end of the phase');
});

/* ---------- clips ---------------------------------------------------------------------------- */

test('every clip resolves at every time without throwing', () => {
  const cls = resolveClass('P100');
  const layout = build('P100', { tier: 0 }).layout;
  const ids = [...CLIPS.map((c) => c.id), MASTER_SEQUENCE.id];
  for (const id of ids) {
    for (const t of [0, 0.13, 0.5, 0.87, 1]) {
      const r = resolveClip(id, t, cls, { layout });
      assert.ok(r, `${id} @ ${t} returned nothing`);
      if (r.state) assert.deepEqual(validateState(sanitizeState(r.state)), [], `${id} @ ${t}`);
      if (r.viewMode) assert.ok(VIEW_MODES.includes(r.viewMode), `${id}: bad view ${r.viewMode}`);
      if (r.cameraPreset) assert.ok(PRESETS[r.cameraPreset], `${id}: bad preset ${r.cameraPreset}`);
      if (r.wrench) assert.equal(r.wrench.length, 6);
    }
  }
});

test('the clip catalogue covers every group and has no duplicate ids', () => {
  const ids = new Set();
  for (const c of CLIPS) {
    assert.ok(!ids.has(c.id), `duplicate clip ${c.id}`);
    ids.add(c.id);
    assert.ok(CLIP_GROUPS.some(([g]) => g === c.group), `${c.id}: unknown group ${c.group}`);
    assert.ok(c.seconds > 0);
    assert.ok(c.label && c.label.length > 3);
  }
  for (const [g] of CLIP_GROUPS) {
    assert.ok(CLIPS.some((c) => c.group === g), `group ${g} has no clips`);
  }
});

test('safe drift and total power loss are genuinely different states', () => {
  const cls = resolveClass('P100');
  const drift = resolveClip('safe_drift', 0.6, cls, {});
  const dead = resolveClip('total_power_loss', 0.6, cls, {});
  assert.equal(drift.state.phase, 'SAFE_DRIFT');
  assert.equal(dead.state.phase, 'TOTAL_POWER_LOSS');
  // Safe drift keeps a trickle of power and recovers charge; total power loss has neither.
  assert.ok(drift.state.batteryStateOfCharge > 0);
  assert.equal(dead.state.batteryStateOfCharge, 0);
  assert.equal(dead.state.propulsionPowerMW, 0);
  assert.equal(dead.state.solarPowerMW, 0);
  assert.ok(dead.allActuatorsOff, 'nothing may be commanded in total power loss');
  assert.match(dead.note, /passive aerodynamic stability|no active climb/i);
});

/* ---------- the hose ------------------------------------------------------------------------- */

test('the hose sags, reaches depth, and never lets the ship touch the water', () => {
  const cls = resolveClass('P100');
  const b = build('P100', { tier: 0 });
  const h = createHose(cls, b.layout.hoseReels[0], { headM: 250 });
  const surfaceZ = h.reel.p[2] - 250;
  for (let i = 0; i < 600; i++) {
    updateHose(h, 1 / 30, { progress: 1, waterFlow: 1, windMps: [0, 4, 0], waterSurfaceZ: surfaceZ });
  }
  assert.ok(podDepthM(h) > 200, `pod only reached ${podDepthM(h).toFixed(0)} m`);
  assert.ok(h.podPos[2] < h.reel.p[2] - 100, 'the pod is far below the ship');
  assert.ok(h.tensionN > 0);
  const c = hoseCurve(h);
  const straightMid = (c[0][2] + c[c.length - 1][2]) / 2;
  assert.ok(c[Math.floor(c.length / 2)][2] < straightMid - 1,
    'the hose must sag; a straight line is a rigid rod');
  assert.ok(h.podPos[1] > 0.5, 'wind must blow the pod downstream');
});

test('an emergency release drops the pod', () => {
  const cls = resolveClass('P100');
  const b = build('P100', { tier: 0 });
  const h = createHose(cls, b.layout.hoseReels[0]);
  for (let i = 0; i < 300; i++) updateHose(h, 1 / 30, { progress: 1 });
  const before = h.podPos[2];
  for (let i = 0; i < 60; i++) updateHose(h, 1 / 30, { progress: 1, release: true });
  assert.ok(h.released);
  assert.ok(h.podPos[2] < before - 5, 'a released pod falls');
});

/* ---------- the driver ------------------------------------------------------------------------ */

test('the driver drives tank fill from state', () => {
  const b = build('P100', { tier: 2 });
  const d = createDriver(b);
  const fillNode = b.index.get('WaterTankFill');
  const zOf = (i) => fillNode.inst.xf[i * 16 + 10];        // the z scale
  updateDriver(d, 1 / 60, defaultState({ waterFraction: 0 }));
  const empty = zOf(0);
  updateDriver(d, 1 / 60, defaultState({ waterFraction: 1 }));
  const full = zOf(0);
  assert.ok(full > empty * 10, `fill did not scale (${empty} -> ${full})`);
  // xf[10] is the z scale in a column-major 4x4: the fill body is scaled to the fill fraction.
  assert.ok(Math.abs(full - 1) < 0.01, `a full tank should be at full scale, got ${full}`);
  assert.ok(empty < 0.01, 'an empty tank should be flat');
});

test('the driver drives LN2 fill by VOLUME, not mass', () => {
  const b = build('P100', { tier: 2 });
  const d = createDriver(b);
  const n = b.index.get('LN2TankFill');
  updateDriver(d, 1 / 60, defaultState({ ln2Fraction: 1 }));
  assert.ok(n.inst.xf[10] > 0.9);
  updateDriver(d, 1 / 60, defaultState({ ln2Fraction: 0 }));
  assert.ok(n.inst.xf[10] < 0.01);
});

test('a failed rotor stops turning and shows no thrust disc', () => {
  const b = build('P100', { tier: 2 });
  const d = createDriver(b);
  const rotor = b.index.get('PrimaryRotorA_00');
  const disc = b.index.get('PrimaryRotorDiscA_00');
  updateDriver(d, 0.5, defaultState());
  const spun = rotor.r[0];
  updateDriver(d, 0.5, defaultState({ failedComponents: ['PrimaryRotorStation_00'] }));
  assert.equal(rotor.r[0], spun, 'a failed rotor must not keep turning');
  assert.equal(disc.opacity, 0);
  assert.equal(b.index.get('PrimaryRotorStation_00').failed, true);
  clearFailures(b);
  assert.equal(b.index.get('PrimaryRotorStation_00').failed, false);
});

test('whole-body attitude is rate-limited by the class envelope', () => {
  for (const id of ['P100', 'P10000']) {
    const b = build(id, { tier: 0 });
    const d = createDriver(b);
    const want = defaultState({ attitude: { rollRad: 0, pitchRad: 0, yawRad: 0.6 } });
    let t = 0;
    // One second of 60 Hz frames.
    for (let i = 0; i < 60; i++) { updateDriver(d, 1 / 60, want); t += 1 / 60; }
    const degPerSec = (d.attitude.yawRad * 180) / Math.PI / t;
    assert.ok(degPerSec <= b.cls.maxYawRateDegS + 1e-6,
      `${id} yawed at ${degPerSec.toFixed(2)} deg/s, limit ${b.cls.maxYawRateDegS}`);
    assert.ok(d.attitude.yawRad < 0.6, 'it must not have arrived yet — this thing is enormous');
  }
});

test('reduced motion freezes rotors and snaps attitude', () => {
  const b = build('P100', { tier: 0 });
  const d = createDriver(b, { reduced: true });
  const rotor = b.index.get('PrimaryRotorA_00');
  const before = rotor.r[0];
  const want = defaultState({ attitude: { rollRad: 0, pitchRad: 0.1, yawRad: 0.3 } });
  updateDriver(d, 1 / 60, want);
  assert.equal(rotor.r[0], before, 'rotors must not spin under reduced motion');
  assert.ok(Math.abs(d.attitude.yawRad - 0.3) < 1e-9, 'attitude cuts rather than slews');
});

/* ---------- view modes and clipping ------------------------------------------------------------ */

test('every view mode produces a style for every node without throwing', () => {
  const b = build('P100', { tier: 2 });
  for (const mode of VIEW_MODES) {
    const vs = viewStyle(b, mode, { cutFrac: 0.5, cameraAzimuth: -0.9,
      systems: ['water'], failed: ['PrimaryRotorStation_00'] });
    assert.ok(VIEW_LABELS[mode], `no label for ${mode}`);
    assert.ok(vs.caption.length > 10);
    walk(b.root, (n) => { vs.styleFor(n); return true; });
  }
});

test('exterior hides the interior and the cutaways clip', () => {
  const b = build('P100', { tier: 2 });
  const ext = viewStyle(b, 'exterior', {});
  assert.equal(ext.clips.length, 0);
  assert.ok(ext.styleFor(b.index.get('WaterTanks')).hidden, 'tanks must not show through the skin');
  assert.equal(ext.styleFor(b.index.get('OuterFairing')), null, 'the fairing is the exterior');

  const cut = viewStyle(b, 'cutaway-longitudinal', { cutFrac: 0.5, cameraAzimuth: 1.0 });
  assert.equal(cut.clips.length, 1);
  assert.ok(cut.extraNodes[0], 'a cutaway must be capped');
});

test('the cut plane stays inside the hull at both extremes', () => {
  const b = build('P1000', { tier: 1 });
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    for (const mode of ['cutaway-longitudinal', 'cutaway-transverse']) {
      const vs = viewStyle(b, mode, { cutFrac: f, cameraAzimuth: -0.9 });
      const plane = vs.clips[0];
      assert.ok(plane.every((v) => isFinite(v)), `${mode} @ ${f}: non-finite plane`);
      const off = Math.abs(plane[3]);
      const lim = mode === 'cutaway-longitudinal' ? b.cls.maxRadiusM : b.cls.lengthM;
      assert.ok(off <= lim * 1.001, `${mode} @ ${f}: plane ${off} outside ±${lim}`);
    }
  }
});

test('the cut follows the camera so the near half is always the one removed', () => {
  const b = build('P100', { tier: 1 });
  const port = viewStyle(b, 'cutaway-longitudinal', { cutFrac: 0.5, cameraAzimuth: 1.2 });
  const stbd = viewStyle(b, 'cutaway-longitudinal', { cutFrac: 0.5, cameraAzimuth: -1.2 });
  assert.notEqual(port.clips[0][1], stbd.clips[0][1], 'the plane must flip with the camera');
});

test('the cut cap is a skin band, not a lid over the opening', () => {
  const cls = resolveClass('P100');
  const g = capGeom(cls, 'y', 0);
  assert.ok(g && g.tris > 0);
  // A lid would have vertices right across the section; a band only near the boundary.
  let interior = 0;
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i], z = g.pos[i + 2];
    const R = Math.max(1e-6, cls.maxRadiusM);
    if (Math.abs(z) < R * 0.5 && Math.abs(x) < cls.lengthM * 0.25) interior++;
  }
  assert.equal(interior, 0, 'the cap must not cover the middle of the section');
});

test('isolation shows one component and dims the rest', () => {
  const b = build('P100', { tier: 1 });
  const vs = viewStyle(b, 'ghost', { isolate: 'Generator_00' });
  const gen = b.index.get('Generators');
  assert.equal(vs.styleFor(gen).hidden, undefined, 'the isolated container stays');
  assert.ok(vs.styleFor(b.index.get('LN2Tanks')).hidden, 'everything else goes');
});

/* ---------- SVG export -------------------------------------------------------------------------- */

test('every figure view and mode renders valid, self-describing SVG', () => {
  const b = build('P100', { tier: 1 });
  for (const view of Object.keys(FIGURE_VIEWS)) {
    for (const mode of ['exterior', 'wire', 'lattice', 'cutaway', 'silhouette']) {
      const svg = staticFigureSVG(b, { view, mode, width: 440, height: 200 });
      assert.match(svg, /^<svg /, `${view}/${mode}`);
      assert.match(svg, /<\/svg>$/, `${view}/${mode}`);
      assert.match(svg, /role="img"/, `${view}/${mode} has no role`);
      assert.match(svg, /aria-label="[^"]{10,}"/, `${view}/${mode} has no text alternative`);
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `${view}/${mode} emitted a bad number`);
      assert.ok(svg.length > 300, `${view}/${mode} is suspiciously empty`);
    }
  }
});

test('SVG output is deterministic', () => {
  const a = staticFigureSVG(build('P1000', { tier: 1 }), { view: 'side', mode: 'wire' });
  const b = staticFigureSVG(build('P1000', { tier: 1 }), { view: 'side', mode: 'wire' });
  assert.equal(a, b);
});

test('the scale figure uses one real scale and names its references', () => {
  const svg = scaleComparisonSVG(CLASS_IDS.map((id) => resolveClass(id)));
  assert.match(svg, /P-10000/);
  assert.match(svg, /Hindenburg/);
  assert.match(svg, /Boeing 747/);
  assert.match(svg, /One scale throughout/);
  assert.match(svg, /enlarged for visibility/);
  assert.ok(!/NaN/.test(svg));
});

/* ---------- palette and styles ------------------------------------------------------------------- */

test('every material and category tone is well formed', () => {
  for (const [k, m] of Object.entries(MATERIALS)) {
    assert.ok(['surface', 'glass', 'line', 'flat'].includes(m.kind), `${k}: bad kind ${m.kind}`);
    assert.match(m.color, /^#[0-9a-f]{6}$/i, `${k}: bad colour ${m.color}`);
  }
  for (const [k, t] of Object.entries(CATEGORY_TONE)) {
    assert.match(t.color, /^#[0-9a-f]{6}$/i, k);
    assert.ok(t.label.length > 3, k);
  }
  for (const t of Object.values(CLAIM_TONE)) assert.ok(t.label.length > 3);
});

test('colour is never the only channel', () => {
  // Every category either has a distinct hue AND a dash pattern, or shares a hue with a category
  // it is distinguished from by dash. The point is that no two categories are separable by hue
  // alone without also being separable some other way.
  const byColour = new Map();
  for (const [k, t] of Object.entries(CATEGORY_TONE)) {
    const list = byColour.get(t.color) || [];
    list.push([k, t]);
    byColour.set(t.color, list);
  }
  for (const [colour, list] of byColour) {
    if (list.length < 2) continue;
    const dashes = list.map(([, t]) => JSON.stringify(t.dash));
    assert.equal(new Set(dashes).size, list.length,
      `categories sharing ${colour} must differ by dash: ${list.map(([k]) => k)}`);
  }
});

test('the stylesheet carries reduced-motion and focus rules', () => {
  assert.match(CSS, /prefers-reduced-motion/);
  assert.match(CSS, /focus-visible/);
  assert.match(CSS, /aria-pressed/);
});

/* ---------- camera --------------------------------------------------------------------------------- */

test('camera presets are all reachable and user input cancels a move', () => {
  const cls = resolveClass('P100');
  const cam = createCamera({ radius: 100 });
  for (const id of PRESET_IDS) {
    assert.ok(goToPreset(cam, id, cls, { seconds: 1 }), `preset ${id} failed`);
    assert.ok(cam.transition, 'a move should be running');
    orbit(cam, 0.01, 0);
    assert.equal(cam.transition, null, `user input did not cancel the ${id} move`);
  }
});

test('a preset move completes and stays inside the distance limits', () => {
  const cls = resolveClass('P1000');
  const cam = createCamera({ radius: 200 });
  goToPreset(cam, 'rotor', cls, { seconds: 1 });
  for (let i = 0; i < 120; i++) {
    updateCamera(cam, 1 / 60);
    assert.ok(cam.distance >= cam.minDistance - 1e-6 && cam.distance <= cam.maxDistance + 1e-6);
  }
  assert.equal(cam.transition, null, 'the move should have finished');
});

/* ---------- the Fable adapter ---------------------------------------------------------------------- */

/** A state shaped exactly like the /airships page's `stateAt()` output. */
const hostState = (over = {}) => ({
  idx: 2, phase: 'WATER_FILL', label: 'pump water aboard', prog: 0.5,
  ll: [-120, 50], bearing: 90, alt: 300,
  water: 50, ln2: 12,
  draw: { hotel: 0.16, pumps: 1.635, prop: 0.2, fans: 0, cryo: 0, winch: 0, rotors: 0 },
  massT: 162, buoyN: 2.16e6, weightN: 1.59e6, netN: 5.7e5, cycleN: 3,
  ...over,
});
const hostClass = { id: 'P100', name: 'P-100', payloadT: 100, dispM3: 180000, lenM: 177, diaM: 44 };

test('the adapter translates units the monitor and the model disagree about', () => {
  const cls = resolveClass('P100');
  const s = fromMonitorState(hostState(), hostClass, cls, {});
  // water and ln2 arrive in TONNES and must leave as fractions.
  assert.ok(Math.abs(s.waterFraction - 0.5) < 1e-9, `waterFraction ${s.waterFraction}`);
  assert.ok(Math.abs(s.ln2Fraction - 12 / cls.ln2TankCapacityTonnes) < 1e-9);
  assert.equal(s.altitudeM, 300);
  assert.equal(s.phase, 'WATER_FILL');
  assert.ok(Math.abs(s.pumpPowerMW - 1.635) < 1e-9);
  assert.ok(Math.abs(s.propulsionPowerMW - 0.2) < 1e-9);
  assert.deepEqual(validateState(s), []);
});

test('the adapter supplies what the monitor has no reason to carry', () => {
  const cls = resolveClass('P100');
  const s = fromMonitorState(hostState(), hostClass, cls, {});
  assert.ok(s.hoseProgress > 0.9, 'the hose must be out during a fill');
  assert.ok(s.pumpPodDepthM > 200);
  const drop = fromMonitorState(hostState({ phase: 'WATER_RELEASE', prog: 0.6, water: 40 }),
    hostClass, cls, {});
  assert.ok(drop.waterReleaseProgress > 0.5);
  assert.ok(drop.verticalSpeedMps > 0, 'a dropping ship is already rising');
});

test('the adapter never invents a mission for an idle aircraft', () => {
  const cls = resolveClass('P100');
  const s = fromMonitorState(hostState({ phase: 'NO_SUITABLE_SOURCE', water: 0, ln2: 0, prog: 0 }),
    hostClass, cls, {});
  assert.equal(s.phase, 'WEATHER_HOLD');
  assert.equal(s.waterFraction, 0);
  assert.equal(s.hoseProgress, 0);
});

test('the adapter accepts every phase the monitor can emit', () => {
  const cls = resolveClass('P100');
  for (const p of [...MISSION_PHASES, 'NO_SUITABLE_SOURCE']) {
    const s = fromMonitorState(hostState({ phase: p }), hostClass, cls, {});
    assert.deepEqual(validateState(s), [], `phase ${p}`);
  }
});

test('checkHostState names exactly what it needs', () => {
  assert.deepEqual(checkHostState(hostState()), []);
  for (const f of REQUIRED_HOST_FIELDS) {
    const bad = hostState();
    delete bad[f];
    const errs = checkHostState(bad);
    assert.ok(errs.some((e) => e.includes(f)), `dropping ${f} was not reported`);
  }
  assert.ok(checkHostState({ ...hostState(), phase: 'MADE_UP' }).length > 0);
});

test('adaptMission picks the class and produces a mass state', () => {
  const a = adaptMission({ cls: { ...hostClass, id: 'P1000' } }, hostState(), {});
  assert.equal(a.classId, 'P1000');
  assert.ok(a.mass.totalTonnes > 0);
});

test('adopting the host assumptions replaces ours rather than adding a second source', () => {
  const before = ASSUMPTIONS.eLN2;
  adoptAssumptions({ eLN2: 0.62, rtLN2: 0.41, hoseHead: 300, pumpEta: 0.8, propEta: 0.7,
    Cd: 0.05, rhoAir: 1.1, rhoSL: 1.225 });
  assert.equal(ASSUMPTIONS.eLN2, 0.62);
  assert.equal(ASSUMPTIONS.rtLN2, 0.41);
  setAssumptions({ eLN2: before, rtLN2: 0.5, hoseHead: 250, pumpEta: 0.75 });
});

test('the mapping is documented as data', () => {
  const m = describeMapping();
  assert.ok(m.length >= 10);
  for (const row of m) {
    assert.equal(row.length, 3);
    for (const cell of row) assert.ok(typeof cell === 'string' && cell.length > 2);
  }
  assert.ok(m.some(([from]) => from.includes('water')), 'the tonnes/fraction trap must be documented');
});

test('the tail mixer produces the torque axis it was asked for', () => {
  // Regression: the mixer took the MAGNITUDE of each fin's projection, so all four deflected the
  // same way — which produces ONLY roll. A yaw demand moved the surfaces and generated no yaw.
  //
  // The property under test is not a sign pattern (guessing one is how the first version of this
  // test was itself wrong): it is that the torque the deflected fins actually SUM to points along
  // the axis that was demanded.
  const b = build('P100', { tier: 1 });
  const d = createDriver(b);
  const tails = ['TailSurface_00', 'TailSurface_01', 'TailSurface_02', 'TailSurface_03']
    .map((id) => b.index.get(id));

  /** The torque one fin makes per unit deflection: p x (xhat x span). */
  const unitTorque = (t) => {
    const th = t.hinge.theta;
    const s = [0, -Math.cos(th), Math.sin(th)];
    const L = [0, -Math.sin(th), -Math.cos(th)];
    const p = [t.hinge.station, t.hinge.radius * s[1], t.hinge.radius * s[2]];
    return [p[1] * L[2] - p[2] * L[1], p[2] * L[0] - p[0] * L[2], p[0] * L[1] - p[1] * L[0]];
  };

  const summedFor = (torque) => {
    for (const t of tails) t.hinge.deflect = 0;
    const alloc = { desired: [0, 0, 0, ...torque], solution: [] };
    for (let i = 0; i < 200; i++) {
      updateDriver(d, 1 / 30, defaultState({ airspeedMps: 40 }), alloc);
    }
    const sum = [0, 0, 0];
    for (const t of tails) {
      const u = unitTorque(t);
      for (let k = 0; k < 3; k++) sum[k] += u[k] * t.hinge.deflect;
    }
    return { sum, deflections: tails.map((t) => t.hinge.deflect) };
  };

  for (const [name, demand] of [['roll', [1, 0, 0]], ['pitch', [0, 1, 0]], ['yaw', [0, 0, 1]]]) {
    const { sum, deflections } = summedFor(demand.map((v) => v * 1e7));
    const mag = Math.hypot(...sum);
    assert.ok(mag > 1e-6, `${name}: the fins produced no torque at all (${deflections})`);
    const unit = sum.map((v) => v / mag);
    const dot = unit[0] * demand[0] + unit[1] * demand[1] + unit[2] * demand[2];
    assert.ok(dot > 0.98,
      `${name}: the fins produced torque along [${unit.map((v) => v.toFixed(2))}], ` +
      `not [${demand}] (deflections ${deflections.map((v) => v.toFixed(2))})`);
  }

  // And the failure the regression is about: equal deflection can ONLY make roll, so a mixer that
  // deflects all four the same way for a yaw demand is broken by construction.
  const equal = [0, 0, 0];
  for (const t of tails) {
    const u = unitTorque(t);
    for (let k = 0; k < 3; k++) equal[k] += u[k];
  }
  assert.ok(Math.abs(equal[1]) < 1e-6 && Math.abs(equal[2]) < 1e-6 && Math.abs(equal[0]) > 1,
    'equal deflection of an X tail must give pure roll — the premise of this regression');
});

test('control surfaces are near-inert at a hover and active in cruise', () => {
  const b = build('P100', { tier: 1 });
  const d = createDriver(b);
  const fin = b.index.get('TailSurface_00');
  const alloc = { desired: [0, 0, 0, 0, 0, 1e7], solution: [] };
  for (let i = 0; i < 200; i++) updateDriver(d, 1 / 30, defaultState({ airspeedMps: 0 }), alloc);
  const hover = Math.abs(fin.hinge.deflect);
  for (let i = 0; i < 200; i++) updateDriver(d, 1 / 30, defaultState({ airspeedMps: 40 }), alloc);
  const cruise = Math.abs(fin.hinge.deflect);
  assert.ok(hover < 1e-6, `fins moved at a hover (${hover})`);
  assert.ok(cruise > 0.05, `fins did not move in cruise (${cruise})`);
});

test('the end-on camera presets look at the end they name', () => {
  // Regression: `nose` and `tail` had their azimuths swapped, so each preset put the eye beyond
  // the OPPOSITE end and you looked down the whole hull at the far tip.
  const cls = resolveClass('P100');
  const mk = () => createCamera({ radius: Math.max(cls.lengthM, cls.diameterM) * 0.55 });

  const nose = mk();
  goToPreset(nose, 'nose', cls, { immediate: true });
  const noseEye = cameraEye(nose);
  assert.ok(noseEye[0] > cls.xNose, `nose preset eye at x=${noseEye[0].toFixed(0)} is not ahead of the nose`);
  assert.ok(nose.target[0] > 0, 'nose preset should look at the forward end');

  const tail = mk();
  goToPreset(tail, 'tail', cls, { immediate: true });
  const tailEye = cameraEye(tail);
  assert.ok(tailEye[0] < cls.xTail, `tail preset eye at x=${tailEye[0].toFixed(0)} is not astern of the tail`);
  assert.ok(tail.target[0] < 0, 'tail preset should look at the aft end');

  // And from the tail preset the fins are nearer the camera than the hull's widest section is.
  const b = build('P100', { tier: 0 });
  const finX = b.layout.tailSurfaces[0].p[0];
  assert.ok(Math.abs(finX - tailEye[0]) < Math.abs(cls.xNose - tailEye[0]),
    'the fins should be the near end from the tail camera');
});

test('every view layer is reachable in the mode that is meant to show it', () => {
  // Regression: HullWire, ComponentEdges and LoadPaths were switched off at build time with
  // `node.visible`, which the renderer honours BEFORE it consults the view mode. The load-path
  // view therefore never drew load paths, the wire view never drew component edges or hull
  // meridians, and the shell-wire toggle could not work. Three bugs, one shape.
  const b = build('P100', { tier: 2 });
  const shows = (mode, id, params = {}) => {
    const n = b.index.get(id);
    assert.ok(n, `${id} is not in the tree`);
    assert.notEqual(n.visible, false,
      `${id} is hidden by node.visible, so no view mode can ever show it`);
    const st = viewStyle(b, mode, { cameraAzimuth: -0.9, ...params }).styleFor(n);
    return !(st && st.hidden);
  };

  assert.ok(shows('load-paths', 'LoadPaths'), 'the load-path view must show load paths');
  assert.ok(!shows('exterior', 'LoadPaths'), 'load paths must not leak into the exterior');

  assert.ok(shows('wire', 'ComponentEdges'), 'the wire view must show component edges');
  assert.ok(shows('wire', 'HullWire'), 'the wire view must show hull meridians');
  assert.ok(!shows('exterior', 'ComponentEdges'), 'component edges must not leak into the exterior');

  // The light shell is opt-in on the solid views and never appears without asking.
  assert.ok(!shows('exterior', 'HullWire'), 'the shell wire must be off by default');
  assert.ok(shows('exterior', 'HullWire', { shellWire: true }), 'shellWire must turn it on');
  assert.ok(shows('ghost', 'HullWire', { shellWire: true }), 'shellWire must work in ghost too');
});

test('only the ROTOR of a blower spins — the housing stays put', () => {
  // Regression: duct and blades were one merged mesh carried by one instance transform, so
  // "spinning the fan" turned the whole nacelle, flange and all. Housing and rotor are now
  // separate instanced containers sharing a placement, and only the rotor turns.
  for (const [housingId, rotorId] of [['LocalTrimFans', 'LocalTrimFanBlades'],
    ['MediumThrusters', 'MediumThrusterFans']]) {
    // A FRESH model per pair. Sharing one across both runs the same 30 frames twice at the same
    // rate, so the second driver lands on the phase the first one left behind and the transform
    // looks unchanged — a false failure that says nothing about the code.
    const b = build('P100', { tier: 2 });
    const acts = buildActuators(b.cls, b.layout);
    const m = massState(b.cls, defaultState({ waterFraction: 1 }), b.layout);
    const alloc = allocate(acts, demoWrench('lateral', b.cls, m.totalTonnes * 1000),
      { densityAt: (p) => b.field.sample(p).density },
      { weightN: m.weightN, armM: b.cls.lengthM / 2 });
    const housing = b.index.get(housingId);
    const rotor = b.index.get(rotorId);
    assert.ok(housing && rotor, `${housingId} / ${rotorId} missing`);
    const h0 = Array.from(housing.inst.xf);
    const r0 = Array.from(rotor.inst.xf);
    const d = createDriver(b);
    for (let i = 0; i < 30; i++) updateDriver(d, 1 / 60, defaultState({ airspeedMps: 10 }), alloc);
    assert.deepEqual(Array.from(housing.inst.xf), h0, `${housingId} moved — the housing must not spin`);
    assert.ok(Array.from(rotor.inst.xf).some((v, i) => Math.abs(v - r0[i]) > 1e-6),
      `${rotorId} did not turn`);
  }
});

test('blowers spin only when commanded, and stop when reduced motion is on', () => {
  const mk = () => build('P100', { tier: 2 });
  const b = mk();
  const acts = buildActuators(b.cls, b.layout);
  const m = massState(b.cls, defaultState({ waterFraction: 1 }), b.layout);
  const alloc = allocate(acts, demoWrench('lateral', b.cls, m.totalTonnes * 1000),
    { densityAt: (p) => b.field.sample(p).density },
    { weightN: m.weightN, armM: b.cls.lengthM / 2 });

  // Nothing commanded: nothing turns.
  const bIdle = mk();
  const idle = bIdle.index.get('LocalTrimFanBlades');
  const still = Array.from(idle.inst.xf);
  const dIdle = createDriver(bIdle);
  for (let i = 0; i < 30; i++) updateDriver(dIdle, 1 / 60, defaultState(), null);
  assert.deepEqual(Array.from(idle.inst.xf), still, 'uncommanded fans must not turn');

  // Reduced motion freezes them even when commanded.
  const b3 = mk();
  const d3 = createDriver(b3, { reduced: true });
  const f3 = b3.index.get('LocalTrimFanBlades');
  const s3 = Array.from(f3.inst.xf);
  for (let i = 0; i < 30; i++) updateDriver(d3, 1 / 60, defaultState({ airspeedMps: 10 }), alloc);
  assert.deepEqual(Array.from(f3.inst.xf), s3, 'reduced motion must stop the blowers');
});

test('ducted units have blades, or spinning them would animate nothing', () => {
  // A cylinder is rotationally symmetric: rotating it is invisible. The fan geometry must have
  // features off its own axis for the spin to read at all.
  const b = build('P100', { tier: 2 });
  for (const id of ['LocalTrimFanBlades', 'MediumThrusterFans']) {
    const g = b.index.get(id).geom;
    let offAxis = 0;
    for (let i = 0; i < g.pos.length; i += 3) {
      // a blade reaches out in y/z while sitting away from the duct wall
      const r = Math.hypot(g.pos[i + 1], g.pos[i + 2]);
      if (r > 1e-3) offAxis++;
    }
    assert.ok(g.tris > 60, `${id} has only ${g.tris} triangles — too simple to be a bladed fan`);
    assert.ok(offAxis > 20, `${id} has no off-axis geometry to make rotation visible`);
  }
});
