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

import { ASSUMPTIONS, RHO_WATER, G, sourceAltM, specNumber } from '../model/config.js?v=d3e69408';
import { clamp01 } from '../core/math.js?v=d3e69408';

/** Source nodes and sink nodes of the electrical graph. */
export const SOURCES = ['solar', 'generator', 'battery', 'ln2Recovery'];
export const SINKS = ['propulsion', 'cryogenic', 'pumps', 'winch', 'avionics', 'batteryCharge'];

export const FLOW_LABELS = {
  solar: 'Solar', generator: 'Generators', battery: 'Battery (discharging)',
  ln2Recovery: 'LN₂ expansion', bus: 'HVDC bus',
  propulsion: 'Propulsion', cryogenic: 'Cryogenic plant', pumps: 'Water pumps',
  winch: 'Winches', avionics: 'Avionics and hotel', batteryCharge: 'Battery (charging)',
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
  // Missing host telemetry is unknown. A phase name or a nameplate is never generation.
  const keys = ['solarPowerMW', 'generatorPowerMW', 'batteryPowerMW', 'cryogenicPowerMW',
    'ln2RecoveryPowerMW', 'pumpPowerMW', 'propulsionPowerMW', 'winchPowerMW', 'hotelPowerMW'];
  const record = s.electrical || s;
  return Object.fromEntries(keys.map(k => [k, Number.isFinite(record[k]) ? record[k] : null]));
}

/**
 * The flow graph the energy view draws: a list of edges with a megawatt value. Sources feed the
 * bus, the bus feeds the sinks, and the battery sits on both sides depending on its sign.
 */
export function energyFlows(cls, s, a = ASSUMPTIONS) {
  const p = { ...derivePower(cls, s, a), ...onlyNumbers(s) };
  const edges = [];
  if (Object.values(p).some(v=>v===null)) return { edges, power:p, available:false, supplyMW:null, demandMW:null, balanceMW:null };
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
    'ln2RecoveryPowerMW', 'pumpPowerMW', 'propulsionPowerMW', 'winchPowerMW', 'hotelPowerMW']) {
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
