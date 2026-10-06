/* The four first-order physical relations the whole model is built on.
 *
 * Each is one equation with its units stated. If the project is wrong about how much
 * energy it takes to move water through the sky, it is wrong in one of these four
 * functions, so they are kept together, short, and separately testable.
 */
import { airDensity, ISA, isaPressurePa, isaTemperatureK } from './atmosphere.js?v=68694086';
import { CFG, WORK_ALT_MSL, sourceAltM } from './config.js?v=68694086';

export function pumpMW(cls) {
  return 1000 * 9.81 * (cls.fillM3s * CFG.fillMul) * sourceAltM(cls) / CFG.pumpEta / 1e6;
}

export function dragMW(cls, mode, rho = ledger(cls, WORK_ALT_MSL).rho) {
  const v = cls.cruiseKph * mode.speed * CFG.speedMul / 3.6;
  const A = Math.PI * (cls.diaM / 2) ** 2;
  return 0.5 * rho * CFG.Cd * A * v ** 3 / CFG.propEta / 1e6;
}

export function diskMW(cls, thrustN, rho = ledger(cls, WORK_ALT_MSL).rho, eta = CFG.propEta) {
  if (thrustN <= 0) return 0;
  return Math.pow(thrustN, 1.5) / Math.sqrt(2 * rho * cls.diskM2) / eta / 1e6;
}

/** Gross aerostatic lift as a mass, kg, before envelope/structure/payload.
 * Gas and ambient air share pressure (Pa) and temperature (K); purity is the gas
 * volume fraction, with dry air as the impurity. Full stated gas volume, no superheat.
 * Constants for He/H2 match research/analysis/helium.py (ideal gas, not an EOS).
 * airDensityKgM3 optionally carries the atmosphere's calibrated density exactly:
 * ledger's rhoSL dial scales density independently of the stipulated ISA P/T.
 */
export function grossLiftKg(volumeM3, { pressurePa, temperatureK, airDensityKgM3 }, gas = 'vacuum', purity = 1) {
  if (!Number.isFinite(volumeM3) || volumeM3 < 0 ||
      !Number.isFinite(pressurePa) || pressurePa <= 0 ||
      !Number.isFinite(temperatureK) || temperatureK <= 0 ||
      !Number.isFinite(purity) || purity < 0 || purity > 1 ||
      !['vacuum', 'hydrogen', 'helium'].includes(gas)) {
    throw new RangeError('grossLiftKg: invalid volume, state, gas or purity');
  }
  const rho = airDensityKgM3 ?? pressurePa / (ISA.R * temperatureK);
  if (!Number.isFinite(rho) || rho <= 0) throw new RangeError('grossLiftKg: invalid air density');
  const gasR = gas === 'helium' ? 2077.1 : 4124.2;
  const gasDensity = gas === 'vacuum' ? 0 : pressurePa / (gasR * temperatureK);
  // Vacuum purity means evacuated volume fraction; the rest contains ambient air.
  return volumeM3 * (purity * (rho - gasDensity));
}

/**
 * The mass and lift ledger at one altitude.
 *
 * `altMslM` is metres above MEAN SEA LEVEL, not above ground: buoyancy answers to the air
 * the hull is sitting in, and the terrain under it is 1,000 m of that. There is no default.
 * A caller that does not know its altitude cannot know its lift either, and the version of
 * this function that silently used sea level published a hull that was 2 / 20 / 200 t heavy
 * everywhere it actually flew.
 */
export function ledger(cls, altMslM) {
  const rho = airDensity(altMslM, CFG.rhoSL);
  const liftT = grossLiftKg(cls.dispM3, {
    pressurePa: isaPressurePa(altMslM), temperatureK: isaTemperatureK(altMslM), airDensityKgM3: rho,
  }) / 1000;                                    // what the evacuated volume displaces here
  const dryT = cls.payloadT;                       // structure allowance = payload (the ledger's bet)
  return { rho, altMslM, liftT, dryT, reserveT: liftT - dryT - cls.payloadT, surplusT: liftT - dryT };
}

/* The whole conceptual cycle for one class, mode and one-way distance. Pure arithmetic. */
