/* The SVG instruments: round gauges, the dual generation/consumption dial, the phase dial.
 */
import { PHASES, PHASE_TINT, fmtMin } from '../../sim/index.js?v=816a54f9';
import { SHORT } from '../dom.js?v=816a54f9';
import { S } from '../store.js?v=816a54f9';

export const SVGNS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export function polar(cx, cy, r, aDeg) {           // clockwise from 12 o'clock
  const a = aDeg * Math.PI / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/* A 240-degree gauge. Needle plus a filled arc; max can be rebound per mission.
 *
 * role="meter", not role="img": one quantity against a scale is exactly what a meter is, and
 * the reading has to be IN the accessibility tree or the dial says "ground speed" and never a
 * speed. The value is written on the element, not into a live region — a listener asks the
 * dial what it reads, the way a sighted user looks at it, and is not interrupted sixty times
 * a second to be told. */

export function makeGauge(mount, label, max, fmtFn, markFrac) {
  const w = 150, h = 116, cx = 75, cy = 62, r = 46;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, role: "meter",
    "font-family": "ui-monospace,SFMono-Regular,Menlo,monospace", "aria-label": label,
    "aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": "0",
    "aria-valuetext": fmtFn(0) });
  const p0 = polar(cx, cy, r, -120), p1 = polar(cx, cy, r, 120);
  svgEl("path", { d: `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A${r} ${r} 0 1 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`,
    fill: "none", stroke: "#232329", "stroke-width": 7, "stroke-linecap": "round" }, svg);
  const fill = svgEl("path", { d: "", fill: "none", stroke: "#7aa2c8", "stroke-width": 7,
    "stroke-linecap": "round" }, svg);
  for (let i = 0; i <= 4; i++) {
    const a = -120 + i * 60, q0 = polar(cx, cy, r + 9, a), q1 = polar(cx, cy, r + 4, a);
    svgEl("line", { x1: q0.x, y1: q0.y, x2: q1.x, y2: q1.y, stroke: "#74747f", "stroke-width": 1 }, svg);
  }
  if (markFrac !== undefined && markFrac > 0 && markFrac < 1) {
    const ma = -120 + 240 * markFrac;
    const m0 = polar(cx, cy, r + 10, ma), m1 = polar(cx, cy, r - 2, ma);
    svgEl("line", { x1: m0.x, y1: m0.y, x2: m1.x, y2: m1.y, stroke: "#c9c3b6",
      "stroke-width": 1.4, "stroke-dasharray": "2 2" }, svg);
  }
  const needle = svgEl("line", { x1: cx, y1: cy + 7, x2: cx, y2: cy - r + 9,
    stroke: "#eceef2", "stroke-width": 1.6 }, svg);
  svgEl("circle", { cx, cy, r: 2.5, fill: "#eceef2" }, svg);
  const val = svgEl("text", { x: cx, y: cy + 28, "text-anchor": "middle", fill: "#eceef2",
    "font-size": 12.5, "font-weight": 600 }, svg);
  const lab = svgEl("text", { x: cx, y: h - 5, "text-anchor": "middle", fill: "#74747f",
    "font-size": 8.5, "letter-spacing": "1.2" }, svg);
  lab.textContent = label.toUpperCase();
  const wrap = document.createElement("div");
  wrap.appendChild(svg); mount.appendChild(wrap);
  let curMax = max, disp = null, lastTxt = null;
  return {
    set(v, newMax) {
      if (newMax !== undefined && Math.max(newMax, 1e-6) !== curMax) {
        curMax = Math.max(newMax, 1e-6);
        svg.setAttribute("aria-valuemax", String(curMax));
      }
      // glide toward the target — phase boundaries move loads in steps, needles shouldn't.
      // Under prefers-reduced-motion there is no glide: the needle is where the number is.
      if (disp === null || S.reduced) disp = v;
      else disp += (v - disp) * Math.min(1, (S.frameDt || 0.016) * 4);
      const f = Math.max(0, Math.min(1, disp / curMax));
      // clamp the sweep away from its endpoints: a zero-length or full-circle arc is how
      // SVG renders the occasional degenerate bulge
      const a = Math.max(-119.7, Math.min(119.7, -120 + 240 * f));
      needle.setAttribute("transform", `rotate(${a.toFixed(2)} ${cx} ${cy})`);
      if (f < 0.012) fill.setAttribute("d", "");
      else {
        const pe = polar(cx, cy, r, a);
        fill.setAttribute("d", `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 ${a > 60.3 ? 1 : 0} 1 ${pe.x.toFixed(2)} ${pe.y.toFixed(2)}`);
      }
      // The printed reading and the accessible reading are the same string, and both are
      // written only when that string changes: a needle moving every frame must not churn
      // the accessibility tree.
      const txt = fmtFn(disp);
      if (txt !== lastTxt) {
        lastTxt = txt;
        val.textContent = txt;
        svg.setAttribute("aria-valuenow", String(Math.round(disp * 1000) / 1000));
        svg.setAttribute("aria-valuetext", txt);
      }
    },
  };
}

