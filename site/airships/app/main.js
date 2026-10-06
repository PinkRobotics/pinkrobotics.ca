/* Wiring the controls, reporting status, and starting the application.
 */
import * as SIM from '../sim/index.js?v=68694086';
import { CFG, DEFAULTS, PHASES, REFERENCE_CLASS, dayKind, selftest, stateAt, resetConfig, setSeed } from '../sim/index.js?v=68694086';
import { M3D_SYS, M3D_SYS_CAM, m3d, m3dAz, m3dBreakSync, m3dCamMode, m3dFadeTo, m3dMode, m3dPhase, m3dVm, updSyncUI, setCamera, cameraMode, panelMode } from './bridge/viz3d.js?v=68694086';
import { renderDrawer } from './cockpit/panels.js?v=68694086';
import { renderStats, renderTable } from './cockpit/tables.js?v=68694086';
import { $, esc } from './dom.js?v=68694086';
import { fetchHeat, fetchWind, guardNoteWords, introWords, loadLive, modeWords, nothingShown, nothingWhy, viewLabels } from './feeds.js?v=68694086';
import { rebuildMissions, replanAll } from './fleet.js?v=68694086';
import { frame } from './loop.js?v=68694086';
import { fitFires, fitFleet, focusMission, select } from './map/interact.js?v=68694086';
import { resize } from './map/projection.js?v=68694086';
import { fetchJSON, storeGet, storeSet } from './net.js?v=68694086';
import { S } from './store.js?v=68694086';
import { DIALS, renderWorked } from './worked.js?v=68694086';

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
  ["Terrain", "Hot", "Wind", "Places", "Perims", "Water", "Routes", "Labels"].forEach(nm => {
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
  // The day control: Today (live) plus every dated status day in the repository, each
  // labelled with what the day is — record only, or fleet simulated. A native select,
  // keyboard-usable for free, and every option is a view the page can actually show.
  // Choosing one navigates, because a view is its URL (?day=…, or live) and a link that
  // shows another person exactly what you were looking at is the point of having URLs.
  const daySel = $("daySel");
  if (daySel) daySel.addEventListener("change", () => {
    const p = new URLSearchParams(location.search);
    p.delete("data");                       // a named day is not the sample
    p.delete("view");
    if (daySel.value === "exercise") { p.set("view", "exercise"); p.delete("day"); }
    else if (daySel.value) p.set("day", daySel.value); else p.delete("day");
    location.search = p.toString();
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
    // The chip and the paragraph name the same tier and the same mode. The rule they both
    // obey: say what is on screen, name the day and the mode in words, and never let a
    // fallback wear the live label. The mode outranks the tier — a record-only day is that
    // even when the data under it arrived by the mirror.
    if (S.exercise) {
      hl.classList.toggle("warn", S.recordOnly);
      hl.innerHTML = S.recordOnly ? `<b>EXERCISE UNAVAILABLE</b> · nothing shown`
        : `<b>EXERCISE</b> · invented fires · fleet simulated`;
    } else if (S.unknownDay) {
      hl.classList.add("warn");
      hl.innerHTML = `<b>NO DATED COPY</b> · ${esc(S.unknownDay)} · nothing shown for it`;
    } else if (S.tier === "none") {
      // Nothing was read at all. The stand-down that follows must not dress an empty map as
      // a record-only day: there is no record on screen.
      hl.classList.add("warn");
      hl.innerHTML = `<b>NO FIRE DATA</b> · nothing could be read`;
    } else if (S.recordOnly) {
      hl.classList.add("warn");
      hl.innerHTML = `<b>RECORD ONLY</b> · ${esc(S.day)} · no fleet this day`;
    } else if (S.daySource === "day") {
      hl.classList.remove("warn");
      hl.innerHTML = `<b>STATUS DAY</b> · ${esc(S.day)} · fleet simulated`;
    } else if (S.daySource !== "live") {
      hl.classList.remove("warn");
      hl.innerHTML = `<b>${S.tier === "replay" ? "REPLAY" : "DATA SNAPSHOT"}</b> · ${esc(S.day)} · fleet simulated`;
    } else if (noData) {
      hl.classList.add("warn");
      hl.innerHTML = `<b>NO FIRE DATA</b> · no feed and no snapshot answered`;
    } else {
      // Past two refresh intervals the page has demonstrably stopped updating, and the chip
      // stops looking healthy about it.
      hl.classList.toggle("warn", age > REFRESH_MS * 2);
      const t = S.fetchedAt.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
      hl.innerHTML = `<b>BC FIRE DATA · MIRROR</b> · ${S.fires.length} fires · ` +
        `fetched ${t} (${ageWords(age)} ago)`;
    }

    hl.title = note;
    // The mode sentence (R7), on every view: the day, the time of the record, and in words
    // whether a fleet is simulated on it. Written in feeds.js so the page, the tests and
    // the fallback generator quote one source.
    const mode = $("modeNote");
    if (mode) mode.textContent = modeWords();
    // What the view calls itself outside the map (viewLabels in feeds.js): the header
    // strip, the tab title and the description tags, from the same state as the chip. A
    // label is written only when it changes, so a suffix added to the title after boot
    // (the self-test's) survives the half-minute repaint.
    const lab = viewLabels();
    const put = (el, key, v) => { if (el && el[key] !== v) el[key] = v; };
    put($("fireModeLabel"), "textContent", lab.fires);
    put($("fleetModeLabel"), "textContent", lab.fleet);
    if (renderStatus._title !== lab.title) { renderStatus._title = lab.title; document.title = lab.title; }
    put(document.querySelector('meta[name="description"]'), "content", lab.description);
    put(document.querySelector('meta[property="og:title"]'), "content", lab.ogTitle);
    put(document.querySelector('meta[property="og:description"]'), "content", lab.ogDescription);
    // The day the fleet controls describe must not outlive the mode: a record-only view
    // has no fleet to pause, speed up or frame.
    document.body.classList.toggle("record-only", S.recordOnly);
    // A status day carries no satellite-heat layer, so the legend does not offer one.
    document.body.classList.toggle("no-heat", S.daySource !== "live");
    const gn = $("guardNote");
    if (gn) gn.textContent = S.guard && S.guard.ok ? guardNoteWords()
      : "The guard file did not load, so no fleet is simulated anywhere on this page.";
    const heat = $("heatNote");
    if (heat) heat.textContent = S.exercise ? "No satellite hotspots are used in the exercise." : S.daySource === "live" ? "" :
      "Satellite hotspots are a live layer and are not part of a status day.";
    // The map's own description says what this view is: on a dated day there is no
    // "today's" about it, on a record-only day there are no airships to task, and on an
    // empty view there is no published record to describe.
    const mc = $("map"), mh = $("mapHelp");
    if (mc) mc.setAttribute("aria-label", nothingShown()
      ? `Map of British Columbia: no fires are shown, because ${nothingWhy()}`
      : S.exercise
      ? "Exercise: invented fires on real British Columbia terrain, with a simulated fleet"
      : S.recordOnly
      ? `Map of British Columbia: the wildfires published for ${S.day}, with no fleet simulated`
      : S.daySource === "live"
      ? "Map of British Columbia: today's wildfires and the simulated airships tasked to them"
      : `Map of British Columbia: the wildfires published for ${S.day} and the simulated airships tasked to them`);
    if (mh) mh.textContent = nothingShown()
      ? `Arrow keys pan, plus and minus zoom, Escape clears the selection. No fire is on the map, because ${nothingWhy()}. No fleet is simulated, so there are no ships, routes or drops. The map still draws water bodies and places, which are not listed as text anywhere on this page.`
      : S.exercise
      ? "Exercise: every fire is invented. Arrow keys pan, plus and minus zoom, Escape clears the selection. Choose an exercise fire on the map or in the table to read its invented size and status. Real lakes supply the simulated fleet."
      : S.recordOnly
      ? `Arrow keys pan, plus and minus zoom, Escape clears the selection. Every fire published that day is on the map; the largest are listed as text in the fires panel, and clicking any fire or a row opens its published record. No fleet is simulated for this day, so there are no ships, routes or drops. The map also draws the published perimeters, water bodies and places, which are not listed as text anywhere on this page.`
      : S.daySource === "live"
      ? "Arrow keys pan, plus and minus zoom, Escape clears the selection. Every simulated airship is also listed as text in the fleet roster panel. The largest fires waiting for or receiving one are listed in the top fires panel. Selecting a row in either selects the same thing here, and the selected ship's full record is written out in the operation panel. The map also draws every fire in the provincial feed, satellite hotspots, water bodies, and routes, which are not listed as text anywhere on this page."
      : "Arrow keys pan, plus and minus zoom, Escape clears the selection. Every simulated airship is also listed as text in the fleet roster panel. The largest fires waiting for or receiving one are listed in the top fires panel. Selecting a row in either selects the same thing here, and the selected ship's full record is written out in the operation panel. The map also draws every fire in that day's published record, its perimeters, water bodies, and routes; satellite hotspots are a live layer and are not part of a status day.";
    const wind = $("windNote");
    if (wind) wind.textContent = S.windOk
      ? "850 hPa wind · site mirror · fetched " + ageWords(Date.now() - S.windAt.getTime()) + " ago"
      : "Still air · " + (S.windNote || "wind mirror unavailable");
    const boundary = $("firstPartyNote");
    if (boundary && !renderStatus._firstPartyNote) {
      renderStatus._firstPartyNote = true;
      import("./first-party-note.js?v=68694086").then(({ auditFirstPartyNote }) => auditFirstPartyNote(boundary))
        .catch(() => { boundary.textContent = "This page's own code talks only to the site that served it. Resource check unavailable."; });
    }

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
  if (refreshing || !S.ready || S.daySource !== "live") return;
  refreshing = true;
  try {
    S.fires = await loadLive();
    // The mirror stopped answering: the view is now a replay, and the day control says so.
    if (S.daySource !== "live") populateDaySel();
    const selFire = S.sel ? (S.sel.f || S.sel.m.fire).id : null;
    const selType = S.sel ? S.sel.type : null;
    // Which HULL was being watched, not just which fire. A rebuild re-runs the whole
    // allocation, so the same fire is often served by a different ship afterwards —
    // and following a ship that silently becomes another ship, with the camera snapping
    // to its heading, is the kind of thing a viewer reads as a glitch rather than as
    // news. Keep the hull if it is still flying; only then fall back to the fire.
    const selHull = S.sel && S.sel.m ? S.sel.m.name : null;
    for (const w of S.water) w.used = false;
    await rebuildMissions();
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

/* Fill the day control once the season index is in. Each option carries the mode in its
 * label, so the choice is informed before it is made: a record-only day is a different
 * thing to ask for than a fleet day, and the label is where the visitor reads that. */
function populateDaySel() {
  const sel = $("daySel");
  if (!sel || !S.dayList) return;
  const opts = [`<option value="">Today (live)</option>`, `<option value="exercise">Exercise: invented fires</option>`];
  for (const d of S.dayList) {
    const fleet = dayKind(S.guard, d.date).fleet;
    opts.push(`<option value="${d.date}">${d.date} · ${fleet ? "fleet simulated" : "record only"}</option>`);
  }
  // The control shows the view that is on screen, not the one that was asked for: a replay
  // standing in for a mirror that did not answer selects its own day, and a day this
  // repository holds no copy of gets an entry of its own that says so.
  const shown = S.exercise ? "exercise" : S.daySource === "live" && !nothingShown() ? "" : S.unknownDay || S.day || "";
  // An empty view never selects an entry that promises a fleet or a record: a listed day
  // whose files failed, or an exercise that did not load, gets an entry of its own too.
  const listed = opts.some(o => o.startsWith(`<option value="${shown}"`));
  const own = shown && (!listed || nothingShown());
  const value = own && listed ? "none:" + shown : shown;
  if (own)
    opts.push(`<option value="${esc(value)}" disabled>${S.exercise ? "Exercise" : esc(shown)} · ${S.unknownDay ? "no dated copy"
      : nothingShown() ? "nothing shown" : S.recordOnly ? "record only" : "fleet simulated"}</option>`);
  sel.innerHTML = opts.join("");
  sel.value = value;
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
  populateDaySel();
  // The header strip, the tab title and the description tags are written by renderStatus(),
  // on every view, from viewLabels(): nothing here names the view a second time.
  if (S.exercise) {
    S.layers.places = false;
    const wd = $("waterDate"); if (wd) wd.textContent = "bundled lakes";
  }
  await rebuildMissions();
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
  // No ship to open on (a record-only day, an empty view, a quiet feed): the operation panel
  // still gets the empty state that fits the view, not the static text it was served with.
  else renderDrawer();
  fetchWind(); fetchHeat();
  S.ready = true;   // resize() may now repaint synchronously
  // First visit: one orientation screen, one tap to dismiss, remembered per browser. With
  // storage blocked it is shown on every visit — mildly annoying, and the only honest
  // alternative to either hiding it or breaking the page. A record-only day skips it: the
  // screen orients a visitor to a fleet, and on those days there is none to orient to.
  if (!S.recordOnly && !storeGet("airshipsIntroSeen")) {
    const ov = $("introOv");
    // The screen names the view it opens on: the exercise, the live feed or a dated replay.
    const iw = introWords();
    for (const [id, words] of [["introTapH", iw.tap], ["introMapH", iw.mapHead], ["introMapP", iw.mapBody], ["introFires", iw.fires]])
      $(id).textContent = words;
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
  // Only a live view has anything newer to fetch: a dated day and the sample pin their
  // inputs, and a refresh cycle on them would be a loop that can only ever repaint.
  if (S.daySource === "live")
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
  // Replay and dated days pin their inputs. There is nothing newer to fetch, and re-running
  // the allocation would quietly change the run the link exists to reproduce.
  if (S.daySource !== "live") { renderStatus(); return; }
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
