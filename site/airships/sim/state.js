/* stateAt: where a mission is and what it is doing at a given moment in its cycle.
 *
 * The phase state machine. Everything the map draws, the instruments read and the 3D
 * model animates comes from this one function, so that no two surfaces can disagree
 * about what the ship is doing.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. This file owns the GEOMETRY of a cycle — which curve the
 * hull is on, where it is along it, which way it points, what the narrative calls the moment.
 * Everything that costs or returns power — altitude, load, speed, the anchor, the rotors, the
 * bus — is `drawAt` in power.js, and stateAt reads it rather than recomputing it. That split is
 * defect 2's fix: planCycle integrates the same `drawAt`, so the budget the site publishes is
 * the integral of what the instruments show, not a second estimate of it.
 */
import { PHASES } from './config.js?v=fc85766f';
import { bez, bezBearing, easeSm, easeTrap, lerpAng } from './geo.js?v=fc85766f';
import { anchorHang, drawAt } from './power.js?v=fc85766f';
import { arrivalCurve, segAt, stationFor, tIdx } from './targets.js?v=fc85766f';

// The anchor rule moved to power.js on 2026-10-01 (the power model needs it before stateAt
// does); it is re-exported here so sim/index.js and app/anchorview.js are unchanged.
export { anchorHang };

