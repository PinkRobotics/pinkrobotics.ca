/* The worked example and the class cards. Shared with the how-it-works page.
 */
import { CFG, CLASSES, CLASS_ORDER, MODES, fmt, fmtMin, planCycle, energyComparison, feasibilityText, selectServedPlan, workedFigures } from '../sim/index.js?v=816a54f9';
import { $, kvRows } from './dom.js?v=816a54f9';
import { replanAll } from './fleet.js?v=816a54f9';
import { S } from './store.js?v=816a54f9';

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

let workedGeneration = 0;
export async function renderWorked() {
  if (!$("worked")) return;
  const generation = ++workedGeneration;
  const cls = CLASSES[S.exampleCls], km = CFG.exampleKm;
  $("worked").textContent = "Cycle energy, delivered water and rate pending: feasible plans are computing.";
  $("workedNote").textContent = "No aircraft has flown.";
  await new Promise(resolve => setTimeout(resolve, 0));
  if (generation !== workedGeneration) return;
  const started = performance.now();
  const result = selectServedPlan(cls, km, null, S.modeId), view = workedFigures(cls, km, result);
  S.workedSelection = {cls: cls.id, km, selection: result, ms: performance.now() - started};
  $("worked").innerHTML = view.status || view.rows.map(row =>
    `<div class="stat" data-energy-quantity="${row.quantity}" data-energy-value="${row.value}" data-energy-basis="${row.basis}"><b style="font-size:var(--t-22)">${row.text}</b><span>${row.label}</span></div>`).join("");
  $("workedNote").textContent = view.note;
}

export function renderClassCards() {
  if (!$("classcards")) return; // class cards render on the concept page
  $("classcards").innerHTML = CLASS_ORDER.map(id => {
    const c = CLASSES[id];
    return `<div class="cls"><span class="kicker">${c.name}${c.id === "P100" ? "" : ' <span style="color:#d98b80;font-weight:600">· structural float unproven</span>'}</span>
      <h3>${fmt(c.payloadT)} t requested capacity</h3>
      <p class="one">${c.use}.</p>` + kvRows([
      ["water requested", fmt(c.payloadT * 1000) + " L"],
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
