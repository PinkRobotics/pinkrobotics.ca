/* The bridge to the 3D model: mounting it, feeding it state, and the synced camera.
 *
 * The 3D library knows nothing about this page. Everything page-specific — which view
 * suits which phase, how the camera follows a heading, how the model is framed — is here.
 */
import { CFG, stateAt } from '../../sim/index.js?v=a67fca39';
import { cockpitShip } from '../cockpit/panels.js?v=a67fca39';
import { $ } from '../dom.js?v=a67fca39';
import { S } from '../store.js?v=a67fca39';

/* The parametric model from 3d/, mounted below the operation strip and driven by the SAME
   stateAt() that drives the map, the dials and the schematic. The library's own adapter
   (3d/adapter/fable.js) owns the unit translation, so its internals can change without this
   file changing. Auto mode picks the most useful view for the current phase. */
// Opens in SHELL with the heading-synced camera: the quiet exterior first, Auto's cutaway
// cinematics only when asked for.
export let m3d = null, m3dMode = "shell", m3dBusy = false, m3dDead = false, m3dVm = "", m3dPhase = "";

export let m3dCamMode = "sync";          // camera follows the ship's heading, like the schematic

export let m3dAz = null;                 // rate-limited camera azimuth (real seconds, not sim speed)
export let m3dShipKey = "";              // which hull the panel is showing; a change is a hard cut
export let m3dAnchorSpanM = 0;           // framed vertical span while the anchor is down, latched


/* Auto per phase: [viewMode, systems isolation, camera]. "sync" keeps the heading-follow
   camera (the travelling shot); named presets glide there via the camera's own easing. */
export const M3D_AUTO = {
  SOURCE_APPROACH: ["exterior", null, "source-filling"],
  WATER_FILL: ["systems", ["water"], "water"],
  OUTBOUND_TRANSIT: ["exterior", null, "sync"],
  WATER_RELEASE: ["ghost", null, "fire-approach"],
  BUOYANCY_ESCAPE: ["exterior", null, "escape-climb"],
  RETURN_TRANSIT: ["systems", ["cryogenic"], "ln2"],
};
/* Each highlight button also flies the camera to its subject. */

export const M3D_SYS_CAM = { water: "water", ballast: "ln2",
  propulsion: "rotor", power: "power", mind: "mind" };

export let m3dFading = false;

export function m3dFadeTo(fn) {
  const el = $("m3dView");
  if (!el || m3dFading || S.reduced) { fn(); return; }
  m3dFading = true;
  el.style.transition = "opacity .22s ease";
  el.style.opacity = "0.15";
  setTimeout(() => { fn(); el.style.opacity = "1"; m3dFading = false; }, 230);
}

/* The highlight buttons: each is a small set of the model's own categories, chosen to tell
   one part of the concept at a time. Everything else ghosts. */
export const M3D_SYS = {
  water: ["water"],
  ballast: ["cryogenic"],
  propulsion: ["propulsion", "control"],
  power: ["power"],
  mind: ["compute", "sensors"],
};

export async function ensureM3D(m) {
  if (m3d || m3dBusy || m3dDead) return;
  m3dBusy = true;
  try {
    // Pin the module graph to the published stamp. The entry URL is what carries the ?v=
    // for the whole import tree; unversioned, Cloudflare pins us to whatever generation it
    // cached for up to four hours (observed: old fins, old rotors, no solar skin). The
    // version.json fetch is cache-busted so it cannot itself be the stale link.
    let m3dVer = "";
    try {
      const vr = await fetch(new URL("../../3d/version.json?ts=" + Date.now(), import.meta.url),
                                  { cache: "reload" });
      m3dVer = ((await vr.json()).version || "").replace(/[^A-Za-z0-9_.-]/g, "");
    } catch (e) { /* fall through to a fixed label — worst case is today's status quo */ }
    const mod = await import(new URL("../../3d/index.js?v=" + (m3dVer || "unpinned"),
                                   import.meta.url).href);
    m3dVm = "exterior";
    m3dPhase = "";                 // adopt the current phase on the first update, no switch
    m3d = mod.mountForMission($("m3dView"), {
      mission: m,
      stateAt: () => { const mm = cockpitShip(); return mm ? stateAt(mm, S.simTime) : null; },
      cfg: CFG,
      // No headM override: the pod hangs the class's real hose (300 m), because the panel now
      // draws the lake and a 45 m hose put the pumps 255 m above the water they are pumping.
      adapt: {},
      props: { quality: "medium", showForces: false, showCells: true, interactive: true },
    });
  } catch (e) {
    m3dDead = true;
    const el = $("model3d");
    if (el) el.hidden = true;
    console.warn("airship3d unavailable:", e && e.message);
  }
  m3dBusy = false;
}

