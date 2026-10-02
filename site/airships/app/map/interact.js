/* Pointer, wheel and keyboard on the map; selection; framing.
 */
import { renderDrawer } from '../cockpit/panels.js?v=762fdcfd';
import { H, W, canvas, mercY } from '../map/projection.js?v=762fdcfd';
import { hitFires, hitShips, hitWater } from '../map/render.js?v=762fdcfd';
import { S } from '../store.js?v=762fdcfd';

/* The map's text alternative, part two.
 *
 * The canvas used to promise "the same information is available in the fleet table below the
 * map"; that table now lives on no page, and a label that describes something that does not
 * exist is a false claim. #mapHelp in index.html says what IS there — the roster and the
 * top-fires list name every ship and the biggest served fires — and what is only ever drawn:
 * the rest of the provincial feed, the hotspots, the water, the routes.
 *
 * This fills in the one thing those panels cannot answer, which is how much of that is in the
 * current frame. It is a plain description referenced by aria-describedby, NOT a live region:
 * it is written once an interaction has settled and read when someone asks the map what it is
 * showing. Panning would otherwise generate a sentence per frame. */
let viewNoteT = null;

export function noteMapView() {
  if (viewNoteT) return;                     // one write per 400 ms, whatever the input rate
  viewNoteT = setTimeout(() => {
    viewNoteT = null;
    const el = document.getElementById("mapHere");
    if (!el) return;
    const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
    const txt = `Currently in frame: ${n(hitFires.length, "fire", "fires")}, ` +
      `${n(hitShips.length, "simulated airship", "simulated airships")}, ` +
      `${n(hitWater.length, "water source in use", "water sources in use")}.`;
    if (el.textContent !== txt) el.textContent = txt;
  }, 400);
}

export let drag = null, pinch = null;
canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  if (pinch === null && drag === null) drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  else if (drag && pinch === null) pinch = { id2: e.pointerId, x2: e.clientX, y2: e.clientY, k0: S.view.k };
});
canvas.addEventListener("pointermove", e => {
  if (pinch && (e.pointerId === pinch.id2 || e.pointerId === drag.id)) {
    if (e.pointerId === pinch.id2) { pinch.x2 = e.clientX; pinch.y2 = e.clientY; }
    else { drag.x = e.clientX; drag.y = e.clientY; }
    const d = Math.hypot(pinch.x2 - drag.x, pinch.y2 - drag.y);
    if (pinch.d0 === undefined) pinch.d0 = d;
    else { S.view.k = Math.max(6, Math.min(9000, pinch.k0 * d / pinch.d0)); }
    return;
  }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved > 4) { canvas.classList.add("drag"); S.follow = false; }
  S.view.cx -= dx / S.view.k; S.view.cy -= dy / S.view.k;
  drag.x = e.clientX; drag.y = e.clientY;
  noteMapView();
});

export function endPointer(e) {
  if (pinch && e.pointerId === pinch.id2) { pinch = null; return; }
  if (drag && e.pointerId === drag.id) {
    if (drag.moved <= 4) clickAt(e.clientX, e.clientY);
    drag = null; pinch = null; canvas.classList.remove("drag");
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const f = Math.exp(-e.deltaY * 0.0015);
  const wx = S.view.cx + (mx - W / 2) / S.view.k, wy = S.view.cy + (my - H / 2) / S.view.k;
  S.view.k = Math.max(6, Math.min(9000, S.view.k * f));
  S.view.cx = wx - (mx - W / 2) / S.view.k; S.view.cy = wy - (my - H / 2) / S.view.k;
  noteMapView();
}, { passive: false });
canvas.addEventListener("keydown", e => {
  const step = 60 / S.view.k;
  if (e.key === "ArrowLeft") S.view.cx -= step;
  else if (e.key === "ArrowRight") S.view.cx += step;
  else if (e.key === "ArrowUp") S.view.cy -= step;
  else if (e.key === "ArrowDown") S.view.cy += step;
  else if (e.key === "+" || e.key === "=") S.view.k = Math.min(9000, S.view.k * 1.3);
  else if (e.key === "-") S.view.k = Math.max(6, S.view.k / 1.3);
  else if (e.key === "Escape") { S.sel = null; renderDrawer(); }
  else return;
  e.preventDefault(); S.follow = false;
  noteMapView();
});

export function clickAt(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  const x = cx - rect.left, y = cy - rect.top;
  const near = (arr, r) => {
    let best = null, bd = r * r;
    for (const h of arr) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  };
  const hs = near(hitShips, 14);
  if (hs) { select({ type: "ship", m: hs.m }); return; }
  const hf = near(hitFires, 12);
  if (hf) {
    const mm = hf.f.mission;
    if (mm && !mm.idle) select({ type: "ship", m: mm });
    else select({ type: "fire", f: hf.f, m: mm });
    return;
  }
  const hw = near(hitWater, 10);
  if (hw) { select({ type: "source", m: S.missions.find(mm => !mm.idle && mm.water === hw.w) }); return; }
  S.sel = null; S.follow = false; renderDrawer();
}

export function select(sel) {
  if (!sel.m && !sel.f) return;
  S.sel = sel;
  // Selecting a ship follows it by default — the mission frame sets the zoom, the ship owns
  // the centre. Dragging the map still breaks the follow, as before.
  S.follow = sel.type === "ship" && !!sel.m && !sel.m.idle;
  if (sel.type === "ship" && sel.m && !sel.m.idle) focusMission(sel.m);
  renderDrawer();
  noteMapView();          // selecting a ship reframes the map, so the frame description moves
}

// One description before anyone touches anything: the first frames have drawn by now, and a
// describedby element that is empty until the user pans describes nothing on arrival.
setTimeout(noteMapView, 2500);

export function focusMission(m) {
  // frame the entire task: hose stations, the fire, and every drop target
  const pts = [m.intake, m.delivery, m.fire.ll]
    .concat(m.stations || []).concat(m.targets || []);
  let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
  for (const q of pts) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]);
    y0 = Math.min(y0, mercY(q[1])); y1 = Math.max(y1, mercY(q[1]));
  }
  S.view.cx = (x0 + x1) / 2; S.view.cy = (y0 + y1) / 2;
  S.view.k = Math.min(4500,
    0.7 * Math.min(W / Math.max(0.02, x1 - x0), H / Math.max(0.02, y1 - y0)));
}

export function fitFleet() {
  // frame the working fleet: every active mission's water source and fire
  const pts = [];
  for (const m of S.missions) if (!m.idle) { pts.push(m.intake, m.fire.ll); }
  if (!pts.length) return fitFires();
  let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, mercY(p[1])); y1 = Math.max(y1, mercY(p[1]));
  }
  S.view.cx = (x0 + x1) / 2; S.view.cy = (y0 + y1) / 2;
  S.view.k = Math.min((W - 60) / Math.max(0.5, x1 - x0), (H - 60) / Math.max(0.5, y1 - y0));
  S.follow = false;
}

export function fitFires() {
  const shown = S.fires.filter(f => S.filter === "note" ? f.note :
    S.filter === "ooc" ? f.status === "Out of Control" : true);
  const pts = shown.length ? shown.map(f => f.ll) : [[-139, 60], [-114, 48.3]];
  let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, mercY(p[1])); y1 = Math.max(y1, mercY(p[1]));
  }
  S.view.cx = (x0 + x1) / 2; S.view.cy = (y0 + y1) / 2;
  S.view.k = Math.min((W - 60) / Math.max(0.5, x1 - x0), (H - 60) / Math.max(0.5, y1 - y0));
  S.follow = false;
}

/* ---------- frame loop ---------------------------------------------------------------------- */
