/* The satellite heat overlay, drawn once into an offscreen canvas and composited.
 */
import { H, W, latOfY, mercY } from '../map/projection.js?v=26282d19';
import { S } from '../store.js?v=26282d19';

/* Live hotspot heat, drawn as heat: each CWFIS detection is an additive glow sprite, so
   burning ground reads as brightness — clusters saturate toward white-orange — instead of
   a lattice of icons stamped over the imagery. */
export const heatSprite = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  rg.addColorStop(0, "rgba(255,150,70,0.55)");
  rg.addColorStop(0.45, "rgba(255,110,50,0.22)");
  rg.addColorStop(1, "rgba(255,90,40,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return c;
})();

/* The glow accumulates additively OFFSCREEN, then lands on the map through a fixed-alpha
   screen blend — so dense clusters brighten the ground without ever hiding it, and the
   6,000 sprites are repainted only when the view actually moves, not every frame. */
export const heatLayer = { cv: document.createElement("canvas"), view: null, n: 0, last: 0 };

export function renderHeatLayer(k) {
  const hl = heatLayer;
  hl.cv.width = Math.ceil(W * 1.3); hl.cv.height = Math.ceil(H * 1.3);
  const g = hl.cv.getContext("2d");
  const rpx = Math.max(4.5, Math.min(34, 1.6 / (111.32 * Math.cos(latOfY(S.view.cy) * Math.PI / 180)) * k));
  g.globalCompositeOperation = "lighter";
  for (const hh of S.heat) {
    const x = (hh.ll[0] - S.view.cx) * k + hl.cv.width / 2;
    const y = (mercY(hh.ll[1]) - S.view.cy) * k + hl.cv.height / 2;
    if (x < -rpx || y < -rpx || x > hl.cv.width + rpx || y > hl.cv.height + rpx) continue;
    g.drawImage(heatSprite, x - rpx, y - rpx, rpx * 2, rpx * 2);
  }
  hl.view = { cx: S.view.cx, cy: S.view.cy, k, w: hl.cv.width, h: hl.cv.height };
  hl.n = S.heat.length;
  hl.last = performance.now();
}

/* ---------- map drawing ------------------------------------------------------------------- */
