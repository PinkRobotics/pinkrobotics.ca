/* Generate every static figure from the model, plus a manifest.
 *
 *   node scripts/figures.mjs [--out assets/static] [--check]
 *
 * The figures are SVG because the site's existing figures are SVG: they print, they scale, they
 * are diffable in review, and they are generated from the SAME geometry and the SAME projection
 * as the interactive viewer, so a figure cannot drift from the thing it illustrates. Nothing here
 * is redrawn by hand and nothing is traced from a screenshot.
 *
 * `--check` regenerates into memory and compares against what is on disk, so CI (or a reviewer)
 * can prove the committed assets match the current model instead of trusting that they do.
 *
 * Rasterisation is a separate step (scripts/render-figures.sh) because it needs a browser, and
 * this file must stay runnable anywhere node runs.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from '../model/build.js';
import { resolveClass, CLASS_IDS } from '../model/config.js';
import { staticFigureSVG, scaleComparisonSVG } from '../render/svg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const args = process.argv.slice(2);
const outDir = join(ROOT, argValue('--out') || 'assets/static');
const check = args.includes('--check');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

/**
 * The figure set. `tier` is deliberately low for the wide views: a figure is read at 880 px, and a
 * 12,000-member lattice at that size is a grey smear that costs 300 kB.
 */
const FIGURES = [];
for (const id of CLASS_IDS) {
  const lower = id.toLowerCase();
  FIGURES.push(
    { name: `${lower}-side-silhouette`, cls: id, tier: 1,
      opts: { view: 'side', mode: 'silhouette', width: 880, height: 240 },
      alt: `Side silhouette of the ${id} conceptual airship.` },
    { name: `${lower}-top-silhouette`, cls: id, tier: 1,
      opts: { view: 'top', mode: 'silhouette', width: 880, height: 260 },
      alt: `Plan silhouette of the ${id}.` },
    { name: `${lower}-front-silhouette`, cls: id, tier: 1,
      opts: { view: 'front', mode: 'silhouette', width: 400, height: 300 },
      alt: `Front silhouette of the ${id}.` },
    { name: `${lower}-exterior-3q`, cls: id, tier: 1,
      opts: { view: 'three-quarter', mode: 'exterior', width: 880, height: 400 },
      alt: `Three-quarter exterior of the ${id}, showing the thrust stations, manoeuvring ` +
        'propulsors, trim fans, tail surfaces and sensor clusters.' },
    // Wire and lattice figures drop a detail tier on the larger classes: at 880 px a
    // 12,000-member lattice is a grey smear that costs 400 kB, and tier 0/1 reads better.
    { name: `${lower}-wire-3q`, cls: id, tier: id === 'P100' ? 1 : 0,
      opts: { view: 'three-quarter', mode: 'wire', width: 880, height: 400 },
      alt: `Wire view of the ${id}: hull meridians, ring frames and component outlines.` },
    { name: `${lower}-cutaway-3q`, cls: id, tier: id === 'P100' ? 2 : 1,
      opts: { view: 'cutaway-three-quarter', mode: 'cutaway', width: 880, height: 400, cut: 0 },
      alt: `Longitudinal cutaway of the ${id}, showing the volumetric cellular structure, the ` +
        'distributed water tanks, the liquid-nitrogen tanks and the power modules.' },
    { name: `${lower}-lattice-side`, cls: id, tier: id === 'P10000' ? 0 : 1,
      opts: { view: 'side', mode: 'lattice', width: 880, height: 320 },
      alt: `Structural lattice of the ${id} — illustrative stress-informed topology, not an FEA ` +
        'result. Denser around the thrust stations, the tanks and the hose reels.' },
    { name: `${lower}-underside`, cls: id, tier: 1,
      opts: { view: 'underside', mode: 'exterior', width: 880, height: 400 },
      alt: `Underside of the ${id}: the keel, the drop outlets, the hose reels and the ` +
        'downward-looking sensor clusters.' },
  );
}

