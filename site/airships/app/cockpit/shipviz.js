/* The 2D schematic avatar — the same state as the 3D model, drawn as a wire diagram.
 *
 * It exists because a wireframe with labelled force arrows says things a rendered
 * vehicle cannot: which way the rotors are pushing, and how hard.
 */
import { fmt } from '../../sim/index.js?v=26282d19';
import { anchorView } from '../anchorview.js?v=26282d19';
import { $ } from '../dom.js?v=26282d19';
import { resize } from '../map/projection.js?v=26282d19';
import { draw } from '../map/render.js?v=26282d19';
import { S } from '../store.js?v=26282d19';

/* A wireframe prolate hull with rotors and fins, rotating continuously and wearing its live
   force vectors. It draws on a 2D canvas and shares nothing with the WebGL model in the panel
   below it: both are driven from the same stateAt() output, and either can be removed without
   touching the other. */
export const shipViz = (() => {
  const cv = $("shipviz");
  if (!cv) return { draw() {} };
  const c2 = cv.getContext("2d");
  let w = 0, h = 0, dpr = 1, theta = 0.7, pitch = 0, dragX = null, snapNext = false;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
  }
  new ResizeObserver(resize).observe(cv);
  cv.addEventListener("pointerdown", e => { dragX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", e => {
    if (dragX !== null) { theta += (e.clientX - dragX) * 0.012; dragX = e.clientX; }
  });
  cv.addEventListener("pointerup", () => { dragX = null; });
  // Unit hull: THE CAPSULE at fineness 2 (2026-08-13) — cylinder between two
  // hemispheres, x in [-1, 1], radius 0.5. The 4:1 prolate cigar this avatar
  // wore is retired everywhere the site speaks; so are its tail fins, which
  // the exterior doctrine never allowed to cut the wall in the first place.
  const B = 0.5, rings = [], longs = [];
  const capR = (x) => {
    const ax = Math.abs(x);
    return ax <= 0.5 ? B : Math.sqrt(Math.max(1e-6, B * B - (ax - 0.5) ** 2));
  };
  for (const x of [-0.9, -0.62, -0.31, 0, 0.31, 0.62, 0.9]) {
    const r = capR(x), ring = [];
    for (let j = 0; j <= 28; j++) {
      const a = 2 * Math.PI * j / 28;
      ring.push([x, r * Math.cos(a), r * Math.sin(a)]);
    }
    rings.push(ring);
  }
  for (let k = 0; k < 8; k++) {
    const a = 2 * Math.PI * k / 8, ln = [];
    for (let j = 0; j <= 24; j++) {
      const x = -1 + 2 * j / 24, r = capR(x);
      ln.push([x, r * Math.cos(a), r * Math.sin(a)]);
    }
    longs.push(ln);
  }
  /* Rotors per class: 4 / 6 / 14, paired port and starboard along the hull, ON THE
     HORIZONTAL PLANE (operator ruling, 08-13): the hardest duty is holddown, and
     holddown's WASH GOES UP — a keel pod would fountain its hardest wash straight
     into the belly, and the ships push both ways. The P-10000's network stays on
     the horizontal line as well: four stations at normal reach, three interleaved
     on extra-long posts standing wider — separated by radius, never by height.
     Station x's follow the 3D layout's t stations (x = 1 - 2t). */
  const rotorCache = {};
  function rotorsFor(cls) {
    if (rotorCache[cls.id]) return rotorCache[cls.id];
    const spec = {
      P100: { xs: [0.40, -0.24], r: 0.18 },
      P1000: { xs: [0.52, 0.08, -0.36], r: 0.15 },
      P10000: { xs: [0.68, 0.46, 0.24, 0.02, -0.20, -0.42, -0.64], r: 0.165, tiers: true },
    }[cls.id] || { xs: [0.40, -0.24], r: 0.18 };
    const out = [];
    spec.xs.forEach((x0, i) => {
      const yh = capR(x0);
      // Everything on the horizontal line (operator revision, 08-13 late).
      // Tiered classes interleave: four stations at normal reach, three on
      // extra-long posts standing wider — radius separates them, not height.
      const widen = spec.tiers && i % 2 === 1 ? spec.r * 3 : 0;
      const yc = yh + spec.r + 0.05 + widen;
      for (const sgn of [1, -1]) {
        const y0 = sgn * yc;
        const z0 = -0.03;
        const disc = [];
        for (let j = 0; j <= 18; j++) {
          const a = 2 * Math.PI * j / 18;
          disc.push([x0 + spec.r * Math.cos(a), y0 + spec.r * Math.sin(a), z0]);
        }
        out.push({ x0, y0, z0, disc,
          pylon: [[x0, sgn * yh * 0.95, -0.02], [x0, y0, z0]] });
      }
    });
    rotorCache[cls.id] = out;
    return out;
  }
  function proj(pt, sc, cx, cy) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = pt[0] * cp + pt[2] * sp, z1 = -pt[0] * sp + pt[2] * cp, y1 = pt[1];
    const ct = Math.cos(theta), st2 = Math.sin(theta);
    const X = x1 * ct - y1 * st2, Y = x1 * st2 + y1 * ct;
    return { x: cx + sc * X, y: cy - sc * (z1 * 0.94 - Y * 0.34), d: Y };
  }
  function line3(a, b, sc, cx, cy, col, alpha) {
    const p = proj(a, sc, cx, cy), q = proj(b, sc, cx, cy);
    const dn = ((p.d + q.d) / 2 + 1) / 2;
    c2.strokeStyle = col;
    c2.globalAlpha = alpha * (0.3 + 0.7 * Math.max(0, Math.min(1, dn)));
    c2.beginPath(); c2.moveTo(p.x, p.y); c2.lineTo(q.x, q.y); c2.stroke();
    c2.globalAlpha = 1;
  }
  function poly3(pts, sc, cx, cy, col, alpha) {
    for (let i = 0; i < pts.length - 1; i++) line3(pts[i], pts[i + 1], sc, cx, cy, col, alpha);
  }
  /* An arrow between two MODEL-SPACE points. The head is built from the PROJECTED direction
     of the shaft, so it points where the shaft points at any view rotation — the old
     fixed-wing head assumed a vertical shaft and came apart the moment the avatar was
     dragged or an arrow tilted with its rotor. */
  function arrow(p0, p1, sc, cx, cy, col, label) {
    const a = proj(p0, sc, cx, cy), b = proj(p1, sc, cx, cy);
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 2) return;
    const ux = dx / L, uy = dy / L;                 // shaft direction on screen
    c2.strokeStyle = col; c2.fillStyle = col; c2.lineWidth = 1.8;
    c2.beginPath(); c2.moveTo(a.x, a.y); c2.lineTo(b.x - ux * 5, b.y - uy * 5); c2.stroke();
    c2.beginPath(); c2.moveTo(b.x, b.y);
    c2.lineTo(b.x - 7 * ux - 4 * uy, b.y - 7 * uy + 4 * ux);
    c2.lineTo(b.x - 7 * ux + 4 * uy, b.y - 7 * uy - 4 * ux);
    c2.closePath(); c2.fill();
    if (label) {
      c2.font = "9.5px ui-monospace,monospace";
      c2.fillText(label, b.x + 7, b.y + (uy > 0 ? 9 : -3));
    }
    c2.lineWidth = 1;
  }
  function draw(st, m) {
    if (cv.clientWidth !== w || cv.clientHeight !== h) resize();
    if (!w || !h) return;
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.clearRect(0, 0, w, h);
    if (dragX === null) {
      // yaw follows the ship's real on-map heading (drag to inspect; it eases back)
      const hdg = m && m.dispAng !== undefined ? m.dispAng : 0;
      const tTh = Math.atan2(Math.sin(hdg) / 0.34, Math.cos(hdg));
      let dd = tTh - theta;
      while (dd > Math.PI) dd -= 2 * Math.PI;
      while (dd < -Math.PI) dd += 2 * Math.PI;
      // The turn-rate ease is for a SHIP turning; switching to a different ship snaps.
      theta += (snapNext || S.reduced) ? dd : dd * Math.min(1, 2.2 * (S.frameDt || 0.016));
      snapNext = false;
    }
    let pt = { BUOYANCY_ESCAPE: 0.18, WATER_RELEASE: -0.04, SOURCE_APPROACH: -0.06 }[st.phase] || 0;
    if (st.phase === "OUTBOUND_TRANSIT" && st.prog < 0.25) pt = 0.12;
    pitch += (pt - pitch) * Math.min(1, 2.5 * (S.frameDt || 0.016));
    const sc = Math.min(w / 2.7, h / 1.85), cx = w / 2, cy = h * 0.5;
    for (const r of rings) poly3(r, sc, cx, cy, "#47637d", 0.75);
    for (const l of longs) poly3(l, sc, cx, cy, "#47637d", 0.55);
    poly3(longs[2], sc, cx, cy, "#c9c3b6", 0.8);                       // solar spine
    // rotor push: down while forcing descent or holding against surplus during the fill
    /* Rotors do all of it: hold-down, climb assist, and forward thrust. Discs TILT for
       cruise (more while spooling up, backward while braking), differentially when the
       ship is steering — outer rotors work harder — and wear unlabelled push arrows;
       the words live in the corner block where they can't cover the airframe. */
    // SAME DUTY THE 3D MODEL USES (st.vert, <= 0). The rotors only ever hold this hull DOWN,
    // and while that job dominates the discs stay level and the thrust is straight down —
    // exactly what the model shows. Only when the hold goes quiet do they rake for cruise.
    const rotF = Math.min(1, Math.abs(st.vert || 0));
    const fwd = Math.min(1, (st.draw.prop || 0) / Math.max(0.1, m.plan.dragMW));
    const vertical = rotF > 0.1;
    const baseTilt = vertical ? 0 : fwd * 0.55 + (st.acc > 0 ? 0.22 : st.acc < 0 ? -0.34 : 0);
    const turn = Math.max(-0.3, Math.min(0.3, (m.turnRate || 0) * 10));
    const rts = rotorsFor(m.cls);
    for (const rt of rts) {
      const tilt = baseTilt + turn * Math.sign(rt.y0);
      const ct = Math.cos(tilt), stt = Math.sin(tilt);
      const disc = rt.disc.map(q => {
        const dx2 = q[0] - rt.x0, dz2 = q[2] - rt.z0;
        return [rt.x0 + dx2 * ct + dz2 * stt, q[1], rt.z0 - dx2 * stt + dz2 * ct];
      });
      poly3(rt.pylon, sc, cx, cy, "#ff4fa3", 0.9);
      poly3(disc, sc, cx, cy, "#ff4fa3", rotF > 0.03 || fwd > 0.15 ? 1 : 0.55);
      // Push arrows ride the DISC NORMAL, so they tilt with the rotor: straight down while
      // holding, straight up on climb assist, raked forward in cruise. One rule — the arrow
      // runs along the thrust axis into the disc.
      const nv = [stt, 0, ct];                                    // tilted disc normal
      const ctr = [rt.x0, rt.y0, rt.z0];
      const along = (m2) => [ctr[0] + nv[0] * m2, ctr[1], ctr[2] + nv[2] * m2];
      if (rotF > 0.03)                                            // pushing the ship DOWN
        arrow(along(0.13 + 0.28 * rotF), along(0.02), sc, cx, cy, "#ff4fa3", "");
      else if (!vertical && fwd > 0.15) {                         // cruise thrust, along +normal
        const mag = fwd * 0.8;
        arrow(along(-(0.13 + 0.24 * mag)), along(-0.02), sc, cx, cy, "#ff4fa3", "");
      }
    }
    // forces: buoyancy up, weight down, rotor downforce, net — lengths against buoyancy
    const base = st.buoyN || 1;
    arrow([-0.55, 0, 0.30], [-0.55, 0, 0.72], sc, cx, cy, "#7aa2c8", "");
    arrow([-0.18, 0, -0.30], [-0.18, 0, -0.30 - 0.42 * st.weightN / base], sc, cx, cy, "#74747f", "");
    const net = st.netN / base;
    if (Math.abs(net) > 0.004)
      arrow([0.2, 0, net > 0 ? 0.3 : -0.3], [0.2, 0, (net > 0 ? 0.3 : -0.3) + 0.42 * net], sc, cx, cy,
        net > 0 ? "#46d06e" : "#d98b80", "");

    /* THE WATER, so that "dips into it" is a thing the picture can show.
     *
     * One line, at the depth the fully-paid-out hose reaches, drawn only when something is
     * actually reaching for it. The 3D view draws a translucent disc for the same reason: a pod
     * and a several-thousand-tonne bag crossing a surface is the whole story of the source, and
     * without the surface they are objects dangling in blank space. Not terrain — the map has
     * terrain, and the map is the wrong instrument for this. */
    const WATER_Z = 0.62;
    const overWater = st.phase === "SOURCE_APPROACH" || st.phase === "WATER_FILL"
      || (st.phase === "RETURN_TRANSIT" && st.prog > 0.62)
      || (st.phase === "OUTBOUND_TRANSIT" && st.prog < 0.18);
    if (overWater) {
      const wl = proj([0, 0, -B - WATER_Z], sc, cx, cy);
      const half = 1.05 * sc;
      c2.strokeStyle = "rgba(122,162,200,.34)"; c2.lineWidth = 1.4;
      c2.beginPath(); c2.moveTo(wl.x - half, wl.y); c2.lineTo(wl.x + half, wl.y); c2.stroke();
      c2.lineWidth = 1;
    }

    /* THE DESCENT ANCHOR — drawn BEFORE the hose so the hose reads in front of it.
     *
     * Same sequence the 3D shows and driven off the same two numbers, because an avatar that
     * disagrees with the model is worse than an avatar that shows nothing. The cable goes out
     * late on the return leg, the bag dips, fills, is winched clear, and is dumped once the
     * tanks hold more than the descent needed. The circle is drawn to the bag's real radius
     * scaled by the cube root of its fill — it is a volume, and the eye reads the radius. */
    const bagCapT = m.cls.anchorBagT || 0;
    if (bagCapT > 0) {
      const fullF = Math.min(1, (m.plan ? m.plan.anchorT : 0) / bagCapT);
      // One rule, shared with the 3D model — see app/anchorview.js for why it is a copy and
      // tests/cases/anchor-parity.cases.js for what stops the two drifting apart again.
      const { cableP, fillF } = anchorView(m.cls, st.alt, st.phase, st.prog, fullF, st.gs);
      if (cableP > 0.02) {
        // The bag hangs at the surface while it fills and just clear of it once it is full.
        const lift = 0.055 * Math.max(0, Math.min(1, (fillF / Math.max(0.01, fullF) - 0.8) / 0.2));
        const drop = WATER_Z * cableP - lift;
        const a0 = proj([0.1, 0, -B], sc, cx, cy);
        const b0 = proj([0.1, 0, -B - drop], sc, cx, cy);
        c2.strokeStyle = "#b9bec8"; c2.lineWidth = 1.1;
        c2.beginPath(); c2.moveTo(a0.x, a0.y); c2.lineTo(b0.x, b0.y); c2.stroke();
        const rr = 3.5 + 9 * Math.cbrt(Math.max(0.02, fillF / Math.max(0.01, fullF)));
        c2.fillStyle = "rgba(122,162,200,.55)";
        c2.strokeStyle = "#7aa2c8"; c2.lineWidth = 1;
        c2.beginPath(); c2.ellipse(b0.x, b0.y, rr, rr * 0.92, 0, 0, 7); c2.fill(); c2.stroke();
      }
    }

    // the hose: pays out on approach, stands taut while pumping, winds up on departure
    let hoseP = 0, pumping = false;
    if (st.phase === "SOURCE_APPROACH") hoseP = st.prog;
    else if (st.phase === "WATER_FILL") { hoseP = 1; pumping = true; }
    else if (st.phase === "OUTBOUND_TRANSIT" && st.prog < 0.18) hoseP = 1 - st.prog / 0.18;
    if (hoseP > 0.02) {
      const a = proj([0, 0, -B], sc, cx, cy);
      const b = proj([0, 0, -B - WATER_Z * hoseP], sc, cx, cy);
      c2.strokeStyle = "#7aa2c8"; c2.lineWidth = 1.4;
      c2.setLineDash([4, 4]);
      c2.lineDashOffset = pumping && !S.reduced
        ? -(((performance.now() / 55) * Math.max(1, S.speed * 0.6)) % 8) : 0;
      c2.beginPath(); c2.moveTo(a.x, a.y); c2.lineTo(b.x, b.y); c2.stroke();
      c2.setLineDash([]); c2.lineWidth = 1;
      c2.fillStyle = "#7aa2c8";
      c2.beginPath(); c2.ellipse(b.x, b.y, 4.5, 2.8, 0, 0, 7); c2.fill();
      if (pumping) {
        c2.strokeStyle = "rgba(122,162,200,.5)";
        c2.beginPath(); c2.moveTo(b.x - 9, b.y + 5); c2.quadraticCurveTo(b.x, b.y + 8, b.x + 9, b.y + 5); c2.stroke();
      }
    }

    // the drop: water falling from the keel outlets along the run, thinning as the last
    // tonnes leave — the counterpart of the fill hose, flowing the other way
    const relLeftT = st.water - (m.plan ? m.plan.retainedT : 0);   // retained ballast stays aboard
    if (st.phase === "WATER_RELEASE" && relLeftT > 0.5) {
      const tailF = Math.min(1, (relLeftT / Math.max(1, m.plan ? m.plan.deliveredT : 1)) * 6);
      const off = -(((performance.now() / 42) * Math.max(1, S.speed * 0.6)) % 9);
      c2.setLineDash([5, 4]);
      c2.lineWidth = 2.2;
      const jets = [[-0.26, -0.08], [0, 0.04], [0.26, 0.16]];   // [keel x, downwind drift]
      for (let k = 0; k < jets.length; k++) {
        const [jx, drift] = jets[k];
        const a = proj([jx, 0, -B], sc, cx, cy);
        const bpt = proj([jx + drift, 0, -B - (0.38 + 0.1 * (k % 2)) * tailF], sc, cx, cy);
        c2.strokeStyle = `rgba(122,162,200,${0.75 * tailF})`;
        c2.lineDashOffset = off + k * 3;
        c2.beginPath(); c2.moveTo(a.x, a.y); c2.lineTo(bpt.x, bpt.y); c2.stroke();
      }
      c2.setLineDash([]); c2.lineWidth = 1;
    }

    // labels live in fixed corners — off the airframe, off each other
    c2.font = "9.5px ui-monospace,monospace";
    const tf2 = 1000 * 9.81;
    c2.fillStyle = "#7aa2c8";
    // Same sign convention as the panel: down positive, so lift is the negative number.
    c2.fillText("buoyancy −" + fmt(st.buoyN / tf2) + " t", 8, 14);
    c2.fillStyle = st.netN > 0 ? "#46d06e" : "#d98b80";
    c2.fillText("net " + (st.netN > 0 ? "−" : "+") + fmt(Math.abs(st.netN) / tf2) + " t", 8, 27);
    c2.fillStyle = "#74747f";
    c2.fillText("mass " + fmt(st.weightN / tf2) + " t · " + fmt(st.water) + " t aboard", 8, h - 22);
    // The word matches the picture: the arrow is down whenever there is a hold, so the label
    // says what that hold is FOR, and only says "thrust" when the discs are actually raked.
    let rlab;
    if (rotF > 0.03) {
      const mw = (st.draw.rotors || 0).toFixed(1) + " MW";
      rlab = st.phase === "RETURN_TRANSIT" && st.prog > 0.72 ? "rotors · descent ↓ " + mw
        : st.phase === "BUOYANCY_ESCAPE" && st.prog < 0.28 ? "rotors · feathering — buoyancy has it"
        : "rotors · holding ↓ " + mw;
    } else if (!vertical && fwd > 0.15) {
      rlab = "rotors · cruise thrust →" + (st.acc > 0 ? " · spooling up" : st.acc < 0 ? " · braking" : "") +
        (Math.abs(turn) > 0.06 ? " · steering" : "");
    } else rlab = "rotors · feathered";
    c2.fillStyle = "#ff4fa3";
    const rw = c2.measureText(rlab).width;
    // Its own line above the weight row: in the narrow side column the top row belongs to
    // buoyancy alone, and the two labels collided mid-canvas. A long label pins to the left
    // edge and loses its tail instead of losing its head.
    c2.fillText(rlab, Math.max(8, w - rw - 8), h - 36);
    c2.fillStyle = "#74747f";
    c2.fillText(m.cls.name + " · " + fmt(m.cls.lenM) + " m · schematic, not the design"
      + (m.cls.id === "P100" ? "" : " · outside the 96 m envelope"), 8, h - 8);
  }
  return { draw, snap() { snapNext = true; } };
})();

/* ---------- the full model (airship3d) ------------------------------------------------------ */
