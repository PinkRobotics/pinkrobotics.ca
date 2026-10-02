/* Stamp a content-derived version onto every module URL.
 *
 *   node scripts/stamp-version.mjs            # stamp
 *   node scripts/stamp-version.mjs --check    # fail if the stamp is stale
 *   node scripts/stamp-version.mjs --strip    # remove the stamps
 *
 * WHY THIS EXISTS. The site sits behind Cloudflare, which caches .js for four hours. A no-build
 * ES-module site cannot cache-bust from the entry point, because a relative specifier resolves
 * against the importing module's URL with the query string DROPPED — so `airship3d.js?v=2` still
 * pulls a stale `model/build.js`. Requesting revalidation does not help either: Cloudflare answers
 * `cf-cache-status: HIT` to `Cache-Control: no-cache`.
 *
 * The result, observed rather than theorised: a deploy landed correctly on the origin and the
 * browser kept running the previous build for hours, across every browser, because the staleness
 * was at the edge and not in any client.
 *
 * So every relative specifier in the tree carries the SAME version query. Changing the version
 * changes every URL at once, and the whole graph misses the cache together. Uniformity is the
 * safety property: a partly-stamped tree would load some modules under two URLs and give you two
 * copies of module state (two `ASSUMPTIONS` objects, two style-injection guards), which is a far
 * nastier bug than a stale file. `--check` exists to keep that from drifting.
 *
 * The version is a hash of the module contents, so it changes exactly when the code does and a
 * rebuild with no changes re-stamps to the same value.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SITE = join(ROOT, '..');

const args = process.argv.slice(2);
const check = args.includes('--check');
const strip = args.includes('--strip');

/** Every .js in the module tree, plus the HTML entry points that import from it. */
function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'assets') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const modules = walkFiles(ROOT).filter((p) => !p.includes(`${'scripts'}/`));
/**
 * HTML entry points are DISCOVERED, not listed.
 *
 * A hardcoded list is how tests/hud-demo.html shipped with an unstamped import: it fetched the
 * un-versioned module URL, was served a cached build from before the export it needed existed,
 * and the page died with "does not provide an export named AirshipHUD". Uniformity is the whole
 * safety property here, so the set of files it covers cannot be something a person must remember
 * to update.
 */
function walkHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'assets') continue;
    const q = join(dir, name);
    const st = statSync(q);
    if (st.isDirectory()) walkHtml(q, out);
    else if (name.endsWith('.html')) out.push(q);
  }
  return out;
}
const htmlEntries = [
  ...walkHtml(ROOT),
  join(SITE, 'airships', 'model-lab', 'index.html'),
].filter((q) => { try { statSync(q); return true; } catch { return false; } });

/* The version: a hash of the STRIPPED contents, so stamping is idempotent.
 *
 * The token pattern is deliberately PERMISSIVE. It used to require exactly eight hex characters,
 * which meant a hand-written label like `?v=0808fix3` could neither be stripped nor re-stamped:
 * the whole tree was pinned to a literal that no longer tracked content, `--check` reported it as
 * clean, and cache-busting was silently disabled for every future change. A checker that only
 * recognises its own output cannot tell you when someone else has edited the thing it guards. */
const STAMP = /(\.m?js)\?v=[A-Za-z0-9_.-]+(['"])/g;
const stripStamp = (s) => s.replace(STAMP, '$1$2');

const h = createHash('sha256');
for (const p of modules.slice().sort()) h.update(stripStamp(readFileSync(p, 'utf8')));
const VERSION = h.digest('hex').slice(0, 8);

/**
 * Add the query to relative specifiers only. Bare specifiers and absolute URLs are left alone —
 * there are none today, and silently rewriting one later would be worse than skipping it.
 */
const SPEC = /(from\s*|import\s*\(\s*)(['"])(\.{1,2}\/[^'"?]+\.m?js)(?:\?[^'"]*)?(['"])/g;
function stampSource(src) {
  const base = stripStamp(src);
  if (strip) return base;
  return base.replace(SPEC, (_, kw, q1, spec, q2) => `${kw}${q1}${spec}?v=${VERSION}${q2}`);
}

let changed = 0, stale = [];
for (const p of [...modules, ...htmlEntries]) {
  const src = readFileSync(p, 'utf8');
  const out = stampSource(src);
  if (out === src) continue;
  changed++;
  if (check) stale.push(relative(SITE, p));
  else writeFileSync(p, out);
}

/* Pages elsewhere on the site that import this tree are REPORTED, never edited — they belong to
 * another session. An unstamped import there is a stale-cache failure waiting to happen. */
{
  const foreign = [];
  const scan = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'assets' || name === 'airship3d') continue;
      const q = join(dir, name);
      let st;
      try { st = statSync(q); } catch { continue; }
      if (st.isDirectory()) scan(q);
      else if (name.endsWith('.html') && !htmlEntries.includes(q)) {
        if (/airship3d\/airship3d\.js(?!\?v=)/.test(readFileSync(q, 'utf8'))) {
          foreign.push(relative(SITE, q));
        }
      }
    }
  };
  try { scan(SITE); } catch { /* nothing to scan */ }
  if (foreign.length) {
    console.warn('stamp: NOTE — these pages import airship3d without a version query, so they ' +
      `can be served a stale module graph:\n  ${foreign.join('\n  ')}\n  Not edited (not this ` +
      `module's files). Add ?v=${VERSION} to their import, or ask their owner to.`);
  }
}

/* Publish the version so a host that imports this module DYNAMICALLY can pin it.
 *
 * A static import inside the tree gets stamped by this script. A dynamic `import("…/airship3d.js")`
 * from someone else's page cannot be — it is their file — so that page rides the un-versioned URL
 * and gets whatever generation the CDN happens to hold. This file is how they pin it without
 * hand-editing a literal on every change:
 *
 *     const { version } = await (await fetch('/airship3d/version.json')).json();
 *     const mod = await import(`/airship3d/airship3d.js?v=${version}`);
 */
if (!check && !strip) {
  writeFileSync(join(ROOT, 'version.json'),
    `${JSON.stringify({ version: VERSION, note: 'Pin dynamic imports to this. See scripts/stamp-version.mjs.' }, null, 2)}\n`);
}

if (check) {
  if (stale.length) {
    console.error(`stamp: ${stale.length} file(s) are not stamped at ${VERSION} ` +
      '(a foreign or hand-written version query counts as stale — it freezes cache-busting):');
    for (const f of stale.slice(0, 12)) console.error(`  ${f}`);
    console.error('\nRun `node scripts/stamp-version.mjs` and redeploy.');
    process.exit(1);
  }
  console.log(`stamp: all module URLs carry ?v=${VERSION}`);
} else {
  console.log(strip
    ? `stamp: removed version queries from ${changed} file(s)`
    : `stamp: ${changed} file(s) stamped at ?v=${VERSION}`);
}
