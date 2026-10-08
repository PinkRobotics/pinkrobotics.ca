import { capsuleFootprintM2, ALT, ALT_DROP_TOP, CFG, PHASES, TERRAIN_MSL, WORK_ALT_MSL, VZ_MAX, sourceAltM } from './config.js?v=01e992e3';
import { easeSm, easeTrap } from './geo.js?v=01e992e3';
import { diskMW, ledger, pumpMW } from './physics.js?v=01e992e3';

import {profilePoint} from './profile.js?v=01e992e3';

import { anchorGeometry } from './config.js?v=01e992e3';
import {instantOperatingMargins,operatingMarginRatio} from './operating-margin.js?v=01e992e3';

const G = 9.81;
/** The share of the bus the rotors may draw; the rest is for everything else aboard. */
export const BUS_CEILING = 1;
/** Force assumptions, not validated hull data. S is the capsule planform, b the diameter.
 * Local research contains no measured hull C_L,max. Report sensitivity at all three values. */
export const AERO_CL_MAX = 1;
export const AERO_CL_VALUES = [0.5, 1, 1.5];
export const AERO_SPAN_EFFICIENCY = 1;
export const VERTICAL_CD = 1; // unverified broadside drag assumption
/** Figure of merit times drive efficiency; neither endpoint is validated for this rotor. */
export const ROTOR_EFFICIENCY_VALUES = [0.55, 0.70];
export const FORCE_TOL = 1e-6;
export const LIMIT_STEPS = 1024;
export function aeroGeometry(cls) {
  return { areaM2: capsuleFootprintM2(cls),
    spanM: cls.diaM, efficiency: AERO_SPAN_EFFICIENCY };
}
/** Hotel load as a fraction of the generator rating (a proxy for the hull's own systems). */
export const HOTEL_FRAC = 0.02;
/** Winch idling (hose and cable handling) as a fraction of pump power. */
export const WINCH_IDLE_FRAC = 0.06;
/** The anchor bag is hoisted this far to break the surface, at this winch efficiency, by a winch
    that pays out and hauls at WINCH_MPS (plan.js sizes the approach to it: the cable must be in
    the water before the ship needs holding down). */
export const HOIST_M = 15;
export const WINCH_ETA = 0.85;
export const WINCH_MPS = 5;
/** The return leg's progress at which the descent to the hold altitude begins. */
export const LETDOWN_FROM = 0.72;
/** The share of the nitrogen store vented during the approach; the rest goes during the fill. */
export const VENT_APPROACH = 0.30;
/** Midpoint samples per phase in planCycle's integral (see integrateCycle for the error). */
export const PLAN_STEPS = 96;
/** Half-step, in phase progress, for the finite differences that give rates. */
const FD = 1e-3;

/** Cable load begins when water is picked up; its hoist remains priced until complete.
 * No pickup on the return leg. Fill inherits the achieved approach inventory. */
function anchorPotential(cls, fullT, id, prog, alt, gs, achievedT = 0) {
  const cap = Math.max(0, Math.min(fullT, cls.anchorBagT || 0));
  const reach = anchorGeometry(cls.anchorM || 0, cls.diaM).contactAltitudeM;
  if (!(cap > 0) || alt > reach) return { cableP: 0, fillF: 0, tonnes: 0 };
  if (id === 'WATER_FILL') {
    const tonnes = Math.min(cap, achievedT) * Math.max(0, 1 - prog / 0.30);
    return { cableP: Math.max(0, 1 - Math.max(0, prog - 0.25) / 0.35), fillF: tonnes / cap, tonnes };
  }
  if (id !== 'SOURCE_APPROACH' || gs / 3.6 > 2) return { cableP: 0, fillF: 0, tonnes: 0 };
  const slow = Math.min(1, Math.max(0, 1 - gs / 3.6 / 2));
  const fillF = slow * Math.min(1, Math.max(0, (reach - alt) / Math.max(1, cls.anchorM * 0.14)));
  return { cableP: 1, fillF, tonnes: cap * fillF };
}