export let m3dWindKey = "";

export function updateM3D(m, st) {
  if (!m3d || $("model3d").hidden) return;

  /* SWITCHING SHIPS IS A CUT, NOT A MOVE.
   *
   * Everything in this panel eases: the camera azimuth is rate-limited to ~29 deg/s so a 60x
   * simulation cannot whip the view around, the hull's attitude is rate-limited by the class's
   * own envelope, and the winches run at winch speed. All of that is right for ONE ship being
   * watched over time, and all of it is wrong the instant the reader picks a different hull —
   * the panel then spends seconds rotating from the heading of a ship nobody is looking at any
   * more, which reads as the new ship spinning for no reason.
   *
   * So a change of ship snaps: the camera adopts the new heading outright, the model adopts the
   * new attitude, and the rates are zeroed so nothing eases in from the old one's state. */
  const shipKey = m ? String(m.id || m.name || "") : "";
  if (shipKey !== m3dShipKey) {
    m3dShipKey = shipKey;
    m3dAz = null;                       // null means "adopt the target this frame"
    // The driver takes it from here: `snapNext` makes the next tick a cut rather than an ease,
    // for the attitude and for both winches at once.
    if (m3d.driver) m3d.driver.snapNext = true;
    m3dAnchorSpanM = 0;                 // the next ship frames its own drop, not this one's
  }
  m3d.sync(m, st);
  // Feed the mission's live wind into the model frame (+x = nose), so the wind lines, the
  // hose drift and the gust responses all answer the same air the plan flies in — plus the
  // sim's play speed, so blades visibly keep up at 20x and 60x. Screen heading -> compass:
  // screen +x is east, +y is south, so compass = 90° + heading.
  {
    let wv = [0, 0, 0];
    if (m.wind && m.wind.spd > 2) {
      const mps = m.wind.spd / 3.6;
      const shipCompass = (90 + (m.dispAng || 0) * 180 / Math.PI + 720) % 360;
      const toward = (m.wind.dir + 180) % 360;
      const rel = (toward - shipCompass) * Math.PI / 180;
      wv = [Math.cos(rel) * mps, Math.sin(rel) * mps, 0];
    }
    const key = Math.round(wv[0]) + ":" + Math.round(wv[1]) + ":" + S.speed;
    if (key !== m3dWindKey) {
      m3dWindKey = key;
      m3d.setProps({ env: { windMps: wv, timeScale: S.speed } });
    }
  }
  // Auto flows through the cycle: view + isolation fade over, the camera glides. It mounts
  // on the shell and adopts the running phase without yanking a cutaway open; if the user
  // broke the camera loose by dragging, their camera is respected until they resync.
  if (m3dMode === "auto" && st.phase !== m3dPhase) {
    const first = m3dPhase === "";
    m3dPhase = st.phase;
    if (!first) {
      const [vm, sys, cam] = M3D_AUTO[st.phase] || ["exterior", null, "sync"];
      m3dFadeTo(() => {
        m3d.setProps({ viewMode: vm, systems: sys });
        m3dVm = vm;
        if (m3dCamMode !== "free" && m3dCamMode !== "presetHold") {
          if (cam === "sync") { m3dCamMode = "sync"; m3dAz = null; }
          else { m3dCamMode = "auto-cam"; m3d.goToPreset(cam); }
        }
      });
    }
  }
  /* The synced camera holds the model in the SAME on-map orientation as the schematic, and
   * nothing else. It used to swing a quarter-turn to the side while water was moving, on the
   * theory that the hose and the spray read better side-on; in practice sync that is sometimes
   * not sync is worse than either, because the reader cannot tell a heading change from a
   * staging decision. Removed 2026-08-09 — if a side-on view is wanted it belongs on a preset
   * the user can choose, not on a phase the ship happens to be in.
   *
   * Still rate-limited in real seconds, so a 60x simulation cannot whip the view around. */
  if ((m3dCamMode === "sync" || m3dCamMode === "syncManual") && m3d.camera) {
    const cam = m3d.camera;
    cam.elevation = 0.35;
    const h = m.dispAng || 0;
    const tgt = -Math.PI / 2 + Math.atan2(Math.sin(h) / Math.sin(cam.elevation), Math.cos(h));
    if (m3dAz === null) m3dAz = tgt;
    let d = tgt - m3dAz;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const cap = 0.5 * (S.frameDt || 0.016);        // ≤ ~29°/s of camera, whatever the sim speed
    m3dAz += Math.max(-cap, Math.min(cap, d));
    cam.azimuth = m3dAz;
    // FULL sync also owns the framing: fit the hull (and the hanging hose, when it is
    // out) to the panel with a small margin, refitting as the heading turns the ship's
    // projected length. A wheel zoom drops to syncManual — heading still follows, but the
    // user's distance is theirs until ⟳ Sync is pressed again.
    if (m3dCamMode === "sync" && m3d.model) {
      const c3 = m3d.model.cls;
      const el2 = $("m3dView");
      const aspect = Math.max(0.5, (el2.clientWidth || 16) / (el2.clientHeight || 9));
      const hoseOut = st.phase === "SOURCE_APPROACH" || st.phase === "WATER_FILL" ||
        (st.phase === "OUTBOUND_TRANSIT" && st.prog < 0.18);
      /* WHAT HANGS BELOW THE SHIP HAS TO BE IN FRAME, or the reader sees a cable leaving the
       * picture and concludes the bucket was never drawn. That was the first report back on the
       * anchor: "only a line". The hose drops 52 m; the anchor drops as far as the water, which
       * on a P-10000 is 640 m during the approach — more than half a hull length.
       *
       * Capped at 0.7 of the hull, because framing the full drop from 790 m would shrink an
       * 876 m airship to a splinter. Past the cap the cable does leave frame, which is the
       * honest reading of "the lake is a long way down" rather than a missing component. */
      const cable = c3.anchorCableM || 0;
      const anchorOut = cable > 0 && st.alt <= (cable - c3.maxRadiusM) + cable * 0.25
        && (st.phase === "SOURCE_APPROACH" || st.phase === "WATER_FILL"
          || (st.phase === "RETURN_TRANSIT" && st.prog > 0.94));
      /* THE FRAMING IS LATCHED WHILE THE ANCHOR IS OUT, and that is the whole point.
       *
       * The model is ship-centred: the hull is the origin and cannot move, so a descent can only
       * ever be shown as the WATER rising to meet it. Framing the drop continuously — fitting
       * ship-to-bag every frame — zooms in by exactly as much as the gap closes and cancels that
       * cue precisely. The ship then appears to hang at the end of a cable that never gets
       * shorter, which is what it looked like: "it stops at anchor length and doesn't continue
       * down". It was descending 790 m to 300 the whole time.
       *
       * So the span is taken once, when the cable goes out, and held until it comes back in. The
       * water then visibly climbs the frame, the bag climbs with it, and the shrinking cable is
       * legible because the frame it is drawn in stopped moving. */
      if (!anchorOut) m3dAnchorSpanM = 0;
      else if (m3dAnchorSpanM === 0) m3dAnchorSpanM = Math.min(st.alt, cable, c3.lengthM * 0.7);
      const dropM = Math.max(hoseOut ? 52 : 0, m3dAnchorSpanM);
      const halfW = Math.max(c3.maxRadiusM * 1.8,
        (c3.lengthM / 2) * Math.abs(Math.sin(cam.azimuth)) * 1.1 + c3.maxRadiusM * 0.5);
      // The elevated camera also projects the hull's LENGTH onto the vertical axis.
      const halfH = Math.max(c3.maxRadiusM * 1.7,
        (c3.lengthM / 2) * Math.abs(Math.cos(cam.azimuth)) * Math.sin(cam.elevation) * 1.15 +
        c3.maxRadiusM * 0.8) + dropM / 2;
      const tanV = Math.tan((cam.fovDeg || 32) * Math.PI / 360);
      const fitD = Math.max(halfH / tanV, halfW / (tanV * aspect)) * 1.3;
      // NEVER let the ship clip the frame: zooming OUT is instant, only zooming IN eases.
      if (fitD > cam.distance) cam.distance = fitD;
      else cam.distance += (fitD - cam.distance) * Math.min(1, (S.frameDt || 0.016) * 3);
      const tz = -dropM / 2;
      cam.target[2] += (tz - cam.target[2]) * Math.min(1, (S.frameDt || 0.016) * 6);
    }
    m3d.invalidate();
  }
}

