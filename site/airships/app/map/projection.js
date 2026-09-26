/* Web Mercator, the canvas, and the one function that turns a coordinate into a pixel.
 */
import { $ } from '../dom.js?v=a67fca39';
import { draw } from '../map/render.js?v=a67fca39';
import { S } from '../store.js?v=a67fca39';

export function mercY(lat) { return -Math.asinh(Math.tan(lat * Math.PI / 180)) * 180 / Math.PI; }

export const canvas = $("map"), ctx = canvas.getContext("2d");

export let W = 0, H = 0, DPR = 1;

export function resize() {
  // Resizing a canvas CLEARS it, and the cleared frame stays up until the next rAF — that
  // one blank frame is the map "flicker" whenever anything else on the page changes size.
  // So: ignore no-op observations, and when the size really changed repaint the same frame
  // synchronously so a resized map is never blank.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (w === W && h === H && dpr === DPR) return;
  DPR = dpr; W = w; H = h;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  if (S.ready) draw();
}
new ResizeObserver(resize).observe(canvas);

export function px(ll) {
  return [ (ll[0] - S.view.cx) * S.view.k + W / 2,
           (mercY(ll[1]) - S.view.cy) * S.view.k + H / 2 ];
}

/* ---------- data ------------------------------------------------------------------------- */

export function latOfY(y) { return Math.atan(Math.sinh(-y * Math.PI / 180)) * 180 / Math.PI; }

/* ---------- interaction -------------------------------------------------------------------- */