function anchorAt(cls, plan, g, id, prog) {
  const seconds = plan.dur.SOURCE_APPROACH * 60, tau = HOIST_M / WINCH_MPS / seconds;
  const potential = p => p < 0 ? 0 : anchorPotential(cls, plan.anchorT, 'SOURCE_APPROACH', p,
    altAt(g, plan, 'SOURCE_APPROACH', p), gsAt(g, plan, 'SOURCE_APPROACH', p)).tonnes;
  // Stop pickup tau before the seam so the last hoist completes before filling.
  const acquired = p => potential(Math.min(Math.max(0, p), Math.max(0, 1 - tau)));
  const achieved = potential(1 - tau);
  if (id === 'WATER_FILL') return { ...anchorPotential(cls, plan.anchorT, id, prog, g.srcAlt, 0, achieved), hoistMW: 0 };
  if (id !== 'SOURCE_APPROACH') return { cableP: 0, fillF: 0, tonnes: 0, hoistMW: 0 };
  const tonnes = acquired(prog);
  const liftingT = Math.max(0, tonnes - potential(prog - tau));
  const creditedT = plan.bagCreditRule === 'completed-hoist' ? potential(prog - tau) : tonnes;
  return { cableP: tonnes > 0 || liftingT > 0 ? 1 : 0,
    fillF: creditedT / Math.max(1e-12, plan.anchorT), tonnes: creditedT,
    hoistMW: liftingT * 9810 * WINCH_MPS / WINCH_ETA / 1e6 };
}

/**
 * Induced power of the rotor disks, MW, for a thrust `thrustN` while moving edgewise through
 * the air at `airV` m/s and axially INTO the thrust direction at `axialV` m/s (for rotors that
 * push down, that is the rate of descent). Glauert's relation, solved by bisection: the function
 * v -> v * sqrt(V^2 + (v_c + v)^2) is increasing, and the root lies in [0, v_h] for nonnegative
 * axialV. Momentum theory covers normal-working and windmill-brake states, but not the
 * recirculating states between them. This model implements neither the windmill-brake branch
 * nor a model for those intermediate states: climb against hold-down thrust (axialV below zero)
 * is priced as level flight, with no conservative error bound. No regenerative power is credited.
 * A constant hover merit times drive efficiency divides ideal power at every thrust and speed;
 * no separate blade profile power or blade, rotor-speed or pitch policy is implemented.
 * At V = 0 and v_c = 0 this returns diskMW exactly.
 */
export function inducedMW(cls, thrustN, airV = 0, axialV = 0, rho = ledger(cls, WORK_ALT_MSL).rho, eta = CFG.propEta) {
  if (thrustN <= 0) return 0;
  const V = Math.abs(airV), vc = Math.max(0, axialV);
  if (V === 0 && vc === 0) return diskMW(cls, thrustN, rho, eta);
  const vh2 = thrustN / (2 * rho * cls.diskM2);
  if (vc === 0) {
    const vi2 = 2 * vh2 * vh2 / (Math.sqrt(V ** 4 + 4 * vh2 * vh2) + V * V);
    return thrustN * Math.sqrt(vi2) / eta / 1e6;
  }
  let lo = 0, hi = Math.sqrt(vh2);
  for (let k = 0; k < 64 && hi - lo > 1e-12 * hi; k++) {
    const mid = 0.5 * (lo + hi);
    if (mid * Math.sqrt(V * V + (vc + mid) * (vc + mid)) > vh2) hi = mid; else lo = mid;
  }
  return thrustN * (vc + 0.5 * (lo + hi)) / eta / 1e6;
}

/** The most thrust the rotors can make on a bus of `busMW`, in tonnes-force: diskMW inverted. */
export function rotorMaxTonnes(cls, busMW, rho = ledger(cls, WORK_ALT_MSL).rho, eta = CFG.propEta) {
  return Math.pow(BUS_CEILING * busMW * 1e6 * eta *
    Math.sqrt(2 * rho * cls.diskM2), 2 / 3) / G / 1000;
}

/** The LN2 leaving the tanks, tonnes per hour, in this phase. The store made on the return leg
    is vented as ballast is swapped for water: VENT_APPROACH of it during the approach, the rest
    during the fill. */
export function ventTph(plan, id) {
  if (id === "SOURCE_APPROACH") return VENT_APPROACH * plan.ln2MakeT / (plan.dur.SOURCE_APPROACH / 60);
  if (id === "WATER_FILL") return (1 - VENT_APPROACH) * plan.ln2MakeT / (Math.max(1e-12, plan.dur.WATER_FILL / 60));
  return 0;
}

/** Declared recovery ceiling, kWh per tonne of liquid nitrogen.
 * Arnaiz-del-Pozo et al., Entropy 22, 959 (2020), printed pp. 6 and 8:
 * pure nitrogen feed at 4 bar; flow-exergy difference from MP GAN to MP LIN.
 * This state-specific process comparator is a model limit, not measured airborne
 * expander recovery or a universal liquid-exergy value at every ambient state.
 * DOI: 10.3390/e22090959. */
