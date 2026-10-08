/* Control allocation.
 *
 * Given a wanted six-degree-of-freedom wrench (force + torque about the centre of mass), decide
 * what each actuator does. The method is a weighted minimum-norm solve with redistributed
 * clamping — the classical "cascading generalised inverse" — chosen because it is transparent:
 * every step can be printed and argued with, which matters more here than optimality.
 *
 * TWO THINGS MAKE THIS BEHAVE LIKE A VEHICLE RATHER THAN LIKE ARITHMETIC.
 *
 * 1. It allocates in NORMALISED control space. The variable per actuator is u in [-1,1], not
 *    newtons, so the minimum-norm solution equalises how hard each unit is working rather than
 *    how much force it contributes. Without this, a 2.6 kN trim fan is asked for the same force
 *    as a 423 kN rotor station, saturates instantly, and the whole set jams. With it, the big
 *    units carry the load and the fans trim — which is what they are for. This is the
 *    "saturation margin" term made structural rather than bolted on.
 *
 * 2. Direction and magnitude are solved in two phases. Phase 1 lets each vectoring unit point
 *    freely (three columns in its own frame), then clamps the result into its real envelope.
 *    Phase 2 FIXES those directions and re-solves for magnitudes alone, redistributing away from
 *    anything that hits its stop. One pass would report a wrench the vehicle cannot actually
 *    produce, because the direction clamp silently changes what each unit contributes.
 *
 * ENVELOPES. A primary station's gimbal swings about its athwartships pylon, so its reachable set
 * is a wedge through the fore-and-aft plane, not a cone about vertical. Ducted units get a cone.
 * Fixed fans get an axis. The clamp is per-kind and is the only place physical limits live.
 *
 * WEIGHTS. In order: electrical cost (via newtons per watt), off-nominal vectoring (a rotor would
 * rather not be pointing sideways), and pushing hard into a lightly built part of the structure
 * (from the density field). Failed units are dropped from the matrix, which is why reallocation
 * after a failure is not a special case — it is the same solve with fewer columns.
 *
 * SYMMETRY comes out rather than being asked for: over a symmetric layout with symmetric weights,
 * the minimum-norm solution of a symmetric demand is itself symmetric.
 *
 * This is a visualisation and systems-explanation model, not a flight-control system, and nothing
 * about it has been shown to stabilise anything.
 */

import { clamp, cross, dot, norm, len, mul, add, sub } from '../core/math.js?v=ceaf69ab';
import { idealDiscPower, wrenchOf } from './actuators.js?v=ceaf69ab';

/** Solve A x = b for a 6x6 A by Gauss-Jordan with partial pivoting. */
export function solve6(A, b) {
  const n = 6;
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * (n + 1) + j] = A[i * n + j];
    M[i * (n + 1) + n] = b[i];
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r * (n + 1) + c]) > Math.abs(M[piv * (n + 1) + c])) piv = r;
    }
    if (Math.abs(M[piv * (n + 1) + c]) < 1e-14) continue;      // singular column: leave it zero
    if (piv !== c) {
      for (let k = c; k <= n; k++) {
        const t = M[c * (n + 1) + k];
        M[c * (n + 1) + k] = M[piv * (n + 1) + k];
        M[piv * (n + 1) + k] = t;
      }
    }
    const d = M[c * (n + 1) + c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r * (n + 1) + c] / d;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r * (n + 1) + k] -= f * M[c * (n + 1) + k];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = M[i * (n + 1) + i];
    x[i] = Math.abs(d) < 1e-14 ? 0 : M[i * (n + 1) + n] / d;
  }
  return x;
}

/**
 * Weighted minimum-norm solve of  B u = target,  u minimising sum(w_i u_i^2).
 * Columns are {wrench:[6], w}. Returns the u vector.
 */
