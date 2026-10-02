/* The actuator set.
 *
 * Turns the placement in model/layout.js into the thing a control allocator can reason about: for
 * every unit, where it is relative to the centre of mass, which way it can push, how hard, how
 * fast it can change, what it costs in electrical power, and whether it is available.
 *
 * NOT AN AUTOPILOT. This is a systems-explanation model. It has no state estimator, no dynamics
 * model of the airframe, no stability augmentation and no certification basis. It answers one
 * question — "given a wanted force and torque, which units would do what, and could they?" — and
 * it answers it transparently enough to be argued with.
 */

import { ASSUMPTIONS } from '../model/config.js?v=5bcbf32c';
import { cross, norm, sub, len } from '../core/math.js?v=5bcbf32c';

/** Thrust available from a disc of area A at power P: T = (2 rho A P^2)^(1/3) for an ideal disc. */
export function idealDiscThrust(areaM2, powerW, rho = ASSUMPTIONS.rhoAir) {
  return Math.cbrt(2 * rho * areaM2 * powerW * powerW);
}

/** Power an ideal disc needs for thrust T: P = T^(3/2) / sqrt(2 rho A). */
export function idealDiscPower(areaM2, thrustN, rho = ASSUMPTIONS.rhoAir) {
  if (areaM2 <= 0) return Infinity;
  return Math.pow(Math.max(0, thrustN), 1.5) / Math.sqrt(2 * rho * areaM2);
}

/**
 * @typedef {object} Actuator
 * @property {string} id
 * @property {'primary'|'medium'|'fan'} kind
 * @property {number[]} r          position relative to the centre of mass, metres
 * @property {number[]} axis       nominal thrust direction (unit)
 * @property {number[][]} basis    [axis, u, v] orthonormal frame for the vectoring envelope
 * @property {'wedge'|'cone'} envelope  how the reachable thrust directions are bounded
 * @property {number} coneRad      cone envelopes: half-angle the vector may leave `axis` by
 * @property {number} pitchMax     wedge envelopes: rotation limit about the pylon axis, rad
 * @property {number} yawMax       wedge envelopes: rotation limit out of the swing plane, rad
 * @property {boolean} reversible  may produce thrust along -axis as well
 * @property {number} fMaxN        maximum thrust magnitude
 * @property {number} rateNps      how fast the commanded thrust may change, N/s
 * @property {number} gimbalRateRad how fast the vector may swing, rad/s
 * @property {number} discAreaM2
 * @property {boolean} enabled
 */

function frameFor(axis) {
  const a = norm(axis);
  const ref = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = norm(cross(ref, a));
  const v = cross(a, u);
  return [a, u, v];
}

/**
 * Build the actuator set for a class.
 *
 * Thrust sizing. Primary stations are sized from the class's published disc area and its battery
 * plus generator peak: the fleet cannot pull more than the electrical system can deliver, so the
 * total available thrust is the ideal-disc thrust at that power, split across the stations. That
 * ties the allocator to the same power ledger the rest of the page uses instead of inventing a
 * force budget.
 */