export const LN2_RECOVERY_KWH_PER_T = 173.4;
/** Requested round-trip work, limited per tonne before the generator power cap.
 * Higher liquefaction consumption does not raise the declared recoverable work. */
export function regenMW(cls, plan, id) {
  const flowTph = ventTph(plan, id);
  // Retain the original multiplication order below the ceiling, including defaults.
  return Math.min(cls.genMW, flowTph * CFG.eLN2 * CFG.rtLN2,
    flowTph * (LN2_RECOVERY_KWH_PER_T / 1000));
}

/** The bus the descent can draw on: the battery plus what the generators return while the
    approach vents ballast. This is the bus the force closure in plan.js is struck against. */
export function descentBusMW(cls, plan) {
  return cls.battMW + regenMW(cls, plan, "SOURCE_APPROACH");
}

/** Cold-ready assumption: production starts immediately on return, with no startup,
 * standby or restart cost; the run fraction only limits output, not thermal readiness. */
export function cryoOnFrac(cls, mode, plan) {
  const cryoCapMW = cls.cryoMW * CFG.cryoMul * mode.cryoShare;
  const capT = cryoCapMW * (plan.dur.RETURN_TRANSIT / 60) / CFG.eLN2;   // t the leg could make
  return capT > 0 ? Math.min(1, plan.ln2MakeT / capT) : 0;
}

/** The altitudes and speeds the profile is built on, all derived from the plan. */
export function cycleGeometry(cls, plan) {
  // How high this class works the water: its own hose length.
  const srcAlt = sourceAltM(cls);
  /* WHERE THE TRANSIT STOPS DESCENDING, and the approach takes over.
   *
   * Below `plan.anchorFromAglM` the rotors cannot hold this hull down on their own and the
   * descent anchor has to be in the water. A bag cannot be dipped at 130 km/h, so the ship may
   * not enter that band until it is over the lake and slow — which means the transit levels off
   * ABOVE it and the approach, which is the slow phase, flies the rest of the way down. */
  const holdAgl = Math.max(srcAlt + 130, (plan.anchorFromAglM || srcAlt) + 60);
  // A ship does not climb to 1,500 m on a two-minute hop. The working ceiling is whatever the
  // shorter leg can actually reach at a sane climb rate.
  const altTop = Math.min(ALT.cruise, srcAlt +
    VZ_MAX * 0.30 * 60 * Math.min(plan.dur.OUTBOUND_TRANSIT, plan.dur.RETURN_TRANSIT));
  // Where the cork stops: three quarters of the working ceiling, never less than 180 m above
  // the line, and allowed to overshoot altTop — the return eases back down afterwards.
  const altEsc = Math.max(ALT_DROP_TOP + 180, altTop * 0.75);
  const vRun = cls.dropKm * (plan.passes || 1) / Math.max(0.05, plan.dur.WATER_RELEASE) * 60;
  const vApp = Math.max(6, plan.gsOut * 0.3);
  const vEsc = plan.gsRet * 0.85;      // what the escape climb has built by the time it ends
  return { srcAlt, holdAgl, altTop, altEsc, vRun, vApp, vEsc, ...plan.altitudeGeometry };
}

/** Altitude above the terrain, m, at `prog` of phase `id`. */
export function altAt(g, plan, id, prog) {
  if(plan.profile?.phases[id])return profilePoint(plan.profile.phases[id],prog*plan.dur[id]*60).alt;
  switch (id) {
    case "SOURCE_APPROACH": {
      // Arrive, stop, THEN go down: the first 30% closes the track, the descent is on the far
      // side of the stop, hovering, because that is the only speed at which a bag can be dipped.
      const sink = easeSm(Math.max(0, (prog - 0.30) / 0.70));
      return g.holdAgl - (g.holdAgl - g.srcAlt) * sink;
    }
    case "WATER_FILL": return g.srcAlt;
    case "OUTBOUND_TRANSIT": {
      const tz = easeTrap(prog);
      return tz < 0.3 ? g.srcAlt + (g.altTop - g.srcAlt) * easeSm(tz / 0.3)
        : tz > 0.70 ? g.altTop - (g.altTop - ALT.drop) * easeSm((tz - 0.70) / 0.30)
        : g.altTop;
    }
    case "WATER_RELEASE": {
      // Keep at least thirty seconds for the rise when little water is delivered.
      const width = plan.releaseRiseFraction ?? Math.min(1, Math.max(0.15, 30 / (plan.dur.WATER_RELEASE * 60)));
      return ALT.drop + (ALT_DROP_TOP - ALT.drop) * easeSm(Math.max(0, (prog - (1 - width)) / width));
    }
    case "BUOYANCY_ESCAPE": return ALT_DROP_TOP + (g.altEsc - ALT_DROP_TOP) * easeSm(prog);
    default: {   // RETURN_TRANSIT starts where the escape ended.
      // A short leg can put its nominal ceiling below both endpoints. Join those endpoints
      // directly instead of diving to that ceiling and climbing steeply back to the source.
      if (g.altTop < Math.min(g.altEsc, g.holdAgl)) return g.altEsc + (g.holdAgl - g.altEsc) * easeSm(prog);
      const tz = easeTrap(prog),[up,down]=plan.returnJoinWidths??[.3,.3];
      return tz < up ? g.altEsc + (g.altTop - g.altEsc) * easeSm(tz / up)
        : tz > 1-down ? g.altTop - (g.altTop - g.holdAgl) * easeSm((tz - (1-down)) / down)
        : g.altTop;
    }
  }
}

