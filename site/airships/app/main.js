/* Wiring the controls, reporting status, and starting the application.
 */
import * as SIM from '../sim/index.js?v=a67fca39';
import { CFG, DEFAULTS, PHASES, REFERENCE_CLASS, selftest, stateAt, resetConfig, setSeed } from '../sim/index.js?v=a67fca39';
import { M3D_SYS, M3D_SYS_CAM, m3d, m3dAz, m3dBreakSync, m3dCamMode, m3dFadeTo, m3dMode, m3dPhase, m3dVm, updSyncUI, setCamera, cameraMode, panelMode } from './bridge/viz3d.js?v=a67fca39';
import { renderDrawer } from './cockpit/panels.js?v=a67fca39';
import { renderStats, renderTable } from './cockpit/tables.js?v=a67fca39';
import { $, esc } from './dom.js?v=a67fca39';
import { REPLAY, fetchHeat, fetchWind, loadLive } from './feeds.js?v=a67fca39';
import { rebuildMissions, replanAll } from './fleet.js?v=a67fca39';
import { frame } from './loop.js?v=a67fca39';
import { fitFires, fitFleet, focusMission, select } from './map/interact.js?v=a67fca39';
import { resize } from './map/projection.js?v=a67fca39';
import { fetchJSON, storeGet, storeSet } from './net.js?v=a67fca39';
import { S } from './store.js?v=a67fca39';
import { DIALS, renderWorked } from './worked.js?v=a67fca39';

