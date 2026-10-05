/* The three DOM conveniences the whole application uses, and nothing else.
 */
import { PHASES, PHASE_TINT, fmt, fmtMin } from '../sim/index.js?v=fc85766f';

export const $ = id => document.getElementById(id);

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function kvRows(rows) {
  return '<dl class="kv">' + rows.map(([k, v, cls]) =>
    `<dt>${k}</dt><dd class="${cls || ""}">${v}</dd>`).join("") + "</dl>";
}

export function barRows(rows, maxV, unit, tint) {
  return '<div class="bars">' + rows.map(([lab, v, col]) => {
    const wpc = Math.max(1, Math.min(100, Math.abs(v) / maxV * 100));
    return `<div class="b-row"><span class="b-lab">${lab}</span>` +
      `<span class="b-tr"><span class="b-fill" style="width:${wpc}%;background:${col || tint}"></span></span>` +
      `<span class="b-val">${fmt(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)} ${unit}</span></div>`;
  }).join("") + "</div>";
}

export function cycleBar(m, st) {
  const total = m.plan.cycleMin;
  let html = '<div class="cycbar" role="img" aria-label="Cycle phases in proportion">';
  PHASES.forEach(([id], i) => {
    const wpc = m.plan.dur[id] / total * 100;
    html += `<i class="${st && st.idx === i ? "on" : ""}" style="width:${wpc}%;background:${PHASE_TINT[id]}" title="${id}"></i>`;
  });
  html += "</div>";
  html += `<p class="cycnote">${st ? `now: <b style="color:${PHASE_TINT[st.phase]};font-weight:600">${PHASES[st.idx][1]}</b> · ` : ""}` +
    `${fmtMin(total)} per cycle · bottleneck: <b>${m.plan.bottleneck}</b></p>`;
  return html;
}
/* ---------- instruments ------------------------------------------------------------------- */

export const SHORT = { SOURCE_APPROACH: "approach", WATER_FILL: "filling",
  OUTBOUND_TRANSIT: "outbound", WATER_RELEASE: "drop run",
  BUOYANCY_ESCAPE: "escape climb", RETURN_TRANSIT: "return" };
