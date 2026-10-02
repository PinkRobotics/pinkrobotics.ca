/* Orbit camera, named presets and interruptible transitions.
 *
 * Rules this enforces, because getting them wrong is what makes a 3D viewer feel broken:
 *   - user input takes the camera IMMEDIATELY, mid-transition, with no snap-back
 *   - a preset move is a smooth interpolation in orbit coordinates (azimuth, elevation, distance,
 *     target), not a straight line in world space, so the camera never sails through the hull
 *   - distance is clamped so the near plane never eats the model and the far plane never collapses
 *     depth precision
 *   - the target is clamped to the model's bounds, so the model cannot be flung off screen
 */

import {
  clamp, lerp, easeInOut, m4lookAt, m4perspective, m4ortho, lerp3, add, sub, mul, norm, dist,
} from '../core/math.js?v=331c3257';
import { lerpAngle } from '../physics/state.js?v=331c3257';
import { stationX } from '../model/config.js?v=331c3257';

/**
 * @param {object} opts
 * @param {number} opts.radius  the model's bounding radius — sets the default distance and clamps
 */
export function createCamera(opts = {}) {
  const radius = opts.radius || 100;
  const cam = {
    azimuth: opts.azimuth === undefined ? -0.9 : opts.azimuth,   // radians, about +z
    elevation: opts.elevation === undefined ? 0.28 : opts.elevation,
    // 2.05 r fills a roughly 16:9 viewport with the hull at the default three-quarter angle.
    // The old 3.1 r left the ship floating in a third of the frame.
    distance: opts.distance || radius * 2.05,
    target: (opts.target || [0, 0, 0]).slice(),
    fovDeg: opts.fovDeg || 32,
    ortho: false,
    orthoHalfHeight: radius * 1.2,
    minDistance: radius * 0.25,
    maxDistance: radius * 14,
    minElevation: -1.45,
    maxElevation: 1.45,
    radius,
    /** Set while a preset move is running. Any user input clears it. */
    transition: null,
    _view: new Float32Array(16),
    _proj: new Float32Array(16),
  };
  return cam;
}

export function cameraEye(cam) {
  const ce = Math.cos(cam.elevation), se = Math.sin(cam.elevation);
  return [
    cam.target[0] + cam.distance * ce * Math.cos(cam.azimuth),
    cam.target[1] + cam.distance * ce * Math.sin(cam.azimuth),
    cam.target[2] + cam.distance * se,
  ];
}

export function viewMatrix(cam) {
  return m4lookAt(cameraEye(cam), cam.target, [0, 0, 1], cam._view);
}

export function projMatrix(cam, aspect) {
  // Near and far are tied to the current distance rather than fixed, which is what keeps depth
  // precision usable across a 177 m and an 820 m vehicle in the same viewer.
  const near = Math.max(cam.radius * 0.002, cam.distance * 0.01);
  const far = cam.distance + cam.radius * 12;
  if (cam.ortho) {
    return m4ortho(cam.orthoHalfHeight * aspect, cam.orthoHalfHeight, -far, far, cam._proj);
  }
  return m4perspective((cam.fovDeg * Math.PI) / 180, aspect, near, far, cam._proj);
}

/* ---------- interaction ---------------------------------------------------------------------- */

/** Any of these cancels a running preset move. That is the rule, in one place. */
function grab(cam) {
  cam.transition = null;
}

export function orbit(cam, dAzimuth, dElevation) {
  grab(cam);
  cam.azimuth += dAzimuth;
  cam.elevation = clamp(cam.elevation + dElevation, cam.minElevation, cam.maxElevation);
}

export function dolly(cam, factor) {
  grab(cam);
  cam.distance = clamp(cam.distance * factor, cam.minDistance, cam.maxDistance);
  cam.orthoHalfHeight = clamp(cam.orthoHalfHeight * factor, cam.radius * 0.1, cam.radius * 8);
}

/**
 * Drag the orbit target across the view plane.
 *
 * `centre` is the point the clamp box is built around, and it defaults to the world origin
 * because that is where the ship is. It stops defaulting the moment a viewer is looking at
 * something that is NOT at the origin: the cell explorer's part tours target a 25 mm joint
 * 0.29 m out, where a box of +-radius*1.6 about the origin snaps the target on the first
 * drag and throws the subject out of frame.
 */