export function wire() {
  $("btnPause").addEventListener("click", () => {
    S.paused = !S.paused;
    $("btnPause").textContent = S.paused ? "Resume" : "Pause";
    $("btnPause").setAttribute("aria-pressed", String(S.paused));
  });
  if (S.reduced) { $("btnPause").textContent = "Resume"; $("btnPause").setAttribute("aria-pressed", "true"); }
  document.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => {
    S.speed = +b.dataset.speed;
    document.querySelectorAll("[data-speed]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  }));
  document.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
    S.filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  }));
  document.querySelectorAll("[data-cls]").forEach(b => b.addEventListener("click", () => {
    S.exampleCls = b.dataset.cls;
    document.querySelectorAll("[data-cls]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderWorked();
  }));
  document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    S.modeId = b.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    replanAll();
  }));
  if ($("btnReset")) $("btnReset").addEventListener("click", () => {
    resetConfig();
    for (const dd of DIALS) { $("i_" + dd.k).value = CFG[dd.k]; $("o_" + dd.k).textContent = CFG[dd.k].toFixed(dd.d) + dd.unit; }
    replanAll();
  });
  ["Terrain", "Sat", "Hot", "Wind", "Places", "Perims", "Water", "Routes", "Labels"].forEach(nm => {
    $("tg" + nm).addEventListener("change", e => { S.layers[nm.toLowerCase()] = e.target.checked; });
  });
  $("btnFitFleet").addEventListener("click", fitFleet);
  $("btnFitFires").addEventListener("click", fitFires);
  // The split button flips the centre column between map-over-model and map-beside-model.
  // A SAVED CHOICE ALWAYS WINS. Without one, the arrangement follows the shape of the
  // window, for the reason written beside .cp-map.split-h in the stylesheet: stacking two
  // views in a wide, short column makes both of them letterboxes, and the 3D panel is the
  // one that pays, because it frames a tall subject (110 m of ship over 350 m of hose) and
  // is therefore sized by its box's HEIGHT. Measured on the deployed page at 1512x945:
  // stacked gave the model an 802x175 slot, side by side gives it ~410x570 and the ship
  // draws about three times larger, out of exactly the same area. The aspect test is what
  // catches "wide and short", where stacking hurts most; the width test asks whether two
  // halves are still usable views — 1360 px leaves each about 345, near the width the map
  // already works at on a phone. Under either test it stacks, and a taller window is where
  // the same argument runs the other way.
  const stored = storeGet("airshipsSplit2");
  S.split = stored === "h" || stored === "v" ? stored
    : (matchMedia("(min-width:1360px) and (min-aspect-ratio:7/5)").matches ? "h" : "v");
  const applySplit = () => {
    $("cpMap").classList.toggle("split-h", S.split === "h");
    // The body carries it too: the intro overlay's call-outs point into the centre column
    // and are not inside it, so they need the arrangement from an ancestor they share.
    document.body.classList.toggle("split-h", S.split === "h");
    $("btnSplit").textContent = S.split === "h" ? "Split ◨" : "Split ⬒";
  };
  applySplit();
  $("btnSplit").addEventListener("click", () => {
    S.split = S.split === "h" ? "v" : "h";
    storeSet("airshipsSplit2", S.split);      // unremembered if storage is blocked; still applied
    applySplit();
  });
  $("btnLayers").addEventListener("click", () => {
    const lp = $("layersPanel");
    const open = lp.style.display !== "none";
    lp.style.display = open ? "none" : "flex";
    $("btnLayers").textContent = open ? "Layers ▾" : "Layers ▴";
  });
  $("btnFS").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $("monroot").requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    $("btnFS").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    resize();
  });
  document.querySelectorAll("[data-m3s]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.m3s;
    setCamera({ panel: k });
    document.querySelectorAll("[data-m3s]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("m3dCustom").style.display = k === "custom" ? "flex" : "none";
    if (!m3d) return;
    if (k === "auto") setCamera({ phase: "", viewMode: "", mode: "sync", azimuth: null });
    else if (k === "shell") {
      m3dFadeTo(() => m3d.setProps({ viewMode: "exterior", systems: null }));
      setCamera({ viewMode: "exterior", mode: "sync", azimuth: null });
    } else if (k === "custom") applyM3DCustom();
    else if (k === "vacuum") {
      // The vacuum story gets its own view mode: a cutaway with the whole free interior
      // packed with pink cell-volume spheres, everything else ghosted.
      m3dFadeTo(() => m3d.setProps({ viewMode: "vacuum", systems: null }));
      setCamera({ viewMode: "vacuum" });
      setCamera({ mode: "presetHold" });
      m3d.goToPreset("side");
    }
    else if (M3D_SYS[k]) {
      m3dFadeTo(() => m3d.setProps({ viewMode: "systems", systems: M3D_SYS[k] }));
      setCamera({ viewMode: "systems" });
      setCamera({ mode: "presetHold" });              // hold this subject until resynced
      m3d.goToPreset(M3D_SYS_CAM[k] || "three-quarter");
    }
    updSyncUI();
  }));
  document.querySelectorAll("[data-m3c]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.m3c === "sync") setCamera({ mode: "sync", azimuth: null });
    else {
      setCamera({ mode: "preset" });
      if (m3d) m3d.goToPreset(b.dataset.m3c);
    }
    updSyncUI();
  }));
  $("m3dView").addEventListener("pointerdown", m3dBreakSync);
  // A wheel zoom is a softer break than a drag: the heading keeps following, the user's
  // distance is respected, and the sync light goes off until ⟳ Sync is pressed.
  $("m3dView").addEventListener("wheel", () => {
    if (cameraMode() === "sync") { setCamera({ mode: "syncManual" }); updSyncUI(); }
  }, { passive: true });
  // the custom panel: any base view, any mix of systems, a movable cut plane
  const CATS = ["structure", "vacuum", "water", "cryogenic", "power", "propulsion", "control", "sensors", "compute", "maintenance"];
  $("m3cCats").innerHTML = CATS.map(c =>
    `<label style="margin-right:8px;white-space:nowrap"><input type="checkbox" data-m3cat="${c}" checked style="accent-color:var(--warm)">${c}</label>`).join("");
  function applyM3DCustom() {
    if (!m3d) return;
    const on = [...document.querySelectorAll("[data-m3cat]")].filter(x => x.checked).map(x => x.dataset.m3cat);
    m3d.setProps({
      viewMode: $("m3cView").value,
      systems: on.length === CATS.length ? null : on,
      cutFrac: parseFloat($("m3cCut").value),
    });
    setCamera({ viewMode: $("m3cView").value });
  }
  $("m3cView").addEventListener("change", () => { if (panelMode() === "custom") applyM3DCustom(); });
  $("m3cCut").addEventListener("input", () => { if (panelMode() === "custom") applyM3DCustom(); });
  document.querySelectorAll("[data-m3cat]").forEach(x => x.addEventListener("change", () => { if (panelMode() === "custom") applyM3DCustom(); }));
}
window.APP = {
  selRow(i) { select({ type: "ship", m: S.missions[i] }); $("monroot").scrollIntoView({ behavior: "smooth", block: "start" }); },
  selShip() { if (S.sel && S.sel.m) select({ type: "ship", m: S.sel.m }); },
  step(dir) {
    if (!S.sel || !S.sel.m || S.sel.m.idle) return;
    const m = S.sel.m;
    const st = stateAt(m, S.simTime);
    const target = (st.idx + dir + PHASES.length) % PHASES.length;
    const startOfTarget = target ? m.phaseEnds[target - 1] : 0;
    const cur = ((S.simTime + m.offset * m.cycleSec) % m.cycleSec + m.cycleSec) % m.cycleSec;
    S.simTime += (startOfTarget - cur + 1) + (dir > 0 && target === 0 ? m.cycleSec : 0);
    renderDrawer();
  },
};

