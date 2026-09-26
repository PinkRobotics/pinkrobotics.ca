/* Drawing the map: the layer order, and every layer.
 */
import { CITIES, PHASE_TINT, bez, fmt, havKm, segAt, stateAt } from '../../sim/index.js?v=a67fca39';
import { $ } from '../dom.js?v=a67fca39';
import { TERRAIN, drawSat, terrainImg, terrainReady } from '../map/basemap.js?v=a67fca39';
import { heatLayer, renderHeatLayer } from '../map/heat.js?v=a67fca39';
import { DPR, H, W, ctx, latOfY, px } from '../map/projection.js?v=a67fca39';
import { S } from '../store.js?v=a67fca39';

export const COL = {
  bg: "#08080a", land: "#101015", coast: "#33333c",
  ooc: "#d98b80", held: "#e3a94e", uc: "#46d06e", newf: "#c9c3b6",
  water: "#7aa2c8", ship: "#ff4fa3", route: "#3a3a44", perim: "#d98b80",
};

export function statusColor(f) {
  if (f.status === "Out of Control" || f.status === "Fire of Note") return COL.ooc;
  if (f.status === "Being Held") return COL.held;
  if (f.status === "Under Control") return COL.uc;
  return COL.newf;
}

export function fireVisible(f) {
  if (S.filter === "note") return f.note;
  if (S.filter === "ooc") return f.status === "Out of Control" || f.status === "Fire of Note";
  return true;
}

export let hitShips = [], hitFires = [], hitWater = [];

