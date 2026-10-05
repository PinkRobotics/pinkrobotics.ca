/* How the descent anchor READS, for the two things that draw it.
 *
 * The 3D model and the schematic avatar have to show the same cable at the same moment. They are
 * drawn by different code in different languages of geometry — one is a catenary in a WebGL scene,
 * the other is a line on a 2D canvas — and the one thing they must not disagree about is WHEN.
 * They did: the model was moved to derive the anchor from altitude and the avatar was left on a
 * hand-authored curve against phase progress, so the bucket went down in one of them several
 * seconds before the other. An avatar that disagrees with the model is worse than no avatar.
 *
 * IT NO LONGER OWNS THE RULE. The bag is a force — thousands of tonnes pulling down on the hull —
 * so the rule belongs to the model, and `sim/state.js` → `anchorHang()` is where it lives; this
 * file is the thin adapter that turns it into the two numbers a drawing wants. Writing it here
 * first is how the net-force line came to report a buoyant ship at the exact moment a bucket was
 * holding it down.
 *
 * `3d/anim/mission.js` → `anchorAt()` is still a separate copy, because that library imports
 * nothing outside itself by design and by lint rule. `tests/cases/anchor-parity.cases.js`
 * compares the two, the same treatment the two copies of the vehicle specification get.
 */

import { anchorHang } from '../sim/index.js?v=fc85766f';

/**
 * @param {object} cls   the monitor's class record (CLASSES[id])
 * @param {number} altM  height above the water, metres
 * @param {string} phase the monitor's phase id
 * @param {number} prog  0..1 within that phase
 * @param {number} fullF what a full bag means for this mission — plan.anchorT over the bag
 * @param {number} [gsKph] ground speed; the bag may not be dipped from a moving ship
 * @returns {{cableP: number, fillF: number}} cable payout and bag fill, both 0..1
 */
export function anchorView(cls, altM, phase, prog, fullF, gsKph = 0) {
  const h = anchorHang(cls, 1, phase, prog, altM, gsKph);
  return { cableP: h.cableP, fillF: fullF * h.fillF };
}