/* ---------- status line ------------------------------------------------------------------------ */

/* How old the data on screen is, in milliseconds, or null when there is none. Measured from
 * the moment the data was FETCHED FROM THE AGENCY, not from the moment this page received
 * it: a mirror hit at 10:31 that the server filled at 10:24 is seven minutes old, and saying
 * "just now" would be a lie the visitor cannot check. */
export function dataAgeMs() {
  return S.fetchedAt ? Date.now() - S.fetchedAt.getTime() : null;
}

/* An age in the units a reader wants: minutes while minutes mean something, then hours,
 * then days. A tab left open overnight should say "14 h", not "863 min". */
function ageWords(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "under a minute";
  if (min < 90) return min + " min";
  const h = ms / 3600000;
  if (h < 36) return Math.round(h) + " h";
  return Math.round(h / 24) + " days";
}

export function renderStatus() {
  const paint = () => {
    const hl = $("hudLive");
    const age = dataAgeMs();
    const note = S.dataNote || "";
    // A tier of "none" and a missing fetch time are the same condition seen from two sides;
    // either one means there is nothing on screen to describe, and neither may be allowed
    // to reach the live branch, which would read a time off null.
    const noData = S.tier === "none" || !S.fetchedAt;
    // The chip and the paragraph name the same tier. The rule they both obey: say what is
    // on screen and how old it is, and never let a fallback wear the live label.
    if (noData) {
      hl.classList.add("warn");
      hl.innerHTML = `<b>NO FIRE DATA</b> · no feed and no snapshot answered`;
    } else if (S.usingFallback) {
      hl.classList.add("warn");
      hl.innerHTML = `<b>DATA SNAPSHOT</b> · ${esc((S.snapshotDate || "").slice(0, 10))} · ` +
        (S.tier === "replay" ? "replay mode" : "live feed unreachable");
    } else {
      // Past two refresh intervals the page has demonstrably stopped updating, and the chip
      // stops looking healthy about it.
      hl.classList.toggle("warn", age > REFRESH_MS * 2);
      const t = S.fetchedAt.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
      hl.innerHTML = `<b>BC FIRE DATA</b> · ${S.fires.length} fires · ` +
        `fetched ${t} (${ageWords(age)} ago)`;
    }

    /* THE PROVENANCE PARAGRAPH IS GONE FROM THE PAGE, not from the project.
     *
     * It ran to four sentences across the bottom of the screen, most of it behind an ellipsis
     * where nobody could read it anyway, and it repeated what the chip above already says in
     * six words. The chip carries the tier, the count and the age — which is the part a reader
     * acts on — and `concept/` carries the method, the sources and their licences in full.
     *
     * What is NOT dropped: the same conditions still reach the screen. `#hudLive` turns warn
     * and says NO FIRE DATA or DATA SNAPSHOT, the map draws points-only when the perimeter
     * layer fails, and `liveNote` announces a tier change to a screen reader. The paragraph was
     * the least-read copy of that news, not the only one.
     */
  };
  paint();
  // The age has to keep counting up on its own: nothing else redraws this line between
  // refreshes, and a frozen "3 min ago" on an hour-old page is exactly the lie to avoid.
  clearInterval(renderStatus._t); renderStatus._t = setInterval(paint, 30000);
}

/* ---------- the refresh cycle --------------------------------------------------------------- */

export const REFRESH_MS = 900000;              // 15 min: the rate the feeds themselves update at

let refreshing = false;

/* Re-read the feeds and rebuild the fleet around whatever the fires are now.
 *
 * Guarded against re-entry because it now has two callers — the timer and the tab coming
 * back into view — and they can arrive together: a tab shown at the moment its interval
 * fires would otherwise run two allocations over the same state and let the slower one win.
 */