/** Instantaneous ground speed, km/h — the dial's needle, not the plan's out/back averages.
    Phase SEAMS carry speed across; two phases pass through zero on purpose: the fill is a
    station-hold, and the approach stops before it lets itself down so the anchor can go in. */
export function gsAt(g, plan, id, prog) {
  if(plan.profile?.phases[id]) {
    const point=profilePoint(plan.profile.phases[id],prog*plan.dur[id]*60);
    return 3.6*(point.airV+(plan.profile.legs[id]?.windMps||0));
  }
  const aE2 = 0.15;
  if (id === "OUTBOUND_TRANSIT") {
    return prog < aE2 ? plan.gsOut * (prog / aE2)
      : prog > 1 - aE2 ? plan.gsOut * ((1 - prog) / aE2)
      : plan.gsOut;
  }
  if (id === "RETURN_TRANSIT") {
    return prog < aE2 ? g.vEsc + (plan.gsRet - g.vEsc) * (prog / aE2)
      : prog > 1 - aE2 ? g.vApp + (plan.gsRet - g.vApp) * ((1 - prog) / aE2)
      : plan.gsRet;
  }
  if (id === "WATER_RELEASE") {
    // The derivative of the eased shuttle: nothing at each turn, the run speed on average.
    const nP = plan.passes || 1;
    const kk = Math.min(nP - 1e-9, prog * nP);
    const pff = kk - Math.floor(kk);
    return g.vRun * 6 * pff * (1 - pff);
  }
  if (id === "BUOYANCY_ESCAPE") return g.vEsc * Math.pow(prog, 1.5);
  if (id === "SOURCE_APPROACH") return g.vApp * (1 - easeSm(Math.min(1, prog / 0.30)));
  return 0;
}

/** Water and nitrogen aboard, tonnes, at `prog` of phase `id`. */
export function loadAt(cls, plan, id, prog, cryoFrac) {
  const L = plan.ln2MakeT;
  switch (id) {
    case "SOURCE_APPROACH": return { water: plan.retainedT, ln2: L * (1 - prog * VENT_APPROACH) };
    case "WATER_FILL": return { water: plan.retainedT + plan.deliveredT * prog,
      ln2: L * (1 - VENT_APPROACH) * (1 - prog) };
    case "OUTBOUND_TRANSIT": return { water: cls.payloadT, ln2: 0 };
    case "WATER_RELEASE": {
      // Water goes out with DISTANCE covered rather than with the clock, so nothing is dumped
      // while the hull is turning.
      const nP = plan.passes || 1;
      const k = Math.min(nP - 1e-9, prog * nP), pi = Math.floor(k), e = easeSm(k - pi);
      return { water: cls.payloadT - plan.deliveredT * ((pi + e) / nP), ln2: 0 };
    }
    case "BUOYANCY_ESCAPE": return { water: plan.retainedT, ln2: 0 };
    // Cold-ready assumption: liquid is credited from the first positive return sample.
    default: return { water: plan.retainedT,   // RETURN_TRANSIT: the plant fills the tanks
      ln2: L * (cryoFrac > 0 ? Math.min(1, prog / cryoFrac) : 1) };
  }
}

/** Airspeed through the disks, m/s. On the transit legs the ship flies its airspeed and the
    ground speed is the day's; everywhere else no wind is applied to the rotors (a stated
    simplification — a wind through the disks would lower the induced power, not raise it). */