export function pan(cam, dxScreen, dyScreen, viewportHeight, centre = [0, 0, 0]) {
  grab(cam);
  const eye = cameraEye(cam);
  const fwd = norm(sub(cam.target, eye));
  const right = norm([-fwd[1], fwd[0], 0]);
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const scale = cam.ortho
    ? (2 * cam.orthoHalfHeight) / viewportHeight
    : (2 * cam.distance * Math.tan((cam.fovDeg * Math.PI) / 360)) / viewportHeight;
  const move = add(mul(right, -dxScreen * scale), mul(up, dyScreen * scale));
  const t = add(cam.target, move);
  // Clamp the target into the subject's neighbourhood so it cannot be panned off the world.
  const lim = cam.radius * 1.6;
  cam.target = [clamp(t[0], centre[0] - lim, centre[0] + lim),
    clamp(t[1], centre[1] - lim, centre[1] + lim),
    clamp(t[2], centre[2] - lim, centre[2] + lim)];
}

/* ---------- presets ---------------------------------------------------------------------------- */

/**
 * Named camera presets, in orbit coordinates. `t` is a station along the hull (0 nose, 1 tail)
 * used to place the target; `d` is the distance as a multiple of the model radius and is only the
 * FALLBACK — when a class is supplied, `goToPreset` computes the distance by fitting the preset's
 * subject to the viewport ("might as well zoom to use the space available"):
 *
 *   fit:'ship'   the whole vehicle, rotors included
 *   fit:'span'   a stretch of hull between stations t0..t1 (the nose and tail close-ups)
 *   fit:'focus'  the bounding box of named layout record lists (needs opts.layout; falls back to
 *                the ship box without it) — this is what makes `water` and `ln2` actual close-ups
 *                of the tanks instead of wide shots with the tanks lost in them
 *   fit:'pod'    the ship plus the pump pod at full hose depth (opts.hoseDepthM, default: class hose length)
 *
 * `pad` is the fractional margin kept around the subject.
 */
export const PRESETS = {
  'three-quarter': { az: -0.95, el: 0.30, d: 2.1, t: 0.45, fit: 'ship', pad: 0.06, label: 'Exterior three-quarter' },
  side: { az: -Math.PI / 2, el: 0.0, d: 2.1, t: 0.45, fit: 'ship', pad: 0.05, label: 'Side elevation' },
  top: { az: -Math.PI / 2, el: 1.40, d: 2.2, t: 0.45, fit: 'ship', pad: 0.05, label: 'Top — solar surface' },
  underside: { az: -Math.PI / 2, el: -1.30, d: 2.2, t: 0.45, fit: 'ship', pad: 0.05, label: 'Underside — actuator layout' },
  // End-on views. The azimuth must put the eye OUTSIDE the end it is looking at: az 0 places the
  // eye at +x (ahead of the nose), az PI at -x (astern of the tail). These two were swapped, so
  // "Tail" put the camera in front of the nose and showed you 177 m of hull with the fins hidden
  // behind it — which is why the tail was hard to inspect straight on.
  nose: { az: 0, el: 0.10, d: 1.6, t: 0.10, fit: 'span', t0: 0, t1: 0.38, pad: 0.10, label: 'Nose' },
  tail: { az: Math.PI, el: 0.10, d: 1.6, t: 0.92, fit: 'span', t0: 0.58, t1: 1, rScale: 1.25, pad: 0.10, label: 'Tail' },
  'cutaway-long': { az: -1.25, el: 0.18, d: 2.1, t: 0.45, fit: 'ship', pad: 0.06, label: 'Longitudinal cutaway' },
  'cutaway-trans': { az: -0.20, el: 0.16, d: 1.7, t: 0.42, fit: 'ship', pad: 0.08, label: 'Transverse cutaway' },
  water: { az: -1.9, el: -0.45, d: 1.2, t: 0.50, fit: 'focus', keys: ['waterTanks'], pad: 0.10, label: 'Water system' },
  cryo: { az: -0.7, el: 0.15, d: 1.3, t: 0.28, fit: 'focus', keys: ['cryoModules'], pad: 0.12, label: 'Cryogenic plant' },
  ln2: { az: -2.05, el: -0.18, d: 1.0, t: 0.6, fit: 'focus', keys: ['ln2Tanks'], pad: 0.12, label: 'LN₂ ballast tanks' },
  power: { az: -2.4, el: -0.20, d: 1.3, t: 0.45, fit: 'focus', keys: ['generators'], pad: 0.18, label: 'Power system' },
  rotor: { az: -1.1, el: 0.10, d: 0.9, t: 0.30, fit: 'focus', keys: ['rotorStations'], near: 0.30, pad: 0.15, label: 'Main rotor station' },
  pumpbay: { az: -1.6, el: -0.75, d: 0.9, t: 0.50, fit: 'focus', keys: ['hoseReels', 'pumpPods'], pad: 0.25, label: 'Pump-pod bay' },
  mind: { az: -2.1, el: 0.25, d: 1.0, t: 0.44, fit: 'focus', keys: ['compute'], pad: 0.30, label: 'Vehicle Mind and safety kernel' },
  scale: { az: -Math.PI / 2, el: 0.12, d: 3.4, t: 0.5, fit: 'ship', pad: 0.28, label: 'Scale comparison' },
  mission: { az: -1.05, el: 0.22, d: 3.8, t: 0.5, fit: 'ship', pad: 0.42, label: 'Full mission' },
  'fire-approach': { az: -0.6, el: 0.08, d: 2.6, t: 0.4, fit: 'ship', pad: 0.22, label: 'Fire approach' },
  'source-filling': { az: -1.5, el: -0.25, d: 3.0, t: 0.5, fit: 'pod', pad: 0.10, label: 'Source filling' },
  'escape-climb': { az: -1.2, el: -0.55, d: 2.8, t: 0.5, fit: 'ship', pad: 0.26, label: 'Escape climb' },
};