export async function refresh() {
  if (refreshing || !S.ready) return;
  refreshing = true;
  try {
    S.fires = await loadLive();
    const selFire = S.sel ? (S.sel.f || S.sel.m.fire).id : null;
    const selType = S.sel ? S.sel.type : null;
    // Which HULL was being watched, not just which fire. A rebuild re-runs the whole
    // allocation, so the same fire is often served by a different ship afterwards —
    // and following a ship that silently becomes another ship, with the camera snapping
    // to its heading, is the kind of thing a viewer reads as a glitch rather than as
    // news. Keep the hull if it is still flying; only then fall back to the fire.
    const selHull = S.sel && S.sel.m ? S.sel.m.name : null;
    for (const w of S.water) w.used = false;
    rebuildMissions();
    for (const m of S.missions) if (!m.idle) S.water[m.waterIdx].used = true;
    if (selType === "fire") {
      const ff = S.fires.find(x => x.id === selFire);
      S.sel = ff ? { type: "fire", f: ff, m: ff.mission } : null;
    } else if (selHull || selFire) {
      const sameHull = selHull && S.missions.find(m => !m.idle && m.name === selHull);
      const ff = selFire && S.fires.find(x => x.id === selFire);
      const m = sameHull || (ff && ff.mission) || null;
      S.sel = m ? { type: "ship", m } : null;
      if (!S.sel) S.follow = false;
    }
    renderStats(); renderTable(); renderStatus(); renderDrawer();
    fetchWind(); fetchHeat();
  } catch (e) {
    // Keep the current picture; the next tick retries. loadLive does not throw, so this is
    // a failure of the rebuild rather than of the network, and the status line goes on
    // reporting the age of what is actually on screen.
    renderStatus();
  } finally { refreshing = false; }
}

/* ---------- boot -------------------------------------------------------------------------------- */

/* Deterministic replay. `?seed=N` pins every choice the model makes, and `?data=snapshot`
 * (read in feeds.js) pins its inputs. The URL is parsed here, in the application, so that
 * nothing in sim/ needs to know a browser exists.
 *
 * Together they make a run reproducible: the same link shows another person exactly what
 * you were looking at, and the golden-output tests have something stable to compare. */
{
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) setSeed(seed);
}

