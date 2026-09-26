/* Deterministic pseudo-randomness.
 *
 * Every scrap of variation in the generated structure comes from here, seeded from the class
 * config's `structuralSeed`. Nothing in the model may call Math.random(): the same seed has to
 * produce byte-identical geometry in the browser, in node (figure export) and in the tests, or
 * the visual-regression figures are meaningless and "deterministic procedural structure from a
 * seed" is untestable.
 */

/** mulberry32 — small, fast, good enough for placement jitter, and easy to port. */
export function prng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random in [lo,hi). */
export const range = (rnd, lo, hi) => lo + (hi - lo) * rnd();

/** Symmetric jitter about zero. */
export const jitter = (rnd, amp) => (rnd() * 2 - 1) * amp;

/**
 * Stable hash of a string to a 32-bit int. Used to derive a per-component sub-seed from its
 * semantic id, so adding a component upstream cannot reshuffle every component downstream.
 */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A generator seeded by (seed, tag) — independent streams that stay stable under edits. */
export const streamFor = (seed, tag) => prng((seed ^ hashStr(tag)) >>> 0);
