/* The mission trace in prose: last, now, next, plan.
 */
import { CFG, PHASES } from './config.js?v=fc85766f';
import { fmt, fmtMin, fmtT } from './format.js?v=fc85766f';

export function narrate(m, st) {
  if (m.served && m.planState !== 'ready') return {
    last: 'Held at dispatch in the simulation.', now: m.planState === 'pending' ? 'Cycle energy, delivery and rate pending: feasible plans are computing.' : `Cycle energy, delivery and rate unavailable: ${m.planReason}`,
    next: m.planState === 'stand-down' ? 'This mission stands down; it supplies no fleet delivery or rate.' : 'Wait for a checked plan.', plan: 'No aircraft has flown.'
  };
  if (m.idle) return {
    last: "Held at dispatch.", now: "No mission: " + m.why,
    next: "Re-evaluate when the provincial feed or the source rules change.",
    plan: "A real fleet would retask this aircraft elsewhere; the demonstration keeps one per fire.",
  };
  if (m.plan.feasible === false) return {
    last: "Conceptual profile only — no flight demonstrated.",
    now: `${m.plan.basis} basis: INFEASIBLE. ${m.plan.bindingLimits.join(', ')}.`,
    next: `Worst unheld force ${fmt(m.plan.worst.unheldT, 1)} tf in ${m.plan.worst.phase}.`,
    plan: `Cycle energy, delivery and rate unavailable: the profile fails ${m.plan.bindingLimits.join(", ")}.`,
  };
  if (st.stopped) return {
    last: "Storage reached zero mid-" + PHASES[st.idx][1].toLowerCase() + ".",
    now: "Power exhausted. Motion after shutdown is not modelled; buoyancy does not prove position hold.",
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
    OUTBOUND_TRANSIT: (st.prog < 0.18 ? `In the simulation, the ship climbs along the selected profile with the hose winding up. ` : "") +
      `Outbound, ${(st.prog * 100).toFixed(0)}% of ${(m.legKm || m.oneWayKm).toFixed(1)} km at ${fmt(st.gs)} km/h ground speed` +
      (p.windUsed ? (p.tailOut > 3 ? ` — riding a ${fmt(p.tailOut)} km/h tailwind` : p.tailOut < -3 ? ` — fighting a ${fmt(-p.tailOut)} km/h headwind` : " in light wind") : "; still-air estimate") +
      `; letting down toward the run-in on arrival.`,
    WATER_RELEASE: `Drop run on ${m.whyT && m.whyT[m.curTi] ? m.whyT[m.curTi] : (m.heat ? "last-24h satellite heat" : "the near fire edge")}${m.curPass > 0 ? " — re-treating the planned line" : ""}: ${fmtT(cls.payloadT - st.water)} of ${fmtT(p.deliveredT)} out along ${fmt(m.cls.dropKm, 1)} km${p.passes > 1 ? ` in ${p.passes} passes` : ""}` +
      (p.retainedT > 1 ? `, retaining ${fmtT(p.retainedT)} as descent ballast` : "") + `.`,
    BUOYANCY_ESCAPE: `In the simulation, the ship climbs along the force-checked profile; buoyancy and retained water are modelled, with ${fmtT(p.retainedT)} of water kept aboard.`,
    RETURN_TRANSIT: `Returning with retained water at ${fmt(st.gs)} km/h; cryogenic plant making ballast — ${fmtT(st.ln2)} of ${fmtT(p.ln2MakeT)}. ` +
      (st.prog > 0.72
        ? `Descending to hose range on ${(st.draw.rotors || 0).toFixed(0)} MW of rotor downforce and the ballast aboard.`
        : `The simulated ship stays at the planned altitude using ${(st.draw.rotors || 0).toFixed(0)} MW of rotor power, with ${fmtT(st.water)} of water aboard.`),
  };
  return {
    last: `Completed: ${prev}.`,
    now: (lines[st.phase] || st.label),
    next: `Next: ${next}.`,
    plan: `Simulated cycle ${st.cycleN}: ${fmtT(p.deliveredT)} delivered per drop` +
      (p.retainedT > 1 ? ` (${fmtT(p.retainedT)} held back as descent ballast)` : "") +
      `, ${fmtMin(p.cycleMin)} per cycle — ` +
      `${fmt(p.tph)} t/h to this fire if every cycle ran as modelled. Current constraint: ${p.bottleneck}. ` +
      `Mode ${m.mode.label.toLowerCase()}; ${p.kwhPerTonne.toFixed(0)} kWh per delivered tonne; ${p.basis} basis, feasible in this model.`,
  };
}

export function srcName(m) { return m.water[4] || (m.water[3] ? "an unnamed reservoir" : "an unnamed lake"); }

/* ---------- self-test --------------------------------------------------------------------- */
