/* planCycle: the function that produces every number the site publishes.
 *
 * Given a vehicle class, an operating mode, a distance and a wind, it returns the
 * duration of each phase of a delivery cycle, the energy that cycle costs, how much
 * water arrives, and which constraint is binding. Pure: same inputs, same outputs.
 */
import { ALT, CFG, TERRAIN_MSL, WORK_ALT_MSL, sourceAltM } from './config.js?v=762fdcfd';
import { diskMW, dragMW, ledger, pumpMW } from './physics.js?v=762fdcfd';

export function planCycle(cls, mode, oneWayKm, wind) {
  // Airspeed is the vehicle's; ground speed belongs to the day. When a live 850 hPa wind is
  // known for the route, each leg gets its along-track component — one leg's tailwind is the
  // other's headwind. Clamped so a storm cannot produce absurd legs in a first-order model.
  const kph = cls.cruiseKph * mode.speed * CFG.speedMul;
  let gsOut = kph, gsRet = kph, tailOut = 0;
  if (wind && wind.spd != null && wind.bearing != null) {
    const toDir = (wind.dir + 180) % 360;
    const comp = b => wind.spd * Math.cos((toDir - b) * Math.PI / 180);
    tailOut = comp(wind.bearing);
    gsOut = Math.min(kph * 1.8, Math.max(kph * 0.35, kph + tailOut));
    gsRet = Math.min(kph * 1.8, Math.max(kph * 0.35, kph + comp((wind.bearing + 180) % 360)));
  }
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
  const cryoCapMW = cls.cryoMW * CFG.cryoMul * mode.cryoShare;
  const ln2NeedT = Math.min(ledLow.surplusT * 0.8, cls.ln2CapT);
  const ln2MakeT = Math.min(ln2NeedT, cryoCapMW * (dur.RETURN_TRANSIT / 60) * 1000 / CFG.eLN2 / 1000);
  const cryoLimited = ln2MakeT < ln2NeedT - 0.5;
  // The force balance must CLOSE. Rotors can only push down so hard on this bus:
  const rotorMaxT = Math.pow((cls.battMW + cls.genMW) * 1e6 * CFG.propEta *
    Math.sqrt(2 * CFG.rhoAir * cls.diskM2), 2 / 3) / 9.81 / 1000;
  /* THE DESCENT, IN THE ORDER THE SHIP TRIES THINGS.
   *
   * A hull sized to float up fully loaded is hard to push down empty, and hardest at the
   * bottom where the air is thickest. Three things can make up the difference, and they are
   * not equal: rotors cost power, the anchor costs almost nothing, and retaining water costs
   * DELIVERY, which is the thing the fleet exists to do. So they are used in that order.
   *
   * 1. Rotors, up to rotorMaxT/0.6 (the 0.6 is the share aero trim cannot take).
   * 2. The anchor — a bag of lake water on a cable, winched clear of the surface. It borrows
   *    mass from the lake and gives it straight back, so it is bounded only by the bag.
   * 3. Retained water, last, because every tonne kept is a tonne not delivered. It is zero on
   *    the shipped numbers and the code path is exercised by a test that removes the anchor. */
  const holdT = Math.max(0, ledLow.surplusT - ln2MakeT);      // total to hold down at the source
  const rotorCapT = rotorMaxT / 0.6;
  // The anchor goes FIRST and takes everything its bag will hold. It is not a way of covering
  // what the rotors cannot manage — it is the cheaper way of doing the job at all. Rotor power
  // goes as thrust^1.5, so moving load onto the lake pays superlinearly, and the bags are sized
  // to take about 90% of the hold. What is left is trim, not lift.
  //
  // The bag cannot exceed what the ship can pick up, which is its own surplus: a bag equal to
  // the surplus leaves the hull neutral and it can lift no more than that. min() with holdT is
  // that physical ceiling, not a safety factor.
  const anchorT = Math.min(cls.anchorBagT || 0, holdT);
  /* WHERE THE ANCHOR HAS TO START WORKING, in metres above the water.
   *
   * Descending is not uniformly hard. High up the air is thin, the surplus is small and the
   * rotors manage alone; somewhere on the way down the surplus overtakes them and from there the
   * ship cannot get lower without help. That crossing is a real altitude and it is computed here
   * rather than guessed, because the flight profile has to respect it: a hull may not descend
   * into the band it cannot climb out of — or hold itself in — while it is still travelling at
   * cruise speed with the bag stowed.
   *
   * Scanned from the fill altitude upward in 10 m steps. Returns the fill altitude itself when
   * the rotors can manage the whole descent, which is the P-100's case. */
  let anchorFromAglM = srcAltM;
  for (let a = srcAltM; a <= srcAltM + (cls.anchorM || 0); a += 10) {
    const led = ledger(cls, TERRAIN_MSL + a);
    if (led.surplusT - ln2MakeT > rotorCapT) anchorFromAglM = a;
  }
  const shortfallT = Math.max(0, holdT - anchorT - rotorCapT);   // what neither can hold
  const retainedT = Math.min(cls.payloadT, shortfallT);
  const deliveredT = cls.payloadT - retainedT;
  dur.WATER_FILL = deliveredT / fill / 60;          // only the delivered water needs replacing
  // The dump is metered like the fill: sprayers lay water on a line, they do not blow the
  // tanks. A payload bigger than one line's worth re-treats the line — whole passes, and an
  // odd count so the run still ends at the far end, where the escape climb begins.
  // The winch runs at 5 m/s, so the cable is paid out during the approach — it has to be in
  // the water before the ship needs holding down, so this one can extend the phase. Recovery
  // does not: the bag is dumped the moment the tanks hold more than the shortfall, and an
  // empty bag on a rope comes up during the climb-out, which is already overlapped work. A
  // fill that finishes before the winch does is not a fill waiting on a winch.
  const anchorMin = (cls.anchorM || 0) / 5 / 60;
  dur.SOURCE_APPROACH = Math.max(dur.SOURCE_APPROACH, anchorMin);
  /* ONE RUN, FLOWN SLOWLY — not repeated passes over the same line.
   *
   * The dump is metered like the fill: sprayers lay water along a line, they do not blow the
   * tanks. That takes `deliveredT / fill` however it is flown, and the question is only whether
   * the ship covers the line once in that time or shuttles over it.
   *
   * It used to shuttle: three passes for a P-10000, an odd count so the run still ended at the
   * far end. Every turn is an 876 m hull reversing over a fire it is dropping on, which is the
   * least plausible manoeuvre in the cycle and buys nothing — the water lands on the same line
   * either way. So the pass count is 1 and the ship simply flies slower: 10,000 t along a 4 km
   * line takes 11 minutes, which is about 22 km/h. A crawl, and a crawl is what a machine laying
   * water deliberately should look like.
   *
   * The line itself is unchanged, and it is not free to grow: dropSeg() shrinks it until both
   * ends are inside the fire, so a longer run would have to be a bigger fire. */
  const passes = 1;
  dur.WATER_RELEASE = Math.max(dur.WATER_RELEASE, deliveredT / fill / 60);
  const resid = Math.max(0, holdT - anchorT - retainedT);   // what the rotors actually push
  const downMW = diskMW(cls, resid * 1000 * 9.81 * 0.6);   // ≤ bus by construction now
  const battLimited = downMW > (cls.battMW + cls.genMW) * 0.92;
  if (battLimited) dur.RETURN_TRANSIT *= 1.12;      // authority-limited: a longer, shallower letdown

  const cycleMin = Object.values(dur).reduce((a, b) => a + b, 0);

  // Energy, phase by phase (MWh). Hotel load rides on everything.
  const hotelMW = cls.genMW * 0.02;
  const eCryo = ln2MakeT * 1000 * CFG.eLN2 / 1000;  // MWh spent liquefying
  const eBack = eCryo * CFG.rtLN2;                  // partially recovered on discharge
  const E = {};
  /* THE PUMP BILL AND THE NITROGEN CREDIT ARE SEPARATE LINES, and they have to be.
   *
   * This was `max(0, pumpWork - eBack)`: the nitrogen recovery was netted against the pump work
   * of the same phase and the clamp threw away whatever was left over. On the two smaller
   * classes there is a lot left over — the recovery exceeds the pumping — so the clamp deleted
   * 0.303 MWh of a P-100's 1.308 MWh cycle and, worse, made the PUMP BILL VANISH ENTIRELY from
   * both of them. A budget that reports zero for the one system whose job is moving the water
   * is not a rounding problem, it is the wrong answer.
   *
   * The recovery is a credit against the cycle, not against one phase of it: the nitrogen
   * expands while the fill runs, but the electricity it returns goes to the same bus everything
   * else draws from. So the pump is charged in full and the credit is its own negative term. */
  E.WATER_FILL = pumpMW(cls) * dur.WATER_FILL / 60;
  E.recovery = -eBack;
  E.OUTBOUND_TRANSIT = dragMW(cls, mode) * dur.OUTBOUND_TRANSIT / 60;
  E.RETURN_TRANSIT = dragMW(cls, mode) * 0.55 * dur.RETURN_TRANSIT / 60 + eCryo; // lighter ship, cheaper leg
  E.letdown = downMW * Math.min(6, dur.RETURN_TRANSIT * 0.2) / 60;
  // The anchor's entire energy cost: lifting the full bag the 15 m it takes to break the
  // surface, at a winch efficiency of 0.85. Everything after that is the lake holding the
  // ship down for free. For the P-10000 this is 0.04 MWh against a 75 MWh cycle — the reason
  // this mechanism beats both making nitrogen (475 MWh) and pumping from altitude (44 MWh).
  E.anchor = anchorT * 1000 * 9.81 * 15 / 0.85 / 3.6e9;
  E.other = hotelMW * cycleMin / 60 +
    dragMW(cls, mode) * 0.4 * (dur.SOURCE_APPROACH + dur.BUOYANCY_ESCAPE + dur.WATER_RELEASE) / 60;
  const eCycle = Object.values(E).reduce((a, b) => a + b, 0);

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
    dur, cycleMin, tph, eCycleMWh: eCycle, kwhPerTonne: eCycle * 1000 / Math.max(1, deliveredT),
    // The ledger itself, not just its total. docs/PHYSICS.md §9 publishes this table and the
    // reports cite it; before this was returned the only way to get it was to re-derive it in
    // prose, which is precisely how it went stale by 45% without anything failing.
    E,
    eBack,
    retainedT, deliveredT, rotorMaxT, passes,
    gsOut, gsRet, tailOut, windUsed: !!(wind && wind.spd != null),
    ln2MakeT, cryoLimited, battLimited, descentShort, downMW, bottleneck,
    anchorT, shortfallT, anchorFromAglM,
    pumpMW: pumpMW(cls), dragMW: dragMW(cls, mode), led, ledLow,
    dropsPerHour: 60 / cycleMin,
  };
}

/* ---------- water sources --------------------------------------------------------------- */
/* WATER rows: [lon, lat, areaHa, kind(0 lake|1 reservoir), name, ring|null]                  */