/* Two quantities on one face: generation (green) and consumption (red), same scale, so the
   gap between the needles IS the deficit. Same footprint as makeGauge — the second label
   simply stacks under the first.

   This one stays role="img" where the single gauges became meters: a meter carries one value,
   and splitting this face into two meters would report the two numbers and lose the only thing
   the face exists to show, which is the distance between them. So the image's accessible NAME
   is the whole reading, deficit included, and it is rewritten whenever the reading changes. */
export function makeDualGauge(mount, labelA, labelB, max, fmtFn, unit = "") {
  const w = 150, h = 116, cx = 75, cy = 62, r = 46;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, role: "img",
    "font-family": "ui-monospace,SFMono-Regular,Menlo,monospace", "aria-label": labelA + " and " + labelB });
  const p0 = polar(cx, cy, r, -120), p1 = polar(cx, cy, r, 120);
  svgEl("path", { d: `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A${r} ${r} 0 1 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`,
    fill: "none", stroke: "#232329", "stroke-width": 7, "stroke-linecap": "round" }, svg);
  const mk = (col, rr) => svgEl("path", { d: "", fill: "none", stroke: col, "stroke-width": 3,
    "stroke-linecap": "round" }, svg);
  const arcA = mk("#46d06e", r + 2), arcB = mk("#d98b80", r - 4);
  for (let i = 0; i <= 4; i++) {
    const a = -120 + i * 60, q0 = polar(cx, cy, r + 9, a), q1 = polar(cx, cy, r + 4, a);
    svgEl("line", { x1: q0.x, y1: q0.y, x2: q1.x, y2: q1.y, stroke: "#74747f", "stroke-width": 1 }, svg);
  }
  const nA = svgEl("line", { x1: cx, y1: cy + 7, x2: cx, y2: cy - r + 9,
    stroke: "#46d06e", "stroke-width": 1.6 }, svg);
  const nB = svgEl("line", { x1: cx, y1: cy + 7, x2: cx, y2: cy - r + 13,
    stroke: "#d98b80", "stroke-width": 1.6 }, svg);
  svgEl("circle", { cx, cy, r: 2.5, fill: "#eceef2" }, svg);
  const val = svgEl("text", { x: cx, y: cy + 28, "text-anchor": "middle", fill: "#eceef2",
    "font-size": 11.5, "font-weight": 600 }, svg);
  const labA = svgEl("text", { x: cx, y: h - 13, "text-anchor": "middle", fill: "#46d06e",
    "font-size": 8.5, "letter-spacing": "1.2" }, svg);
  labA.textContent = labelA.toUpperCase();
  const labB = svgEl("text", { x: cx, y: h - 4, "text-anchor": "middle", fill: "#d98b80",
    "font-size": 8.5, "letter-spacing": "1.2" }, svg);
  labB.textContent = labelB.toUpperCase();
  const wrap = document.createElement("div");
  wrap.appendChild(svg); mount.appendChild(wrap);
  const curMax = Math.max(max, 1e-6);
  let dA = null, dB = null, lastTxt = null;
  const setArc = (arc, needle, disp, rr) => {
    const f = Math.max(0, Math.min(1, disp / curMax));
    const a = Math.max(-119.7, Math.min(119.7, -120 + 240 * f));
    needle.setAttribute("transform", `rotate(${a.toFixed(2)} ${cx} ${cy})`);
    if (f < 0.012) { arc.setAttribute("d", ""); return; }
    const q0 = polar(cx, cy, rr, -120), pe = polar(cx, cy, rr, a);
    arc.setAttribute("d", `M${q0.x.toFixed(2)} ${q0.y.toFixed(2)} A${rr} ${rr} 0 ${a > 60.3 ? 1 : 0} 1 ${pe.x.toFixed(2)} ${pe.y.toFixed(2)}`);
  };
  return {
    set(genV, useV) {
      const k = S.reduced ? 1 : Math.min(1, (S.frameDt || 0.016) * 4);
      dA = dA === null ? genV : dA + (genV - dA) * k;
      dB = dB === null ? useV : dB + (useV - dB) * k;
      setArc(arcA, nA, dA, r + 2);
      setArc(arcB, nB, dB, r - 4);
      const txt = fmtFn(dA) + " / " + fmtFn(dB);
      if (txt !== lastTxt) {
        lastTxt = txt;
        val.textContent = txt;
        // The face prints bare numbers because both labels are already on it; the accessible
        // name has to carry the unit, which is why `unit` exists at all.
        const net = dA - dB, u = unit ? " " + unit : "";
        svg.setAttribute("aria-label",
          `${labelA} ${fmtFn(dA)}${u}, ${labelB} ${fmtFn(dB)}${u} — ` +
          (net < 0 ? `deficit ${fmtFn(-net)}${u}` : `surplus ${fmtFn(net)}${u}`));
      }
    },
  };
}

