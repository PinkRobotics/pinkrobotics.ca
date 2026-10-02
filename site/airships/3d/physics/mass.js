/* Mass, centre of mass, buoyancy and the force display.
 *
 * The rules this file exists to keep (numbered as in the model's consistency list):
 *   2/3  water release lowers weight and raises net positive buoyancy; intake does the reverse
 *   4/5  LN2 production adds mass and costs energy; expansion removes it and returns only part
 *   15   water and LN2 mass MOVE the displayed centre of mass — it is not a fixed dot
 *
 * The buoyancy figure is the same one the homepage ledger prints: displaced volume times
 * working-altitude density. Everything else is the dry allowance plus what is currently aboard.
 */

import { RHO_WORK, ASSUMPTIONS, RHO_LN2, RHO_WATER, G, specNumber } from '../model/config.js?v=331c3257';
import { clamp01 } from '../core/math.js?v=331c3257';

// Compatibility exports: packaging and mass arithmetic read the same declarations.
export { RHO_LN2, RHO_WATER } from '../model/config.js?v=331c3257';

/**
 * Full mass state for a class at a given fill condition.
 *
 * @param {object} cls resolved class config
 * @param {object} s   AirshipVisualState (waterFraction, ln2Fraction, fuelFraction)
 * @param {object} layout for the centre-of-mass arithmetic
 */
export function massState(cls, s, layout) {
  const dryT = cls.structureAllowanceTonnes;
  const waterT = cls.payloadTonnes * clamp01(s.waterFraction);
  const ln2T = cls.ln2TankCapacityTonnes * clamp01(s.ln2Fraction);
  // Fuel is a small share of the dry allowance; it is inside `dryT`, so only its VARIATION moves
  // the numbers. Treating it as extra mass on top would double-count the ledger.
  const fuelT = dryT * 0.06 * clamp01(s.fuelFraction);
  const fuelNominalT = dryT * 0.06;

  const totalT = dryT - fuelNominalT + fuelT + waterT + ln2T;
  // WORKING-ALTITUDE DENSITY, not sea level. This was the last copy of the defect
  // docs/OPEN-QUESTIONS.md #1 records as FIXED: the sim ledger moved to the density the hull
  // actually flies in and the 3D library kept buying its lift at 1.225, which overstated the
  // P-10000's net by 7,070 t against 1,051 — 6.7x on the surplus, printed as a scene caption.
  // A parity test that compares dispM3 and rhoSL cannot see it: both inputs agreed and the
  // derived quantity did not.
  const liftT = (cls.displacementM3 * RHO_WORK) / 1000;

  const com = centreOfMass(cls, layout, { waterT, ln2T, dryT: dryT - fuelNominalT + fuelT });

  const weightN = totalT * 1000 * G;
  const buoyancyN = liftT * 1000 * G;

  return {
    dryTonnes: dryT,
    waterTonnes: waterT,
    ln2Tonnes: ln2T,
    fuelTonnes: fuelT,
    totalTonnes: totalT,
    displacedTonnes: liftT,
    surplusTonnes: liftT - totalT,
    weightN,
    buoyancyN,
    netN: buoyancyN - weightN,
    /** Positive means it wants to rise. */
    netTonnes: liftT - totalT,
    centreOfMass: com,
    centreOfBuoyancy: [0, 0, 0],          // the model origin is the CB, by construction
    /** Vertical acceleration if nothing else acted, m/s2. */
    freeAccelMps2: totalT > 0 ? ((liftT - totalT) * G) / totalT : 0,
  };
}

/**
 * Per-tank LN2 levels for a bank fill fraction, filled SEQUENTIALLY: tank 0 fills completely
 * before tank 1 takes anything, and so on (the layout alternates port/starboard, so the leading
 * tanks stay roughly trim). The rationale is honesty at real mission quantities: the cryo plant
 * makes single-digit tonnes on a typical return leg against a 30-700 t bank, and dividing that
 * across every tank equally draws a hairline in each — technically correct and unreadable. One
 * partly-filled tank holds exactly the same total volume and can actually be seen filling.
 *
 * @returns {number[]} volume fraction 0..1 per tank; sums to fraction * tankCount.
 */
export function ln2TankLevels(fraction, tankCount) {
  const n = Math.max(1, tankCount | 0);
  const total = clamp01(fraction) * n;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = clamp01(total - i);
  return out;
}

/**
 * Centre of mass in model coordinates. Dry mass is taken as distributed with the hull volume
 * (so its centroid is the origin); water and LN2 are taken at their tanks' actual positions,
 * which is why filling and dropping visibly move the marker. LN2 uses the same sequential
 * tank-by-tank distribution the fill display draws, so the marker and the picture agree.
 */