function airV(cls, mode, plan, id, prog, gs) {
  if(plan.profile?.phases[id]) {
    const point=profilePoint(plan.profile.phases[id],prog*plan.dur[id]*60);
    return Math.hypot(point.airV,plan.profile.legs[id]?.crosswindMps||0);
  }
  // Use the actual wind, never a difference recovered from a timing bound.
  if (id === "OUTBOUND_TRANSIT") return Math.hypot(gs - (plan.tailOut || 0), plan.crossOut || 0) / 3.6;
  if (id === "RETURN_TRANSIT") return Math.hypot(gs + (plan.tailOut || 0), plan.crossOut || 0) / 3.6;
  return gs / 3.6;
}

/** Installed thrust surrogate: hover thrust at the existing battery + generator rating.
 * No blade thrust rating is supplied in the class record; this is an explicit unverified limit,
 * independent of the instantaneous bus. Requirements may override it without altering a class. */
export function rotorThrustLimitT(cls, rho = ledger(cls, WORK_ALT_MSL).rho, eta = CFG.propEta) { return rotorMaxTonnes(cls, cls.battMW + cls.genMW, rho, eta); }

/** Minimum electrical power split for a specified hold-down, with aerodynamic and rotor limits.
 * The objective is convex: rotor momentum power plus the quadratic induced-drag bill. */
function splitForce(cls, needT, aeroLimitT, thrustLimitT, V, vc, k, rho, eta) {
  const heldT = Math.min(Math.max(0, needT), aeroLimitT + thrustLimitT);
  let lo = Math.max(0, heldT - thrustLimitT), hi = Math.min(heldT, aeroLimitT);
  const cost = a => inducedMW(cls, (heldT - a) * 9810, V, vc, rho, eta) + k * a * a;
  if (hi > lo) {
    // Golden-section search, fixed tolerance in force, independent of integration samples.
    const r = (Math.sqrt(5) - 1) / 2;
    let x = hi - r * (hi - lo), y = lo + r * (hi - lo), fx = cost(x), fy = cost(y);
    for (let i = 0; i < 32; i++) {
      if (fx < fy) { hi = y; y = x; fy = fx; x = hi - r * (hi - lo); fx = cost(x); }
      else { lo = x; x = y; fx = fy; y = lo + r * (hi - lo); fy = cost(y); }
    }
  }
  const aeroT = (lo + hi) / 2, rotorT = heldT - aeroT;
  return { aeroT, rotorT, rotorMW: inducedMW(cls, rotorT * 9810, V, vc, rho, eta), inducedMW: k * aeroT * aeroT };
}

/** The one instantaneous energy and vertical-force record. Positive owner forces hold DOWN;
 * vertical drag is signed. Fixed choreography is evaluated quasi-statically: no residual force
 * is silently used to justify a different trajectory. An unsupported instant refuses the plan. */