function minNorm(columns, target, lambda) {
  const G = new Float64Array(36);
  for (const c of columns) {
    const iw = 1 / Math.max(1e-12, c.w);
    for (let p = 0; p < 6; p++) {
      const wp = c.wrench[p] * iw;
      for (let q = p; q < 6; q++) G[p * 6 + q] += wp * c.wrench[q];
    }
  }
  for (let p = 0; p < 6; p++) for (let q = 0; q < p; q++) G[p * 6 + q] = G[q * 6 + p];
  let tr = 0;
  for (let p = 0; p < 6; p++) tr += G[p * 6 + p];
  const lam = lambda * (tr / 6 || 1);
  for (let p = 0; p < 6; p++) G[p * 6 + p] += lam;
  const y = solve6(G, target);
  return columns.map((c) => {
    let u = 0;
    for (let p = 0; p < 6; p++) u += c.wrench[p] * y[p];
    return u / Math.max(1e-12, c.w);
  });
}

const DEFAULTS = {
  lambda: 1e-6,
  energyWeight: 1,
  vectorWeight: 1.8,
  structuralWeight: 0.8,
  dirRounds: 3,
  magRounds: 5,
  densityAt: null,
};

function weightFor(a, o, efficiencyRef) {
  const eff = a.efficiencyNpW || 1e-9;
  const wEnergy = o.energyWeight * (efficiencyRef / eff);
  const dens = o.densityAt ? o.densityAt(a.r) : 0.6;
  return wEnergy * (1 + o.structuralWeight * (1 - dens));
}

/**
 * Clamp a commanded force to what the unit can physically produce.
 * @returns {{f:number[], axis:number[], dirLimited:boolean, magLimited:boolean}}
 */
export function clampToEnvelope(a, f) {
  let mag = len(f);
  if (mag < 1e-9) return { f: [0, 0, 0], axis: a.axis.slice(), dirLimited: false, magLimited: false };
  let dir = mul(f, 1 / mag);
  // The direction the UNIT POINTS, which is not the direction thrust acts when it is reversed.
  // The gimbal animation needs the former; the wrench needs the latter.
  let axis = dir;
  let dirLimited = false;

  if (a.envelope === 'wedge') {
    // Station frame: `up` is the nominal thrust axis, `swing` the pylon, `fwd` completes it.
    const up = a.axis;
    const swing = norm(a.swingAxis || [0, 1, 0]);
    const fwd = norm(cross(swing, up));

    /** Clamp one candidate pointing direction into the wedge; report what the stops cost. */
    const fit = (d) => {
      const yaw = Math.asin(clamp(dot(d, swing), -1, 1));
      const yawC = clamp(yaw, -a.yawMax, a.yawMax);
      const inPlane = norm(sub(d, mul(swing, Math.sin(yaw))));
      const pitch = Math.atan2(dot(inPlane, fwd), dot(inPlane, up));
      const pitchC = clamp(pitch, -a.pitchMax, a.pitchMax);
      const limited = yawC !== yaw || pitchC !== pitch;
      if (!limited) return { dir: d, keep: 1, limited: false };
      const cy = Math.cos(yawC), sy = Math.sin(yawC);
      const nd = norm(add(mul(swing, sy),
        mul(add(mul(up, Math.cos(pitchC)), mul(fwd, Math.sin(pitchC))), cy)));
      // What the stop costs is lost, not silently kept: project onto the reachable direction.
      return { dir: nd, keep: Math.max(0, dot(d, nd)), limited: true };
    };

    // A REVERSIBLE rotor may point either way and reverse thrust, so both orientations are
    // candidates and the better one wins. This is why the gimbal never needs to swing a motor all
    // the way round: with +/-90 degrees of travel the two candidates between them cover every
    // direction in the swing plane.
    const fwdFit = fit(dir);
    let chosen = fwdFit, sign = 1;
    if (a.reversible) {
      const revFit = fit(mul(dir, -1));
      if (revFit.keep > fwdFit.keep + 1e-9) { chosen = revFit; sign = -1; }
    }
    axis = chosen.dir;                 // where the gimbal points
    dir = mul(chosen.dir, sign);       // where the thrust acts
    mag *= chosen.keep;
    dirLimited = chosen.limited;
  } else if (a.coneRad <= 1e-3) {
    // Fixed axis: only the component along it survives. The duct does not move, so the axis is
    // the axis whichever way the fan is blowing.
    const sc = dot(dir, a.axis);
    if (!a.reversible && sc < 0) {
      return { f: [0, 0, 0], axis: a.axis.slice(), dirLimited: true, magLimited: false };
    }
    if (Math.abs(Math.abs(sc) - 1) > 1e-9) dirLimited = true;
    mag *= Math.abs(sc);
    dir = mul(a.axis, sc < 0 ? -1 : 1);
    axis = a.axis.slice();
  } else {
    let axis = a.axis;
    if (a.reversible && dot(dir, a.axis) < 0) axis = mul(a.axis, -1);
    else if (!a.reversible && dot(dir, a.axis) < 0) {
      return { f: [0, 0, 0], axis: a.axis.slice(), dirLimited: true, magLimited: false };
    }
    const c = clamp(dot(dir, axis), -1, 1);
    const ang = Math.acos(c);
    if (ang > a.coneRad + 1e-9) {
      const perp = sub(dir, mul(axis, c));
      const pl = len(perp);
      dir = pl < 1e-9 ? axis.slice()
        : add(mul(axis, Math.cos(a.coneRad)), mul(mul(perp, 1 / pl), Math.sin(a.coneRad)));
      mag *= Math.max(0, Math.cos(ang - a.coneRad));
      dirLimited = true;
    }
    axis = dir;
  }

  let magLimited = false;
  if (mag > a.fMaxN) { mag = a.fMaxN; magLimited = true; }
  return { f: mul(dir, mag), axis, dirLimited, magLimited };
}