export function centreOfMass(cls, layout, { waterT, ln2T, dryT }) {
  let mx = 0, my = 0, mz = 0, m = dryT;
  // dry contributes at the origin, so nothing to add for it
  if (layout && layout.waterTanks && layout.waterTanks.length && waterT > 0) {
    const per = waterT / layout.waterTanks.length;
    for (const t of layout.waterTanks) {
      mx += per * t.p[0]; my += per * t.p[1]; mz += per * t.p[2];
    }
    m += waterT;
  }
  if (layout && layout.ln2Tanks && layout.ln2Tanks.length && ln2T > 0) {
    const n = layout.ln2Tanks.length;
    const levels = ln2TankLevels(ln2T / Math.max(1e-9, cls.ln2TankCapacityTonnes), n);
    const perTankCap = cls.ln2TankCapacityTonnes / n;
    for (let i = 0; i < n; i++) {
      const t = layout.ln2Tanks[i];
      const mt = levels[i] * perTankCap;
      mx += mt * t.p[0]; my += mt * t.p[1]; mz += mt * t.p[2];
    }
    m += ln2T;
  }
  return m > 0 ? [mx / m, my / m, mz / m] : [0, 0, 0];
}

/** Volume of the water aboard, m3 — used to scale the tank fill geometry. */
export const waterVolumeM3 = (cls, frac) => cls.payloadTonnes * clamp01(frac);
/** Volume of the LN2 aboard, m3. Denser than water, so a tonne takes less room. */
export const ln2VolumeM3 = (cls, frac) =>
  (cls.ln2TankCapacityTonnes * clamp01(frac) * 1000) / RHO_LN2;

/**
 * Aerodynamic force on the hull. A drag-only model against the published Cd and the frontal area
 * of the published nominal diameter, plus a small lift term with angle of attack. Enough to make the
 * force overlay honest about which arrow is which; not an aerodynamic model.
 */
export function aeroForce(cls, s, assumptions = ASSUMPTIONS) {
  const v = s.airspeedMps || 0;
  const rho = assumptions?.rhoAir ?? ASSUMPTIONS.rhoAir;
  const Cd = assumptions?.Cd ?? ASSUMPTIONS.Cd;
  // sim/physics.js quotes Cd against nominal frontal area, not V^(2/3).
  const Aref = Math.PI * (specNumber(cls, 'nominalDiameterM') / 2) ** 2;
  const q = 0.5 * rho * v * v;
  const drag = q * Cd * Aref;
  const alpha = s.attitude ? s.attitude.pitchRad : 0;
  const lift = q * Aref * 0.9 * Math.sin(2 * alpha) * 0.5;
  return {
    dragN: drag,
    liftN: lift,
    /** In model axes: drag opposes +x, lift is +z. */
    vector: { x: -drag, y: 0, z: lift },
    dynamicPressurePa: q,
    referenceAreaM2: Aref,
  };
}

/**
 * The force set the overlay draws. Every arrow here is either from the ledger or from the state;
 * none of them is invented at draw time.
 */
export function forceSet(cls, s, layout, assumptions) {
  const m = massState(cls, s, layout);
  const aero = aeroForce(cls, s, assumptions);
  return {
    buoyancy: { at: [0, 0, 0], vec: [0, 0, m.buoyancyN], label: 'Vacuum buoyancy', tone: 'vacuum' },
    weight: { at: m.centreOfMass, vec: [0, 0, -m.weightN], label: 'Weight', tone: 'mass' },
    aero: {
      at: [cls.lengthM * 0.06, 0, 0],
      vec: [aero.vector.x, aero.vector.y, aero.vector.z],
      label: 'Aerodynamic force', tone: 'aero',
    },
    net: { at: m.centreOfMass, vec: [0, 0, m.netN], label: 'Net static force', tone: 'net' },
    mass: m,
    aeroDetail: aero,
  };
}

/**
 * Rotational inertia about the three body axes, from a solid-of-revolution approximation at the
 * current mass. This is what makes the motion look like an airship: the animation drivers divide
 * commanded torque by these numbers, and they are enormous.
 */
export function inertia(cls, totalTonnes) {
  const M = totalTonnes * 1000;
  const a = cls.lengthM / 2;          // semi-major
  const b = cls.maxRadiusM;           // semi-minor
  // Prolate spheroid: Ixx = 2/5 M b^2 (roll, about the long axis); Iyy = Izz = 1/5 M (a^2 + b^2).
  return {
    roll: 0.4 * M * b * b,
    pitch: 0.2 * M * (a * a + b * b),
    yaw: 0.2 * M * (a * a + b * b),
  };
}

/** Angular acceleration, deg/s2, for a torque — the number that shows why these do not pirouette. */
export function angularAccelDegS2(cls, totalTonnes, torqueNm) {
  const I = inertia(cls, totalTonnes);
  return {
    roll: ((torqueNm[0] || 0) / I.roll) * (180 / Math.PI),
    pitch: ((torqueNm[1] || 0) / I.pitch) * (180 / Math.PI),
    yaw: ((torqueNm[2] || 0) / I.yaw) * (180 / Math.PI),
  };
}
