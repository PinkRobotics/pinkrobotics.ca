/* First-party terrain backdrop. */
/* Terrain backdrop: dark hillshade built offline from AWS/Mapzen Terrain Tiles (z7 mercator
   mosaic, pipeline/terrain.py). Its bounds are linear in the page's world coordinates. */
export const TERRAIN = { src: "data/terrain-bc.jpg", x0: -140.625, x1: -112.5, y0: -78.75, y1: -53.4375 };

export const terrainImg = new Image();

export let terrainReady = false;
terrainImg.onload = () => { terrainReady = true; };
terrainImg.src = TERRAIN.src;