export function drawAt(cls, mode, plan, id, prog, opts = {}) {
  const g = cycleGeometry(cls, plan), durS = plan.dur[id] * 60;
  const cryoFrac = cryoOnFrac(cls, mode, plan), alt = altAt(g, plan, id, prog);
  const { water, ln2 } = loadAt(cls, plan, id, prog, cryoFrac), gs = gsAt(g, plan, id, prog);
  const p0 = Math.max(0, prog - FD), p1 = Math.min(1, prog + FD);
  const vz = (altAt(g, plan, id, p1) - altAt(g, plan, id, p0)) / Math.max(1e-9, (p1 - p0) * durS);
  const led = ledger(cls, TERRAIN_MSL + alt), massT = led.dryT + water + ln2;
  const surplusT = led.liftT - massT, reserveT = Math.max(1, led.liftT - led.dryT);
  const V = opts.hover ? 0 : airV(cls, mode, plan, id, prog, gs), vc = opts.hover ? 0 : Math.max(0, -vz);
  const rho = led.rho, eta = plan.rotorEfficiency ?? CFG.propEta;
  const geometry = aeroGeometry(cls), qPa = 0.5 * rho * V * V;
  const basis = plan.basis || 'record', clMax = plan.clMax ?? AERO_CL_MAX;
  const aeroLimitT = basis === 'favourable' ? clMax * qPa * geometry.areaM2 / 9810 : 0;
  const k = qPa > 0 ? 9810 ** 2 / (qPa * Math.PI * geometry.spanM ** 2 * geometry.efficiency) * V / CFG.propEta / 1e6 : 0;
  const verticalDragT = 0.5 * rho * (plan.verticalCd ?? VERTICAL_CD) * geometry.areaM2 * vz * Math.abs(vz) / 9810;
  const anchor = anchorAt(cls, plan, g, id, prog);
  // Dump excess water rather than crediting a bag that would pull the hull below the profile.
  anchor.tonnes = Math.min(anchor.tonnes, Math.max(0, surplusT - verticalDragT));
  const bagT = opts.anchorCredit === false ? 0 : anchor.tonnes, hoistMW = anchor.hoistMW;
  const needT = Math.max(0, surplusT - bagT - verticalDragT);
  const regen = regenMW(cls, plan, id);
  const gen = { solar: cls.solarM2 * CFG.solarWPerM2 / 1e6 };
  if (regen > 0) gen.regen = regen;
  const busMW = (plan.requiredBatteryMW ?? cls.battMW) + gen.solar + regen;
  const zeroLiftDragN = qPa * CFG.Cd * Math.PI * (cls.diaM / 2) ** 2;
  const draw = { hotel: cls.genMW * HOTEL_FRAC, prop: zeroLiftDragN * V / CFG.propEta / 1e6 };
  if (id === 'SOURCE_APPROACH') draw.winch = pumpMW(cls) * WINCH_IDLE_FRAC + hoistMW;
  if (id === 'WATER_FILL') draw.pumps = plan.pumpMW;
  if (id === 'OUTBOUND_TRANSIT' && prog < 0.18) draw.winch = pumpMW(cls) * WINCH_IDLE_FRAC;
  // This production-only draw has no startup, standby or restart term (cold-ready assumption).
  if (id === 'RETURN_TRANSIT' && prog < cryoFrac) draw.cryo = cls.cryoMW * CFG.cryoMul * mode.cryoShare;
  const nonRotorMW = Object.values(draw).reduce((a, b) => a + b, 0);
  const availableMW = Math.max(0, busMW - nonRotorMW);
  const thrustLimitT = plan.requiredRotorT ?? rotorThrustLimitT(cls, rho, eta);
  const ask = splitForce(cls, needT, aeroLimitT, thrustLimitT, V, vc, k, rho, eta);
  let { aeroT, rotorT } = ask;
  const rotorAskMW = ask.rotorMW, forceAskMW = ask.rotorMW + ask.inducedMW;
  const busLimited = nonRotorMW + forceAskMW > busMW + 1e-9;
  if (forceAskMW > availableMW) {
    // Minimum split power is monotone in held force. Find the largest force
    // whose optimum fits the supply, so reallocation cannot leave a bus gap.
    let lo = 0, hi = ask.rotorT + ask.aeroT;
    for (let i = 0; i < 40; i++) {
      const forceT = (lo + hi) / 2;
      const trial = splitForce(cls, forceT, aeroLimitT, thrustLimitT, V, vc, k, rho, eta);
      if (trial.rotorMW + trial.inducedMW > availableMW) hi = forceT; else lo = forceT;
    }
    const supported = splitForce(cls, lo, aeroLimitT, thrustLimitT, V, vc, k, rho, eta);
    rotorT = supported.rotorT; aeroT = supported.aeroT;
  }
  draw.rotors = inducedMW(cls, rotorT * 9810, V, vc, rho, eta);
  const inducedDragN = qPa > 0 ? (aeroT * 9810) ** 2 / (qPa * Math.PI * geometry.spanM ** 2 * geometry.efficiency) : 0;
  draw.prop += inducedDragN * V / CFG.propEta / 1e6;
  const owners = { bagT, rotorT, aeroT, verticalDragT };
  const unheldT = surplusT - Object.values(owners).reduce((a, b) => a + b, 0);
  const limits = [];
  if (busLimited) limits.push('bus power');
  if (needT > thrustLimitT + aeroLimitT + FORCE_TOL) limits.push('rotor thrust');
  if (Math.abs(unheldT) > FORCE_TOL * Math.max(1, Math.abs(surplusT))) {
    if (basis === 'favourable' && ask.aeroT >= aeroLimitT - FORCE_TOL) limits.push('aerodynamic coefficient');
    if (unheldT < 0) limits.push(cls.reversibleThrust ? 'upward thrust not modelled' : 'upward authority unavailable');
    if (bagT === 0 && (id === 'SOURCE_APPROACH' || id === 'WATER_FILL')) limits.push('anchor cable reach');
    if (!limits.length) limits.push('vertical force');
  }
  const drawMW = Object.values(draw).reduce((a, b) => a + b, 0);
  const feasible = Math.abs(unheldT) <= FORCE_TOL * Math.max(1, Math.abs(surplusT)) && drawMW <= busMW + 1e-9;
  if (drawMW > busMW + 1e-9 && !limits.includes('bus power')) limits.push('bus power');
  const electrical = { propulsionPowerMW: draw.prop + draw.rotors,
    cryogenicPowerMW: draw.cryo || 0, pumpPowerMW: draw.pumps || 0,
    winchPowerMW: draw.winch || 0, hotelPowerMW: draw.hotel,
    solarPowerMW: gen.solar, generatorPowerMW: 0, ln2RecoveryPowerMW: regen,
    batteryPowerMW: drawMW - gen.solar - regen };
  const letdown = id === 'SOURCE_APPROACH' || (id === 'RETURN_TRANSIT' && prog > LETDOWN_FROM);
  return { alt, water, ln2, gs, vz, led, massT, reserveT, surplusT, owners, unheldT,
    feasible, limits, basis, clMax, aeroLimitT, thrustLimitT, availableMW, busLimited,
    zeroLiftDragN, inducedDragN, qPa, aeroGeometry: geometry,
    netFrac: Math.max(0, surplusT - bagT) / reserveT, vert: -Math.min(1, rotorT / reserveT),
    thrustN: rotorT * 9810, airV: V, rotorAskMW, busMW, draw, gen, electrical,
    anchor, hoistMW, letdown, cryoFrac, nonRotorMW, forceAskMW };
}