/* The phase dial: the whole mission cycle as one 360-degree face. Segments are the phases,
   sized by their share of the cycle; the needle is the ship, sweeping through them — a
   state transition is the needle crossing a boundary, visibly. */
export function makePhaseDial(mount, m) {
  mount.innerHTML = "";
  const w = 260, h = 240, cx = 130, cy = 126, r = 102;
  // viewBox starts at y=8: the needle tip reaches y=13, so everything above is dead air
  // the right column cannot afford.
  // role="img" rather than meter: the reading is a state plus how far through it the ship is,
  // which is two facts and a name, not a point on one scale. The name is rewritten as the
  // needle moves — see set() — so asking the dial what it says returns the current answer.
  const svg = svgEl("svg", { viewBox: `0 8 ${w} ${h - 8}`, role: "img",
    "font-family": "ui-monospace,SFMono-Regular,Menlo,monospace",
    "aria-label": "Mission phase dial: the needle sweeps once per cycle through segments sized by phase duration" });
  const segs = [];
  let acc = 0;
  PHASES.forEach(([id], i) => {
    const frac = m.plan.dur[id] * 60 / m.cycleSec;
    const gap = Math.min(0.8, frac * 120);
    const aS = 360 * acc + gap, aE = 360 * (acc + frac) - gap;
    const q0 = polar(cx, cy, r, aS), q1 = polar(cx, cy, r, Math.max(aS + 0.2, aE));
    segs.push(svgEl("path", { d: `M${q0.x.toFixed(1)} ${q0.y.toFixed(1)} A${r} ${r} 0 ${aE - aS > 180 ? 1 : 0} 1 ${q1.x.toFixed(1)} ${q1.y.toFixed(1)}`,
      fill: "none", stroke: PHASE_TINT[id], "stroke-width": 13, "stroke-opacity": 0.38 }, svg));
    acc += frac;
  });
  const needle = svgEl("line", { x1: cx, y1: cy - r - 11, x2: cx, y2: cy - r + 12,
    stroke: "#eceef2", "stroke-width": 2 }, svg);
  // Larger in-dial type: this dial is the cockpit's centrepiece and its text was the
  // smallest thing on the page. The CYCLE TIME is a headline metric, not a footnote —
  // it gets its own bright line inside the face.
  const tPhase = svgEl("text", { x: cx, y: cy - 16, "text-anchor": "middle",
    "font-size": 17, "font-weight": 600, fill: "#eceef2" }, svg);
  const tSub = svgEl("text", { x: cx, y: cy + 6, "text-anchor": "middle",
    "font-size": 11.5, fill: "#9a9aa5" }, svg);
  const tCyc = svgEl("text", { x: cx, y: cy + 24, "text-anchor": "middle",
    "font-size": 10.5, fill: "#74747f" }, svg);
  const tBot = svgEl("text", { x: cx, y: cy + 48, "text-anchor": "middle",
    "font-size": 13, "font-weight": 600, fill: "#c9c3b6", "letter-spacing": "1.4" }, svg);
  tBot.textContent = (fmtMin(m.plan.cycleMin) + " / CYCLE").toUpperCase();
  mount.appendChild(svg);
  let lastIdx = -1, lastSub = null, lastCyc = null;
  return {
    set(st) {
      needle.setAttribute("transform", `rotate(${(360 * st.cyclePos / m.cycleSec).toFixed(2)} ${cx} ${cy})`);
      if (st.idx !== lastIdx) {
        segs.forEach((sg, i) => sg.setAttribute("stroke-opacity", i === st.idx ? 1 : 0.38));
        tPhase.setAttribute("fill", PHASE_TINT[st.phase]);
        tPhase.textContent = SHORT[st.phase];
        lastIdx = st.idx;
      }
      const sub = Math.round(st.prog * 100) + "% · " + fmtMin((1 - st.prog) * m.plan.dur[st.phase]) + " left";
      const cyc = st.sub ? "+ " + st.sub : "cycle #" + st.cycleN;
      if (sub === lastSub && cyc === lastCyc) return;
      lastSub = sub; lastCyc = cyc;
      tSub.textContent = sub;
      tCyc.textContent = cyc;
      svg.setAttribute("aria-label",
        `Mission phase: ${SHORT[st.phase]}, ${Math.round(st.prog * 100)}% through it, ` +
        `${fmtMin((1 - st.prog) * m.plan.dur[st.phase])} left, ` +
        `${st.sub ? "sub-phase " + st.sub : "cycle " + st.cycleN}. ` +
        `One sweep of the needle is one ${fmtMin(m.plan.cycleMin)} cycle.`);
    },
  };
}

/* ---------- the ship, in three dimensions -------------------------------------------------- */
