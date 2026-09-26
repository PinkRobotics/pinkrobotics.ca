/* The state driver: AirshipVisualState in, node-tree mutations out.
 *
 * This is the only place that writes to the tree per frame. Everything it does is a function of
 * the state object, the class config and the allocator's solution — no hidden animation clocks
 * except the ones that must be continuous (rotor phase, reel rotation), and those are exposed so
 * a static export can reproduce a frame exactly.
 *
 * MOTION MUST COMMUNICATE SCALE. Whole-body attitude is rate-limited by the class's own envelope
 * (1.8 deg/s in pitch for a P-100, 0.6 for a P-10000) and accelerated toward that limit rather
 * than snapped to it. Rotors and gimbals are NOT rate-limited to the same degree — they slew at
 * 18 deg/s — because that contrast is the point: the actuators are quick and the vehicle is not.
 * An 800 m machine that pirouettes is the single most common way this kind of visualisation lies.
 */

import { clamp, clamp01, lerp, damp, norm, mul, add, sub, len, easeInOut } from '../core/math.js?v=41bc1f51';
import { setInstance, aimEuler, instanceById } from '../model/build.js?v=41bc1f51';
import { byPrefix, walk } from '../core/nodes.js?v=41bc1f51';
import { massState, waterVolumeM3, ln2VolumeM3, ln2TankLevels, inertia } from '../physics/mass.js?v=41bc1f51';
import { createHose, updateHose, hoseCurve, podDepthM, reelAngleRad } from './hose.js?v=41bc1f51';
import { hoseGeometry } from './hose.js?v=41bc1f51';
import { STATE_TONE, TOKENS } from '../render/palette.js?v=41bc1f51';

/** Wind used by the hose and the drift behaviour when the host has not supplied a field. */
const DEFAULT_WIND = [0, 0, 0];

/** Deterministic per-particle jitter in [0,1) — no Math.random, so frames stay reproducible. */
const hash01 = (x) => { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); };

/**
 * @param {object} b   build() result
 * @param {object} opts { headM, reduced }
 */
export function createDriver(b, opts = {}) {
  const cls = b.cls;
  const idx = b.index;

  const stations = byPrefix(idx, 'PrimaryRotorStation_');
  const gimbals = new Map();
  const rotors = new Map();
  const discs = new Map();
  for (const st of stations) {
    const i = st.id.slice(-2);
    gimbals.set(st.id, idx.get(`PrimaryRotorGimbal_${i}`));
    rotors.set(st.id, [idx.get(`PrimaryRotorA_${i}`), idx.get(`PrimaryRotorB_${i}`)]);
    discs.set(st.id, [idx.get(`PrimaryRotorDiscA_${i}`), idx.get(`PrimaryRotorDiscB_${i}`)]);
  }

  const hoses = b.layout.hoseReels.map((r) => createHose(cls, r, { headM: opts.headM || 250 }));
  const hoseNodes = hoses.map((h) => idx.get(h.id));
  const podNodes = b.layout.pumpPods.map((p) => idx.get(p.id));
  const reelInst = idx.get('HoseReels');

  const waterTanks = idx.get('WaterTanks');
  const waterFill = idx.get('WaterTankFill');
  const dropSpray = idx.get('DropSpray');
  const flowSlugs = idx.get('FlowSlugs');
  const pipeFlow = idx.get('PipeFlow');
  const airStreaks = idx.get('AirStreaks');
  const motionLines = idx.get('MotionLines');
  const windLines = idx.get('WindLines');
  const gustPuffs = idx.get('GustPuffs');
  const hoseFlow = idx.get('HoseFlow');
  const ln2Tanks = idx.get('LN2Tanks');
  const ln2Fill = idx.get('LN2TankFill');
  const tails = byPrefix(idx, 'TailSurface_');

  return {
    build: b,
    hoses,
    /** Continuous phases, exposed so a figure export can pin them. */
    clock: { rotorPhase: 0, fanPhase: 0, t: 0 },
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    attitudeRate: { roll: 0, pitch: 0, yaw: 0 },
    _nodes: { stations, gimbals, rotors, discs, hoseNodes, podNodes, reelInst,
      waterTanks, waterFill, ln2Tanks, ln2Fill, tails, dropSpray, flowSlugs, pipeFlow,
      airStreaks, motionLines, windLines, gustPuffs, hoseFlow },
    reduced: !!opts.reduced,
  };
}

/**
 * Advance the model one frame.
 *
 * @param {object} d       driver
 * @param {number} dt      seconds (already clamped by the caller)
 * @param {object} state   AirshipVisualState
 * @param {object} [alloc] allocator result, if the scene is driving the actuators
 * @param {object} [env]   { windMps, waterSurfaceZ, shipVel }
 */
/**
 * How hard the rotors are holding the hull DOWN, in [-1, 0].
 *
 * Never positive: this design carries a permanent lift reserve, so it is buoyant with a full
 * payload and hugely so when empty. Climbing is done by RELAXING the hold, not by thrusting
 * up. The magnitude is the physics — surplus lift right now over the most there can be — so
 * the fill's decay and the drop run's growth come out of the mass ledger rather than by hand.
 *
 * Exported because it is the invariant worth testing: a picture of wash blowing downward off
 * a hull that is thousands of tonnes light argues against its own numbers.
 */
