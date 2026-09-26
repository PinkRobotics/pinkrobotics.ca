/* The four first-order physical relations the whole model is built on.
 *
 * Each is one equation with its units stated. If the project is wrong about how much
 * energy it takes to move water through the sky, it is wrong in one of these four
 * functions, so they are kept together, short, and separately testable.
 */
import { airDensity } from './atmosphere.js?v=a67fca39';
import { CFG, sourceAltM } from './config.js?v=a67fca39';

export function pumpMW(cls) {
  return 1000 * 9.81 * (cls.fillM3s * CFG.fillMul) * sourceAltM(cls) / CFG.pumpEta / 1e6;
}

export function dragMW(cls, mode) {
  const v = cls.cruiseKph * mode.speed * CFG.speedMul / 3.6;
  const A = Math.PI * (cls.diaM / 2) ** 2;
  return 0.5 * CFG.rhoAir * CFG.Cd * A * v ** 3 / CFG.propEta / 1e6;
}

export function diskMW(cls, thrustN) {
  if (thrustN <= 0) return 0;
  return Math.pow(thrustN, 1.5) / Math.sqrt(2 * CFG.rhoAir * cls.diskM2) / CFG.propEta / 1e6;
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
  const liftT = cls.dispM3 * rho / 1000;           // what the evacuated volume displaces here
  const dryT = cls.payloadT;                       // structure allowance = payload (the ledger's bet)
  return { rho, altMslM, liftT, dryT, reserveT: liftT - dryT - cls.payloadT, surplusT: liftT - dryT };
}

/* The whole conceptual cycle for one class, mode and one-way distance. Pure arithmetic. */
