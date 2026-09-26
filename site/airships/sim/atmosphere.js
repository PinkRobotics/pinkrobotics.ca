/* Air density against altitude — the International Standard Atmosphere, troposphere only.
 *
 * Density is the one quantity in this model that changes a SIGN rather than a percentage
 * when it is wrong. A hull sized on sea-level air and flown at 2,500 m is not 22% short of
 * its lift, it is a different vehicle: buoyant on paper, heavy in the air. So density stops
 * being a constant and becomes a function of where the ship actually is, and every place
 * that buys lift has to say at what altitude it is buying it.
 *
 * Only the first ISA layer is implemented. It runs to 11,000 m and the fleet never works
 * above 3,000 m, so a second layer would be code that cannot execute. Altitudes outside the
 * layer throw rather than extrapolate: an out-of-range altitude in a buoyancy calculation is
 * a bug in the caller, not a number to be clamped quietly.
 *
 * Everything here is pure. No CFG, no state, no defaults that could hide a missing argument.
 */

/**
 * The ISA constants, with their sources. These are definitions, not measurements: the
 * standard atmosphere is a stipulated reference atmosphere, which is why every figure below
 * is exact rather than uncertain.
 */
export const ISA = {
  T0: 288.15,        // K, sea-level temperature. ISO 2533:1975 / ICAO Doc 7488.
  P0: 101325,        // Pa, sea-level pressure. ISO 2533:1975.
  LAPSE: 0.0065,     // K/m, tropospheric temperature lapse rate. ISO 2533:1975.
  G0: 9.80665,       // m/s2, standard gravity. CGPM 1901; part of the ISA definition.
  R: 287.0528,       // J/(kg K), specific gas constant of dry air = 8314.32 / 28.9644.
  TROPOPAUSE: 11000, // m, top of the first layer. ISO 2533:1975.
  FLOOR: -2000,      // m, bottom of the tabulated standard atmosphere. ISO 2533:1975.
};

/* g0 / (R L) = 5.255881…, the pressure exponent. One less than it is the density exponent,
 * because rho = p / (R T) and T is itself linear in altitude. Computed rather than written
 * out so that the constants above are the only place a value can be edited. */
const P_EXP = ISA.G0 / (ISA.R * ISA.LAPSE);
const RHO_EXP = P_EXP - 1;

/** ISA sea-level density, kg/m3. P0 / (R T0) = 1.225 to six figures — the familiar number. */
export const RHO_SL_ISA = ISA.P0 / (ISA.R * ISA.T0);

function checkAltitude(hM, where) {
  if (typeof hM !== 'number' || !isFinite(hM)) {
    throw new Error(`${where}: altitude must be a finite number of metres above mean sea level, got ${hM}`);
  }
  if (hM < ISA.FLOOR || hM > ISA.TROPOPAUSE) {
    throw new Error(`${where}: ${hM} m is outside the ISA troposphere layer `
      + `(${ISA.FLOOR} m to ${ISA.TROPOPAUSE} m)`);
  }
}

/** Temperature at altitude, K. Linear: the lapse rate is the definition of the layer. */
export function isaTemperatureK(hM) {
  checkAltitude(hM, 'isaTemperatureK');
  return ISA.T0 - ISA.LAPSE * hM;
}

/** Pressure at altitude, Pa. Hydrostatic balance through a linear temperature profile. */
export function isaPressurePa(hM) {
  checkAltitude(hM, 'isaPressurePa');
  return ISA.P0 * Math.pow(1 - ISA.LAPSE * hM / ISA.T0, P_EXP);
}

/**
 * Density at altitude as a fraction of the sea-level value. 1.0 at sea level, 0.7811 at
 * 2,500 m. Separated from `airDensity` because the ratio is what the ledger's arithmetic
 * turns on, and because it is the part that does not depend on the day's sea-level density.
 */
export function densityRatio(hM) {
  checkAltitude(hM, 'densityRatio');
  return Math.pow(1 - ISA.LAPSE * hM / ISA.T0, RHO_EXP);
}

/**
 * Air density at altitude, kg/m3.
 *
 * `rho0` is the sea-level density the profile is anchored to, defaulting to ISA. The model
 * passes `CFG.rhoSL`, so the page's sea-level dial scales the whole column rather than
 * setting the density at one arbitrary height — a warmer or cooler day to first order, with
 * the ISA lapse structure unchanged.
 */
export function airDensity(hM, rho0 = RHO_SL_ISA) {
  return densityRatio(hM) * rho0;
}

/**
 * The inverse: the altitude at which the air has a given density, metres MSL.
 *
 * Used to state break-even altitudes — "this hull goes heavy above X metres" — which is the
 * only honest way to publish a buoyancy margin, since the margin is a function of height.
 * Densities outside the layer throw, for the same reason altitudes do.
 */
export function altitudeForDensity(rhoKgM3, rho0 = RHO_SL_ISA) {
  if (typeof rhoKgM3 !== 'number' || !isFinite(rhoKgM3) || rhoKgM3 <= 0) {
    throw new Error(`altitudeForDensity: density must be a positive finite number, got ${rhoKgM3}`);
  }
  const hM = ISA.T0 / ISA.LAPSE * (1 - Math.pow(rhoKgM3 / rho0, 1 / RHO_EXP));
  checkAltitude(hM, 'altitudeForDensity');
  return hM;
}