export function verticalDuty(cls, state, layout) {
  // When the host computes this itself (the fleet monitor does, so that its 2D avatar and its
  // power ledger read the SAME number as the model), take it. Two implementations of one
  // physical quantity is two chances to disagree, and they did.
  if (Number.isFinite(state.verticalDuty)) return clamp(state.verticalDuty, -1, 0);
  const ph = state.phase, pr = clamp01(state.phaseProgress || 0);
  const ms = massState(cls, state, layout);
  const reserveT = Math.max(1, ms.displacedTonnes - cls.structureAllowanceTonnes);
  const netFrac = clamp01(ms.surplusTonnes / reserveT);
  let hold = 1;                                    // multiplier on that baseline, 0..1
  if (ph === 'OUTBOUND_TRANSIT' || ph === 'DEPARTURE_CLIMB') {
    hold = pr < 0.10 ? 1 - 0.75 * easeInOut(pr / 0.10)
      : pr < 0.34 ? 0.25 + 0.55 * ((pr - 0.10) / 0.24) : 0.8;
  } else if (ph === 'BUOYANCY_ESCAPE') {
    // The cork: let go almost completely, ride the pop, then come back in to arrest.
    hold = pr < 0.28 ? 1 - 0.94 * (pr / 0.28) : 0.06 + 0.94 * Math.pow((pr - 0.28) / 0.72, 1.5);
  } else if (ph === 'RETURN_TRANSIT') {
    hold = pr < 0.30 ? 1 - 0.2 * (pr / 0.30) : pr > 0.72 ? 0.8 + 0.2 * ((pr - 0.72) / 0.28) : 0.8;
  }
  return -hold * netFrac;
}

