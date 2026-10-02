/* The electrical picture: where power comes from and where it goes, per mission phase.
 *
 * The energy view animates this graph. Edge thickness is megawatts, direction is the arrow, and
 * every number comes from the state object — the model does not compute a mission of its own.
 * When a host page supplies the power fields (the wildfire page does), they are used verbatim.
 * `derivePower()` only fills the gaps for the standalone lab.
 *
 * The nitrogen store is the point worth reading twice: liquefying costs about 0.45 kWh per
 * kilogram and gives back about half of it. It is a lossy battery whose useful side effect is
 * mass. Nothing here should let it look free.
 */

import { ASSUMPTIONS, RHO_WATER, G, sourceAltM, specNumber } from '../model/config.js?v=5bcbf32c';
import { clamp01 } from '../core/math.js?v=5bcbf32c';

/** Source nodes and sink nodes of the electrical graph. */
export const SOURCES = ['solar', 'generator', 'battery', 'ln2Recovery'];
export const SINKS = ['propulsion', 'cryogenic', 'pumps', 'winch', 'avionics', 'batteryCharge'];

export const FLOW_LABELS = {
  solar: 'Solar', generator: 'Generators', battery: 'Battery (discharging)',
  ln2Recovery: 'LN₂ expansion', bus: 'HVDC bus',
  propulsion: 'Propulsion', cryogenic: 'Cryogenic plant', pumps: 'Water pumps',
  winch: 'Winches', avionics: 'Avionics and hotel', batteryCharge: 'Battery (charging)',
};

/**
 * Per-phase power shape for the standalone lab, in megawatts. Only used when the host has not
 * supplied the numbers. Shares are of the class's own installed capacity, so a P-10000's
 * "cruise" is its own cruise rather than a scaled P-100's.
 */
const PHASE_SHAPE = {
  //                    prop  cryo  pump  winch  solarUse
  SOURCE_APPROACH:    [0.22, 0.30, 0.00, 0.00],
  HOSE_DEPLOY:        [0.12, 0.30, 0.00, 0.06],
  WATER_FILL:         [0.14, 0.10, 1.00, 0.00],
  HOSE_RETRACT:       [0.12, 0.20, 0.00, 0.06],
  DEPARTURE_CLIMB:    [0.55, 0.00, 0.00, 0.00],
  OUTBOUND_TRANSIT:   [0.62, 0.20, 0.00, 0.00],
  FIRE_APPROACH:      [0.45, 0.00, 0.00, 0.00],
  WATER_RELEASE:      [0.28, 0.00, 0.00, 0.00],
  BUOYANCY_ESCAPE:    [0.18, 0.00, 0.00, 0.00],
  RETURN_TRANSIT:     [0.34, 1.00, 0.00, 0.00],
  CONTROLLED_DESCENT: [0.70, 0.40, 0.00, 0.00],
  WEATHER_HOLD:       [0.30, 0.40, 0.00, 0.00],
  SAFE_DRIFT:         [0.02, 0.00, 0.00, 0.00],
  TOTAL_POWER_LOSS:   [0.00, 0.00, 0.00, 0.00],
  TANKER_REFUEL:      [0.14, 0.10, 0.00, 0.02],
};

/** Pump shaft power for a class: rho g Q H / eta, in MW. Same arithmetic as the /airships page. */
export function pumpPowerMW(cls, a = ASSUMPTIONS) {
  const Q = specNumber(cls, 'fillRateM3s');
  return (RHO_WATER * G * Q * sourceAltM(cls)) / a.pumpEta / 1e6;
}

/**
 * Fill in any power fields the host did not supply. Returns a NEW state-like object holding only
 * the power fields, so the caller can decide what to merge.
 */
export function derivePower(cls, s, a = ASSUMPTIONS) {
  const shape = PHASE_SHAPE[s.phase] || PHASE_SHAPE.OUTBOUND_TRANSIT;
  const dead = s.phase === 'TOTAL_POWER_LOSS';
  const hotel = dead ? 0 : cls.generatorContinuousPowerMW * 0.02;

  const propulsion = pick(s.propulsionPowerMW,
    shape[0] * (cls.generatorContinuousPowerMW + cls.batteryPeakPowerMW) * 0.35);
  const cryogenic = pick(s.cryogenicPowerMW, shape[1] * cls.cryogenicPowerMW);
  const pumps = pick(s.pumpPowerMW, shape[2] * pumpPowerMW(cls, a));
  const winch = shape[3] * cls.generatorContinuousPowerMW * 0.05;

  // Solar: the projected area at ASSUMPTIONS.solarWPerM2 electrical, faded by phase altitude.
  const solarMW = (cls.solarAreaM2 * ASSUMPTIONS.solarWPerM2) / 1e6;
  const solar = pick(s.solarPowerMW, dead ? solarMW * 0.25 : solarMW);

  // Expansion recovery only happens while the store is being drawn down.
  const drawingLN2 = s.phase === 'CONTROLLED_DESCENT' || s.phase === 'WEATHER_HOLD';
  const ln2Recovery = pick(s.ln2RecoveryPowerMW,
    drawingLN2 && !dead ? cls.cryogenicPowerMW * 0.5 * a.rtLN2 : 0);

  const demand = propulsion + cryogenic + pumps + winch + hotel;
  const supplyBeforeGen = solar + ln2Recovery;
  const generator = pick(s.generatorPowerMW,
    dead ? 0 : Math.max(0, Math.min(cls.generatorContinuousPowerMW, demand - supplyBeforeGen)));
  // Battery covers whatever is left, or absorbs a surplus (negative = charging). With a dead bus
  // the panels do not stop being panels: what they make goes into the store, which is the only
  // honest place for it. It is not steering anything.
  const battery = pick(s.batteryPowerMW,
    dead ? -(solar + ln2Recovery) : demand - supplyBeforeGen - generator);

  return {
    solarPowerMW: solar,
    generatorPowerMW: generator,
    batteryPowerMW: battery,
    cryogenicPowerMW: cryogenic,
    ln2RecoveryPowerMW: ln2Recovery,
    pumpPowerMW: pumps,
    propulsionPowerMW: propulsion,
    winchPowerMW: winch,
    hotelPowerMW: hotel,
  };
}

