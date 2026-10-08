/* The public engineering page: live numbers and three drawn figures, all read from
 * the same committed model the viewer runs. Nothing on this page is typed — the
 * binder resolves every [data-cat] against the values assembled here, marks a miss
 * with a dash and the .miss class, and check_levels.py fails the build on either.
 *
 * The walls trio uses the front page's exact bases (tools/robotics.py tok_walls):
 * crush harsh = band.harshMid.crushT, crush best = band.frame1450.crushT,
 * sink = band.harshMid.liftSLT. Two pages disagreeing about the same wall is the
 * class of bug this project exists to make impossible.
 */
import { SHIP, WALL, GRID, ARTICLE } from '../ship/catalog.js?v=01e992e3';
import { ship0Summary } from '../ship/model.js?v=01e992e3';

const S = ship0Summary();
const WALLS = {
  crushHarshT: S.band.harshMid.crushT,
  crushBestT: S.band.frame1450.crushT,
  sinkT: S.band.harshMid.liftSLT,
  missT: SHIP.bestWorldResidualT,                     // signed: negative = too heavy
  missAbsT: Math.abs(SHIP.bestWorldResidualT),
};
const VALUES = {
  ship: SHIP, wall: WALL, grid: GRID, article: ARTICLE, walls: WALLS,
  scale: { first: S.floatWindow.curve[0], last: S.floatWindow.curve.at(-1) },
  inputs: {
    tiT: S.mid.ledgerT.tiJoints,
    filmM2: SHIP.hullM2,
  },
};

/* ---- the binder: same contract as the blueprint page ---- */
function dig(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}
for (const el of document.querySelectorAll('[data-cat]')) {
  const v = dig(VALUES, el.dataset.cat);
  if (v === undefined || v === null || Number.isNaN(+v)) {
    el.textContent = '—';
    el.classList.add('miss');
    continue;
  }
  const f = el.dataset.f !== undefined ? +el.dataset.f : 0;
  el.textContent = (+v).toLocaleString('en-US',
    { minimumFractionDigits: f, maximumFractionDigits: f });
}

/* ---- figures ---- */
const fmt0 = (v) => (+v).toLocaleString('en-US', { maximumFractionDigits: 0 });
function put(id, no, svg) {
  const fig = document.getElementById(id);
  if (!fig) return;
  fig.innerHTML = `<span class="figno">fig ${no}</span>` + svg;
}

/* fig 1 — the wall: film on hoop rings, one panel dished by the sky. */
{
  const W = 640, H = 260;
  const p = [];
  // A run of the barrel in section: rings as ticks under a film line.
  const y0 = 150, x0 = 40, x1 = 380, n = 12;
  const pitch = (x1 - x0) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pitch;
    p.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + 26}" stroke="#7aa2c8" stroke-width="3" stroke-linecap="round"/>`);
  }
  // The film: shallow scallops dished inward between ring crests.
  let d = `M ${x0} ${y0}`;
  for (let i = 0; i < n - 1; i++) {
    const xa = x0 + i * pitch, xb = xa + pitch;
    d += ` Q ${(xa + xb) / 2} ${y0 + 9} ${xb} ${y0}`;
  }
  p.push(`<path d="${d}" fill="none" stroke="#ff4fa3" stroke-width="2.2"/>`);
  // Sky arrows pressing down onto the film.
  for (const x of [90, 175, 260, 345]) {
    p.push(`<line x1="${x}" y1="${y0 - 44}" x2="${x}" y2="${y0 - 16}" stroke="#c9c3b6" stroke-opacity=".7" stroke-width="1.4"/>`);
    p.push(`<path d="M ${x - 4} ${y0 - 22} L ${x} ${y0 - 13} L ${x + 4} ${y0 - 22} Z" fill="#c9c3b6" fill-opacity=".7"/>`);
  }
  p.push(`<text x="${x0}" y="${y0 - 58}" fill="#c9c3b6" font-size="12">the sky presses the film onto the rings</text>`);
  p.push(`<text x="${x0}" y="${y0 + 56}" fill="#7aa2c8" font-size="12">hoop rings, ${WALL.ringPitchM} m apart — ${fmt0(WALL.rings)} around the barrel</text>`);
  p.push(`<text x="${x0}" y="${y0 + 76}" fill="#ff4fa3" font-size="12">one membrane, ~${fmt0(WALL.panels)} dished square panels, ${fmt0(WALL.filmGM2)} g/m²</text>`);
  // Inset: one panel in plan, curvature both ways.
  const ix = 470, iy = 60, s = 120;
  p.push(`<rect x="${ix}" y="${iy}" width="${s}" height="${s}" fill="none" stroke="#33333c"/>`);
  p.push(`<path d="M ${ix} ${iy + s / 2} Q ${ix + s / 2} ${iy + s / 2 + 16} ${ix + s} ${iy + s / 2}" fill="none" stroke="#ff4fa3" stroke-opacity=".8"/>`);
  p.push(`<path d="M ${ix + s / 2} ${iy} Q ${ix + s / 2 - 16} ${iy + s / 2} ${ix + s / 2} ${iy + s}" fill="none" stroke="#ff4fa3" stroke-opacity=".8"/>`);
  p.push(`<text x="${ix + s / 2}" y="${iy + s + 22}" fill="#9a9aa5" font-size="11" text-anchor="middle">square panel: curved both ways,</text>`);
  p.push(`<text x="${ix + s / 2}" y="${iy + s + 38}" fill="#9a9aa5" font-size="11" text-anchor="middle">half the tension of a trough</text>`);
  put('fig-wall', 1, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The wall in section: one film scalloping between evenly spaced hoop rings while the sky presses down on it, with an inset showing a single square panel curved in both directions">${p.join('')}</svg>`);
}