const t0 = Date.now();
const manifest = {
  generator: 'airship3d/scripts/figures.mjs',
  note: 'Every figure is generated from model/ and render/svg.js. Do not edit by hand — ' +
    'regenerate. `node scripts/figures.mjs --check` proves these match the model.',
  figures: [],
};

let differed = 0;
if (!check && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

for (const f of FIGURES) {
  const b = build(f.cls, { tier: f.tier });
  const svg = staticFigureSVG(b, { ...f.opts, alt: f.alt });
  emit(`${f.name}.svg`, svg, { ...f, bytes: svg.length, stats: b.stats });
}

{
  const svg = scaleComparisonSVG(CLASS_IDS.map((id) => resolveClass(id)), { width: 880 });
  emit('scale-comparison.svg', svg, {
    name: 'scale-comparison', cls: 'all', tier: 0, bytes: svg.length,
    alt: 'All three conceptual classes and four physical references at one real scale.',
  });
}

// The map-level representation, one per class: a marker asset, not a viewer.
for (const id of CLASS_IDS) {
  const b = build(id, { tier: 0 });
  const svg = staticFigureSVG(b, {
    view: 'side', mode: 'silhouette', width: 160, height: 44,
    background: 'transparent', caption: null, alt: `${b.cls.name} outline`,
  });
  emit(`map-${id.toLowerCase()}.svg`, svg, {
    name: `map-${id.toLowerCase()}`, cls: id, tier: 0, bytes: svg.length,
    alt: `${b.cls.name} map marker outline`, stats: b.stats,
  });
}

function emit(file, content, meta) {
  const path = join(outDir, file);
  if (check) {
    const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (have !== content) {
      differed++;
      console.error(`DIFFERS  ${file}${have === null ? ' (missing)' : ''}`);
    }
  } else {
    writeFileSync(path, content);
  }
  // The gzipped size is the one that matters: the web server serves these compressed, and SVG path
  // data compresses about 8:1. Reporting only the raw size would overstate the cost 8x.
  const gz = gzipSync(Buffer.from(content), { level: 9 }).length;
  manifest.figures.push({
    file, class: meta.cls, tier: meta.tier, bytes: meta.bytes, gzipBytes: gz,
    kb: +(meta.bytes / 1024).toFixed(1), gzipKb: +(gz / 1024).toFixed(1),
    alt: meta.alt,
    triangles: meta.stats ? meta.stats.triangles : undefined,
    segments: meta.stats ? meta.stats.segments : undefined,
  });
}

manifest.totalBytes = manifest.figures.reduce((a, f) => a + f.bytes, 0);
manifest.totalGzipBytes = manifest.figures.reduce((a, f) => a + f.gzipBytes, 0);
manifest.count = manifest.figures.length;
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const p = join(outDir, 'manifest.json');
  const have = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (have !== manifestJson) { differed++; console.error('DIFFERS  manifest.json'); }
  if (differed) {
    console.error(`\n${differed} generated asset(s) do not match the model. ` +
      'Run `node scripts/figures.mjs` and commit the result.');
    process.exit(1);
  }
  console.log(`figures: ${manifest.count} assets match the model ` +
    `(${(manifest.totalBytes / 1024).toFixed(0)} kB total)`);
} else {
  writeFileSync(join(outDir, 'manifest.json'), manifestJson);
  console.log(`figures: wrote ${manifest.count} assets to ${outDir} ` +
    `(${(manifest.totalBytes / 1024).toFixed(0)} kB raw, ` +
    `${(manifest.totalGzipBytes / 1024).toFixed(0)} kB gzipped, ${Date.now() - t0} ms)`);
  for (const f of manifest.figures) {
    console.log(`  ${f.kb.toFixed(1).padStart(7)} kB raw  ${f.gzipKb.toFixed(1).padStart(6)} kB gz  ${f.file}`);
  }
}
