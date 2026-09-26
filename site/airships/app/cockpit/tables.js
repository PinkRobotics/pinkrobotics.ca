/* The fleet roster and the top-fires list.
 */
import { CLASSES, PHASE_TINT, fmt, fmtMin, srcName, stateAt } from '../../sim/index.js?v=a67fca39';
import { timeSinceDrop } from '../cockpit/panels.js?v=a67fca39';
import { $, SHORT, esc } from '../dom.js?v=a67fca39';
import { needsShip } from '../feeds.js?v=a67fca39';
import { FLEET } from '../fleet.js?v=a67fca39';
import { select } from '../map/interact.js?v=a67fca39';
import { S } from '../store.js?v=a67fca39';

/* ---------- the two lists are grids, and here is why ---------------------------------------- *
 *
 * Both were bare <tr> elements with click handlers: no role, no tab stop, no key that did
 * what the mouse did. Three patterns were available.
 *
 *   A listbox reads best for a pure pick-one list, but it flattens a row to a single string —
 *   these rows are columns that mean different things (hull, fire, phase; and fire, size,
 *   time since last drop, delivery rate) and the columns are the point. A listbox also may
 *   not own the roster's per-class highlight buttons, which are real controls sitting between
 *   the groups, so the roster could not legally be one at all.
 *
 *   A focusable button in every row keeps the table but puts twenty-four tab stops between
 *   the fleet panel and the map.
 *
 *   A grid with row-level focus keeps the columns, keeps the class buttons legal inside their
 *   own cell, carries aria-selected on the row that is actually selected, and costs one tab
 *   stop per list. That is what these are.
 *
 * Cell-level navigation is deliberately absent: no cell is separately actionable, so Up and
 * Down walk the rows (and, in the roster, the class buttons), Home and End jump to the ends,
 * and Enter or Space does exactly what a click does. */

const GRID_ITEMS = "tr.r-ship, .r-cls";

function gridItems(el) { return [...el.querySelectorAll(GRID_ITEMS)]; }

/* Roving tabindex: exactly one item in a grid is reachable by Tab, and it is the selected row
   when there is one, so returning to the list returns to where the user was. */
function rove(el, to) {
  for (const x of gridItems(el)) x.tabIndex = x === to ? 0 : -1;
}

function roveToSelection(el) {
  if (el.contains(document.activeElement)) return;    // never steal a focus the user placed
  const its = gridItems(el);
  const want = its.find(x => x.getAttribute("aria-selected") === "true") || its[0];
  if (!want || want.tabIndex === 0) return;           // this runs on a 2.5 s tick: no churn
  rove(el, want);
}

/* The panels are rebuilt by innerHTML on every fifteen-minute feed refresh, but the container
   they are rebuilt inside survives — so the delegated handlers are attached to it exactly
   once. Attaching per render would stack a fresh copy of both every quarter of an hour. */