export function updateDriver(d, dt, state, alloc = null, env = {}) {
  const b = d.build, cls = b.cls, N = d._nodes;
  const reduced = d.reduced;
  d.clock.t += dt;

  const failed = new Set(state.failedComponents || []);

  // THE DUTY MODEL — computed first because both the actuators and the particle systems
  // read it. When NO allocator is driving (the monitor path — it syncs state, it never
  // sends a wrench), the stations articulate from the host state, mirroring the schematic
  // avatar's reading of the mission:
  //   - the ship is buoyancy-positive at every point in the cycle, so the rotors hold it
  //     DOWN throughout, harder or softer, and the wash accordingly always blows UP;
  //   - the fill's hold decays as incoming water replaces rotor down-force, and the drop
  //     run's grows as the water leaves — both straight out of the mass ledger below.
  //
  // THE CORK. The drop and the escape are one continuous manoeuvre and the rotors tell its
  // story: through the drop run the hull sheds tonnes and fights to stay on the line, so the
  // down-push GROWS with every tonne released; the escape then simply LETS GO — the rotors
  // feather and the buoyancy that has been building all through the run throws the hull
  // upward — and they come back in over the second half to arrest the climb and hold the
  // empty ship at its ceiling through the top of the return arc. Every phase therefore hands
  // the next one the duty it ended on: no seam in this model steps.
  // vert: -1 = pushing the ship DOWN hard (wash blows up); 0 = feathered. Never positive.
  const cruiseMps2 = (cls.cruiseKph || 90) / 3.6;
  // FORWARD EFFORT MUST NOT READ VERTICAL POWER. propulsionPowerMW is a total — it includes
  // the rotors' down-force — so using it as the forward proxy made the blades wind UP exactly
  // when the rotors were pushing hardest DOWNWARD, swamping the vertical story: the drop run
  // saturated it from the first tonne, so the wash barely changed while the hull emptied.
  // When the host supplies its own vertical duty (the fleet monitor does), forward effort is
  // airspeed and nothing else. The power term stays for standalone figures with no airspeed.
  const hostDuty = Number.isFinite(state.verticalDuty);
  const hostAf = Math.min(1, hostDuty
    ? (state.airspeedMps || 0) / cruiseMps2
    : Math.max((state.airspeedMps || 0) / cruiseMps2,
      (state.propulsionPowerMW || 0) / Math.max(0.5, cls.generatorContinuousPowerMW * 0.15)));
  const ph = state.phase, pr = clamp01(state.phaseProgress || 0);
  // THE ROTORS NEVER PUSH UP. This hull carries a permanent lift reserve — it is buoyant
  // even with a full payload, and hugely so when empty — so the vertical job is always to
  // hold it DOWN, harder or softer. Climbing is done by RELAXING that hold and letting the
  // buoyancy up, not by thrusting upward. Anything else puts wash blowing downward off a
  // ship that is 12,000 t light, which is the picture arguing against its own numbers.
  //
  // So the baseline is the physics: how much surplus lift there is to hold right now,
  // as a fraction of the most there can ever be (empty). The fill's decay and the drop
  // run's growth then fall out of the mass ledger instead of being drawn by hand.
  let hostVert = verticalDuty(cls, state, b.layout), hostFwd = hostAf;
  // Is the hull light right now? Prefer the host's own force numbers when it sent them.
  const surplusT = Number.isFinite(state.vacuumBuoyancyN) && Number.isFinite(state.weightN) &&
    (state.vacuumBuoyancyN || state.weightN)
    ? (state.vacuumBuoyancyN - state.weightN) / 9810
    : massState(cls, state, b.layout).surplusTonnes;
  const holdingDown = hostVert < 0 || surplusT > 0;
  if (ph === 'WATER_FILL') hostFwd = 0;
  else if (ph === 'BUOYANCY_ESCAPE') hostFwd = hostAf * (0.25 + 0.75 * pr);
  const hostFwdEff = hostFwd * (1 - Math.abs(hostVert) * 0.7);
  const hostWant = Math.abs(hostVert) > 0.1 || hostFwdEff < 0.05
    ? [0, 0, 1]
    : norm([0.85 * hostFwdEff, 0, 1 - 0.5 * hostFwdEff]);
  const hostFrac = Math.min(1, Math.abs(hostVert) * 0.85 + hostFwdEff * 0.7);
  // Blades must READ as turning at 20x and 60x sim speed: a floor plus a time-scale boost.
  const tScale = env.timeScale || 1;
  const spinMul = 1 + Math.min(2.2, Math.max(0, Math.log2(tScale)) * 0.55);
  // The allocator's per-unit solutions, up here because the wash particles read them too.
  const bySol = new Map();
  if (alloc) for (const s of alloc.solution) bySol.set(s.id, s);

  /* ---- mass-driven geometry: tank fills ---------------------------------------------------- */
  if (N.waterFill) {
    const f = clamp01(state.waterFraction);
    for (const t of b.layout.waterTanks) {
      const r = t.radius;
      // Empty collapses in ALL axes, and a partial fill floats a little clear of the shell so
      // its rim never renders coplanar with — and through — the translucent tank bottom. The
      // width follows the chord of a horizontal cylinder at that depth: a nearly-empty tank
      // holds a narrow ribbon along the keel line, not a full-width glowing pancake.
      const gone = f < 0.01;
      const w = 0.90 * (f < 0.5 ? 2 * Math.sqrt(f * (1 - f)) : 1);
      setInstance(N.waterFill, `${t.id}_Fill`, {
        p: [t.p[0], t.p[1], t.p[2] - r * (1 - f) + r * 0.03],
        s: gone ? [0.0001, 0.0001, 0.0001] : [w, w, f],
      });
    }
  }
  if (N.ln2Fill) {
    // LN2 is 807 kg/m3 — LESS dense than water, so a tonne of it takes about a quarter MORE room.
    // The fill body is therefore scaled by VOLUME fraction, not mass fraction. (An earlier comment
    // here claimed the opposite; the arithmetic was always right, the sentence was not.)
    const volFrac = clamp01(ln2VolumeM3(cls, state.ln2Fraction) /
      Math.max(1e-6, ln2VolumeM3(cls, 1)));
    // SEQUENTIAL, not equal-split. A monitor-driven return leg carries plan.ln2MakeT tonnes —
    // cryo-rate-limited to a few percent of the whole bank (a P-100 makes ~1.6 t against 30 t of
    // tanks on a 15 km leg). Spread over every tank that is a guaranteed invisible hairline; put
    // tank-by-tank it is the same honest volume and a visibly rising level in the leading tank.
    const levels = ln2TankLevels(volFrac, b.layout.ln2Tanks.length);
    for (const t of b.layout.ln2Tanks) {
      const f = levels[t.index];
      const r = t.radius;
      const gone = f < 0.01;
      const w = 0.90 * (f < 0.5 ? 2 * Math.sqrt(f * (1 - f)) : 1);
      setInstance(N.ln2Fill, `${t.id}_Fill`, {
        p: [t.p[0], t.p[1], t.p[2] - r * (1 - f) + r * 0.03],
        s: gone ? [0.0001, 0.0001, 0.0001] : [w, w, f],
      });
    }
  }

  /* ---- flow in the manifolds ------------------------------------------------------------------
   * Bright slugs marching along each manifold whenever water is moving: toward the tanks
   * while filling, toward the outlets while releasing. The tank levels change too slowly to
   * read as motion on their own; this is the arrow that says WHICH WAY. */
  if (N.flowSlugs) {
    const filling = state.phase === 'WATER_FILL';
    const releasing = (state.waterReleaseProgress || 0) > 0.002 && (state.waterReleaseProgress || 0) < 0.998;
    const per = N.flowSlugs.slugsPerRun || 5;
    for (const mrun of b.layout.waterManifolds) {
      const path = mrun.path;
      for (let k = 0; k < per; k++) {
        const id = `${mrun.id}_Slug${k}`;
        if (!(filling || releasing) || reduced) {
          setInstance(N.flowSlugs, id, { s: [0.0001, 0.0001, 0.0001] });
          continue;
        }
        // One parameter runs the length of the path; direction flips with the flow.
        let u = ((d.clock.t * 0.22) + k / per + mrun.index * 0.37) % 1;
        if (releasing && !filling) u = 1 - u;
        const seg = Math.min(path.length - 2, Math.floor(u * (path.length - 1)));
        const f = u * (path.length - 1) - seg;
        const a = path[seg], c = path[seg + 1];
        const pulse = 0.85 + 0.3 * Math.sin(d.clock.t * 11 + k * 2.1);
        setInstance(N.flowSlugs, id, {
          p: [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f],
          s: [1.6, pulse, pulse],
        });
      }
    }
  }

  /* ---- flow in the branch pipes -----------------------------------------------------------------
   * The rest of the route: risers carry water UP from the reels while filling, the tank
   * feeds run trunk->tank on a fill and tank->trunk on a release, and the outlet stubs run
   * trunk->outlet only while releasing. Branch paths are stored EQUIPMENT -> TRUNK. */
  if (N.pipeFlow) {
    const filling2 = state.phase === 'WATER_FILL';
    const rel2 = state.waterReleaseProgress || 0;
    const releasing2 = rel2 > 0.002 && rel2 < 0.998;
    b.layout.waterPipes.forEach((pp, i) => {
      // +1 flows equipment->trunk, -1 trunk->equipment, 0 idle
      let dirF = 0;
      if (!reduced) {
        if (filling2) dirF = pp.kind === 'riser' ? 1 : pp.kind === 'feed' ? -1 : 0;
        else if (releasing2) dirF = pp.kind === 'feed' ? 1 : pp.kind === 'outlet' ? -1 : 0;
      }
      for (let k = 0; k < 2; k++) {
        const id = `Pipe_${i}_${k}`;
        if (!dirF) { setInstance(N.pipeFlow, id, { s: [0.0001, 0.0001, 0.0001] }); continue; }
        let u = ((d.clock.t * 0.55) + k / 2 + hash01(i * 3.71)) % 1;
        if (dirF < 0) u = 1 - u;
        const a = pp.path[0], c = pp.path[1];
        const pulse = 0.8 + 0.3 * Math.sin(d.clock.t * 10 + i * 1.3 + k * 2.6);
        setInstance(N.pipeFlow, id, {
          p: [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u],
          s: [1.3, pulse, pulse],
        });
      }
    });
  }

  /* ---- release water: droplet spray -----------------------------------------------------------
   * Keyed to release PROGRESS, not the water fraction — retained descent ballast keeps the
   * fraction above zero for the whole flight, and it never leaves through these. Each droplet
   * runs its own deterministic fall cycle: accelerating, drifting outward, streaking longer as
   * it speeds up — rain, not a solid tube. */
  if (N.dropSpray) {
    const rel = state.waterReleaseProgress || 0;
    const on = rel > 0.002 && rel < 0.998 && !reduced;
    const per = N.dropSpray.sprayPer || 14;
    const span = N.dropSpray.spanM || 12;
    const tail = 0.35 + 0.65 * (1 - rel);            // the curtain thins as the last tonnes leave
    for (const o of b.layout.dropOutlets) {
      for (let k = 0; k < per; k++) {
        const id = `${o.id}_Drop${k}`;
        if (!on) { setInstance(N.dropSpray, id, { s: [0.0001, 0.0001, 0.0001] }); continue; }
        const r1 = hash01(k * 12.9898 + o.index * 78.233);
        const r2 = hash01(k * 39.3468 + o.index * 11.135);
        const u = ((d.clock.t * (0.45 + 0.30 * r1)) + r2) % 1;   // fall phase, per-droplet rate
        const fall = u * u * span;                               // gravity: quadratic in phase
        const fan = (0.4 + u * 2.2);                             // drifts outward as it falls
        setInstance(N.dropSpray, id, {
          p: [o.p[0] + (r1 - 0.5) * 2 * fan, o.p[1] + (r2 - 0.5) * 2 * fan, o.p[2] - 0.6 - fall],
          s: [0.55 + 0.45 * r2, 0.55 + 0.45 * r1, (1.6 + 4.5 * u) * tail],  // streaks as it speeds up
        });
      }
    }
  }

  /* ---- rotor and blower wash -------------------------------------------------------------------
   * The same particle idea shows WORK: streaks stream through each rotor disc and out of each
   * blower whenever the unit is doing something. Direction is honest — prop wash runs aft in
   * cruise; while holding station against surplus buoyancy the rotors push air UP (downforce),
   * and the blowers exhale along their own duct axes. */
  if (N.airStreaks) {
    const cruiseMps = (cls.cruiseKph || 90) / 3.6;
    const af = reduced ? 0 : Math.min(1, Math.max(
      (state.airspeedMps || 0) / cruiseMps,
      (state.propulsionPowerMW || 0) / Math.max(0.5, cls.generatorContinuousPowerMW * 0.15)));
    const perR = N.airStreaks.washPerRotor || 6, perT = N.airStreaks.washPerThruster || 3;
    const hide = (id) => setInstance(N.airStreaks, id, { s: [0.0001, 0.0001, 0.0001] });
    const cross3 = (a2, b2) => [a2[1] * b2[2] - a2[2] * b2[1],
      a2[2] * b2[0] - a2[0] * b2[2], a2[0] * b2[1] - a2[1] * b2[0]];
    // Each station's wash runs along ITS OWN gimbal's live axis — the streaks turn with the
    // prop as it slews, instead of pointing wherever the fleet-average duty says. The SIGN
    // along the axis comes from what the thrust is doing (reversible rotors push either way
    // along the same axis): holding the ship down blows air up the axis; everything else —
    // cruise thrust, climb assist — blows air down/back along it.
    // The wash must SLOW as the duty falls, not just thin out: through the fill the rotors
    // hand their work to the incoming water, and streaks that keep racing while the needle
    // drops read as a loop playing rather than a machine easing off. Speed therefore tracks
    // hostFrac almost from zero, and the streaks shorten with it instead of cutting out.
    const washOn = hostFrac > 0.015;
    const washSpeed = 0.15 + 1.9 * hostFrac;
    const washLen = 0.35 + 0.65 * Math.min(1, hostFrac * 2.2);
    for (const st of b.layout.rotorStations) {
      const gim = N.gimbals.get(st.id);
      const axis = gim ? gimbalDir(gim) : [0, 0, 1];
      const sol = bySol.get(st.id);
      // Direction is BUOYANCY's to decide, not the duty's. To push a vehicle DOWN a rotor
      // must accelerate air UP — inflow under the disc, slipstream above it — so a hull with
      // surplus lift always has its wash blowing upward, however gently it is being held.
      // Keying off `hostVert < 0` alone left one hole: a duty that rounds to exactly zero
      // flipped the wash downward off a ship that was still thousands of tonnes light.
      const sign = sol ? (sol.reversed ? 1 : -1) : (holdingDown ? 1 : -1);
      const dn = [axis[0] * sign, axis[1] * sign, axis[2] * sign];
      // disc-plane basis, so the streak cloud spreads across the disc and rides its tilt
      const ref = Math.abs(dn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const p1 = norm(cross3(dn, ref));
      const p2 = cross3(dn, p1);
      const rr = (st.rotorDiameter || 10) / 2;
      const run = rr * 2.4 * washLen;
      for (let k = 0; k < perR; k++) {
        const id = `${st.id}_Wash${k}`;
        if (!washOn) { hide(id); continue; }
        const r1 = hash01(k * 7.13 + st.index * 3.7), r2 = hash01(k * 2.71 + st.index * 9.1);
        const u = ((d.clock.t * washSpeed * (0.8 + 0.4 * r1)) + r2) % 1;
        const o1 = (r1 - 0.5) * rr * 1.3, o2 = (r2 - 0.5) * rr * 1.3;
        setInstance(N.airStreaks, id, {
          p: [st.p[0] + p1[0] * o1 + p2[0] * o2 + dn[0] * u * run,
              st.p[1] + p1[1] * o1 + p2[1] * o2 + dn[1] * u * run,
              st.p[2] + p1[2] * o1 + p2[2] * o2 + dn[2] * u * run],
          r: aimEuler(dn),
          s: [rr * (0.5 + 0.5 * u) * 0.6, 0.6, 0.6],
        });
      }
    }
    // Medium thrusters: BURSTS, not a constant blast. Each unit fires in its own
    // pseudo-random windows — trim corrections and gust response — swelling in and dying
    // out inside the window, more often when the air is rough.
    const windV = env.windMps || DEFAULT_WIND;
    const windMag = Math.hypot(windV[0], windV[1], windV[2]);
    const gust = Math.min(1, windMag / 10);
    const W = 1.6;                                   // burst window, seconds
    const wIdx = Math.floor(d.clock.t / W);
    const wFrac = (d.clock.t / W) % 1;
    for (const mt of b.layout.mediumThrusters) {
      const out = mt.outward || [0, 0, 1];
      const run = (mt.diameter || 6) * 2.2;
      // A keel unit blasting straight DOWN pushes the hull UP, which is the opposite of
      // what a buoyant ship is trying to do — and next to rotors washing upward it reads as
      // a bug. Trim genuinely works both ways, so both still fire; the units whose exhaust
      // agrees with the hold simply fire far more often.
      const align = (out[2] * (holdingDown ? 1 : -1) + 1) / 2;    // 1 = agrees, 0 = opposes
      const firing = hash01(mt.index * 7.31 + wIdx * 13.7) <
        (0.08 + 0.30 * gust + 0.12 * af) * (0.35 + 1.30 * align);
      const env2 = Math.sin(Math.PI * wFrac);         // swell and die within the window
      for (let k = 0; k < perT; k++) {
        const id = `${mt.id}_Wash${k}`;
        if (!firing || env2 < 0.1) { hide(id); continue; }
        const r1 = hash01(k * 5.77 + mt.index * 13.3), r2 = hash01(k * 17.2 + mt.index * 1.9);
        const u = ((d.clock.t * (1.6 + 0.8 * r1)) + r2) % 1;
        setInstance(N.airStreaks, id, {
          p: [mt.p[0] + out[0] * (0.5 + u) * run,
              mt.p[1] + out[1] * ((0.5 + u) * run) + (r1 - 0.5) * mt.diameter * 0.4,
              mt.p[2] + out[2] * ((0.5 + u) * run) + (r2 - 0.5) * mt.diameter * 0.4],
          r: aimEuler(out),
          s: [(mt.diameter || 6) * 0.5 * env2, 0.5 * env2, 0.5 * env2],
        });
      }
    }
  }

  /* ---- movement and wind ------------------------------------------------------------------------
   * The ship's own SPEED reads as motion lines slipping aft past the hull; the ambient WIND
   * is its own family, crossing the scene along the true wind vector the host supplies. Two
   * different stories, two different directions, deliberately never merged. */
  if (N.motionLines) {
    const av = Math.min(1, (state.airspeedMps || 0) / ((cls.cruiseKph || 90) / 3.6));
    const L = cls.lengthM;
    for (let k = 0; k < 12; k++) {
      const id = `Motion_${k}`;
      if (av < 0.1 || reduced) { setInstance(N.motionLines, id, { s: [0.0001, 0.0001, 0.0001] }); continue; }
      const r1 = hash01(k * 3.31), r2 = hash01(k * 8.77);
      const th = r1 * Math.PI * 2;
      const rad = cls.maxRadiusM * (1.18 + 0.30 * r2);
      const u = ((d.clock.t * (0.22 + 0.4 * av) * (0.8 + 0.4 * r2)) + r1) % 1;
      setInstance(N.motionLines, id, {
        p: [cls.xNose + L * 0.15 - u * L * 1.3, -rad * Math.cos(th), rad * Math.sin(th)],
        s: [L * 0.045 * (0.4 + 0.6 * av), 0.5, 0.5],
      });
    }
  }
  if (N.windLines) {
    const wv = env.windMps || DEFAULT_WIND;
    const mag = Math.hypot(wv[0], wv[1], wv[2]);
    const L = cls.lengthM;
    if (mag < 1.5 || reduced) {
      for (let k = 0; k < 10; k++) setInstance(N.windLines, `Wind_${k}`, { s: [0.0001, 0.0001, 0.0001] });
    } else {
      const wn = [wv[0] / mag, wv[1] / mag, wv[2] / mag];
      const span = L * 1.5;
      const wr = aimEuler(wn);
      for (let k = 0; k < 10; k++) {
        const r1 = hash01(k * 4.19), r2 = hash01(k * 9.13);
        // fixed seeds scattered around the hull, above and to the sides
        const base = [
          (r1 - 0.5) * L * 0.9,
          (r2 - 0.5) * cls.maxRadiusM * 3.4,
          cls.maxRadiusM * (0.6 + r1 * 1.6),
        ];
        const u = ((d.clock.t * (0.10 + mag / 60)) + hash01(k * 2.9)) % 1;
        setInstance(N.windLines, `Wind_${k}`, {
          p: [base[0] + wn[0] * (u - 0.5) * span, base[1] + wn[1] * (u - 0.5) * span,
              base[2] + wn[2] * (u - 0.5) * span],
          r: wr,
          s: [L * 0.035 * Math.min(1, mag / 12 + 0.4), 0.45, 0.45],
        });
      }
    }
  }
  // The small actuators answer gusts: scattered short puffs, each slot roving to a random
  // trim fan every window — reactive, irregular, and busier in rough air.
  if (N.gustPuffs && b.layout.trimFans.length) {
    const wv = env.windMps || DEFAULT_WIND;
    const gust2 = Math.min(1, Math.hypot(wv[0], wv[1], wv[2]) / 10);
    const W2 = 1.1;
    const wI = Math.floor(d.clock.t / W2);
    const wF = (d.clock.t / W2) % 1;
    const fans = b.layout.trimFans;
    for (let k = 0; k < 18; k++) {
      const id = `Puff_${k}`;
      const active = !reduced && hash01(k * 3.97 + wI * 17.13) < (0.10 + 0.45 * gust2);
      if (!active) { setInstance(N.gustPuffs, id, { s: [0.0001, 0.0001, 0.0001] }); continue; }
      const f = fans[Math.floor(hash01(k * 11.71 + wI * 29.31) * fans.length)];
      const outb = f.outward || [0, 0, 1];
      const reach = f.diameter * (0.4 + wF * 2.4);
      const size2 = Math.sin(Math.PI * wF);           // swell and fade within the window
      setInstance(N.gustPuffs, id, {
        p: [f.p[0] + outb[0] * reach, f.p[1] + outb[1] * reach, f.p[2] + outb[2] * reach],
        r: aimEuler(outb),
        s: [f.diameter * 0.45 * size2, 0.5 * size2, 0.5 * size2],
      });
    }
  }

  /* ---- actuators (bySol is built with the duty model above) --------------------------------- */

  for (const st of N.stations) {
    const sol = bySol.get(st.id);
    const gim = N.gimbals.get(st.id);
    const isFailed = failed.has(st.id);
    const frac = isFailed ? 0 : (sol ? sol.fraction : (alloc ? 0 : hostFrac));

    if (gim) {
      // Aim along the AXIS the unit points, not the direction thrust acts. With reversible rotors
      // those differ whenever thrust is reversed, and following the thrust vector would swing the
      // gimbal 180 degrees to achieve something a pitch reversal already did.
      const want = isFailed ? [0, 0, 1]
        : (sol && sol.magnitude > 1 ? sol.axis : (alloc ? [0, 0, 1] : hostWant));
      const cur = gimbalDir(gim);
      // The gimbal slews at a real rate. Fast — but a rate, not a jump.
      const maxStep = (reduced ? Math.PI : (18 * Math.PI) / 180) * dt;
      const nd = slerpLimited(cur, want, maxStep);
      gim.r = aimEuler(nd);
      gim._localDirty = true;
    }

    const spin = isFailed ? 0 : (5 + 16 * frac) * spinMul;   // rad/s, visual
    for (const rn of N.rotors.get(st.id) || []) {
      if (!rn) continue;
      if (!reduced) {
        rn.r[0] += spin * (rn.spin ? rn.spin.dir : 1) * dt;
        rn._localDirty = true;
      }
      rn.tint = isFailed ? STATE_TONE.failed : null;
    }
    const reversed = !isFailed && sol ? !!sol.reversed : false;
    for (const dn of N.discs.get(st.id) || []) {
      if (!dn) continue;
      // A feathered or failed rotor shows no disc. A working one shows a disc whose opacity is
      // its share of its own maximum — the visual reading of "how hard is this station working".
      dn.opacity = isFailed ? 0 : 0.06 + 0.42 * frac;
      dn.visible = frac > 0.002 || (!reduced && spin > 4);
      // The disc sits DOWNSTREAM of its rotor, so reversing thrust moves BOTH discs of a station
      // to the other side together. That is the only visible cue that a station has reversed
      // rather than swung round, and without it a powered descent looks identical to a hover.
      const want = (dn.rotorX || 0) + (dn.leadM || 1) * (reversed ? -1 : 1);
      if (dn.p[0] !== want) { dn.p[0] = want; dn._localDirty = true; }
    }
  }

  // Instanced units: tint by usage AND spin the ones that are working. Tint alone says "this fan
  // is commanded"; rotation says "this fan is moving air", and on a distributed-actuator vehicle
  // that distinction is most of the story. Idle units stay still, which is what makes the active
  // ones legible.
  paintInstances(b, 'MediumThrusters', bySol, failed);
  paintInstances(b, 'LocalTrimFans', bySol, failed);
  paintInstances(b, 'MediumThrusterFans', bySol, failed, '_Fan');
  paintInstances(b, 'LocalTrimFanBlades', bySol, failed, '_Fan');
  if (!reduced) {
    // ONLY the rotor containers turn. The housings are separate nodes and stay put — spinning a
    // merged duct-and-blades mesh turns the whole nacelle, flange and all.
    spinInstances(b, 'MediumThrusterFans', b.layout.mediumThrusters, bySol, failed, d, dt, 22,
      alloc ? 0 : hostAf * 0.6, spinMul);
    spinInstances(b, 'LocalTrimFanBlades', b.layout.trimFans, bySol, failed, d, dt, 34,
      alloc ? 0 : hostAf * 0.4, spinMul);
  }

  /* ---- control surfaces ---------------------------------------------------------------------
   * Each fin is mixed by PROJECTING its own unit torque onto the demanded torque, which is the
   * same idea as the actuator allocator and needs no hand-derived sign table. A fin's lift acts
   * perpendicular to both its span and the flow, so its unit torque is p x (x_hat x s_hat).
   *
   * Taking the magnitude of the projection instead — deflecting every fin the same way — can only
   * ever produce ROLL: the pitch and yaw contributions of an X tail cancel exactly in pairs. That
   * is worth stating because it is what this code used to do.
   *
   * Deflection is scaled by dynamic pressure. At a hover these are decorative, and the model
   * should show that rather than waving them about. */
  {
    const q = clamp01((state.airspeedMps || 0) / 30);
    const cmd = alloc ? alloc.desired : [0, 0, 0, 0, 0, 0];
    const T = [cmd[3] || 0, cmd[4] || 0, cmd[5] || 0];
    const Tmag = Math.hypot(T[0], T[1], T[2]);
    for (const t of N.tails) {
      if (!t.hinge) continue;
      let want = 0;
      if (Tmag > 1e-6 && q > 1e-3) {
        const th = t.hinge.theta;
        const s = [0, -Math.cos(th), Math.sin(th)];              // span, radially outward
        const L = [0, -Math.sin(th), -Math.cos(th)];             // lift = x_hat x span
        const p = [t.hinge.station, t.hinge.radius * s[1], t.hinge.radius * s[2]];
        const tau = [
          p[1] * L[2] - p[2] * L[1],
          p[2] * L[0] - p[0] * L[2],
          p[0] * L[1] - p[1] * L[0],
        ];
        const tm = Math.hypot(tau[0], tau[1], tau[2]) || 1;
        const proj = (tau[0] * T[0] + tau[1] * T[1] + tau[2] * T[2]) / (tm * Tmag);
        want = clamp(proj, -1, 1) * 0.42 * q;
      }
      t.hinge.deflect = damp(t.hinge.deflect, failed.has(t.id) ? 0 : want, 3.5, dt);
      t.r[1] = t.hinge.deflect;                                  // about the fin's OWN span
      t._localDirty = true;
      t.tint = failed.has(t.id) ? STATE_TONE.failed : null;
    }
  }

  /* ---- hose and pump pods -------------------------------------------------------------------- */
  {
    const out = state.hoseProgress || 0;
    const flow = state.phase === 'WATER_FILL' ? 1 : 0;
    for (let i = 0; i < d.hoses.length; i++) {
      const h = d.hoses[i];
      const node = N.hoseNodes[i];
      const pod = N.podNodes[i];
      const podFailed = failed.has(h.id) || failed.has(pod ? pod.id : '');
      updateHose(h, dt, {
        progress: out,
        waterFlow: flow,
        windMps: env.windMps || DEFAULT_WIND,
        shipVel: env.shipVel,
        waterSurfaceZ: env.waterSurfaceZ,
        release: podFailed,
        reduced,
      });
      const showing = h.deployed > 0.002;
      if (node) {
        node.visible = showing;
        if (showing) {
          const segs = env.lowDetail ? 10 : 24;
          node.geom = hoseGeometry(h, Math.max(0.3, cls.maxRadiusM * 0.012), segs,
            env.lowDetail ? 5 : 6);
        }
      }
      if (pod) {
        pod.visible = showing;
        pod.p = h.podPos.slice();
        pod.r = [0, h.podPitch, 0];
        pod._localDirty = true;
        pod.tint = podFailed ? STATE_TONE.failed : null;
      }
      if (N.reelInst && !reduced) {
        setInstance(N.reelInst, h.reel.id, { r: [reelAngleRad(h), 0, Math.PI / 2] });
      }
      // Water climbing the hose: slugs run the live catenary pod -> reel while pumping.
      if (N.hoseFlow) {
        const per = N.hoseFlow.flowPer || 7;
        const pumping = flow > 0 && h.deployed > 0.9 && !h.released && !reduced;
        const pts = pumping ? hoseCurve(h, 16) : null;
        for (let k = 0; k < per; k++) {
          const id = `HoseFlow_${String(h.reel.index).padStart(2, '0')}_${k}`;
          if (!pts) { setInstance(N.hoseFlow, id, { s: [0.0001, 0.0001, 0.0001] }); continue; }
          // u runs 1 -> 0: up the hose, against the curve's reel-to-pod parameterisation
          const u = 1 - ((d.clock.t * 0.35 + k / per + h.reel.index * 0.29) % 1);
          const seg = Math.min(pts.length - 2, Math.floor(u * (pts.length - 1)));
          const f = u * (pts.length - 1) - seg;
          const a = pts[seg], c = pts[seg + 1];
          const pulse = 0.8 + 0.35 * Math.sin(d.clock.t * 9 + k * 1.7);
          setInstance(N.hoseFlow, id, {
            p: [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f],
            s: [pulse, pulse, 1.5],
          });
        }
      }
    }
  }

  /* ---- failures on everything else ------------------------------------------------------------
   * The mark is recomputed from the state every frame, never accumulated. A host that clears an
   * entry from `failedComponents` must see the component come back — a failure flag that can only
   * ever be set is a component that can never be repaired. */
  {
    const anyChange = failed.size > 0 || d._hadFailures;
    if (anyChange) {
      walk(b.root, (n) => { n.failed = failed.has(n.id); return true; });
      for (const id of failed) {
        const hit = instanceById(b.root, id);
        if (hit) {
          hit.node.inst.tint.set([2.0, 0.55, 0.35, 1], hit.index * 4);
          hit.node.inst.dirty = true;
        }
      }
      // Instanced units that are no longer failed get their tint back from the usage pass above;
      // ones that were never in a usage pass are reset here.
      if (d._lastFailed) {
        for (const id of d._lastFailed) {
          if (failed.has(id)) continue;
          const hit = instanceById(b.root, id);
          if (hit) {
            hit.node.inst.tint.set([1, 1, 1, 1], hit.index * 4);
            hit.node.inst.dirty = true;
          }
        }
      }
    }
    d._lastFailed = failed;
    d._hadFailures = failed.size > 0;
  }

  /* ---- whole-body attitude ---------------------------------------------------------------------
   * Rate-limited by the class envelope AND accelerated toward that limit, so a step change in the
   * commanded attitude produces a slow start and a slow stop rather than a snap. The limits are in
   * config and differ by a factor of three across the family. */
  {
    const want = state.attitude || { rollRad: 0, pitchRad: 0, yawRad: 0 };
    const lim = {
      roll: (cls.maxRollRateDegS * Math.PI) / 180,
      pitch: (cls.maxPitchRateDegS * Math.PI) / 180,
      yaw: (cls.maxYawRateDegS * Math.PI) / 180,
    };
    if (reduced) {
      d.attitude = { ...want };
    } else {
      for (const [k, key] of [['roll', 'rollRad'], ['pitch', 'pitchRad'], ['yaw', 'yawRad']]) {
        const err = shortestAngle((want[key] || 0) - d.attitude[key]);
        // Proportional rate command, clamped, then the rate itself is rate-limited: that second
        // limit is the inertia, and it is why these do not flick.
        const rateWant = clamp(err * 0.6, -lim[k], lim[k]);
        const accel = lim[k] / 2.5;                       // seconds to reach full rate
        d.attitudeRate[k] = clamp(
          d.attitudeRate[k] + clamp(rateWant - d.attitudeRate[k], -accel * dt, accel * dt),
          -lim[k], lim[k]);
        d.attitude[key] += d.attitudeRate[k] * dt;
      }
    }
    b.root.r = [d.attitude.rollRad, d.attitude.pitchRad, d.attitude.yawRad];
    b.root._localDirty = true;
  }

  return d;
}

/**
 * Advance the blade phase of every ACTIVE instanced unit and rewrite its transform.
 *
 * The spin angle goes in the local-x euler, which `m4compose` applies FIRST (R = Rz·Ry·Rx), so it
 * rotates the fan about its own axis before the aim rotation points it outward. Getting that order
 * wrong makes the fans wobble about the hull axis instead of turning.
 *
 * Only units with a command are touched, and the buffer is only re-uploaded if something moved.
 */
function spinInstances(b, containerId, records, bySol, failed, d, dt, maxRate, baseFrac = 0, rateMul = 1) {
  const n = b.index.get(containerId);
  if (!n || !n.inst) return;
  if (!d._spin) d._spin = new Map();
  let phases = d._spin.get(containerId);
  if (!phases) { phases = new Float32Array(n.inst.count); d._spin.set(containerId, phases); }
  let moved = false;
  for (let i = 0; i < n.inst.count; i++) {
    const id = n.inst.ids[i];
    if (failed.has(id) || failed.has(id.replace(/_Fan$/, ''))) continue;
    // Blade containers carry a "_Fan" suffix; the solution is keyed by the unit's own id.
    const sol = bySol.get(id.endsWith('_Fan') ? id.slice(0, -4) : id);
    // With no per-unit solution (the monitor path), the whole bank idles along at the
    // host-state baseline so working machinery visibly turns.
    const frac = Math.max(sol ? sol.fraction : 0, baseFrac);
    if (frac <= 0.002) continue;
    // A working unit turns at a rate set by how hard it is working, with a floor so a barely
    // commanded fan still reads as running rather than as stopped.
    phases[i] = (phases[i] + (4.5 + maxRate * frac) * rateMul * dt) % (2 * Math.PI);
    const rec = records[i];
    if (!rec) continue;
    const aim = aimEuler(rec.outward);
    setInstance(n, id, { r: [phases[i], aim[1], aim[2]] });
    moved = true;
  }
  if (moved) n.inst.dirty = true;
}

function paintInstances(b, containerId, bySol, failed, suffix = '') {
  const n = b.index.get(containerId);
  if (!n || !n.inst) return;
  const t = n.inst.tint;
  for (let i = 0; i < n.inst.count; i++) {
    const raw = n.inst.ids[i];
    const id = suffix && raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;
    if (failed.has(id)) { t.set([2.0, 0.55, 0.35, 1], i * 4); continue; }
    const s = bySol.get(id);
    const f = s ? s.fraction : 0;
    // Brightness carries usage. An idle unit is the base colour; a working one lifts toward the
    // propulsion green, so "the small actuators are participating" is legible at a glance.
    const k = 1 + 1.5 * f;
    t.set([k, k * (1 + 0.25 * f), k, 1], i * 4);
  }
  n.inst.dirty = true;
}

function gimbalDir(gim) {
  // Inverse of aimEuler: (0, ry, rz) -> direction.
  const ry = gim.r[1], rz = gim.r[2];
  const cy = Math.cos(ry);
  return [cy * Math.cos(rz), cy * Math.sin(rz), -Math.sin(ry)];
}

function slerpLimited(from, to, maxRad) {
  const a = norm(from), bb = norm(to);
  const d = clamp(a[0] * bb[0] + a[1] * bb[1] + a[2] * bb[2], -1, 1);
  const ang = Math.acos(d);
  if (ang <= maxRad || ang < 1e-6) return bb;
  const t = maxRad / ang;
  const s = Math.sin(ang);
  const k0 = Math.sin((1 - t) * ang) / s, k1 = Math.sin(t * ang) / s;
  return norm([a[0] * k0 + bb[0] * k1, a[1] * k0 + bb[1] * k1, a[2] * k0 + bb[2] * k1]);
}

function shortestAngle(a) {
  let d = a % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Clear every failure mark — the failure explorer's reset. */
export function clearFailures(b) {
  walk(b.root, (n) => { n.failed = false; n.tint = null; return true; });
  walk(b.root, (n) => {
    if (!n.inst) return true;
    for (let i = 0; i < n.inst.count; i++) n.inst.tint.set([1, 1, 1, 1], i * 4);
    n.inst.dirty = true;
    return true;
  });
}

void lerp; void mul; void add; void sub; void len; void massState; void waterVolumeM3;
void inertia; void hoseCurve; void podDepthM; void TOKENS; void createHose;
