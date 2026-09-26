/* The terrain image and the satellite tiles underneath everything else.
 */
import { H, W, ctx } from '../map/projection.js?v=a67fca39';
import { S } from '../store.js?v=a67fca39';

/* Terrain backdrop: dark hillshade built offline from AWS/Mapzen Terrain Tiles (z7 mercator
   mosaic, tools/airships_terrain.py). Its bounds are linear in the page's world coordinates. */
export const TERRAIN = { src: "data/terrain-bc.jpg", x0: -140.625, x1: -112.5, y0: -78.75, y1: -53.4375 };

export const terrainImg = new Image();

export let terrainReady = false;
terrainImg.onload = () => { terrainReady = true; };
terrainImg.src = TERRAIN.src;

/* Cities: orientation anchors. [lon, lat, name, tier] — tier 1 always labelled,
   tier 2 from mid zoom, tier 3 close in. */

/* Satellite basemap: Esri World Imagery tiles, cached, drawn under everything and toned
   down to the page's mood. The canvas is never read back, so cross-origin tiles are fine. */
export const tileCache = new Map();

export function drawSatLevel(k, z, createLoads) {
  const n = 1 << z, ts = 360 / n;
  const tx0 = Math.floor((S.view.cx - (W / 2) / k + 180) / ts);
  const tx1 = Math.floor((S.view.cx + (W / 2) / k + 180) / ts);
  const ty0 = Math.floor((S.view.cy - (H / 2) / k + 180) / ts);
  const ty1 = Math.floor((S.view.cy + (H / 2) / k + 180) / ts);
  for (let ty = Math.max(0, ty0); ty <= Math.min(n - 1, ty1); ty++) {
    for (let tx = Math.max(0, tx0); tx <= Math.min(n - 1, tx1); tx++) {
      const key = z + "/" + ty + "/" + tx;
      let t = tileCache.get(key);
      if (!t) {
        if (!createLoads) continue;
        if (tileCache.size > 600) tileCache.delete(tileCache.keys().next().value);
        t = { img: new Image(), ok: false };
        t.img.onload = () => {
          // pre-tone the tile once, so the frame loop never touches ctx.filter
          const c2 = document.createElement("canvas");
          c2.width = c2.height = 256;
          const g2 = c2.getContext("2d");
          g2.filter = "brightness(0.72) saturate(0.85)";
          g2.drawImage(t.img, 0, 0);
          t.cv = c2; t.ok = true;
        };
        t.img.onerror = () => {};
        t.img.src = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/" + z + "/" + ty + "/" + tx;
        tileCache.set(key, t);
      } else {
        tileCache.delete(key); tileCache.set(key, t);   // LRU touch: visible tiles never evict
      }
      if (t.ok) {
        const sx = (tx * ts - 180 - S.view.cx) * k + W / 2;
        const sy = (ty * ts - 180 - S.view.cy) * k + H / 2;
        ctx.drawImage(t.cv, sx, sy, ts * k + 0.75, ts * k + 0.75);
      }
    }
  }
}

export function drawSat(k) {
  const z = Math.max(4, Math.min(15, Math.round(Math.log2(k * 360 / 256))));
  if (z - 1 >= 4) drawSatLevel(k, z - 1, true);   // coarse underlay: no flash while children load
  drawSatLevel(k, z, true);
}
