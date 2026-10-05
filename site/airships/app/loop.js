/* The frame loop: advance the clock, integrate the energy ledger, redraw.
 */
import { stateAt } from '../sim/index.js?v=fc85766f';
import { updateCockpit } from './cockpit/panels.js?v=fc85766f';
import { $ } from './dom.js?v=fc85766f';
import { mercY } from './map/projection.js?v=fc85766f';
import { draw } from './map/render.js?v=fc85766f';
import { S } from './store.js?v=fc85766f';

export function frame(ts) {
  if (S.lastFrame === null) S.lastFrame = ts;
  const dt = Math.min(0.25, (ts - S.lastFrame) / 1000);
  S.lastFrame = ts; S.frameDt = dt;
  if (!S.paused) S.simTime += dt * S.speed;
  // The energy ledger, integrated in sim time for every hull: generation is solar plus
  // nitrogen recovery, everything else drains storage. There are no refills — when a
  // hull's storage reaches zero it freezes where it is (energy imports are the next
  // iteration of this demonstration).
  if (!S.paused && dt > 0) {
    const dtH = dt * S.speed / 3600;
    for (const mm of S.missions) {
      if (mm.idle) continue;
      if (mm.battE === undefined) mm.battE = mm.cls.battMWh;
      if (!mm.dead) {
        const sb = stateAt(mm, S.simTime);
        const use = Object.values(sb.draw).reduce((a, b) => a + b, 0);
        const mk = Object.values(sb.gen).reduce((a, b) => a + b, 0);
        mm.battE = Math.min(mm.cls.battMWh, mm.battE - (use - mk) * dtH);
        if (mm.battE <= 0) { mm.battE = 0; mm.dead = true; mm.deadAt = S.simTime; }
      }
      if (mm.shipId) S.battByHull[mm.shipId] = { e: mm.battE, dead: !!mm.dead, deadAt: mm.deadAt };
    }
  }
  if (S.follow && S.sel && S.sel.m && !S.sel.m.idle) {
    const st = stateAt(S.sel.m, S.simTime);
    S.view.cx = st.ll[0]; S.view.cy = mercY(st.ll[1]);
  }
  draw();
  updateCockpit();
  const hc = $("hudClock");
  const hmin = Math.floor(S.simTime / 60);
  hc.textContent = "T+" + Math.floor(hmin / 60) + "h" + String(hmin % 60).padStart(2, "0") +
    (S.paused ? " · paused" : " · " + S.speed + "×");
  requestAnimationFrame(frame);
}

/* ---------- drawer -------------------------------------------------------------------------- */