/* fig 2 — the two walls: the corridor a real ship must land in. */
{
  const W = 640, H = 300;
  // Mass axis, vertical: map tonnes to y. Show 150..360 t.
  const tLo = 150, tHi = 360, y0 = 250, y1 = 40;
  const yOf = (t) => y0 + (t - tLo) * (y1 - y0) / (tHi - tLo);
  const bx0 = 150, bx1 = 490;
  const p = [];
  const yl = yOf(WALLS.sinkT), ycb = yOf(WALLS.crushBestT), ych = yOf(WALLS.crushHarshT);
  // Compare greedy sizing with displaced-air mass; the interval is unchecked.
  p.push(`<rect x="${bx0}" y="${yl}" width="${bx1 - bx0}" height="${ycb - yl}" fill="#46d06e" fill-opacity="0.10"/>`);
  p.push(`<line x1="${bx0}" y1="${yl}" x2="${bx1}" y2="${yl}" stroke="#7aa2c8" stroke-width="2"/>`);
  p.push(`<text x="${bx1 + 8}" y="${yl + 4}" fill="#7aa2c8" font-size="12">${fmt0(WALLS.sinkT)} t</text>`);
  p.push(`<text x="${bx0}" y="${yl - 8}" fill="#7aa2c8" font-size="12">sea-level displaced-air mass</text>`);
  p.push(`<line x1="${bx0}" y1="${ycb}" x2="${bx1}" y2="${ycb}" stroke="#46d06e" stroke-width="2"/>`);
  p.push(`<text x="${bx1 + 8}" y="${ycb + 4}" fill="#46d06e" font-size="12">${fmt0(WALLS.crushBestT)} t</text>`);
  p.push(`<text x="${bx0}" y="${ycb + 16}" fill="#46d06e" font-size="12">greedy sizing at SF 1, favourable basis</text>`);
  p.push(`<line x1="${bx0}" y1="${ych}" x2="${bx1}" y2="${ych}" stroke="#d98b80" stroke-width="2" stroke-dasharray="7 4"/>`);
  p.push(`<text x="${bx1 + 8}" y="${ych + 4}" fill="#d98b80" font-size="12">${fmt0(WALLS.crushHarshT)} t</text>`);
  p.push(`<text x="${bx0}" y="${ych - 8}" fill="#d98b80" font-size="12">greedy sizing at SF 1, record basis</text>`);
  p.push(`<text x="${(bx0 + bx1) / 2}" y="${(yl + ycb) / 2 + 4}" fill="#46d06e" font-size="12" text-anchor="middle">unchecked mass interval</text>`);
  // Axis.
  p.push(`<line x1="${bx0 - 60}" y1="${y0}" x2="${bx0 - 60}" y2="${y1}" stroke="#33333c"/>`);
  for (const t of [150, 200, 250, 300, 350]) {
    p.push(`<line x1="${bx0 - 64}" y1="${yOf(t)}" x2="${bx0 - 56}" y2="${yOf(t)}" stroke="#74747f"/>`);
    p.push(`<text x="${bx0 - 70}" y="${yOf(t) + 4}" fill="#74747f" font-size="10" text-anchor="end">${t}</text>`);
  }
  p.push(`<text x="${bx0 - 60}" y="${y1 - 14}" fill="#74747f" font-size="10" text-anchor="middle">tonnes</text>`);
  put('fig-walls', 2, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="A mass axis compares sea-level displaced air with greedy sizing at safety factor 1 on two bases. The interval is unchecked; neither sizing result is a minimum or a design.">${p.join('')}</svg>`);
}

/* fig 3 — the gear: everything hangs outside the vacuum, lines coded by job. */
{
  const W = 640, H = 320;
  const p = [];
  const cx = 300, cy = 96, R = 58, L = R * 2 * 2;  // fineness 2 capsule, side view
  const x0 = cx - L / 2 + R, x1 = cx + L / 2 - R;
  // Hull: capsule silhouette.
  p.push(`<path d="M ${x0} ${cy - R} L ${x1} ${cy - R} A ${R} ${R} 0 0 1 ${x1} ${cy + R} L ${x0} ${cy + R} A ${R} ${R} 0 0 1 ${x0} ${cy - R} Z" fill="#111114" stroke="#7aa2c8" stroke-width="1.6"/>`);
  // Solar decking arc on top.
  p.push(`<path d="M ${x0 - 10} ${cy - R + 7} A ${R + 8} ${R + 8} 0 0 1 ${x0 + 24} ${cy - R - 7}" fill="none" stroke="#2f4a6e" stroke-width="5" stroke-linecap="round"/>`);
  p.push(`<line x1="${x0 + 24}" y1="${cy - R - 7}" x2="${x1 - 24}" y2="${cy - R - 7}" stroke="#2f4a6e" stroke-width="5" stroke-linecap="round"/>`);
  p.push(`<path d="M ${x1 - 24} ${cy - R - 7} A ${R + 8} ${R + 8} 0 0 1 ${x1 + 10} ${cy - R + 7}" fill="none" stroke="#2f4a6e" stroke-width="5" stroke-linecap="round"/>`);
  p.push(`<text x="${cx}" y="${cy - R - 18}" fill="#7aa2c8" font-size="11" text-anchor="middle">solar decking, the whole top half</text>`);
  // Rotor pods on the beam (drawn at the visible side).
  for (const px of [x0 + 18, cx, x1 - 18]) {
    p.push(`<line x1="${px}" y1="${cy + R}" x2="${px}" y2="${cy + R}" stroke="none"/>`);
    p.push(`<line x1="${px - 14}" y1="${cy}" x2="${px - 26}" y2="${cy}" stroke="#9a9aa5" stroke-width="2"/>`);
    p.push(`<ellipse cx="${px - 32}" cy="${cy}" rx="5" ry="11" fill="none" stroke="#c9c3b6" stroke-width="1.6"/>`);
  }
  p.push(`<text x="${x1 + 14}" y="${cy + 4}" fill="#9a9aa5" font-size="11">rotors on the beam — their</text>`);
  p.push(`<text x="${x1 + 14}" y="${cy + 19}" fill="#9a9aa5" font-size="11">hardest push is upward</text>`);
  // Bridle to the raft.
  const ry = cy + R + 40;
  for (const bx of [cx - 60, cx - 20, cx + 20, cx + 60]) {
    p.push(`<line x1="${bx}" y1="${cy + R - 6}" x2="${cx + (bx - cx) * 0.5} " y2="${ry}" stroke="#ff4fa3" stroke-opacity=".75" stroke-width="1.2"/>`);
  }
  // The raft with tanks.
  p.push(`<rect x="${cx - 52}" y="${ry}" width="104" height="18" rx="3" fill="none" stroke="#c9c3b6" stroke-width="1.4"/>`);
  for (const tx of [cx - 38, cx, cx + 38]) {
    p.push(`<ellipse cx="${tx}" cy="${ry + 9}" rx="14" ry="7" fill="#17171c" stroke="#7aa2c8" stroke-width="1.2"/>`);
  }
  p.push(`<text x="${cx + 66}" y="${ry + 14}" fill="#c9c3b6" font-size="11">the raft: tanks, power, the mind —</text>`);
  p.push(`<text x="${cx + 66}" y="${ry + 29}" fill="#c9c3b6" font-size="11">all outside the vacuum</text>`);
  // Working lines down from the raft: pink bucket line, blue pump pipe, sprayer.
  const wy = ry + 18, wend = 292;
  p.push(`<line x1="${cx}" y1="${wy}" x2="${cx}" y2="${wend}" stroke="#ff4fa3" stroke-width="1.8"/>`);
  p.push(`<path d="M ${cx - 9} ${wend} L ${cx + 9} ${wend} L ${cx + 6} ${wend + 13} L ${cx - 6} ${wend + 13} Z" fill="none" stroke="#ff4fa3" stroke-width="1.6"/>`);
  p.push(`<line x1="${cx - 34}" y1="${wy}" x2="${cx - 34}" y2="${wend + 6}" stroke="#5b8fc4" stroke-width="2.4"/>`);
  p.push(`<rect x="${cx - 44}" y="${wend + 6}" width="20" height="9" rx="4" fill="#17171c" stroke="#5b8fc4" stroke-width="1.4"/>`);
  p.push(`<line x1="${cx + 34}" y1="${wy}" x2="${cx + 34}" y2="${wend - 30}" stroke="#5b8fc4" stroke-width="1.4"/>`);
  p.push(`<path d="M ${cx + 30} ${wend - 30} L ${cx + 38} ${wend - 30} L ${cx + 34} ${wend - 18} Z" fill="none" stroke="#5b8fc4" stroke-width="1.2"/>`);
  // Legend.
  p.push(`<line x1="40" y1="270" x2="66" y2="270" stroke="#ff4fa3" stroke-width="2.4"/>`);
  p.push(`<text x="74" y="274" fill="#ff4fa3" font-size="12">pink carries weight</text>`);
  p.push(`<line x1="40" y1="292" x2="66" y2="292" stroke="#5b8fc4" stroke-width="2.4"/>`);
  p.push(`<text x="74" y="296" fill="#5b8fc4" font-size="12">blue carries water</text>`);
  put('fig-gear', 3, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Side elevation of the dressed ship: capsule hull with solar decking over the top, rotor pods on the beam, a raft of tanks slung under the keel on a pink bridle, a pink bucket line, a blue pump pipe and a blue sprayer feed reaching down, with the pink-carries-weight blue-carries-water legend">${p.join('')}</svg>`);
}