/* ---------- subject fitting ------------------------------------------------------------------- */

/** Right/up/forward unit vectors of an orbit camera at (az, el), z-up. */
function viewBasis(az, el) {
  const ce = Math.cos(el), se = Math.sin(el);
  const fwd = [-ce * Math.cos(az), -ce * Math.sin(az), -se];   // eye -> target
  const rl = Math.hypot(fwd[0], fwd[1]) || 1;
  const right = [-fwd[1] / rl, fwd[0] / rl, 0];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  return { fwd, right, up };
}

/**
 * The smallest orbit distance from `target` at (az, el) that keeps every corner of the axis-
 * aligned box inside the frustum, with `pad` of the field kept as margin. Exact per corner:
 * a corner at camera-space offset o needs d >= |o·right|/tanH - o·fwd (and the same in V), because
 * its own depth (o·fwd) widens or narrows the frustum where it sits.
 */
export function fitDistance(cam, box, az, el, target, aspect = 1.6, pad = 0.08) {
  const { fwd, right, up } = viewBasis(az, el);
  const tanV = Math.tan((cam.fovDeg * Math.PI) / 360) * (1 - pad);
  const tanH = tanV * Math.max(0.6, Math.min(2.6, aspect));
  let d = 0;
  for (const cx of [box.min[0], box.max[0]]) {
    for (const cy of [box.min[1], box.max[1]]) {
      for (const cz of [box.min[2], box.max[2]]) {
        const o = [cx - target[0], cy - target[1], cz - target[2]];
        const ov = o[0] * fwd[0] + o[1] * fwd[1] + o[2] * fwd[2];
        const or_ = Math.abs(o[0] * right[0] + o[1] * right[1] + o[2] * right[2]);
        const ou = Math.abs(o[0] * up[0] + o[1] * up[1] + o[2] * up[2]);
        d = Math.max(d, or_ / tanH - ov, ou / tanV - ov);
      }
    }
  }
  return d;
}

/** Whole-vehicle box: hull plus the rotor stations, which reach well outboard of the skin. */
function shipBox(cls) {
  const ry = cls.maxRadiusM + (cls.primaryRotorDiameterM) * 1.1;
  const rz = cls.maxRadiusM * 1.05;
  return { min: [cls.xTail, -ry, -rz], max: [cls.xNose, ry, rz] };
}

function spanBox(cls, t0, t1, rScale = 1.05) {
  const r = cls.maxRadiusM * rScale;
  return { min: [stationX(cls, t1), -r, -r], max: [stationX(cls, t0), r, r] };
}

/** Circumscribing half-extent of one layout record, whatever family it belongs to. */
function recHalf(r) {
  return Math.max(
    r.radius !== undefined ? r.radius * 1.15 : 0,
    r.length !== undefined ? r.length * 0.6 : 0,
    r.size !== undefined ? r.size * 1.6 : 0,
    r.rotorDiameter !== undefined ? r.rotorDiameter * 0.85 : 0,
    1.5);
}

/** Bounding box of the named layout record lists; `nearT` filters to records near one station. */
function focusBox(layout, keys, nearT) {
  if (!layout) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const k of keys) {
    const v = layout[k];
    for (const rec of Array.isArray(v) ? v : (v ? [v] : [])) {
      if (!rec || !rec.p) continue;
      if (nearT !== undefined && rec.t !== undefined && Math.abs(rec.t - nearT) > 0.16) continue;
      const h = recHalf(rec);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], rec.p[a] - h);
        max[a] = Math.max(max[a], rec.p[a] + h);
      }
      any = true;
    }
  }
  return any ? { min, max } : null;
}

export const PRESET_IDS = Object.keys(PRESETS);