export function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
  const k = S.view.k;

  // Land base first — any gap in terrain or imagery shows quiet land, never black.
  const landPath = new Path2D();
  for (const ring of S.outline) {
    for (let i = 0; i < ring.length; i++) {
      const p = px(ring[i]);
      i ? landPath.lineTo(p[0], p[1]) : landPath.moveTo(p[0], p[1]);
    }
    landPath.closePath();
  }
  ctx.fillStyle = COL.land;
  ctx.fill(landPath);

  // Terrain backdrop (mercator mosaic, so one linear drawImage places it exactly)
  const useTerrain = S.layers.terrain && terrainReady;
  if (useTerrain) {
    const tx0 = (TERRAIN.x0 - S.view.cx) * k + W / 2, ty0 = (TERRAIN.y0 - S.view.cy) * k + H / 2;
    const tx1 = (TERRAIN.x1 - S.view.cx) * k + W / 2, ty1 = (TERRAIN.y1 - S.view.cy) * k + H / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainImg, tx0, ty0, tx1 - tx0, ty1 - ty0);
  }

  // Satellite imagery over the hillshade — forest, burn scars, snow, the real place.
  if (S.layers.sat) drawSat(k);

  ctx.strokeStyle = COL.coast; ctx.lineWidth = 1; ctx.stroke(landPath);

  // Roads and cities: orientation, kept quiet.
  if (S.layers.places) {
    ctx.strokeStyle = "#565664"; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9;
    for (const rd of S.roads) {
      ctx.beginPath();
      for (let i = 0; i < rd.length; i++) { const q = px(rd[i]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.font = "10px ui-monospace,monospace";
    for (const c of CITIES) {
      if (c[3] === 2 && k < 26) continue;
      if (c[3] === 3 && k < 55) continue;
      const q = px(c);
      if (q[0] < -10 || q[1] < -10 || q[0] > W + 10 || q[1] > H + 10) continue;
      ctx.fillStyle = "#c9c3b6";
      ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
      ctx.fillStyle = "#9a9aa5";
      ctx.fillText(c[2], q[0] + 5, q[1] + 3);
    }
  }

  // Live hotspot heat (CWFIS, last 24 h): bounded-brightness glow under the vector layers.
  if (S.layers.hot && S.heat.length) {
    const hl = heatLayer, now = performance.now();
    const drift = hl.view ? Math.abs(Math.log(k / hl.view.k)) +
      Math.abs((hl.view.cx - S.view.cx) * k) / W + Math.abs((hl.view.cy - S.view.cy) * k) / H : 9;
    if ((!hl.view || hl.n !== S.heat.length || drift > 0.1) && now - hl.last > 140) renderHeatLayer(k);
    if (hl.view) {
      const sc = k / hl.view.k;
      const x0 = (hl.view.cx - S.view.cx) * k + W / 2 - hl.view.w / 2 * sc;
      const y0 = (hl.view.cy - S.view.cy) * k + H / 2 - hl.view.h / 2 * sc;
      ctx.globalAlpha = 0.6; ctx.globalCompositeOperation = "screen";
      ctx.drawImage(hl.cv, x0, y0, hl.view.w * sc, hl.view.h * sc);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    }
  }

  // Water bodies: assigned sources always; others as faint dots when zoomed or big.
  hitWater = [];
  if (S.layers.water) {
    ctx.fillStyle = COL.water;
    for (let i = 0; i < S.water.length; i++) {
      const w = S.water[i];
      // visibility tiers: sources always; everything close in; mid lakes at mid zoom
      if (!w.used && !(k > 60 || (k > 32 && w[2] >= 100) || w[2] >= 2000)) continue;
      const p = px(w);
      if (w.bb) {
        // true-extent cull: corners of the real bounding box against the viewport
        const a = px([w.bb[0], w.bb[3]]), b = px([w.bb[2], w.bb[1]]);
        if (b[0] < -40 || b[1] < -40 || a[0] > W + 40 || a[1] > H + 40) continue;
      } else {
        const rpx = Math.sqrt(w[2] * 1e4 / Math.PI) / 1000 / (111.32 * Math.cos(w[1] * Math.PI / 180)) * k * 1.6;
        if (p[0] < -20 - rpx || p[1] < -20 - rpx || p[0] > W + 20 + rpx || p[1] > H + 20 + rpx) continue;
      }
      if (w[5] && k > 30) {
        ctx.globalAlpha = 0.4; ctx.beginPath();
        for (let j = 0; j < w[5].length; j++) { const q = px(w[5][j]); j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = COL.water; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = COL.water;
      } else {
        const r = Math.max(w.used ? 2.5 : 1, Math.min(9, Math.sqrt(w[2]) * k / 4000));
        ctx.globalAlpha = w.used ? 0.9 : 0.35;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (w.used) hitWater.push({ x: p[0], y: p[1], w, i });
    }
  }

  // Perimeters
  if (S.layers.perims) {
    for (const f of S.fires) {
      if (!f.ring || !fireVisible(f)) continue;
      const rings = f.ring.allRings || [f.ring];
      ctx.beginPath();
      for (const r of rings) {
        for (let i = 0; i < r.length; i++) { const p = px(r[i]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.closePath();
      }
      ctx.fillStyle = COL.perim; ctx.globalAlpha = 0.10; ctx.fill();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = COL.perim; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Routes
  if (S.layers.routes) {
    for (const m of S.missions) {
      if (m.idle || !fireVisible(m.fire)) continue;
      const selMe = S.sel && S.sel.m === m;
      const dimCls = S.hlClass && m.cls.id !== S.hlClass ? 0.25 : 1;
      ctx.strokeStyle = selMe ? COL.ship : COL.route;
      ctx.globalAlpha = (selMe ? 0.9 : 0.55) * dimCls;
      ctx.lineWidth = selMe ? 1.4 : 1;
      ctx.setLineDash(selMe ? [] : [3, 4]);
      const co = m.curCtlOut || m.ctlOut, cr = m.curCtlRet || m.ctlRet;
      const dvA = m.curSeg ? m.curSeg[0] : (m.curDelivery || m.delivery);
      const dvB = m.curSeg ? m.curSeg[1] : dvA;
      const ika = m.curIk || m.intake, ikb = m.curIkNext || ika;
      for (const [a, c, b] of [[ika, co, dvA], [dvB, cr, ikb]]) {
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) { const p = px(bez(a, c, b, i / 20)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  // Fires
  hitFires = [];
  for (const f of S.fires) {
    const p = px(f.ll);
    if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) continue;
    const vis = fireVisible(f);
    const r = Math.max(2.5, Math.min(11, 1.5 + Math.log10(1 + f.sizeHa) * 2));
    ctx.globalAlpha = vis ? 0.9 : 0.18;
    ctx.fillStyle = statusColor(f);
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
    if (f.note && vis) {
      ctx.strokeStyle = COL.newf; ctx.lineWidth = 1.4;   // live data never wears the fleet's pink
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 3.5, 0, 7); ctx.stroke();
    }
    // A fire with no ship assigned is selectable — the top-eight table lists fires that
    // are waiting for a hull — so `S.sel.m` is legitimately null here. Reading through
    // it threw inside draw(), and because the next frame is requested after draw()
    // returns, that one click stopped the map, the clock, the instruments and the
    // energy ledger for the rest of the session.
    if (S.sel && S.sel.type === "fire" && (S.sel.f || (S.sel.m && S.sel.m.fire)) === f) {
      ctx.strokeStyle = "#eceef2"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 6, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (vis) hitFires.push({ x: p[0], y: p[1], r: r + 4, f });
    if ((S.layers.labels || k > 120) && vis) {
      ctx.fillStyle = "#74747f"; ctx.font = "10px ui-monospace,monospace";
      ctx.fillText(f.id, p[0] + r + 4, p[1] + 3);
    }
  }

  // Wind: one live arrow per mission midpoint, pointing where the air is going.
  if (S.layers.wind) {
    for (const m of S.missions) {
      if (m.idle || !m.wind || !fireVisible(m.fire)) continue;
      const mp = px([(m.intake[0] + m.delivery[0]) / 2, (m.intake[1] + m.delivery[1]) / 2]);
      if (mp[0] < -20 || mp[1] < -20 || mp[0] > W + 20 || mp[1] > H + 20) continue;
      const selMe = S.sel && S.sel.m === m;
      const toD = (m.wind.dir + 180) * Math.PI / 180;
      const ux = Math.sin(toD), uy = -Math.cos(toD);
      const ln = Math.min(30, 7 + m.wind.spd * 0.45) * (selMe ? 1.4 : 1);
      ctx.strokeStyle = ctx.fillStyle = "#c9c3b6";
      ctx.globalAlpha = selMe ? 0.95 : 0.45;
      ctx.lineWidth = selMe ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(mp[0] - ux * ln / 2, mp[1] - uy * ln / 2);
      ctx.lineTo(mp[0] + ux * ln / 2, mp[1] + uy * ln / 2);
      ctx.stroke();
      const tipX = mp[0] + ux * ln / 2, tipY = mp[1] + uy * ln / 2;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * 5 - uy * 3, tipY - uy * 5 + ux * 3);
      ctx.lineTo(tipX - ux * 5 + uy * 3, tipY - uy * 5 - ux * 3);
      ctx.closePath(); ctx.fill();
      if (selMe) {
        ctx.font = "10px ui-monospace,monospace";
        ctx.fillText(fmt(m.wind.spd) + " km/h", tipX + 6, tipY + 3);
      }
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
  }

  // Drop history: each mission's last ten simulated lines, fading with age, plus the
  // line being painted right now. Deterministic, so history survives reloads.
  for (const m of S.missions) {
    if (m.idle || !m.segs || !fireVisible(m.fire)) continue;
    const cycN = Math.floor((S.simTime + m.offset * m.cycleSec) / m.cycleSec) + 1;
    const lw = m.cls.id === "P100" ? 1.5 : m.cls.id === "P1000" ? 2 : 2.8;
    const tCyc = ((S.simTime + m.offset * m.cycleSec) % m.cycleSec + m.cycleSec) % m.cycleSec;
    const runDone = tCyc >= m.phaseEnds[3];      // this cycle's release is complete
    for (let j = Math.max(1, cycN - 10); j <= cycN; j++) {
      if (j === cycN && !runDone) continue;      // the live run paints itself under the ship
      const seg = segAt(m, j);
      if (!seg) continue;
      const a = px(seg[0]), b = px(seg[1]);
      if ((a[0] < -30 && b[0] < -30) || (a[0] > W + 30 && b[0] > W + 30)) continue;
      ctx.strokeStyle = COL.water;
      ctx.globalAlpha = (0.08 + 0.42 * (1 - (cycN - j) / 11)) * (S.hlClass && m.cls.id !== S.hlClass ? 0.25 : 1);
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  // Ships
  hitShips = [];
  for (const m of S.missions) {
    if (m.idle || !fireVisible(m.fire)) continue;
    const st = stateAt(m, S.simTime);
    const p = px(st.ll);
    if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) { m.lastSt = st; continue; }
    /* Heading. An omnidirectional ship holds its heading while station-keeping and crabs
       sideways; it does not pirouette. So the displayed heading is a persistent per-ship
       value: frozen through the hold phases, steered by movement only when a movement
       sample is trustworthy (both samples in transit, and more than a pixel of it), and
       always turned via shortest arc with exponential smoothing so phase handoffs read
       as a vehicle yawing, never as a glitch. */
    if (m.dispAng === undefined) {
      const a0 = px(m.intake), a1 = px(m.delivery);
      m.dispAng = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
    }
    // Heading comes from the SIMULATION's own bearing, which is continuous through every
    // seam by construction. The old four-second lookahead inferred direction from where the
    // ship WOULD be, so a sample landing past a shuttle turn or a phase change reported the
    // reverse of the way the hull was actually pointing — the "rotates the long way, feels
    // backwards" swing. Compass bearing -> screen angle: +x is east, +y is south.
    const target = Number.isFinite(st.bearing)
      ? Math.atan2(-Math.cos(st.bearing), Math.sin(st.bearing))
      : m.dispAng;
    let diff = target - m.dispAng;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    let step = diff * (1 - Math.exp(-3 * (S.frameDt || 0.016)));
    const maxStep = 0.55 * (S.frameDt || 0.016);   // the view of a ship turns at ship speed,
    step = Math.max(-maxStep, Math.min(maxStep, step));   // not at simulation speed
    m.dispAng += step;
    m.turnRate = (m.turnRate || 0) * 0.9 + step * 0.1;
    const ang = m.dispAng;
    const selMe = S.sel && S.sel.type === "ship" && S.sel.m === m;
    const L = (m.cls.id === "P100" ? 7 : m.cls.id === "P1000" ? 9.5 : 12.5) * (selMe ? 1.3 : 1);
    // altitude stalk: exaggerated, but proportional — a ship at cruise stands taller
    const stalk = st.alt > 5 ? Math.min(34, 3 + st.alt / 55) : 0;
    if (stalk > 2) {
      ctx.strokeStyle = "#74747f"; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] - stalk); ctx.stroke();
      ctx.fillStyle = "#000"; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(p[0], p[1], L * 0.5, L * 0.2, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    p[1] -= stalk;
    // filling: a line down to the water; releasing: an expanding pulse.
    if (st.phase === "WATER_FILL") {
      ctx.strokeStyle = COL.water; ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] + 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (st.phase === "WATER_RELEASE" && m.curSeg) {
      // Water already on the ground STAYS on the ground. Drawing from the line's head to the
      // ship made a return pass un-paint what it had just laid down; a second pass re-treats
      // the line, it does not undo it. Completed passes hold the full line and darken with
      // each one; the pass in progress draws brightest over the top.
      const a = px(m.curSeg[0]), bEnd = px(m.curSeg[1]);
      const nP = (m.plan && m.plan.passes) || 1;
      const pi = Math.floor(Math.min(nP - 1e-9, st.prog * nP));
      const stalkY = p[1] + (st.alt > 5 ? Math.min(34, 3 + st.alt / 55) : 0);
      ctx.strokeStyle = COL.water;
      ctx.lineWidth = (m.cls.id === "P100" ? 1.5 : m.cls.id === "P1000" ? 2 : 2.8) + 0.6;
      if (pi > 0) {
        ctx.globalAlpha = Math.min(0.8, 0.42 + 0.19 * pi);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bEnd[0], bEnd[1]); ctx.stroke();
      }
      const from = pi % 2 ? bEnd : a;      // the end this pass set out from
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(p[0], stalkY); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
    ctx.fillStyle = st.stopped ? "#74747f" : COL.ship;   // a dead hull goes grey where it froze
    ctx.globalAlpha = S.hlClass && m.cls.id !== S.hlClass ? 0.3 : 1;
    ctx.beginPath(); ctx.ellipse(0, 0, L, L * 0.36, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    if (st.stopped) { ctx.strokeStyle = "#d98b80"; ctx.lineWidth = 1; ctx.stroke(); }
    if (selMe) { ctx.strokeStyle = "#eceef2"; ctx.lineWidth = 1.2; ctx.stroke(); }
    ctx.restore();
    if (selMe) {
      const tag = (m.name ? m.name + " · " : "") + m.cls.name + " · " + st.label;
      ctx.font = "10.5px ui-monospace,monospace";
      const tw = ctx.measureText(tag).width;
      ctx.fillStyle = "rgba(10,10,12,.85)";
      ctx.fillRect(p[0] + L + 6, p[1] - 14, tw + 10, 17);
      ctx.fillStyle = PHASE_TINT[st.phase];
      ctx.fillText(tag, p[0] + L + 11, p[1] - 2);
    }
    hitShips.push({ x: p[0], y: p[1], m });
    m.lastSt = st;
  }

  // Selected mission: mark intake and delivery.
  if (S.sel && S.sel.m && !S.sel.m.idle) {
    const m = S.sel.m;
    for (const [pt, col] of [[m.curIk || m.intake, COL.water], [m.curDelivery || m.delivery, COL.ooc]]) {
      const p = px(pt);
      ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p[0] - 5, p[1]); ctx.lineTo(p[0] + 5, p[1]);
      ctx.moveTo(p[0], p[1] - 5); ctx.lineTo(p[0], p[1] + 5); ctx.stroke();
    }
  }
  updateScalebar();
}

export function updateScalebar() {
  const el = $("scalebar");
  const kmPerPx = havKm([S.view.cx, latOfY(S.view.cy)], [S.view.cx + 1 / S.view.k, latOfY(S.view.cy)]);
  const targets = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
  let kmv = targets.find(t => t / kmPerPx <= 120) || 1;
  el.firstChild.textContent = kmv + " km";
  el.querySelector("i").style.width = Math.round(kmv / kmPerPx) + "px";
}