/**
 * Allocate a desired wrench across the actuator set.
 *
 * @param {Actuator[]} actuators
 * @param {number[]} desired  [Fx,Fy,Fz,Tx,Ty,Tz], N and N·m, about the centre of mass
 * @param {object} [opts] see DEFAULTS; `densityAt(r)` supplies the structural weight
 * @param {object} [ref] { weightN, armM } — the scale residuals are reported against
 */
export function allocate(actuators, desired, opts = {}, ref = null) {
  const o = { ...DEFAULTS, ...opts };
  const live = actuators.filter((a) => a.enabled);
  const efficiencyRef = live.length
    ? live.reduce((m, a) => Math.max(m, a.efficiencyNpW || 0), 1e-9) : 1;

  const W = new Map();
  for (const a of live) W.set(a.id, weightFor(a, o, efficiencyRef));

  /* ---- phase 1: find a direction for every vectoring unit ---------------------------------- */
  const dirOf = new Map();     // where thrust acts
  const axisOf = new Map();    // where the unit POINTS — the same thing unless it is reversed
  for (const a of live) { dirOf.set(a.id, a.axis.slice()); axisOf.set(a.id, a.axis.slice()); }
  let rounds = 0;

  for (let it = 0; it < o.dirRounds; it++) {
    rounds++;
    const cols = [];
    for (const a of live) {
      const w = W.get(a.id);
      const dirs = a.envelope === 'wedge' || a.coneRad > 1e-3 ? a.basis : [a.axis];
      for (let k = 0; k < dirs.length; k++) {
        // Columns are in NORMALISED control space: the direction is scaled by fMax so u is the
        // fraction of the unit's capability, and the min-norm solution equalises effort.
        cols.push({
          a,
          dir: dirs[k],
          wrench: wrenchOf(a.r, mul(dirs[k], a.fMaxN)),
          w: k === 0 ? w : w * o.vectorWeight,
        });
      }
    }
    const u = minNorm(cols, desired, o.lambda);
    const acc = new Map();
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const cur = acc.get(c.a.id) || [0, 0, 0];
      acc.set(c.a.id, add(cur, mul(c.dir, u[i] * c.a.fMaxN)));
    }
    let moved = 0;
    for (const a of live) {
      const f = acc.get(a.id) || [0, 0, 0];
      if (len(f) < 1e-6) continue;
      const cl = clampToEnvelope(a, f);
      if (len(cl.f) < 1e-9) continue;
      const nd = norm(cl.f);
      moved += 1 - Math.abs(dot(nd, dirOf.get(a.id)));
      dirOf.set(a.id, nd);
      axisOf.set(a.id, cl.axis);
    }
    if (moved < 1e-4) break;
  }

  /* ---- phase 2: directions fixed, solve magnitudes with redistributed clamping -------------- */
  const mag = new Map();
  for (const a of live) mag.set(a.id, 0);
  const frozen = new Set();
  let target = desired.slice();

  for (let it = 0; it < o.magRounds; it++) {
    rounds++;
    const free = live.filter((a) => !frozen.has(a.id));
    if (!free.length) break;
    const cols = free.map((a) => ({
      a,
      dir: dirOf.get(a.id),
      wrench: wrenchOf(a.r, mul(dirOf.get(a.id), a.fMaxN)),
      w: W.get(a.id),
    }));
    const u = minNorm(cols, target, o.lambda);
    let newlyFrozen = 0;
    for (let i = 0; i < cols.length; i++) {
      const a = cols[i].a;
      let uu = u[i];
      // A non-reversible unit cannot pull. A gimballed rotor station is NOT reversible: its
      // gimbal already supplies the direction, and letting the solver drive it negative would
      // command thrust along a vector the gimbal cannot point at — an envelope violation the
      // clamp cannot see, because the clamp only checks the direction it was handed.
      const lo = a.reversible ? -1 : 0;
      const cl = clamp(uu, lo, 1);
      if (cl !== uu) { frozen.add(a.id); newlyFrozen++; }
      mag.set(a.id, cl * a.fMaxN);
    }
    // Recompute what the frozen set actually produces and hand the rest to the next round.
    const got = [0, 0, 0, 0, 0, 0];
    for (const a of live) {
      if (!frozen.has(a.id)) continue;
      const w = wrenchOf(a.r, mul(dirOf.get(a.id), mag.get(a.id)));
      for (let k = 0; k < 6; k++) got[k] += w[k];
    }
    target = desired.map((v, k) => v - got[k]);
    if (!newlyFrozen) break;
  }

  /* ---- report ------------------------------------------------------------------------------ */
  const solution = [];
  let powerW = 0;
  const saturated = [];
  const achieved = [0, 0, 0, 0, 0, 0];

  for (const a of actuators) {
    if (!a.enabled) {
      solution.push({
        id: a.id, kind: a.kind, force: [0, 0, 0], direction: a.axis.slice(),
        axis: a.axis.slice(), reversed: false, magnitude: 0,
        fraction: 0, signedFraction: 0, saturated: false, gimbalRad: 0, powerW: 0, enabled: false,
      });
      continue;
    }
    const d = dirOf.get(a.id) || a.axis;
    const m = mag.get(a.id) || 0;
    const f = mul(d, m);
    const absM = Math.abs(m);
    // A reversible unit commanded negative pushes the OTHER way. The reported direction has to be
    // the direction the thrust actually acts in, or every arrow drawn from it points backwards.
    const actual = m < 0 ? mul(d, -1) : d;
    const frac = a.fMaxN > 0 ? absM / a.fMaxN : 0;
    const p = absM > 0 ? idealDiscPower(a.discAreaM2, absM) : 0;
    powerW += p;
    const sat = frac > 0.995;
    if (sat) saturated.push(a.id);
    const w = wrenchOf(a.r, f);
    for (let k = 0; k < 6; k++) achieved[k] += w[k];
    const ax = axisOf.get(a.id) || a.axis;
    solution.push({
      id: a.id, kind: a.kind, force: f,
      direction: actual.slice(),
      // Where the unit POINTS. A reversed rotor thrusts opposite to the way it is aimed, and the
      // gimbal animation must follow the aim, not the thrust — otherwise a descent command swings
      // every station through 180 degrees on screen for no reason.
      axis: ax.slice(),
      reversed: dot(actual, ax) < 0,
      magnitude: absM,
      fraction: clamp(frac, 0, 1),
      signedFraction: clamp(a.fMaxN > 0 ? m / a.fMaxN : 0, -1, 1),
      saturated: sat,
      gimbalRad: Math.acos(clamp(dot(ax, a.axis), -1, 1)),
      powerW: p,
      enabled: true,
    });
  }

  const residual = desired.map((v, k) => v - achieved[k]);
  const wN = ref && ref.weightN ? ref.weightN : 0;
  const wArm = ref && ref.armM ? ref.armM : 1;
  const fDem = Math.hypot(desired[0], desired[1], desired[2]);
  const tDem = Math.hypot(desired[3], desired[4], desired[5]);
  const fRes = Math.hypot(residual[0], residual[1], residual[2]);
  const tRes = Math.hypot(residual[3], residual[4], residual[5]);

  return {
    desired: desired.slice(),
    achieved,
    residual,
    residualN: fRes,
    residualNm: tRes,
    // Shortfall against what was ASKED FOR — null when nothing was asked for on that axis, so a
    // "no torque wanted" case cannot be reported as an infinite percentage.
    shortfall: {
      force: fDem > 0 ? fRes / fDem : null,
      torque: tDem > 0 ? tRes / tDem : null,
    },
    // Unwanted output, against the vehicle's own scale. This is where cross-axis leakage shows:
    // a demand the envelope cannot meet cleanly produces force on axes nobody asked about, and
    // 0.6% of the vehicle's weight is the honest way to say how much.
    crossAxis: wN > 0 ? {
      forceFracOfWeight: fDem > 0 ? 0 : fRes / wN,
      torqueFracOfWeightArm: tDem > 0 ? 0 : tRes / (wN * wArm),
    } : null,
    demand: { forceN: fDem, torqueNm: tDem },
    solution,
    saturated,
    powerW,
    powerMW: powerW / 1e6,
    rounds,
    /** Fraction of the whole set's capability in use, for the saturation read-out. */
    utilisation: live.length
      ? solution.filter((s) => s.enabled).reduce((a, s) => a + s.fraction, 0) / live.length : 0,
  };
}