export function buildActuators(cls, layout, comOffset = [0, 0, 0]) {
  const acts = [];
  const rho = ASSUMPTIONS.rhoAir;
  const peakW = (cls.batteryPeakPowerMW + cls.generatorContinuousPowerMW) * 1e6;

  // Primary stations share ~78% of peak electrical power; the rest is hotel, pumps and cryo.
  const primaryShare = 0.78;
  const perStationW = (peakW * primaryShare) / Math.max(1, cls.primaryRotorStations);
  const stationDisc = cls.rotorsPerStation * Math.PI * Math.pow(cls.primaryRotorDiameterM / 2, 2);
  const stationFmax = idealDiscThrust(stationDisc, perStationW, rho);

  for (const st of layout.rotorStations) {
    const axis = norm(st.nominal);
    // A station's gimbal swings about its PYLON axis, which is athwartships, sweeping the thrust
    // vector through the fore-and-aft plane. It is a wedge, not a cone.
    //
    // The rotors are REVERSIBLE — counter-rotating variable-pitch discs reverse thrust without
    // reversing rotation — so a motor never has to be swung all the way round. Within +/-90
    // degrees of gimbal travel every direction in the fore-and-aft plane is reachable: point at
    // it, or point the opposite way and reverse. Down-thrust for a powered descent is therefore a
    // small gimbal movement plus a pitch reversal, not a 180-degree slew.
    const swing = [0, st.side, 0];            // the pylon axis
    acts.push({
      id: st.id,
      kind: 'primary',
      r: sub(st.p, comOffset),
      axis,
      basis: frameFor(axis),
      envelope: 'wedge',
      swingAxis: swing,
      pitchMax: st.gimbalRangeDeg.pitch * Math.PI / 180,
      yawMax: (st.gimbalRangeDeg.yaw / 2) * Math.PI / 180,
      coneRad: Math.PI,
      reversible: true,
      fMaxN: stationFmax,
      rateNps: stationFmax / 3.5,             // full thrust in ~3.5 s
      gimbalRateRad: (18 * Math.PI) / 180,    // 18 deg/s: fast for a gimbal, slow for a body
      discAreaM2: stationDisc,
      efficiencyNpW: stationFmax / Math.max(1, perStationW),
      enabled: true,
      node: st.id,
    });
  }

  // Medium propulsors: ~14% of peak, reversible in their duct.
  const medW = (peakW * 0.14) / Math.max(1, layout.mediumThrusters.length || 1);
  for (const t of layout.mediumThrusters) {
    const disc = Math.PI * Math.pow(t.diameter / 2, 2);
    const f = idealDiscThrust(disc, medW, rho);
    const axis = norm(t.outward);
    acts.push({
      id: t.id, kind: 'medium', r: sub(t.p, comOffset), axis, basis: frameFor(axis),
      envelope: 'cone',
      coneRad: (t.gimbalRangeDeg.yaw / 2) * Math.PI / 180,
      reversible: true,
      fMaxN: f, rateNps: f / 1.2, gimbalRateRad: (25 * Math.PI) / 180,
      discAreaM2: disc, efficiencyNpW: f / Math.max(1, medW),
      enabled: true, node: 'MediumThrusters',
    });
  }

  // Local trim fans: ~8% of peak between all of them. Individually tiny, collectively the thing
  // that lets a local load be shed without a whole-body attitude change.
  const fanW = (peakW * 0.08) / Math.max(1, layout.trimFans.length || 1);
  for (const f of layout.trimFans) {
    const disc = Math.PI * Math.pow(f.diameter / 2, 2);
    const fm = idealDiscThrust(disc, fanW, rho);
    const axis = norm(f.outward);
    acts.push({
      id: f.id, kind: 'fan', r: sub(f.p, comOffset), axis, basis: frameFor(axis),
      envelope: 'cone', coneRad: 0, reversible: true,
      fMaxN: fm, rateNps: fm / 0.4, gimbalRateRad: 0,
      discAreaM2: disc, efficiencyNpW: fm / Math.max(1, fanW),
      enabled: true, node: 'LocalTrimFans',
    });
  }

  return acts;
}

/** Total thrust available if everything pushed the same way. Used for the saturation read-out. */
export const totalThrustN = (acts) =>
  acts.reduce((a, x) => a + (x.enabled ? x.fMaxN : 0), 0);

/** Wrench (force, torque about the origin) produced by a thrust vector f applied at r. */
export function wrenchOf(r, f) {
  const t = cross(r, f);
  return [f[0], f[1], f[2], t[0], t[1], t[2]];
}

/** Sum the wrench of a solution. */
export function totalWrench(acts, solution) {
  const w = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < acts.length; i++) {
    const f = solution[i] && solution[i].force;
    if (!f) continue;
    const wi = wrenchOf(acts[i].r, f);
    for (let k = 0; k < 6; k++) w[k] += wi[k];
  }
  return w;
}

void len;
