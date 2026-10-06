/* The front page's spinning ship — the explorer's own vessel scene, booted with no
 * controls at all. One model everywhere: this imports the same mountExplorer the
 * public viewer runs, in lite mode, so the hull on the front page can never drift
 * from the hull in the viewer. What lite mode buys on a landing page:
 *
 *   - only The Ship level builds; the six joint-scale levels get empty shells,
 *   - the 6.5 MB of joint display meshes never load (they are a lazy module now),
 *   - the host sets pointer-events:none on the canvas, so the viewer's own drag,
 *     pinch and wheel listeners — which DO attach; lite mode does not skip them —
 *     never see an event and the page keeps its scroll. That CSS line is load
 *     bearing: remove it and the hero starts eating scrolls on a phone.
 *
 * The turntable is the viewer's own idle spin, which runs from the first frame
 * until an interaction — and here no interaction can ever come. The environment
 * boots already on, with the tree line and the watchers closing the full circle
 * (ctx.envRing), so the ship has company from every azimuth as it turns.
 * prefers-reduced-motion gets a still ship; a machine without WebGL2 keeps
 * whatever fallback the hosting section painted behind the canvas. */
import { mountExplorer, LEVELS } from './explorer.js?v=816a54f9';

export function mountShipHero(canvas) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const api = mountExplorer({
    canvas,
    reducedMotion: reduced,
    lite: true,
    envRing: true,
    transparentSky: true,      // the ship floats over the page; sky pixels are the page
    layers: { env: true },
    startLevel: LEVELS.findIndex((l) => l.id === 'vessel'),
    // Tight framing (operator, 08-14): the whole machine fills the frame — hull
    // top to the bucket at the water, raft and lines included — with minimal
    // margin. Target sits mid-stack (hull top +26 m, water -60 m); the vertical
    // fov at ~172 m covers the ~95 m stack. The shore ring reads at the frame's
    // edges as it turns, which is what the watchers are for.
    //
    // WHY 34.4 AND NOT 32 (operator, 08-14 round 2: the crown was flattening).
    // A turning capsule is not a constant silhouette. Bow-on, the nose cap is
    // 52 m nearer the eye than the hull's centre, so perspective throws the
    // crown HIGHER than it ever gets broadside — 3.5% of the half-height past a
    // 32-degree frame, which the canvas edge sliced flat once per turn. The fix
    // keeps the ship exactly where and how big it was: the canvas grows 8%
    // taller and the fov grows 8% in tangent WITH it (tan(17.2) = 1.08 x
    // tan(16)), and since pixels per metre are tan(fov/2) / canvas height, the
    // two cancel. Horizontal is untouched for the same reason — tan(hfov/2) is
    // tan(vfov/2) x aspect, and aspect falls by exactly the 8% the fov gained.
    // All of it becomes frame, half above and half below, so the host's pull
    // (see .shipfree in the front page) grows by half the added height to keep
    // the canvas CENTRE — and with it the ship — on the same line of the page.
    // Worst case now clears by 4%: hull top 0.2969 against a half-height of
    // 0.3097, gear bottom 0.2731. Recompute if the pose, the hull or the gear
    // moves; the sweep that found these lives in the working doc, part 26.
    pose: { tg: [0, 0, -17], el: 0.05, d: 172, fov: 34.4 },
  });
  if (api) canvas.classList.add('live');
  // Spin only while the banner is actually on screen — a hero scrolled past should
  // not keep a phone's GPU warm. api.state is the mount's live state object.
  if (api && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) api.state.turntable = e.isIntersecting && !reduced;
    }).observe(canvas);
  }
  return api;
}

// Self-boot when the hosting page marks a canvas for it; a page that wants manual
// control imports mountShipHero instead and leaves the attribute off.
const auto = document.querySelector('canvas[data-ship-hero]');
if (auto) mountShipHero(auto);