/**
 * Convenience wrenches for the lab's demonstration buttons. Scaled by the vehicle so the same
 * button means the same thing on every class: forces as a fraction of the vehicle's own weight,
 * torques as a fraction of (weight x half-length).
 */
export function demoWrench(kind, cls, massKg) {
  const W = massKg * 9.81;
  const arm = cls.lengthM / 2;
  const T = W * arm * 0.012;
  switch (kind) {
    case 'up': return [0, 0, 0.10 * W, 0, 0, 0];
    case 'down': return [0, 0, -0.10 * W, 0, 0, 0];
    case 'forward': return [0.05 * W, 0, 0, 0, 0, 0];
    case 'lateral': return [0, 0.05 * W, 0, 0, 0, 0];
    case 'yaw': return [0, 0, 0, 0, 0, T];
    case 'pitch': return [0, 0, 0, 0, T, 0];
    case 'roll': return [0, 0, 0, T * 0.4, 0, 0];
    case 'emergency': return [0.04 * W, 0.05 * W, 0.08 * W, 0, T * 0.6, -T * 0.9];
    case 'gust': return [0, -0.04 * W, 0.02 * W, 0, 0, T * 0.5];
    default: return [0, 0, 0, 0, 0, 0];
  }
}

/** Human-readable name for each demo wrench, for the lab and the accessible text alternative. */
export const WRENCH_LABELS = {
  up: 'Vertical force, up', down: 'Vertical force, down',
  forward: 'Forward acceleration', lateral: 'Lateral translation',
  yaw: 'Yaw torque', pitch: 'Pitch torque', roll: 'Roll torque',
  emergency: 'Combined emergency manoeuvre', gust: 'Gust rejection',
};

void cross;