/** A supplied value wins even when it is zero; only null/undefined falls back. */
const pick = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);

/**
 * The flow graph the energy view draws: a list of edges with a megawatt value. Sources feed the
 * bus, the bus feeds the sinks, and the battery sits on both sides depending on its sign.
 */
export function energyFlows(cls, s, a = ASSUMPTIONS) {
  const p = { ...derivePower(cls, s, a), ...onlyNumbers(s) };
  const edges = [];
  const add = (from, to, mw, tone) => {
    if (mw > 1e-4) edges.push({ from, to, mw, tone });
  };
  add('solar', 'bus', p.solarPowerMW, 'solar');
  add('generator', 'bus', p.generatorPowerMW, 'power');
  add('ln2Recovery', 'bus', p.ln2RecoveryPowerMW, 'cryo');
  if (p.batteryPowerMW > 0) add('battery', 'bus', p.batteryPowerMW, 'power');

  add('bus', 'propulsion', p.propulsionPowerMW, 'propulsion');
  add('bus', 'cryogenic', p.cryogenicPowerMW, 'cryo');
  add('bus', 'pumps', p.pumpPowerMW, 'water');
  add('bus', 'winch', p.winchPowerMW || 0, 'water');
  add('bus', 'avionics', p.hotelPowerMW || 0, 'compute');
  if (p.batteryPowerMW < 0) add('bus', 'batteryCharge', -p.batteryPowerMW, 'power');

  const supply = p.solarPowerMW + Math.max(0, p.generatorPowerMW) + p.ln2RecoveryPowerMW +
    Math.max(0, p.batteryPowerMW);
  const demand = p.propulsionPowerMW + p.cryogenicPowerMW + p.pumpPowerMW +
    (p.winchPowerMW || 0) + (p.hotelPowerMW || 0) + Math.max(0, -p.batteryPowerMW);

  return {
    edges, power: p,
    supplyMW: supply, demandMW: demand,
    /** Should be ~0. A non-zero balance is a bug in whoever supplied the numbers. */
    balanceMW: supply - demand,
  };
}

function onlyNumbers(s) {
  const o = {};
  for (const k of ['solarPowerMW', 'generatorPowerMW', 'batteryPowerMW', 'cryogenicPowerMW',
    'ln2RecoveryPowerMW', 'pumpPowerMW', 'propulsionPowerMW']) {
    if (typeof s[k] === 'number' && isFinite(s[k])) o[k] = s[k];
  }
  return o;
}

/**
 * The nitrogen store's ledger, for the LN2 scene's caption. Charge cost and discharge return over
 * the class's full tank, at the current assumptions.
 */
export function ln2Ledger(cls, a = ASSUMPTIONS) {
  const kg = cls.ln2TankCapacityTonnes * 1000;
  const chargeMWh = (kg * a.eLN2) / 1000;
  const returnMWh = chargeMWh * a.rtLN2;
  return {
    tankTonnes: cls.ln2TankCapacityTonnes,
    chargeMWh,
    returnMWh,
    lostMWh: chargeMWh - returnMWh,
    roundTrip: a.rtLN2,
    specificEnergyKWhPerKg: a.eLN2,
    /** Hours of the cryogenic plant at full rate to fill the tank. */
    hoursToFill: chargeMWh / Math.max(1e-6, cls.cryogenicPowerMW),
    note: 'Demonstration assumptions, not an airborne plant specification.',
  };
}

/** The process sequence the cryogenic scene steps through, in order. */
export const CRYO_SEQUENCE = [
  ['CryoAirIntake', 'ambient air, filtered'],
  ['CryoCompressor', 'compression — most of the energy, most of the heat'],
  ['CryoColdBox', 'drying, CO₂ removal, nitrogen separation'],
  ['CryoColdBox', 'precooling and liquefaction'],
  ['LN2Tank', 'dense liquid ballast stored'],
  ['CryoExpander', 'pumped, warmed, expanded through the turbine'],
  ['HVDCBus', 'electricity returned to the bus — about half of what went in'],
  ['CryoAirIntake', 'nitrogen returned to the atmosphere'],
];

void clamp01;
