/* The hose and the pump pod.
 *
 * The intake architecture is the part of this vehicle that most needs to be seen rather than
 * described, and it is also the easiest thing to get physically wrong in an animation. The rules
 * this file exists to keep:
 *
 *   - the aircraft NEVER touches the water; the hose reaches down to it
 *   - the pump is at the SUBMERGED end, pushing water up. An onboard suction pump cannot lift
 *     water past about 10 m of head at sea level no matter how much power it has; the working
 *     head is the class hose length
 *   - the hose is a loaded, sagging line under tension. It is not a rigid weightless rod and it
 *     must not be drawn as a straight segment
 *   - it drains before it retracts (a full hose is several tonnes of water hanging on the winch)
 *
 * IMPLEMENTATION. An analytic catenary in the vertical plane, blown off the vertical by wind, with
 * the pod as a critically damped follower of its commanded position. No rope solver: a soft-body
 * simulation here would cost more than the entire rest of the frame and would be less predictable.
 * The curve is deterministic given (progress, wind, ship motion), which is what lets the same
 * animation appear in a static exported figure.
 */

import { clamp, clamp01, lerp, damp, add, sub, mul, len, norm } from '../core/math.js?v=ceaf69ab';
import { sourceAltM, G } from '../model/config.js?v=ceaf69ab';
import { tubeGeom } from '../model/geom.js?v=ceaf69ab';

/**
 * @param {object} cls   resolved class
 * @param {object} reel  layout record for the reel this hose belongs to
 * @param {object} opts  { headM, segments }
 */
export function createHose(cls, reel, opts = {}) {
  const headM = opts.headM ?? sourceAltM(cls);
  return {
    id: `Hose_${String(reel.index).padStart(2, '0')}`,
    reel,
    headM,
    segments: opts.segments || 24,
    // state
    deployed: 0,          // 0..1 of headM paid out
    podPos: reel.p.slice(),
    podVel: [0, 0, 0],
    podPitch: 0,
    waterFlow: 0,         // 0..1, drives the flow shader and the drain behaviour
    tensionN: 0,
    released: false,
    spinRad: 0,
    podLengthM: opts.podLengthM || Math.max(3.2, cls.maxRadiusM * 0.14),
  };
}

/**
 * Advance the hose one frame.
 *
 * @param {object} h
 * @param {number} dt seconds
 * @param {object} cmd { progress, waterFlow, windMps:[x,y,z], shipVel:[x,y,z], release, reduced,
 *                       waterSurfaceZ }
 */
export function updateHose(h, dt, cmd = {}) {
  const target = clamp01(cmd.progress === undefined ? h.deployed : cmd.progress);
  // `snap` is for a CUT, not a frame: the viewer has been pointed at a different ship, and
  // easing from the previous one's winch state would show this hull reeling in line it never
  // had out. Everything else in this file is deliberately rate-limited; this is the one case
  // where the previous state is not this vehicle's history at all.
  if (cmd.snap) { h.deployed = target; h.podPos = null; }
  // The winch has a rate. Paying out is faster than hauling in, as it is on any winch.
  // These are CAPS against a jumping target (a phase skip, a ship swap) — in normal play the
  // commanded progress itself ramps in sim time (hoseDeployMin/hoseRetractMin through the
  // monitor's phase durations), and the caps must stay above that ramp at 20x play speed.
  const rate = target > h.deployed ? 0.30 : 0.22;
  const step = rate * Math.min(dt, 0.1);
  h.deployed = Math.abs(target - h.deployed) < step ? target
    : h.deployed + Math.sign(target - h.deployed) * step;

  h.waterFlow = clamp01(cmd.waterFlow === undefined ? 0 : cmd.waterFlow);
  if (cmd.release) h.released = true;

  const reel = h.reel.p;
  const depth = h.deployed * h.headM;
  const wind = cmd.windMps || [0, 0, 0];
  // Wind blows the pod downstream; the deeper it hangs, the further it goes. A real pod would
  // also be dragged by the ship's own motion, which is what `shipVel` contributes.
  const drift = mul(add(mul(wind, 0.55), mul(cmd.shipVel || [0, 0, 0], -0.8)), depth / 120);

  let want;
  if (h.released) {
    // Emergency release: the pod is no longer attached. It falls and the hose goes with it.
    h.podVel = add(h.podVel, [0, 0, -G * dt]);
    want = add(h.podPos, mul(h.podVel, dt));
  } else {
    want = [reel[0] + drift[0], reel[1] + drift[1], reel[2] - depth];
    if (cmd.waterSurfaceZ !== undefined) {
      // The pod stops at the surface and submerges only a little way below it.
      want[2] = Math.max(want[2], cmd.waterSurfaceZ - h.podLengthM);
    }
  }

  if (h.released) {
    // Once released the pod is ballistic. Damping it toward a target derived from its own
    // position would cancel the velocity it is accumulating, and it would hang in the air.
    h.podPos = want;
  } else if (cmd.snap || h.podPos === null) {
    h.podPos = want;
    h.podVel = [0, 0, 0];
  } else if (cmd.reduced) {
    h.podPos = want;
    h.podVel = [0, 0, 0];
  } else {
    const prev = h.podPos;
    h.podPos = [
      damp(prev[0], want[0], 2.2, dt),
      damp(prev[1], want[1], 2.2, dt),
      damp(prev[2], want[2], 3.4, dt),
    ];
    h.podVel = dt > 0 ? mul(sub(h.podPos, prev), 1 / dt) : [0, 0, 0];
  }

  // Pitch: the pod hangs nose-down along the hose's local direction at its lower end.
  const dir = norm(sub(h.podPos, reel));
  h.podPitch = Math.atan2(-dir[0], -dir[2]);

  // Tension: the suspended hose mass plus the water column it currently holds, plus drag.
  const hoseMassPerM = 6 + 30 * h.waterFlow;
  h.tensionN = depth * hoseMassPerM * 9.81 + len(h.podVel) * 800;
  h.spinRad = reelAngleRad(h);

  return h;
}

/**
 * The curve, as a point list. A catenary between the reel and the pod, with sag proportional to
 * the slack that has been paid out — a taut hose is nearly straight, a slack one bellies.
 */
export function hoseCurve(h, segments = null) {
  const n = segments || h.segments;
  const a = h.reel.p, b = h.podPos;
  const straight = len(sub(b, a));
  const paid = h.deployed * h.headM * 1.06;                // 6% more line than the straight run
  const slack = Math.max(0, paid - straight);
  const sag = Math.min(straight * 0.34, slack * 0.9);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    // A catenary's shape is cosh; over one span the parabolic term is visually identical and
    // costs one multiply.
    p[2] -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

/** Rebuild the hose tube geometry in place. Called only when the curve actually moved. */
export function hoseGeometry(h, radius, segments = null, radial = 6) {
  return tubeGeom(hoseCurve(h, segments), radius, radial);
}

/** Depth of the pod below the reel, metres — the state field the panel reports. */
export const podDepthM = (h) => Math.max(0, h.reel.p[2] - h.podPos[2]);

/** Reel rotation implied by the line paid out, for the winch animation. */
export function reelAngleRad(h) {
  return (h.deployed * h.headM) / Math.max(0.5, h.reel.radius);
}

void clamp;
