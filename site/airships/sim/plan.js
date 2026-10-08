/* planCycle: the function that produces every number the site publishes.
 *
 * Given a vehicle class, an operating mode, a distance and a wind, it returns the
 * duration of each phase of a delivery cycle, the energy that cycle costs, how much
 * water arrives, and which constraint is binding. Pure: same inputs, same outputs.
 */
import {instantOperatingMargins} from './operating-margin.js?v=01e992e3';
import { ALT, CFG, TERRAIN_MSL, WORK_ALT_MSL, sourceAltM } from './config.js?v=01e992e3';
import { dragMW, ledger, pumpMW } from './physics.js?v=01e992e3';
import { searchedProfile, prescribedReturnJoins } from './profile.js?v=01e992e3';
import { WINCH_MPS, descentBusMW, integrateCycle, rotorMaxTonnes, cycleGeometry, drawAt } from './power.js?v=01e992e3';

import {trackWind} from './wind.js?v=01e992e3';

import {windBasis} from './wind.js?v=01e992e3';

export function planCycle(cls, mode, oneWayKm, wind, options = {}, rejectEarly = false) {
  if(options.verticalRateMultiplier!==undefined)throw new RangeError('Use movingPhaseRateMultiplier for whole-phase dilation, or verticalProfile for independent controls');
  const movingPhaseRateMultiplier = options.movingPhaseRateMultiplier ?? 1;
  if (!(movingPhaseRateMultiplier >= 0.5 && movingPhaseRateMultiplier <= 1))
    throw new RangeError('movingPhaseRateMultiplier must be in [0.5, 1]');
  const speedMultiplier = options.speedMultiplier ?? CFG.speedMul;
  const rotorEfficiency = options.rotorEfficiency ?? CFG.propEta;
  if (!(Number.isFinite(rotorEfficiency) && rotorEfficiency > 0 && rotorEfficiency <= 1))
    throw new RangeError('rotorEfficiency must be in (0, 1]');
  // The selected airspeed and actual route wind determine physical ground progress.
  // A timing refusal is separate from the quasi-static force-and-bus predicate.
  const kph = cls.cruiseKph * mode.speed * speedMultiplier;
  const track = trackWind(kph, wind);
  let {gsOut, gsRet, tailOut, crossOut} = track;
  // Whole-phase dilation scales ground motion without a vector-wind control solution.
  // Refuse that combination rather than silently scaling the weather with the aircraft.
  if (movingPhaseRateMultiplier < 1 && track.windUsed && wind.spd > 0) {
    track.trackPossible = false;
    track.trackReason = 'nonzero route wind with whole-phase dilation has no represented track';
  }
  if (!track.trackPossible) return {
    ...track, feasible: false, bindingLimits: [track.trackReason], worst: null,
    basis: options.basis || 'record', speedMultiplier, movingPhaseRateMultiplier,
    cycleMin: null, tph: null, eCycleMWh: null, kwhPerTonne: null, dur: null,
    deliveredT: null, retainedT: null, planSteps: null,
  };
  const fill = Math.max(0.01, cls.fillM3s * CFG.fillMul);
  /* TWO LEDGERS, BECAUSE THE TWO QUESTIONS HAVE DIFFERENT WORST CASES.
   *
   * Buoyancy is not a property of the ship, it is a property of the air the ship is in, and a
   * cycle crosses 1,200 m of it. Asking "can it float up?" and "can it get back down?" at the
   * same altitude answers one of them with the other one's air.
   *
   * `led` — at WORK_ALT_MSL, the ceiling. Thinnest air, least lift, smallest surplus. That is
   * the conservative case for FLOAT-UP and for sizing the hull, and it is what the class table
   * is built against.
   *
   * `ledLow` — at the lake, where the letdown ENDS. Densest air, most lift, largest surplus,
   * and therefore the hardest place to push the hull down. This is the conservative case for
   * DESCENT, and using the ceiling figure for it was the sea-level error one layer up: the
   * balance was being checked in air 16% thinner than the air the ship actually arrives in.
   * A descent that closes at 2,500 m and fails at 1,300 m is a descent that fails.
   *
   * Everything below that answers to descent — how much nitrogen to make, how much water to
   * keep as ballast, how hard the rotors work on the way down — reads ledLow. */
  const led = ledger(cls, WORK_ALT_MSL);
  const srcAltM = sourceAltM(cls);
  const ledLow = ledger(cls, TERRAIN_MSL + srcAltM);
  const dur = {};                                   // minutes per phase
  // Overlap doctrine: the pod is already dropping during the approach, so HOSE_DEPLOY is
  // only the tail of that work; the hose winds up during the climb-out; climb and descent
  // ride the transit legs; and the drop is a run at working speed, not a hover.
  dur.SOURCE_APPROACH = Math.max(1.5 * mode.fixed, cls.hoseDeployMin * 0.5 * mode.hose);
  dur.WATER_FILL = cls.payloadT / fill / 60;
  // A leg is a trapezoid, not a step: the ship accelerates over the first 15% and brakes over
  // the last 15%, so covering the distance at a CRUISE of gsOut takes 1/0.85 as long as the
  // naive quotient. Without this the map flew 18% faster than the ground-speed dial read.
  const rampF = 1 / (1 - 0.15);
  dur.OUTBOUND_TRANSIT = Math.max(oneWayKm / gsOut * 60 * rampF,
    cls.hoseRetractMin * 0.4 * mode.hose + 0.8);
  dur.WATER_RELEASE = Math.max(0.8, cls.dropKm / (kph * 0.45) * 60);
  dur.BUOYANCY_ESCAPE = 2 * mode.fixed;
  dur.RETURN_TRANSIT = Math.max(1.2, oneWayKm / gsRet * 60 * rampF);

  // Nitrogen: the return leg's cryo output, bounded by the tanks and by what descent needs.
  // Cold-ready assumption: production starts at the first instant of the return leg,
  // as if already cold, with no startup, standby or restart cost. This is not a result.
  const cryoCapMW = cls.cryoMW * CFG.cryoMul * mode.cryoShare;
  const ln2NeedT = Math.min(ledLow.surplusT * 0.8, cls.ln2CapT);
  let ln2MakeT = Math.min(ln2NeedT, cryoCapMW * (dur.RETURN_TRANSIT / 60) * 1000 / CFG.eLN2 / 1000);
  let cryoLimited = ln2MakeT < ln2NeedT - 0.5;
  // The winch runs at WINCH_MPS, so the cable is paid out during the approach — it has to be in
  // the water before the ship needs holding down, so this one can extend the phase. Recovery
  // does not: the bag is dumped the moment the tanks hold more than the shortfall, and an
  // empty bag on a rope comes up during the climb-out, which is already overlapped work. A
  // fill that finishes before the winch does is not a fill waiting on a winch.
  const anchorMin = (cls.anchorM || 0) / WINCH_MPS / 60;
  dur.SOURCE_APPROACH = Math.max(dur.SOURCE_APPROACH, anchorMin);
  /* THE BUS THE DESCENT IS STRUCK AGAINST. The battery, plus what the LN2 expansion generators
   * return while the approach vents ballast — NOT the generators' nameplate. Until 2026-10-01
   * this read battMW + genMW, which booked 8 / 40 / 150 MW of generation as if there were fuel
   * aboard; there is none, and the generators can only hand back what the cryo plant put into
   * the nitrogen (defect 6). On the P-10000 that is about 2 MW during the approach against a
   * 1,400 MW battery, so the authority the rotors have falls by 6.5%, and by 15% on the two
   * smaller classes. The force balance below must CLOSE on this bus: rotors can only push
   * down so hard, and the clamp the instruments enforce (power.js BUS_CEILING) is the clamp the
   * closure assumes. */
  let busMW = descentBusMW(cls, { ln2MakeT, dur });
  let rotorMaxT = rotorMaxTonnes(cls, busMW, ledLow.rho, rotorEfficiency);
  /* Quasi-static force and energy closure is evaluated by power.js. */
  const holdT = Math.max(0, ledLow.surplusT - ln2MakeT);      // total to hold down at the source
  const rotorCapT = rotorMaxT;
  // The anchor goes FIRST and takes everything its bag will hold. It is not a way of covering
  // what the rotors cannot manage — it is the cheaper way of doing the job at all. Rotor power
  // goes as thrust^1.5, so moving load onto the lake pays superlinearly. Bag capacity is
  // a sizing intention; drawAt credits only the inventory acquired on this approach.
  //
  // The bag cannot exceed what the ship can pick up, which is its own surplus: a bag equal to
  // the surplus leaves the hull neutral and it can lift no more than that. min() with holdT is
  // that physical ceiling, not a safety factor.
  let anchorT = Math.min(cls.anchorBagT || 0, holdT);
  /* Quasi-static force and energy closure is evaluated by power.js. */
  let anchorFromAglM = srcAltM;
  for (let a = srcAltM; a <= srcAltM + (cls.anchorM || 0); a += 10) {
    const led = ledger(cls, TERRAIN_MSL + a);
    if (led.surplusT - ln2MakeT > rotorCapT) anchorFromAglM = a;
  }
  let shortfallT = Math.max(0, holdT - anchorT - rotorCapT);   // what neither can hold
  const retainedT = Math.min(cls.payloadT, Math.max(0, options.ballastT || 0));
  const deliveredT = cls.payloadT - retainedT;
  dur.WATER_FILL = deliveredT / fill / 60;          // only the delivered water needs replacing
  /* ONE RUN, FLOWN SLOWLY — not repeated passes over the same line.
   *
   * The dump is metered like the fill: sprayers lay water along a line, they do not blow the
   * tanks. That takes `deliveredT / fill` however it is flown, and the question is only whether
   * the ship covers the line once in that time or shuttles over it.
   *
   * It used to shuttle: three passes for a P-10000, an odd count so the run still ended at the
   * far end. Every turn is the largest configured hull reversing over a fire it is dropping on, which is the
   * least plausible manoeuvre in the cycle and buys nothing — the water lands on the same line
   * either way. So the pass count is 1 and the ship simply flies slower: 10,000 t along a 4 km
   * line takes 11 minutes, which is about 22 km/h. A crawl, and a crawl is what a machine laying
   * water deliberately should look like.
   *
   * Geometric lines are bounded by dropSeg(): shorter candidates and the fallback must
   * have both ends inside the modelled fire, or the target is refused. Cycle jitter is
   * kept only when it preserves that predicate. Detection lines may extend beyond the
   * mapped outline; neither rule establishes where released water arrives. */
  const passes = 1;
  dur.WATER_RELEASE = Math.max(dur.WATER_RELEASE, deliveredT / fill / 60);
  let cycleMin = Object.values(dur).reduce((a, b) => a + b, 0);

  /* Quasi-static force and energy closure is evaluated by power.js. */
  const partial = { bagCreditRule: options.bagCreditRule, rotorEfficiency, speedMultiplier, movingPhaseRateMultiplier, verticalCd: options.verticalCd, basis: options.basis || 'record', clMax: options.clMax,
    requiredBatteryMW: options.requiredBatteryMW, requiredRotorT: options.requiredRotorT, dur, anchorFromAglM, retainedT, deliveredT, ln2MakeT, gsOut, gsRet, tailOut, crossOut, selectedAirKph: kph, passes,
    anchorT, dragMW: dragMW(cls, mode, led.rho), pumpMW: pumpMW(cls) };
  const shape = cycleGeometry(cls, partial);
  const altitudeGeometry = Object.fromEntries(['srcAlt','holdAgl','altTop','altEsc'].map(k=>[k,shape[k]]));
  const releaseRiseFraction = Math.min(1, Math.max(0.15, 30 / (dur.WATER_RELEASE * 60)));
  Object.assign(partial, {altitudeGeometry,releaseRiseFraction});
  if (!options.verticalProfile) {
    const joined=prescribedReturnJoins(shape,dur.RETURN_TRANSIT*60);
    partial.returnJoinWidths=joined.widths;
    if(joined.seconds>dur.RETURN_TRANSIT*60){
      dur.RETURN_TRANSIT=joined.seconds/60;
      ln2MakeT=Math.min(ln2NeedT,cryoCapMW*dur.RETURN_TRANSIT/60/CFG.eLN2);
      anchorT=Math.min(cls.anchorBagT||0,Math.max(0,ledLow.surplusT-ln2MakeT));
      Object.assign(partial,{ln2MakeT,anchorT});
      cycleMin=Object.values(dur).reduce((a,b)=>a+b,0);
      cryoLimited=ln2MakeT<ln2NeedT-.5;
      busMW=descentBusMW(cls,partial);
      rotorMaxT=rotorMaxTonnes(cls,busMW,ledLow.rho,rotorEfficiency);
      shortfallT=Math.max(0,ledLow.surplusT-ln2MakeT-anchorT-rotorMaxT);
    }
  }
  if (options.verticalProfile) {
    if(movingPhaseRateMultiplier!==1)throw new RangeError('independent profile cannot use moving-phase dilation');
    partial.profile=searchedProfile(partial,shape,oneWayKm,options.verticalProfile,partial.tailOut/3.6,partial.crossOut/3.6);
  }
  if (movingPhaseRateMultiplier < 1) {
    for (const phase of Object.keys(dur)) if (phase !== 'WATER_FILL') dur[phase] /= movingPhaseRateMultiplier;
    gsOut *= movingPhaseRateMultiplier; gsRet *= movingPhaseRateMultiplier;
    ln2MakeT = Math.min(ln2NeedT, cryoCapMW * dur.RETURN_TRANSIT / 60 / CFG.eLN2);
    anchorT = Math.min(cls.anchorBagT || 0, Math.max(0, ledLow.surplusT - ln2MakeT));
    Object.assign(partial, {gsOut,gsRet,ln2MakeT,anchorT});
    cycleMin = Object.values(dur).reduce((a,b)=>a+b,0);
    cryoLimited = ln2MakeT < ln2NeedT - 0.5;
    busMW = descentBusMW(cls, partial);
    rotorMaxT = rotorMaxTonnes(cls, busMW, ledLow.rho, rotorEfficiency);
    shortfallT = Math.max(0, ledLow.surplusT - ln2MakeT - anchorT - rotorMaxT);
  }
  if(partial.profile) {
    ln2MakeT=Math.min(ln2NeedT,cryoCapMW*dur.RETURN_TRANSIT/60/CFG.eLN2);
    anchorT=Math.min(cls.anchorBagT||0,Math.max(0,ledLow.surplusT-ln2MakeT));
    Object.assign(partial,{ln2MakeT,anchorT});
    cycleMin=Object.values(dur).reduce((a,b)=>a+b,0);
    cryoLimited=ln2MakeT<ln2NeedT-0.5;
    busMW=descentBusMW(cls,partial);
    rotorMaxT=rotorMaxTonnes(cls,busMW,ledLow.rho,rotorEfficiency);
    shortfallT=Math.max(0,ledLow.surplusT-ln2MakeT-anchorT-rotorMaxT);
  }
  // Search may reject at a coarse sample, but acceptance always uses the full ledger.
  if(rejectEarly) {
    if(partial.profile&&!partial.profile.feasibleGeometry)return {feasible:false};
    for(const id of Object.keys(dur))for(const progress of [0,.15,.3,.5,.7,.85,1]) {
      if(dur[id]>0){
        const sample=drawAt(cls,mode,partial,id,progress);
        if(!sample.feasible)return {feasible:false};
        // A search may prune on policy too. Final acceptance always runs the full mesh.
        if(rejectEarly.minimumOperatingMargin&&Object.values(instantOperatingMargins(sample)).some(r=>r.relativeMargin<rejectEarly.minimumOperatingMargin))
          return {feasible:false,searchPruned:'operating reserve'};
      }
    }
  }
  const I = integrateCycle(cls, mode, partial);
  if(partial.profile&&!partial.profile.feasibleGeometry) {
    I.feasible=false;I.bindingLimits.push('vertical legs exceed route distance');
  }
  const E = I.E, eBack = I.eBack, eCycle = I.eCycleMWh, downMW = I.downMW;
  const battLimited = I.battLimited;

  const tph = deliveredT * 60 / cycleMin;
  const handling = dur.SOURCE_APPROACH + dur.WATER_FILL;
  const transit = dur.OUTBOUND_TRANSIT + dur.RETURN_TRANSIT;
  let bottleneck = "transit distance";
  if (handling > transit) bottleneck = "water handling at the source";
  if (cryoLimited && mode.id === "endurance") bottleneck = "cryogenic production rate";
  if (battLimited) bottleneck = "descent authority";
  if (retainedT > cls.payloadT * 0.25) bottleneck = "descent ballast — cryogenic capacity";
  // The clamp above is a physical wall, not a tuning knob: a hull cannot keep back more water
  // than it went to fetch. Reaching it means nitrogen, rotors and the entire payload together
  // still do not close the descent, and the honest report is that the trip does not work —
  // not a quietly smaller delivery.
  const descentShort = shortfallT > cls.payloadT;
  if (descentShort) bottleneck = "descent does not close at the source";

  return {
    operatingMargins: I.operatingMargins, profile: partial.profile, bagCreditRule: options.bagCreditRule, verticalCd: options.verticalCd, rotorEfficiency, speedMultiplier, movingPhaseRateMultiplier, altitudeGeometry, releaseRiseFraction, peakBatteryMW: I.peakBatteryMW, peakRotorT: I.peakRotorT, basis: partial.basis, clMax: partial.clMax, feasible: I.feasible, worst: I.worst, bindingLimits: I.bindingLimits,
    requiredBatteryMW: options.requiredBatteryMW, requiredRotorT: options.requiredRotorT,
    phasePeaks: I.phasePeaks, returnJoinWidths: partial.returnJoinWidths,
    dur, cycleMin, tph, eCycleMWh: eCycle, kwhPerTonne: eCycle * 1000 / Math.max(1, deliveredT),
    // The ledger itself, not just its total: energy by phase with the nitrogen recovery as its
    // own negative line (E sums to eCycleMWh), and the same energy by channel (Echan sums to the
    // gross, eCycleMWh + eBack). docs/PHYSICS.md §9 publishes these tables and the reports cite
    // them; before they were returned the only way to get them was to re-derive them in prose,
    // which is precisely how they went stale by 45% without anything failing.
    E, Echan: I.chan,
    eBack,
    // The descent's own lines, read out of the same integral: rotor energy during the letdown
    // (the return leg's descent to the hold altitude plus the approach onto the lake) and the
    // winch energy of hoisting the bag clear of the surface.
    letdownMWh: I.letdownMWh, anchorHoistMWh: I.anchorHoistMWh,
    // Whole-cycle rotor clipping; battLimited covers every running channel and phase.
    rotorClipMin: I.rotorClipMin, rotorClipMWh: I.rotorClipMWh, letdownClipMin: I.letdownClipMin,
    retainedT, deliveredT, rotorMaxT, busMW, passes,
    gsOut, gsRet, tailOut, crossOut, alongAirKph: track.alongAirKph, selectedAirKph: kph, windUsed: track.windUsed, windBasis: windBasis(track), trackPossible: true, trackReason: null,
    ln2MakeT, cryoLimited, battLimited, descentShort,
    // The rotors' peak draw over the cycle and the phase it falls in. It is the drop run on
    // every class: the hull is held at the drop altitude while the water leaves it.
    downMW, downMWPhase: I.downMWPhase, bottleneck,
    anchorT, shortfallT, anchorFromAglM,
    pumpMW: pumpMW(cls), dragMW: dragMW(cls, mode, led.rho), led, ledLow,
    dropsPerHour: 60 / cycleMin,
    planSteps: I.steps,
  };
}

/* ---------- water sources --------------------------------------------------------------- */
/* WATER rows: [lon, lat, areaHa, kind(0 lake|1 reservoir), name, ring|null]                  */