function wireGrid(el, activate) {
  if (el.dataset.gridWired) { roveToSelection(el); return; }
  el.dataset.gridWired = "1";
  el.addEventListener("keydown", e => {
    const cur = e.target.closest(GRID_ITEMS);
    if (!cur || !el.contains(cur)) return;
    if ((e.key === "Enter" || e.key === " ") && cur.matches("tr.r-ship")) {
      e.preventDefault();                             // Space would scroll the panel
      activate(cur);
      return;
    }
    const list = gridItems(el), i = list.indexOf(cur);
    let n;
    if (e.key === "ArrowDown") n = Math.min(list.length - 1, i + 1);
    else if (e.key === "ArrowUp") n = Math.max(0, i - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = list.length - 1;
    else return;                                      // Enter/Space on a class button is the
    e.preventDefault();                               // button's own business
    rove(el, list[n]);
    list[n].focus();
  });
  // A click or a Tab into the list moves the single tab stop to whatever was reached.
  el.addEventListener("focusin", e => {
    const cur = e.target.closest(GRID_ITEMS);
    if (cur) rove(el, cur);
  });
  roveToSelection(el);
}

export function renderFires() {
  const el = $("firesTop");
  if (!el) return;
  const top = S.fires.filter(needsShip).slice().sort((a, b) => b.sizeHa - a.sizeHa).slice(0, 8);
  el.innerHTML = `<table class="fleettab" role="grid" aria-describedby="firesNote" ` +
    `aria-label="Largest fires served or queued: fire, mapped size, time since the last drop, delivery rate">` +
    `<tbody>` + top.map(f => {
    const m = f.mission;
    return `<tr class="r-ship" aria-selected="false" data-fid="${esc(f.id)}">` +
      `<td>${esc(f.name || f.geo || f.id)}</td>` +
      `<td style="text-align:right">${f.sizeHa > 0 ? fmt(f.sizeHa) + " ha" : "size unmapped"}</td>` +
      `<td class="dropt" style="text-align:right">…</td>` +
      `<td style="text-align:right">${m && !m.idle ? fmt(m.plan.tph) + " kL/h" : "queued — no hull in range"}</td></tr>`;
  }).join("") + "</tbody></table>";
  const pick = tr => {
    const f = S.fires.find(x => x.id === tr.dataset.fid);
    if (!f) return;
    if (f.mission && !f.mission.idle) select({ type: "ship", m: f.mission });
    else select({ type: "fire", f, m: f.mission });
  };
  el.querySelectorAll("tr.r-ship").forEach(tr => tr.addEventListener("click", () => pick(tr)));
  wireGrid(el, pick);
  updateFires();
}

export function updateFires() {
  const el = $("firesTop");
  if (!el) return;
  el.querySelectorAll("tr.r-ship").forEach(tr => {
    const f = S.fires.find(x => x.id === tr.dataset.fid);
    const cell = tr.querySelector(".dropt");
    if (!f || !cell) return;
    // Selection is shown the same way the roster shows it, and said the same way: a row
    // that looks picked must also report itself picked.
    const on = !!(S.sel && (S.sel.f === f || (S.sel.m && S.sel.m.fire === f)));
    tr.classList.toggle("sel", on);
    tr.setAttribute("aria-selected", String(on));
    const m = f.mission;
    if (!m || m.idle) { cell.textContent = "—"; return; }
    const since = timeSinceDrop(m);
    cell.textContent = since === null ? "inbound" : "-" + fmtMin(since / 60);
  });
  roveToSelection(el);
}

export function renderRoster() {
  const el = $("roster");
  if (!el) return;
  const body = FLEET.map(([clsId, count]) => {
    const ships = S.missions.map((m, i) => ({ m, i })).filter(x => x.m.cls && x.m.cls.id === clsId);
    // P-1000 and P-10000 wear the truth beside their names (operator, 08-13):
    // the crush envelope closes near 96 m of hull and both live outside it.
    const impossible = clsId === "P100" ? "" :
      ` <span style="color:#d98b80;font-weight:600" title="the crush envelope closes near 96 m of hull diameter — this class lives outside it, and flies here to find where the arithmetic breaks (front page, Figure 2)">· outside the 96 m envelope</span>`;
    const head = `<tr class="r-clsrow"><td colspan="3"><button class="r-cls" data-hl="${clsId}" ` +
      `aria-pressed="${S.hlClass === clsId}">${CLASSES[clsId].name} ×${count}${impossible}</button></td></tr>`;
    const rows = ships.map(({ m, i }) =>
      `<tr class="r-ship${S.sel && S.sel.m === m ? " sel" : ""}" data-mi="${i}" ` +
      `aria-selected="${!!(S.sel && S.sel.m === m)}" title="${esc(m.why || "")}">` +
      `<td class="r-name">${esc(m.name || m.shipId || "?")}</td>` +
      `<td>${esc(m.fire.name || m.fire.geo || m.fire.id)}</td>` +
      `<td class="ph">…</td></tr>`).join("");
    return head + rows;
  }).join("");
  el.innerHTML = `<table class="fleettab" role="grid" ` +
    `aria-label="Fleet roster, grouped by class: hull, the fire it serves, and its current phase">` +
    `<tbody>${body}</tbody></table>`;
  el.querySelectorAll("tr.r-ship").forEach(tr => tr.addEventListener("click", () => {
    APP.selRow(+tr.dataset.mi);
  }));
  el.querySelectorAll(".r-cls").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    S.hlClass = S.hlClass === b.dataset.hl ? null : b.dataset.hl;
    el.querySelectorAll(".r-cls").forEach(x => x.setAttribute("aria-pressed", String(S.hlClass === x.dataset.hl)));
  }));
  wireGrid(el, tr => APP.selRow(+tr.dataset.mi));
  updateRoster();
}

