/* The production schematic reads the model's held water and deployment channels.
 * Both drawings define fill against the class's installed bag capacity, not the
 * water a plan intends to pick up. The schematic keeps a stylised collapsed-bag
 * radius; fill is inventory, not a claim of measured bag shape.
 * Standalone demonstrations without a held state retain the copied geometry rule.
 * Anchor parity checks that fallback independently and compares real plan states.
 */

import { anchorHang } from '../sim/index.js?v=01e992e3';

/**
 * @param {object} cls   the monitor's class record (CLASSES[id])
 * @param {number} altM  hull-centre height above the water, metres
 * @param {string} phase the monitor's phase id
 * @param {number} prog  0..1 within that phase
 * @param {number} fullF legacy standalone target fraction of nominal bag capacity
 * @param {number} [gsKph] ground speed; the bag may not be dipped from a moving ship
 * @param {object} [heldState] actual model anchorT and anchorCableOut channels
 * @returns {{cableP: number, fillF: number}} deployment indicator and nominal-capacity fill
 */
export function anchorView(cls, altM, phase, prog, fullF, gsKph = 0, heldState) {
  if (heldState !== undefined) {
    const capacity = cls.anchorBagT || 0;
    const tonnes = Number.isFinite(heldState.anchorT) ? heldState.anchorT : 0;
    return { cableP: Math.max(0, Math.min(1, heldState.anchorCableOut || 0)),
      fillF: capacity > 0 ? Math.max(0, Math.min(1, tonnes / capacity)) : 0 };
  }
  const h = anchorHang(cls, 1, phase, prog, altM, gsKph);
  return { cableP: h.cableP, fillF: fullF * h.fillF };
}