export async function boot() {
  resize(); wire();
  try {
    const [outline, waterDoc, roads] = await Promise.all([
      fetchJSON("data/bc-outline.json", 20000),
      fetchJSON("data/water-bc.json", 30000),
      fetchJSON("data/roads-bc.json", 20000).catch(() => []),
    ]);
    S.outline = outline;
    S.roads = roads;
    // ringed lakes get true bounding boxes: a long lake must render (and cull) by its
    // real extent, not by a circle around a centroid that may be 60 km off-screen
    for (const w of waterDoc.water) {
      if (!w[5]) continue;
      let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
      for (const q of w[5]) {
        if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
        if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      }
      w.bb = [x0, y0, x1, y1];
      w.spanKm = Math.max((x1 - x0) * 111.32 * Math.cos(w[1] * Math.PI / 180), (y1 - y0) * 110.57) / 2;
    }
    S.water = waterDoc.water;
    S.waterMeta = waterDoc;
    const wd = $("waterDate"); if (wd && waterDoc.generated) wd.textContent = waterDoc.generated.slice(0, 10);
  } catch (e) {
    // No dataline any more; the chip is the channel for this.
    const hl0 = $("hudLive");
    if (hl0) { hl0.classList.add("warn"); hl0.innerHTML = "<b>NO MAP DATA</b> · " + esc(e.message); }
    return;
  }
  S.fires = await loadLive();
  rebuildMissions();
  for (const m of S.missions) if (!m.idle) S.water[m.waterIdx].used = true;
  renderStats(); renderTable(); renderWorked(); renderStatus();
  fitFires();
  // Open on a REFERENCE-CLASS ship, working the largest fire that class has been given.
  //
  // Two rules, and the order matters. The cockpit should start occupied rather than empty, so
  // it opens on a fire the fleet is actually working — a rule and not a named incident, because
  // every fire in the feed is out within weeks and a hardcoded fire number would leave the page
  // opening on nothing.
  //
  // But "largest fire" alone always opened on the P-10000: the allocator runs the biggest hull
  // first and gives it the highest-priority fire. That is the class this project explicitly does
  // not propose building, and it was the first thing every visitor saw. The P-100 is the
  // reference ship and it is what the page should open on. If no P-100 is flying — the feed is
  // quiet, or every one of them is idle — fall back to any ship rather than to an empty cockpit.
  //
  // Ties break on fire number so the same feed always selects the same ship.
  const larger = (m, best) => !best || m.fire.sizeHa > best.fire.sizeHa ||
    (m.fire.sizeHa === best.fire.sizeHa && m.fire.id < best.fire.id);
  let pick = null, anyShip = null;
  for (const m of S.missions) {
    if (m.idle) continue;
    if (larger(m, anyShip)) anyShip = m;
    if (m.cls.id === REFERENCE_CLASS && larger(m, pick)) pick = m;
  }
  pick = pick || anyShip;
  if (pick) { S.sel = { type: "ship", m: pick }; S.follow = true; renderDrawer(); focusMission(pick); }
  fetchWind(); fetchHeat();
  S.ready = true;   // resize() may now repaint synchronously
  // First visit: one orientation screen, one tap to dismiss, remembered per browser. With
  // storage blocked it is shown on every visit — mildly annoying, and the only honest
  // alternative to either hiding it or breaking the page.
  if (!storeGet("airshipsIntroSeen")) {
    const ov = $("introOv");
    ov.hidden = false;
    // Any first gesture dismisses it, and it lets go on its own after twelve seconds: a
    // reader who scrolls past, a keyboard user, and anything that reads the page without a
    // hand (a static render, an agent) must all reach the monitor underneath.
    let done = false;
    const dismiss = () => {
      if (done) return; done = true;
      ov.hidden = true;
      storeSet("airshipsIntroSeen", "1");
      for (const [t, ev] of listeners) t.removeEventListener(ev, dismiss);
    };
    const listeners = [[ov, "click"], [window, "scroll"], [window, "wheel"], [window, "keydown"], [window, "touchmove"]];
    for (const [t, ev] of listeners) t.addEventListener(ev, dismiss, { passive: true });
    setTimeout(dismiss, 12000);
  }
  requestAnimationFrame(frame);
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  if (location.search.indexOf("selftest=1") >= 0) {
    try { const r = selftest(); console.log(r); document.title += " · " + r; }
    catch (e) { console.error(e.message); document.title += " · " + e.message; }
  }
}

/* Coming back to a tab that has been sitting in the background.
 *
 * The frame clock is reset because the animation loop must not integrate the hours the tab
 * spent hidden as one enormous step. The data is a separate problem: the interval above
 * declines to fetch while hidden, so a tab left open all day arrives back with fire data
 * hours old and up to another fifteen minutes to wait before anything asks for more. Catch
 * up on sight if the data has outlived the interval, and repaint either way so the age in
 * the status line is the real one rather than whatever it was when the tab went away. */
let wasHidden = document.hidden;
document.addEventListener("visibilitychange", () => {
  S.lastFrame = null;
  const hidden = document.hidden;
  // Only a real hidden → visible transition counts. Browsers fire this event in other
  // circumstances too, and a page that reallocates its fleet on a spurious one is a page
  // whose output depends on how its tab was opened.
  const returning = wasHidden && !hidden;
  wasHidden = hidden;
  if (!returning || !S.ready) return;
  // Replay pins its inputs. There is nothing newer to fetch, and re-running the allocation
  // would quietly change the run the link exists to reproduce.
  if (REPLAY) { renderStatus(); return; }
  const age = dataAgeMs();
  if (age === null || age > REFRESH_MS) refresh();
  else renderStatus();
});
/* The page is an ES module, so nothing it declares is global. These two are published
 * deliberately: `APP` because the markup binds to it, and `AIRSHIPS` so that anyone reading
 * the page can re-run the model in their own devtools console without cloning anything —
 * `AIRSHIPS.sim.selftest()` runs every assertion, and
 * `AIRSHIPS.sim.planCycle(AIRSHIPS.sim.CLASSES.P100, AIRSHIPS.sim.MODES.balanced, 15)`
 * recomputes a published figure from scratch. Arithmetic nobody can re-run is just a claim.
 *
 * `APP` does only what the on-page controls do — select a ship, step its phase — and
 * `AIRSHIPS` is a read handle. Neither can edit the model's state or its assumptions: a
 * console visitor can inspect and recompute, not rewrite. */
window.AIRSHIPS = { sim: SIM, app: S, stateAt };

boot();
