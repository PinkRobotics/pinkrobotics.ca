/* Deterministic pseudo-randomness.
 *
 * The plan order and the drop-line placement vary between visits so the demonstration
 * does not replay one identical attack forever. Pinning the seed makes a run
 * reproducible, which is what lets one person hand another an exact scenario and what
 * the golden-output tests compare against. The seed is set by the page, never read from
 * the URL here: this module knows nothing about browsers.
 */

/** The current seed. Pinned by `setSeed`; otherwise a fresh one per page load. */
export let SEED = String(Math.floor(Math.random() * 1e9));

/**
 * Pin the seed, making every downstream choice reproducible.
 *
 * Call this before building any mission — the seed is read when plans are made, not when
 * this module loads. The page passes `?seed=` here; nothing in `sim/` reads a URL itself,
 * so the model stays runnable outside a browser.
 */
export function setSeed(seed) {
  SEED = String(seed);
}

export function hashFrac(s) {          // stable per-fire phase offset so the fleet doesn't move in lockstep
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/* ---------- first-order physics --------------------------------------------------------- */