export function updateRoster() {
  const el = $("roster");
  if (!el) return;
  el.querySelectorAll("tr.r-ship").forEach(tr => {
    const m = S.missions[+tr.dataset.mi];
    if (!m || m.idle) return;
    const st = stateAt(m, S.simTime);
    const ph = tr.querySelector(".ph");
    const txt = st.stopped ? "no power" : SHORT[st.phase];
    if (ph && ph.textContent !== txt) ph.textContent = txt;
    const on = !!(S.sel && S.sel.m === m);
    tr.classList.toggle("sel", on);
    tr.setAttribute("aria-selected", String(on));
  });
  roveToSelection(el);
}

/* ---------- fleet UI ------------------------------------------------------------------------ */

export function renderStats() {
  // The header stat line was retired; the elements survive on no page. Guard and skip.
  if (!$("fsFires")) return;
  const act = S.missions.filter(m => !m.idle);
  const n = { P100: 0, P1000: 0, P10000: 0 };
  let tph = 0;
  for (const m of act) { n[m.cls.id]++; tph += m.plan.tph; }
  $("fsFires").textContent = fmt(S.fires.length);
  $("fsNote").textContent = fmt(S.fires.filter(f => f.note).length) + " · " + fmt(S.fires.filter(f => f.status === "Out of Control").length);
  $("fsShips").textContent = `${n.P100}/10 · ${n.P1000}/5 · ${n.P10000}/1`;
  $("fsRate").textContent = fmt(Math.round(tph / 100) * 100) + (S.uncovered ? " · " + S.uncovered + " wait" : "");
}

export function renderTable() {
  if (!$("ftbody")) return;   // the flat mission table lives on no page now; roster covers it
  const rows = S.missions.map((m, i) => {
    const f = m.fire;
    return `<tr><td><button onclick="APP.selRow(${i})">${esc(f.id)}</button>${f.note ? " ★" : ""}</td>` +
      `<td>${esc(f.status)}</td><td class="num">${fmt(f.sizeHa)}</td>` +
      (m.idle ? `<td colspan="4">no suitable mapped source</td>` :
        `<td>${m.cls.name}</td><td>${esc(srcName(m))}</td><td class="num">${m.oneWayKm.toFixed(1)}</td>` +
        `<td class="num">${fmt(m.plan.cycleMin)}</td>`) +
      `<td class="num">${m.idle ? "—" : fmt(m.plan.tph)}</td>` +
      `<td class="phase">${m.idle ? "idle" : ""}</td></tr>`;
  });
  $("ftbody").innerHTML = rows.join("");
}
setInterval(() => {
  updateRoster();
  updateFires();
  const cells = document.querySelectorAll("#ftbody td.phase");
  if (!cells.length || document.hidden) return;
  S.missions.forEach((m, i) => {
    if (!m.idle && cells[i]) {
      const stt = stateAt(m, S.simTime);
      cells[i].innerHTML = `<span style="color:${PHASE_TINT[stt.phase]}">${stt.label}</span>`;
    }
  });
}, 2500);

/* ---------- assumptions + worked example ----------------------------------------------------- */