/** Quadrature is for energy only. Limits and extrema use a separate seam-inclusive mesh. */
export function integrateCycle(cls, mode, plan, steps = PLAN_STEPS, opts = {}) {
  const E = {}, chan = {};
  let eBack = 0, letdown = 0, hoist = 0, clipMWh = 0;
  for (const [id] of PHASES) {
    if (!(plan.dur[id] > 0)) { E[id] = 0; continue; }
    const dt = plan.dur[id] / 60 / steps;
    let eP = 0;
    for (let i = 0; i < steps; i++) {
      const s = drawAt(cls, mode, plan, id, (i + 0.5) / steps, opts);
      for (const [k, v] of Object.entries(s.draw)) { eP += v * dt; chan[k] = (chan[k] || 0) + v * dt; }
      eBack += (s.gen.regen || 0) * dt; hoist += s.hoistMW * dt;
      if (s.letdown) letdown += s.draw.rotors * dt;
      clipMWh += Math.max(0, s.rotorAskMW - s.draw.rotors) * dt;
    }
    E[id] = eP;
  }
  E.recovery = -eBack;
  return { E, chan, eBack, eCycleMWh: Object.values(E).reduce((a,b)=>a+b,0),
    letdownMWh: letdown, anchorHoistMWh: hoist, rotorClipMWh: clipMWh,
    ...cycleLimits(cls, mode, plan, opts), steps };
}