export function stateAt(m, tRaw) {
  if (m.served && m.planState !== "ready") return {phase: "STAND_DOWN", label: m.planState === "pending" ? "plan pending" : m.planState === "stand-down" ? "stands down" : "plan unavailable", ll: m.fire.ll, water: 0, ln2: 0, prog: 0, alt: 0, bearing: 0, idx: -1, inactive: true};
  if (m.idle) return { phase: "NO_SUITABLE_SOURCE", label: "idle — no suitable mapped source", ll: m.fire.ll, water: 0, ln2: 0, prog: 0, alt: 0, bearing: 0, idx: -1 };
  // A hull whose storage reached zero is frozen at the moment the bus died: the picture
  // (position, phase, tanks) holds, but nothing draws power and nothing moves.
  const stopped = !!(m.dead && tRaw >= m.deadAt);
  if (stopped) tRaw = m.deadAt;
  const t = ((tRaw + m.offset * m.cycleSec) % m.cycleSec + m.cycleSec) % m.cycleSec;
  let idx = m.phaseEnds.findIndex(e => t < e);
  if (idx < 0) idx = PHASES.length - 1;
  const start = idx ? m.phaseEnds[idx - 1] : 0;
  const dur = Math.max(1e-6, m.phaseEnds[idx] - start);
  const prog = (t - start) / dur;
  const id = PHASES[idx][0];
  const cls = m.cls, plan = m.plan;
  // this cycle's drop line and the S-curve built on it: outbound flies to the line's start,
  // the run paints the line, escape and return leave from its end
  const cycN = Math.floor((tRaw + m.offset * m.cycleSec) / m.cycleSec) + 1;
  const ti = tIdx(m, cycN);
  const seg = segAt(m, cycN);
  const sA = seg[0], sB = seg[1];
  const ikN = stationFor(m, cycN), ikX = stationFor(m, cycN + 1);
  const mid2 = [(ikN[0] + sA[0]) / 2, (ikN[1] + sA[1]) / 2];
  const dX = sA[0] - ikN[0], dY = sA[1] - ikN[1];
  const cO = [mid2[0] - dY * 0.09, mid2[1] + dX * 0.09];
  const cR = [(ikX[0] + sB[0]) / 2 + dY * 0.09, (ikX[1] + sB[1]) / 2 - dX * 0.09];
  m.curDelivery = sA; m.curCtlOut = cO; m.curCtlRet = cR; m.curSeg = seg; m.curTi = ti;
  m.curIk = ikN; m.curIkNext = ikX;
  m.curPass = m.order ? Math.floor((cycN - 1) / m.order.length) : 0;
  /* THE PHYSICS OF THE MOMENT — altitude, load, speed, the bag, the rotors, the bus — from the
     one power model. Read first, because the geometry below only decides where on the map the
     hull is and which way it points; nothing the instruments show is computed in this file. */
  const P = drawAt(cls, m.mode, plan, id, prog);
  const alt = P.alt, water = P.water, ln2 = P.ln2;
  let ll, bearing = 0, sub = "";
  const B = (p0, c, p2, tt) => { ll = bez(p0, c, p2, tt); bearing = bezBearing(p0, c, p2, tt, ll[1]); };
  const tz = easeTrap(prog);
  // Distance the escape climb covers, as a fraction of the return leg: mean speed (the dial's
  // vEsc profile integrates to vEsc/2.5) times its duration, over the one-way distance. The
  // return picks up exactly where it leaves off, so map motion and needle never disagree.
  const escF = Math.max(0.01, Math.min(0.15,
    (plan.gsRet * 0.85 / 2.5) * (plan.dur.BUOYANCY_ESCAPE / 60) / Math.max(1, m.legKm || m.oneWayKm)));
  switch (id) {
    case "SOURCE_APPROACH": {
      // The flown tail of the previous cycle's return curve, hose paying out on the way in.
      //
      // It must be THE SAME CURVE the return actually flew. Rebuilding the control point from
      // THIS cycle's geometry gave the approach a different arc from the one the ship was on,
      // so the hull jumped and swung through the seam — a phase change that looked like a
      // manoeuvre when all that really happens here is the hose starting to pay out.
      /* ARRIVE, STOP, THEN GO DOWN — in that order, and the order is the point.
       *
       * This used to fly the last of the arrival curve and the whole descent at the same time,
       * so the ship was still making 30-odd km/h as it sank into the band where the anchor has
       * to be in the water. Dipping several thousand tonnes of bag at that speed is a bad time
       * at 20 km/h and an unsurvivable one at 40. The ship now closes the last of the track and
       * comes to a dead stop in the first 30% of the approach, and only then lets itself down,
       * hovering, onto the lake (the altitude profile is power.js altAt). */
      const arrive = easeSm(Math.min(1, prog / 0.30));
      if (m.segs && cycN > 1) B(...arrivalCurve(m, cycN), 0.96 + 0.04 * arrive);
      else ll = ikN.slice();
      sub = "hose paying out";
      break;
    }
    case "WATER_FILL": {
      ll = ikN.slice();
      /* HEADING THROUGH THE HOLD: IT DOES NOT TURN.
       *
       * A station-keeping ship has no track to take a bearing from, and leaving it at the
       * default sent the hull snapping to due north going in and again coming out — the worst
       * seam on the page. It used to fix that by turning onto the departure heading over the
       * last third of the fill, which solved the seam and created something worse: an 876 m
       * hull yawing with a hose, a pump pod and an anchor cable all hanging in the water under
       * it. That is how you tangle lines.
       *
       * So it holds the heading it arrived on for the whole fill, and the turn onto the
       * departure track happens at the start of the outbound leg, once the pod is clear of the
       * surface. See OUTBOUND_TRANSIT. */
      bearing = bezBearing(...arrivalCurve(m, cycN), 1, ll[1]);
      // What holds the ship down while filling: the anchor's bag until the tanks pass what the
      // descent needed, retained water and LN2 ballast, the water column standing in the hose,
      // and rotor trim on the residual.
      sub = "hose column + rotor trim";
      break;
    }
    case "OUTBOUND_TRANSIT": {
      B(ikN, cO, sA, tz);
      /* THE TURN LIVES HERE NOW, not in the fill. The ship leaves on the heading it filled on,
       * holds it while the pod comes up through the last of the water — a few seconds of winch
       * — and only then swings onto the outbound track. Nothing rotates while there is line in
       * the lake. */
      if (prog < 0.20) {
        const bHold = bezBearing(...arrivalCurve(m, cycN), 1, ll[1]);
        bearing = lerpAng(bHold, bearing, easeSm(Math.max(0, (prog - 0.04) / 0.16)));
      }
      // Turn onto the line before reaching it: the drop run starts already tracking the
      // heading it will fly, instead of the hull snapping 90 degrees at the phase change.
      if (prog > 0.88) {
        const kxo = Math.cos(ll[1] * Math.PI / 180);
        bearing = lerpAng(bearing, Math.atan2((sB[0] - sA[0]) * kxo, sB[1] - sA[1]),
          easeSm((prog - 0.88) / 0.12));
      }
      if (prog < 0.18) sub = "hose winding up";
      break;
    }
    case "WATER_RELEASE": {
      // Multiple passes shuttle the line: out, back, out … always an odd count, so the
      // final pass delivers the ship to sB where BUOYANCY_ESCAPE picks it up.
      const nP = plan.passes || 1;
      const k = Math.min(nP - 1e-9, prog * nP), pi = Math.floor(k), pf = k - pi;
      // Each pass eases in and out, so the ship never reverses at speed: it slows into the
      // turn, comes about, and accelerates back down the line.
      const e = easeSm(pf);
      const tt = pi % 2 ? 1 - e : e;
      ll = [sA[0] + (sB[0] - sA[0]) * tt, sA[1] + (sB[1] - sA[1]) * tt];
      // Heading is the line's, reversed on alternate passes and swung through the turn rather
      // than snapped — the ship is barely moving there, which is when a hull that size turns.
      const kx = Math.cos(ll[1] * Math.PI / 180);
      const segB = Math.atan2((sB[0] - sA[0]) * kx, sB[1] - sA[1]);
      // A 180° reversal is the one case shortest-arc interpolation cannot answer: the two
      // directions are exactly equal, so floating-point noise in (a + π) − a picks one per
      // sample and the hull flickers end for end. Count the turns instead and always swing
      // the same way — the heading accumulates, which is also what a rate-limited camera
      // wants to follow.
      const tw = 0.12;
      let turns = pi, frac = 0;
      if (pi < nP - 1 && pf > 1 - tw) frac = (pf - (1 - tw)) / (2 * tw);
      else if (pi > 0 && pf < tw) { turns = pi - 1; frac = (pf + tw) / (2 * tw); }
      bearing = segB + Math.PI * (turns + easeSm(frac));
      if (prog > 0.5) sub = "buoyancy building — escape climb imminent";
      break;
    }
    case "BUOYANCY_ESCAPE":
      // The cork. It leaves the line barely moving and accelerates the whole way up: 10% of
      // the return curve is covered here, on a squared profile, not the 2% that made the
      // most dramatic phase of the cycle look like a hover.
      // How far along the return curve the climb actually carries the ship, derived from the
      // speed the dial is showing rather than picked: average escape speed x duration, as a
      // fraction of the leg. A hand-chosen fraction had the map moving at 300 km/h while the
      // needle read 120.
      B(sB, cR, ikX, escF * Math.pow(prog, 1.7));
      // Comes off the line still pointing down it, and turns onto the homeward curve as it
      // rises — the climb and the turn are one movement, not a snap followed by a climb.
      if (prog < 0.35) {
        const kxe = Math.cos(ll[1] * Math.PI / 180);
        const lineB = Math.atan2((sB[0] - sA[0]) * kxe, sB[1] - sA[1]) +
          Math.PI * ((plan.passes || 1) - 1);
        bearing = lerpAng(lineB, bearing, easeSm(prog / 0.35));
      }
      sub = prog < 0.55 ? "simulated climb — buoyancy and force checked" : "arresting the climb";
      break;
    case "RETURN_TRANSIT": {
      B(sB, cR, ikX, escF + tz * (0.96 - escF));   // ends short: the approach flies the rest in
      if (prog > 0.72) sub = "descending to hose range";
      else if (prog < 0.30) sub = "simulated return — retained water aboard";
      break;
    }
  }
  // speed fraction and accel sense for the transit legs (drives the rotor tilt display)
  let vf = 0, acc = 0;
  if (id === "OUTBOUND_TRANSIT" || id === "RETURN_TRANSIT") {
    const aE = 0.15;
    vf = Math.min(prog / aE, 1, (1 - prog) / aE);
    acc = prog < aE ? 1 : prog > 1 - aE ? -1 : 0;
  } else if (id === "WATER_RELEASE" || id === "BUOYANCY_ESCAPE") vf = 0.5;
  const buoyN = P.led.liftT * 1000 * 9.81;
  const weightN = P.massT * 1000 * 9.81;
  let draw = P.draw, gs = P.gs, anchor = P.anchor;
  if (stopped) {
    draw = {}; sub = "power exhausted — safe shutdown"; gs = 0; vf = 0; acc = 0;
    // A ship that has stopped moving may have the bag in the water even where a moving one
    // could not — the anchor rule is asked about the ship as it actually is.
    // Preserve achieved inventory; stopping cannot create hoisted water.
  }
  const anchorN = anchor.tonnes * 1000 * 9.81;
  return { idx, phase: id, label: PHASES[idx][1], prog, ll, bearing, alt, water, ln2, sub,
    draw, gen: P.gen, electrical: stopped ? null : P.electrical, basis: P.basis, feasible: plan.feasible,
    owners: P.owners, unheldT: P.unheldT, limits: P.limits, gs, stopped, massT: P.massT, buoyN, weightN,
    // THE NET INCLUDES THE BUCKET. It is the largest single force on the hull whenever it is in
    // use — 12,400 t on a P-10000 against a 21,000 t hull — and leaving it out of the net line
    // reported a ship straining upward at the exact moment it was being held down by a bag of
    // lake water. anchorT/anchorN are published alongside so the panel can show the mechanism
    // rather than only its effect.
    anchorT: anchor.tonnes, anchorCableOut: anchor.cableP, anchorN,
    netN: buoyN - weightN - anchorN, vf, acc, vert: P.vert,
    // The rotors' story at this instant: what the choreography asked for, what the bus gave.
    rotorAskMW: P.rotorAskMW, busMW: P.busMW, airV: P.airV, vz: P.vz,
    cyclePos: t, cycleN: cycN };
}

/* The Mind's trace: last / now / next / plan, from the state machine and real numbers. */