/**
 * Start a move to a preset. `immediate` (reduced motion) cuts instead of moving.
 * The transition is stored on the camera and advanced by `updateCamera`; any user input drops it.
 *
 * @param {object} [opts] { seconds, immediate, layout, aspect, hoseDepthM }
 *   layout      the build's layout record — lets `fit:'focus'` presets aim at the actual machinery
 *   aspect      viewport width/height, so the fit uses the space that is really there
 *   hoseDepthM  full pod depth for `source-filling` (defaults to the class hose length)
 */
export function goToPreset(cam, id, cls, opts = {}) {
  const { seconds = 1.1, immediate = false } = opts;
  const p = PRESETS[id];
  if (!p) return false;
  let target = [cls ? cls.xNose - p.t * cls.lengthM : 0, 0, 0];
  let distance = cam.radius * p.d;
  if (cls) {
    let box = null;
    if (p.fit === 'focus') {
      box = focusBox(opts.layout, p.keys, p.near) || shipBox(cls);
      target = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2];
    } else if (p.fit === 'span') {
      box = spanBox(cls, p.t0, p.t1, p.rScale);
      target = [(box.min[0] + box.max[0]) / 2, 0, 0];
    } else if (p.fit === 'pod') {
      // The pod hangs hoseDepthM below the keel; the shot must hold ship AND pod at full payout.
      const depth = opts.hoseDepthM === undefined ? cls.hoseLengthM : Math.max(0, opts.hoseDepthM);
      box = shipBox(cls);
      box.min[2] = -cls.maxRadiusM - depth - Math.max(3.2, cls.maxRadiusM * 0.14) * 1.2;
      target = [cls.xNose - 0.5 * cls.lengthM, 0, (box.max[2] + box.min[2]) / 2];
    } else if (p.fit === 'ship') {
      box = shipBox(cls);
    }
    if (box) distance = fitDistance(cam, box, p.az, p.el, target, opts.aspect, p.pad);
  }
  distance = clamp(distance, cam.minDistance, cam.maxDistance);
  const to = {
    azimuth: p.az, elevation: p.el, distance, target,
    orthoHalfHeight: distance * 0.45,
  };
  if (immediate || seconds <= 0) {
    Object.assign(cam, {
      azimuth: to.azimuth, elevation: to.elevation, distance: to.distance,
      target: to.target.slice(), orthoHalfHeight: to.orthoHalfHeight,
    });
    cam.transition = null;
    return true;
  }
  cam.transition = {
    from: {
      azimuth: cam.azimuth, elevation: cam.elevation, distance: cam.distance,
      target: cam.target.slice(), orthoHalfHeight: cam.orthoHalfHeight,
    },
    to, t: 0, seconds, id,
  };
  return true;
}

/** Advance any running transition. Returns true if the camera changed this frame. */
export function updateCamera(cam, dt) {
  const tr = cam.transition;
  if (!tr) return false;
  tr.t = Math.min(1, tr.t + dt / tr.seconds);
  const k = easeInOut(tr.t);
  cam.azimuth = lerpAngle(tr.from.azimuth, tr.to.azimuth, k);
  cam.elevation = lerp(tr.from.elevation, tr.to.elevation, k);
  // Distance interpolates geometrically: a linear ramp from 5 r to 0.5 r spends most of its time
  // far away and then lurches.
  cam.distance = tr.from.distance * Math.pow(tr.to.distance / tr.from.distance, k);
  cam.orthoHalfHeight = tr.from.orthoHalfHeight *
    Math.pow(tr.to.orthoHalfHeight / tr.from.orthoHalfHeight, k);
  cam.target = lerp3(tr.from.target, tr.to.target, k);
  if (tr.t >= 1) cam.transition = null;
  return true;
}

/**
 * Push the camera out of the hull if a preset or a dolly has put it inside. The hull is a body of
 * revolution, so "inside" is an exact analytic test rather than a raycast.
 */
export function avoidInterior(cam, cls, hullRFn, marginM) {
  if (!cls) return;
  const eye = cameraEye(cam);
  const t = (cls.xNose - eye[0]) / cls.lengthM;
  if (t < 0 || t > 1) return;
  const r = hullRFn(cls, eye[0]) + marginM;
  const rr = Math.hypot(eye[1], eye[2]);
  if (rr < r) {
    // Back off along the view ray until clear.
    const need = (r - rr) / Math.max(0.15, Math.cos(cam.elevation));
    cam.distance = clamp(cam.distance + need * 1.15, cam.minDistance, cam.maxDistance);
  }
}

/** Frame the whole model. */
export function frameAll(cam, radius, target = [0, 0, 0]) {
  cam.distance = radius * 2.05;
  cam.target = target.slice();
  cam.orthoHalfHeight = radius * 0.95;
  cam.transition = null;
}

void dist;