export function cycleLimits(cls, mode, plan, opts = {}) {
  let downMW = 0, downMWPhase = null, rotorClipMin = 0, letdownClipMin = 0;
  let peakBatteryMW = 0, peakRotorT = 0;
  let battLimited = false, feasible = true, worst = { unheldT: 0, phase: null, progress: 0, limits: [] };
  const bound = new Set(), phasePeaks = {}, operatingMargins = {};
  for (const [id] of PHASES) {
    if (!(plan.dur[id] > 0)) continue;
    const points = new Set([0, 1, .1, .15, .18, .25, .28, .3, .34, .55, .6, .7, .72, .75, .85, .94, cryoOnFrac(cls, mode, plan)]);
    let elapsed=0;
    for(const segment of plan.profile?.phases[id]||[]) {
      elapsed+=segment.seconds;
      points.add(elapsed/(plan.dur[id]*60));
    }
    const seams = [...points];
    for (let i = 0; i <= LIMIT_STEPS; i++) points.add(i / LIMIT_STEPS);
    const xs = [...points].filter(x=>x>=0&&x<=1).sort((a,b)=>a-b);
    const at = p => drawAt(cls, mode, plan, id, p, opts);
    const note = (s, x) => {
      for(const [limit,row] of Object.entries(instantOperatingMargins(s)))
        if(!operatingMargins[limit]||row.relativeMargin<operatingMargins[limit].relativeMargin)
          operatingMargins[limit]={...row,phase:id,progress:x};
      if (s.draw.rotors > downMW) { downMW = s.draw.rotors; downMWPhase = id; }
      peakBatteryMW = Math.max(peakBatteryMW, s.electrical.batteryPowerMW);
      peakRotorT = Math.max(peakRotorT, s.owners.rotorT);
      battLimited ||= s.busLimited; feasible &&= s.feasible;
      for (const k of s.limits) bound.add(k);
      if (Math.abs(s.unheldT) > Math.abs(worst.unheldT)) worst = { unheldT: s.unheldT, phase: id, progress: x, limits: s.limits };
      if (!phasePeaks[id] || Math.abs(s.unheldT) > Math.abs(phasePeaks[id].unheldT))
        phasePeaks[id] = { unheldT: s.unheldT, phase: id, progress: x, limits: s.limits };
    };
    // Some owners change at a seam. Include each side, rather than replacing the
    // endpoint value with a limit from the neighbouring interval.
    for (const x of seams) for (const side of [-1, 1]) {
      const z = x + side * 1e-12;
      if (z > 0 && z < 1) note(at(z), z);
    }
    let prev = at(xs[0]), prevprev = null; note(prev, xs[0]);
    for (let i=1; i<xs.length; i++) {
      const x=xs[i], s=at(x); note(s,x);
      if (prevprev) for (const value of [q=>q.draw.rotors,q=>q.electrical.batteryPowerMW,q=>q.owners.rotorT,q=>Math.abs(q.unheldT),...['bus power','rotor thrust','downward authority','upward authority'].map(k=>q=>-operatingMarginRatio(q,k))]) {
        const epsilon = 1e-10 * Math.max(1, Math.abs(value(prev)));
        if (!(value(prev)>value(prevprev)+epsilon && value(prev)>value(s)+epsilon)) continue;
        let lo=xs[i-2], hi=x;
        for(let j=0;j<36;j++) {
          const a=lo+(hi-lo)/3, b=hi-(hi-lo)/3;
          if(value(at(a))<value(at(b)))lo=a;else hi=b;
        }
        const z=(lo+hi)/2;note(at(z),z);
      }
      const clipped = q => q.busLimited || q.rotorAskMW > q.draw.rotors + 1e-9;
      let frac = clipped(prev) ? 1 : 0;
      if (clipped(prev) !== clipped(s)) {
        let lo=xs[i-1],hi=x;
        for (let j=0;j<32;j++) { const mid=(lo+hi)/2; if(clipped(at(mid))===clipped(prev))lo=mid;else hi=mid; }
        const cross=(lo+hi)/2;
        frac=clipped(prev)?(cross-xs[i-1])/(x-xs[i-1]):(x-cross)/(x-xs[i-1]);
      }
      const minutes=(x-xs[i-1])*plan.dur[id]*frac;
      rotorClipMin+=minutes;
      if (id==='SOURCE_APPROACH'||(id==='RETURN_TRANSIT'&&x>LETDOWN_FROM))letdownClipMin+=minutes;
      prevprev=prev; prev=s;
    }
  }
  return { downMW, downMWPhase, peakBatteryMW, peakRotorT, rotorClipMin, letdownClipMin, battLimited, feasible,
    operatingMargins, worst, phasePeaks, bindingLimits: [...bound], limitSteps: LIMIT_STEPS };
}

/** Legacy schematic geometry only. Never used for force or energy credit. Actual inventory
 * is drawAt().anchor / stateAt().anchorT, after the paid hoist. */
export function anchorHang(cls, fullT, phaseId, prog, altAgl, gsKph) {
  const cable = cls.anchorM || 0;
  if (cable <= 0 || !(fullT > 0)) return { cableP: 0, fillF: 0, tonnes: 0 };
  const done = (cableP, fillF) => ({ cableP, fillF, tonnes: fullT * fillF });

  // The fill dumps on a schedule, not on an altitude: the ship is stationary and the trigger is
  // the tanks passing what the descent needed.
  if (phaseId === "WATER_FILL") {
    return done(1 - Math.min(1, Math.max(0, (prog - 0.25) / 0.35)),
      1 - Math.min(1, Math.max(0, prog / 0.30)));
  }
  // Everywhere else the water's distance decides — and the ship has to be stopped. A bag dipped
  // at 20 km/h is a bad time; 2 m/s is drift, not travel.
  // The approach, and the last few per cent of the return leg where the ship is already over
  // the lake and braking. Everywhere else there is no water under it to dip into.
  const overLake = phaseId === "SOURCE_APPROACH"
    || (phaseId === "RETURN_TRANSIT" && prog > 0.94);
  if (!overLake || gsKph / 3.6 > 2) return done(0, 0);
  const reachAlt = anchorGeometry(cable, cls.diaM).contactAltitudeM;
  if (altAgl > reachAlt + cable * 0.25) return done(0, 0);
  return done(1, Math.min(1, Math.max(0, (reachAlt - altAgl) / Math.max(1, cable * 0.14))));
}
