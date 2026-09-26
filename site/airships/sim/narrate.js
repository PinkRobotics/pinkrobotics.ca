/* The mission trace in prose: last, now, next, plan.
 */
import { CFG, PHASES } from './config.js?v=a67fca39';
import { fmt, fmtMin, fmtT } from './format.js?v=a67fca39';

export function narrate(m, st) {
  if (m.idle) return {
    last: "Held at dispatch.", now: "No mission: " + m.why,
    next: "Re-evaluate when the provincial feed or the source rules change.",
    plan: "A real fleet would retask this aircraft elsewhere; the demonstration keeps one per fire.",
  };
  if (st.stopped) return {
    last: "Storage reached zero mid-" + PHASES[st.idx][1].toLowerCase() + ".",
    now: "Power exhausted — safe shutdown. The hull holds position on buoyancy alone; nothing on the bus is live.",
    next: "Wait for imported energy. Delivery ships that ferry charge to the fleet are the next iteration of this demonstration.",
    plan: "Every hull runs an energy deficit: solar and nitrogen recovery do not cover propulsion, pumping and the cryogenic plant. A real fleet needs an energy logistics chain, and this monitor now shows why.",
  };
  const p = m.plan, cls = m.cls, i = st.idx;
  const prev = PHASES[(i + PHASES.length - 1) % PHASES.length][1];
  const next = PHASES[(i + 1) % PHASES.length][1];
  const remMin = ((1 - st.prog) * p.dur[st.phase]).toFixed(1);
  const lines = {
    SOURCE_APPROACH: `Final approach over ${srcName(m)}, flying the last stretch in — pod paying out on the way; hose range in about ${remMin} min.`,
    WATER_FILL: `On station, just filling: ${(cls.fillM3s * CFG.fillMul).toFixed(1)} m³/s — ${fmtT(st.water)} of ${fmtT(cls.payloadT)} aboard` +
      (p.retainedT > 1 ? ` (topping up the ${fmtT(p.deliveredT)} delivered last run)` : "") +
      `; incoming mass is replacing rotor downforce.`,
    OUTBOUND_TRANSIT: (st.prog < 0.18 ? `Climbing out with the hose winding up beneath — nothing waits for anything. ` : "") +
      `Outbound, ${(st.prog * 100).toFixed(0)}% of ${(m.legKm || m.oneWayKm).toFixed(1)} km at ${fmt(p.gsOut)} km/h ground speed` +
      (p.windUsed ? (p.tailOut > 3 ? ` — riding a ${fmt(p.tailOut)} km/h tailwind` : p.tailOut < -3 ? ` — fighting a ${fmt(-p.tailOut)} km/h headwind` : " in light wind") : "; still-air estimate") +
      `; letting down toward the run-in on arrival.`,
    WATER_RELEASE: `Drop run on ${m.whyT && m.whyT[m.curTi] ? m.whyT[m.curTi] : (m.heat ? "last-24h satellite heat" : "the near fire edge")}${m.curPass > 0 ? " — re-treating the planned line" : ""}: ${fmtT(cls.payloadT - st.water)} of ${fmtT(p.deliveredT)} out along ${fmt(m.cls.dropKm, 1)} km${p.passes > 1 ? ` in ${p.passes} passes` : ""}` +
      (p.retainedT > 1 ? `, retaining ${fmtT(p.retainedT)} as descent ballast` : "") + `.`,
    BUOYANCY_ESCAPE: `Escape climb on ${fmtT(p.led.surplusT - p.retainedT)} of surplus buoyancy — the drop is the manoeuvre.`,
    RETURN_TRANSIT: `Returning light at ${fmt(p.gsRet)} km/h; cryogenic plant making ballast — ${fmtT(st.ln2)} of ${fmtT(p.ln2MakeT)}. ` +
      (st.prog > 0.72
        ? `Descending to hose range on ${(st.draw.rotors || 0).toFixed(0)} MW of rotor downforce and the ballast aboard.`
        : `Holding the ceiling empty costs ${(st.draw.rotors || 0).toFixed(0)} MW — this hull is ${fmtT(st.netN / (1000 * 9.81))} light with the tanks dry.`),
  };
  return {
    last: `Completed: ${prev}.`,
    now: lines[st.phase] || st.label,
    next: `Next: ${next}.`,
    plan: `Cycle ${st.cycleN}: ${fmtT(p.deliveredT)} delivered per drop` +
      (p.retainedT > 1 ? ` (${fmtT(p.retainedT)} held back as descent ballast)` : "") +
      `, ${fmtMin(p.cycleMin)} per cycle — ` +
      `${fmt(p.tph)} t/h to this fire if every cycle ran as modelled. Current constraint: ${p.bottleneck}. ` +
      `Mode ${m.mode.label.toLowerCase()}; ${p.kwhPerTonne.toFixed(0)} kWh per delivered tonne.`,
  };
}

export function srcName(m) { return m.water[4] || (m.water[3] ? "an unnamed reservoir" : "an unnamed lake"); }

/* ---------- self-test --------------------------------------------------------------------- */