/* The avatar grows into whatever the right column has left over: measure the column's
   slack with the base height, then hand it to the canvas. Re-run on resize and reselect. */
export function sizeAvatar() {
  const col = document.querySelector(".cp-rightcol");
  const cv = $("shipviz");
  if (!col || !cv || $("cpLeft").hidden || window.innerWidth <= 1100) return;
  cv.style.height = "150px";
  // scrollHeight clamps to clientHeight, so slack must be measured from where the content
  // actually ENDS against the bottom of the column's box.
  const last = col.lastElementChild;
  if (!last) return;
  const slack = col.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom - 10;
  if (slack > 8) cv.style.height = Math.min(430, 150 + slack) + "px";
  // The measure above can overshoot by a few px (late layout shifts). The column must
  // never scroll: give back exactly the overflow.
  const over = col.scrollHeight - col.clientHeight;
  if (over > 0) cv.style.height = Math.max(150, (parseFloat(cv.style.height) || 150) - over - 2) + "px";
}
window.addEventListener("resize", () => requestAnimationFrame(sizeAvatar));

/**
 * Change the camera's mode, and optionally its azimuth, from outside this module.
 *
 * The mode is not a preference, it is a statement about who is steering:
 *
 *   "sync"        the camera follows the ship's heading, and owns the framing
 *   "syncManual"  heading still followed, but the viewer set the distance themselves
 *   "preset"      a named viewpoint, held until the viewer resyncs
 *   "presetHold"  the same, pinned to a subsystem the viewer is inspecting
 *   "free"        the viewer is dragging
 *
 * Passing `azimuth: null` re-seeds the follow angle, so the next frame snaps to the
 * ship's current heading instead of sweeping to it from wherever the camera was left.
 */
export function setCamera({ mode, azimuth, viewMode, phase, panel } = {}) {
  if (mode !== undefined) m3dCamMode = mode;
  if (azimuth !== undefined) m3dAz = azimuth;
  if (viewMode !== undefined) m3dVm = viewMode;
  if (phase !== undefined) m3dPhase = phase;
  if (panel !== undefined) m3dMode = panel;
}

/** What the camera is doing, for the controls that light up to match it. */
export function cameraMode() {
  return m3dCamMode;
}

/** Which button in the systems row is active ("shell", "auto", "water", "custom", …). */
export function panelMode() {
  return m3dMode;
}

export function m3dBreakSync() {
  if (m3dCamMode !== "sync") return;
  m3dCamMode = "free";
  m3dAz = null;
  updSyncUI();
}

/* The ⟳ Sync control lives as the FIRST camera view button and lights pink exactly while
   the camera is heading-synced; any drag or preset un-lights it. */
export function updSyncUI() {
  document.querySelectorAll("[data-m3c]").forEach(x =>
    x.setAttribute("aria-pressed", String(x.dataset.m3c === "sync" && m3dCamMode === "sync")));
}

/* ---------- the cockpit --------------------------------------------------------------------- */
