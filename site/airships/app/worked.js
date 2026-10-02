/* The worked example and the class cards. Shared with the how-it-works page.
 */
import { CFG, CLASSES, CLASS_ORDER, MODES, fmt, fmtMin, planCycle } from '../sim/index.js?v=26282d19';
import { $, kvRows } from './dom.js?v=26282d19';
import { replanAll } from './fleet.js?v=26282d19';
import { S } from './store.js?v=26282d19';

export const DIALS = [
  { k: "exampleKm", label: "Worked example one-way distance", unit: " km", min: 3, max: 150, step: 1, d: 0, note: "distance between water and fire for the tiles below" },
  { k: "speedMul", label: "Airspeed multiplier", unit: "×", min: 0.6, max: 1.4, step: 0.05, d: 2, note: "scales every class's cruise speed" },
  { k: "fillMul", label: "Fill-rate multiplier", unit: "×", min: 0.5, max: 2, step: 0.1, d: 1, note: "pump capacity is a demonstration assumption" },
  // Scales every class's hose at once. It is a multiplier rather than a length because the
  // length is a property of the class (`CLASSES[*].hoseM`, 300 m on all three today). The hose
  // sets the altitude the ship fills from, so lengthening it lifts the ship out of the densest
  // air and shortening it pushes it further in — which is why the descent anchor, not this
  // dial, is what makes the big hulls able to get down at all.
  { k: "hoseMul", label: "Hose length", unit: "x", min: 0.4, max: 1.6, step: 0.1, d: 1, note: "how far up water is pushed, and so how high the ship fills from" },
  { k: "pumpEta", label: "Pump system efficiency", unit: "", min: 0.5, max: 0.9, step: 0.05, d: 2, note: "pumps, hose losses and electrics, all-in" },
  { k: "Cd", label: "Hull drag coefficient", unit: "", min: 0.03, max: 0.12, step: 0.005, d: 3, note: "streamlined-body assumption; cube-law sensitive" },
  { k: "eLN2", label: "LN₂ production energy", unit: " kWh/kg", min: 0.3, max: 0.8, step: 0.05, d: 2, note: "demonstration assumption, not a plant spec" },
  { k: "rtLN2", label: "LN₂ round-trip efficiency", unit: "", min: 0.10, max: 0.38, step: 0.02, d: 2, note: "fraction of liquefaction energy recovered — capped at the exergy of the liquid, 173.4 kWh/t" },
  { k: "cryoMul", label: "Cryogenic capacity multiplier", unit: "×", min: 0.5, max: 2, step: 0.1, d: 1, note: "scales the onboard liquefaction plant" },
];

export function renderAsm() {
  if (!$("asmpanel")) return;   // assumption dials render on the concept page
  $("asmpanel").innerHTML = DIALS.map(dd =>
    `<div class="a-row"><label>${dd.label}<output id="o_${dd.k}">${CFG[dd.k].toFixed(dd.d)}${dd.unit}</output></label>` +
    `<input type="range" id="i_${dd.k}" min="${dd.min}" max="${dd.max}" step="${dd.step}" value="${CFG[dd.k]}" aria-label="${dd.label}">` +
    `<div class="a-note">${dd.note}</div></div>`).join("");
  for (const dd of DIALS) {
    $("i_" + dd.k).addEventListener("input", e => {
      CFG[dd.k] = parseFloat(e.target.value);
      $("o_" + dd.k).textContent = CFG[dd.k].toFixed(dd.d) + dd.unit;
      replanAll();
    });
  }
}

export function renderWorked() {
  if (!$("worked")) return;     // worked example renders on the concept page
  const cls = CLASSES[S.exampleCls], mode = MODES[S.modeId];
  const p = planCycle(cls, mode, CFG.exampleKm);
  $("worked").innerHTML = [
    [fmtMin(p.cycleMin), "per conceptual cycle"],
    [p.dropsPerHour.toFixed(1), "drops per hour"],
    [fmt(p.tph) + " t", "water per hour — " + fmt(p.tph * 1000) + " litres"],
    [p.eCycleMWh.toFixed(1) + " MWh", "energy per cycle"],
    [fmt(p.kwhPerTonne) + " kWh", "per delivered tonne"],
    [p.bottleneck, "current bottleneck"],
  ].map(([b, s]) => `<div class="stat"><b style="font-size:var(--t-22)">${b}</b><span>${s}</span></div>`).join("");
  $("workedNote").textContent = `${cls.name} · ${mode.label.toLowerCase()} mode · ${CFG.exampleKm} km one-way · ` +
    (p.retainedT > 1 ? `delivers ${fmt(p.deliveredT)} t per drop, retaining ${fmt(p.retainedT)} t as descent ballast · ` : "") +
    (p.anchorT > 1 ? `descends on ${fmt(p.anchorT)} t of lake water in the anchor bag · ` : "") +
    // The label said "sea-level ledger" for as long as the ledger bought its lift at sea
    // level. It does not any more — it is evaluated in the air the ship is actually in — so
    // the altitude is named rather than assumed, and the reader can see which one.
    `still air (the live map applies current winds per mission) · ledger at ` +
    `${fmt(p.led.altMslM)} m MSL: ` +
    `${fmt(p.led.liftT)} t displaced = ${fmt(p.led.dryT)} t structure + ${fmt(cls.payloadT)} t water + ${fmt(p.led.reserveT, 1)} t reserve. ` +
    `All values are demonstration assumptions; water delivered is not fire extinguished.`;
}

export function renderClassCards() {
  if (!$("classcards")) return; // class cards render on the concept page
  $("classcards").innerHTML = CLASS_ORDER.map(id => {
    const c = CLASSES[id];
    return `<div class="cls"><span class="kicker">${c.name}${c.id === "P100" ? "" : ' <span style="color:#d98b80;font-weight:600">· outside the 96 m envelope</span>'}</span>
      <h3>${fmt(c.payloadT)} t of water</h3>
      <p class="one">${c.use}.</p>` + kvRows([
      ["payload", fmt(c.payloadT * 1000) + " L"],
      ["size", fmt(c.lenM) + " × " + fmt(c.diaM) + " m"],
      ["displacement", fmt(c.dispM3) + " m³"],
      ["cruise", fmt(c.cruiseKph) + " km/h"],
      ["fill rate", c.fillM3s + " m³/s"],
      ["hose", fmt(c.hoseM) + " m"],
      ["descent anchor", c.anchorM ? fmt(c.anchorM) + " m cable · " + fmt(c.anchorBagT) + " t bag" : "not needed"],
      ["generation", fmt(c.genMW) + " MW"],
      ["battery", fmt(c.battMWh) + " MWh"],
      ["battery peak", fmt(c.battMW) + " MW"],
      ["cryo plant", fmt(c.cryoMW) + " MW"],
      ["LN₂ tanks", "≤ " + fmt(c.ln2CapT) + " t"],
      ["solar", fmt(c.solarM2) + " m²"],
      ["rotors", fmt(c.rotors) + " vectorable"],
      ["rotor disk", fmt(c.diskM2) + " m² total"],
      ["min source", fmt(c.minSourceHa) + " ha"],
      ["source search", "≤ " + fmt(c.searchKm) + " km"],
    ]) + `<p class="one" style="margin:var(--s3) 0 0;color:var(--faint)">All values conceptual — illustrative scaling, not a design.</p></div>`;
  }).join("");
}

/* ---------- controls ------------------------------------------------------------------------- */
