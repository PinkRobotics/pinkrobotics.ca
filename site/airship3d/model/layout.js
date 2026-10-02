/* Where every machine goes.
 *
 * Pure placement: this module produces positions, orientations and sizes, and nothing else. It
 * emits no geometry and no scene nodes. Two consumers need it before geometry exists —
 * density.js (the load anchors ARE the machinery positions) and the actuator model (the allocator
 * needs moment arms, not meshes) — so keeping placement separate is what stops the structure from
 * being generated before it knows what it has to carry.
 *
 * CLAIM LEVEL. Every arrangement here is conceptual layout. The reasoning behind each choice is
 * stated in the comment above it so a reader can disagree with the reasoning rather than guess at
 * it, but none of it is a settled design and none of it has been analysed.
 */

import {
  hullR, hullPoint, stationX, profileR, sectionScale,
  RHO_LN2, PACKAGING, capsuleRadiusForVolume, boxScaleForVolume,
  DUCT_SEAL_OF_DIAMETER, HULL_BAND_LIFT,
} from './config.js?v=187e4a51';
import { segPointDist } from '../core/math.js?v=187e4a51';
import { streamFor, jitter } from '../core/prng.js?v=187e4a51';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * A point inside the hull: station t in [0,1], hull angle theta, and `f` as the fraction of the
 * local radius (1 = on the skin). Everything internal is placed through this so nothing can
 * escape the body when a profile parameter changes.
 */
export function inside(cls, t, theta, f) {
  const x = stationX(cls, t);
  const r = hullR(cls, x) * sectionScale(theta, cls.hull) * f;
  return [x, -r * Math.cos(theta), r * Math.sin(theta)];
}

/** True when p is within the hull surface, with an optional inward margin in metres. */
export function insideHull(cls, p, marginM = 0) {
  const t = (cls.xNose - p[0]) / cls.lengthM;
  if (t < 0 || t > 1) return false;
  const theta = Math.atan2(p[2], -p[1]);
  const r = hullR(cls, p[0]) * sectionScale(theta, cls.hull) - marginM;
  if (r <= 0) return false;
  return Math.hypot(p[1], p[2]) <= r;
}

/**
 * Primary thrust-station stations along the length, per layout family.
 *
 * The families differ because rotor diameter grows far slower than the hull (config.js explains
 * why), so the same "four big rotors" reading cannot survive to the largest class. 'quad' is a
 * recognisable four-station layout; 'network' is deliberately not recognisable as any small
 * number of rotors.
 */
function stationStations(cls) {
  const n = cls.primaryRotorStations;
  const perSide = Math.max(1, Math.round(n / 2));
  const out = [];
  if (cls.stationLayout === 'quad') {
    // Straddling the maximum section, well separated fore and aft for pitch authority.
    const ts = [0.30, 0.62];
    for (const t of ts) out.push(t);
    return { ts: out, perSide };
  }
  if (cls.stationLayout === 'hex') {
    for (const t of [0.24, 0.46, 0.68]) out.push(t);
    return { ts: out, perSide };
  }
  // network: spread over most of the body, uneven spacing so it reads as a distribution
  for (let i = 0; i < perSide; i++) out.push(0.16 + (0.66 * i) / (perSide - 1 || 1));
  return { ts: out, perSide };
}

/** Where maintenance corridors run. Other keel-adjacent runs deliberately avoid these. */
const CORRIDOR_ROUTES = [Math.PI * 1.5, Math.PI * 0.5, Math.PI * 1.0, Math.PI * 2.0,
  Math.PI * 1.25, Math.PI * 1.75, Math.PI * 0.75, Math.PI * 0.25];

/** Nearest angular distance from `theta` to any corridor route, in radians. */
function offCorridor(theta, n) {
  let best = theta, bestGap = -1;
  for (let k = 0; k < 24; k++) {
    const cand = theta + (k % 2 ? -1 : 1) * Math.floor(k / 2) * 0.06;
    let gap = Infinity;
    for (let i = 0; i < Math.min(n, CORRIDOR_ROUTES.length); i++) {
      let d = Math.abs(((cand - CORRIDOR_ROUTES[i]) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      d = Math.PI - d;
      gap = Math.min(gap, d);
    }
    if (gap > bestGap) { bestGap = gap; best = cand; }
    if (bestGap > 0.16) break;
  }
  return best;
}

export function buildLayout(cls) {
  const R = cls.maxRadiusM;
  const L = cls.lengthM;
  const rnd = streamFor(cls.structuralSeed, 'layout');

  const layout = {
    classId: cls.id,
    rotorStations: [], mediumThrusters: [], trimFans: [],
    waterTanks: [], waterManifolds: [], dropOutlets: [],
    ln2Tanks: [], cryoModules: [], cryoTrains: [],
    generators: [], batteries: [], hvdcBuses: [],
    hoseReels: [], pumpPods: [],
    tailSurfaces: [], sensors: [], corridors: [], sectionJoints: [],
    compute: [], tankerDock: null, solarZones: [],
    waterPipes: [], ln2Pipes: [],
  };

  /* --- primary thrust stations -------------------------------------------------------------
   * Mounted on short pylons at the hull's widest band, port and starboard. Pylons rather than
   * flush mounts because a vectoring rotor needs clearance to swing and because a discrete
   * hardpoint is an honest place to introduce a large load — which is exactly what the density
   * field then densifies around. */
  {
    const { ts } = stationStations(cls);
    const perSide = ts.length;
    let k = 0;
    for (let i = 0; i < perSide; i++) {
      const t = ts[i];
      for (const side of [1, -1]) {          // +1 port (+y), -1 starboard
        const theta = side > 0 ? Math.PI : 0; // beam
        const skin = inside(cls, t, theta, 1);
        const rl = hullR(cls, skin[0]);
        // THE PYLON MUST BE LONGER THAN THE ROTOR RADIUS, or the disc slices through the hull.
        //
        // The hub sits `pylon` outboard of the skin and the disc is a circle of rotor radius about
        // it, so the disc's inboard edge is at (hullR + pylon - rotorRadius) from the axis. For
        // that to clear, the pylon must exceed the rotor radius — and by enough to cover the hull
        // GROWING across the x-range the disc spans, because a horizontal disc reaches fore and aft
        // as well as inboard. Both terms are computed, not guessed.
        const rr = cls.primaryRotorDiameterM / 2;
        let widest = rl;
        for (let j = -6; j <= 6; j++) {          // `j`: `k` is the station counter
          widest = Math.max(widest, hullR(cls, skin[0] + (rr * j) / 6));
        }
        const pylon = widest - rl + rr + Math.max(1.2, rr * 0.10);
        const p = [skin[0], skin[1] + side * pylon, skin[2] + rl * 0.06];
        layout.rotorStations.push({
          id: `PrimaryRotorStation_${pad(k)}`,
          index: k, side, t, p,
          pylonLength: pylon,
          rotorDiameter: cls.primaryRotorDiameterM,
          rotors: cls.rotorsPerStation,
          // Gimbal range. With REVERSIBLE rotors the swing never has to exceed 90 degrees: every
          // direction in the fore-and-aft plane is reachable either by pointing at it, or by
          // pointing the opposite way and reversing thrust. 95 is 90 plus a little margin.
          gimbalRangeDeg: { pitch: 95, yaw: 35 },
          // Nominal thrust axis is up; the allocator moves it.
          nominal: [0, 0, 1],
        });
        k++;
      }
    }
  }

  /* --- medium manoeuvring thrusters ---------------------------------------------------------
   * Reversible ducted units set into the skin in four belts (upper port/stbd, lower port/stbd)
   * so lateral and vertical trim authority exists without moving a primary station. */
  {
    const n = cls.mediumThrusters;
    const belts = [Math.PI * 0.28, Math.PI * 0.72, Math.PI * 1.28, Math.PI * 1.72];
    for (let i = 0; i < n; i++) {
      const belt = belts[i % belts.length];
      const row = Math.floor(i / belts.length);
      const rows = Math.ceil(n / belts.length);
      const t = 0.16 + (0.68 * (row + 0.5)) / rows;
      // Recessed so the duct MOUTH is roughly flush with the skin. Placed on the surface, half the
      // duct hangs outside and the unit reads as bolted on rather than built in.
      const localRm = hullR(cls, stationX(cls, t)) * sectionScale(belt, cls.hull);
      const depth = (cls.mediumThrusterDiameterM / 2) * 0.62;
      const p = inside(cls, t, belt, Math.max(0.5, (localRm - depth * 0.9) / localRm));
      const outward = [0, -Math.cos(belt), Math.sin(belt)];
      layout.mediumThrusters.push({
        id: `MediumThruster_${pad(i)}`,
        index: i, t, p, outward,
        diameter: cls.mediumThrusterDiameterM,
        // Reversible along its duct axis, with a modest vector cone.
        gimbalRangeDeg: { pitch: 25, yaw: 25 },
        nominal: outward,
      });
    }
  }

  /* (Local trim fans are placed near the END of this function: a proud-mounted skin unit must
   * avoid the blower ports, sensor clusters, keel gear and fin roots, so it has to be placed
   * after all of them exist.) */

  /* --- water ---------------------------------------------------------------------------------
   * Distributed tanks in rings about the centre of buoyancy, in the lower half. Near the CB so
   * filling and dropping move the centre of mass as little as possible; distributed and in the
   * lower half so a partly-filled ship is stable rather than top-heavy. Explicitly NOT one large
   * tank: one tank is a free-surface problem, a single point of failure, and a torque generator
   * on release. */
  {
    const rings = cls.waterTankRings;
    // Distribute the configured tank count across the rings, remainder included. Rounding the
    // per-ring count and multiplying back silently BUILT FEWER TANKS THAN CONFIGURED — 15 instead
    // of 16 on the P-1000 — while capacity was still divided by the configured count, so the
    // vehicle could physically hold only 937.5 t of its stated 1000 t payload.
    const perRing = [];
    for (let ri = 0; ri < rings; ri++) {
      perRing.push(Math.floor(cls.waterTanks / rings) + (ri < cls.waterTanks % rings ? 1 : 0));
    }
    const builtTanks = perRing.reduce((a, n) => a + n, 0);
    let k = 0;
    for (let ri = 0; ri < rings; ri++) {
      const per = perRing[ri];
      const t = 0.42 + (ri - (rings - 1) / 2) * (0.11 + 0.02 * rings);
      for (let j = 0; j < per; j++) {
        // Lower hemisphere, spread across the beam, avoiding the exact keel (corridors live there).
        const frac = per === 1 ? 0.5 : j / (per - 1);
        const theta = Math.PI * (1.18 + 0.64 * frac);   // ~212deg .. ~328deg: the lower half
        const p = inside(cls, t, theta, 0.62);
        // Sized by what it holds: water is 1 t per m3, so the tank follows the payload split —
        // divided by the number of tanks that actually exist, not the number requested.
        const capacityTonnes = cls.payloadTonnes / builtTanks;
        const radius = capsuleRadiusForVolume(capacityTonnes, 3.1);
        layout.waterTanks.push({
          id: `WaterTank_${pad(k)}`, index: k, t, p,
          radius, length: radius * 3.1,
          capacityTonnes, volumeM3: capacityTonnes,
          ring: ri,
        });
        k++;
      }
    }
    // Fill and release manifolds run fore-aft near the keel, one per ring. They follow the keel
    // PATH rather than being one straight cylinder: a straight run at a fixed radius leaves the
    // hull wherever the section narrows, which on the P-10000 put 63 m of pipe outside the
    // aircraft. Each ring's manifold is also offset in azimuth so two of them cannot occupy the
    // same line.
    for (let ri = 0; ri < rings; ri++) {
      const t = 0.42 + (ri - (rings - 1) / 2) * (0.11 + 0.02 * rings);
      const theta = offCorridor(Math.PI * (1.5 + (ri - (rings - 1) / 2) * 0.13),
        cls.maintenanceCorridors);
      const t0 = Math.max(0.10, t - 0.13), t1 = Math.min(0.90, t + 0.13);
      const path = [];
      for (let k = 0; k <= 6; k++) path.push(inside(cls, t0 + ((t1 - t0) * k) / 6, theta, 0.80));
      layout.waterManifolds.push({
        id: `WaterManifold_${pad(ri)}`, index: ri, t, theta, path,
        radius: Math.max(0.30, R * 0.012),
        p: inside(cls, t, theta, 0.80),
      });
    }
    // Drop outlets: a symmetric line along the keel about the CB, so release is torque-neutral.
    const nOut = cls.dropOutlets;
    for (let i = 0; i < nOut; i++) {
      const half = Math.floor(nOut / 2);
      const side = i < half ? -1 : 1;
      const j = i < half ? half - i : i - half + 1;
      const t = 0.5 + side * (0.035 + (0.16 * j) / (half + 1));
      const theta = Math.PI * (1.5 + (i % 2 ? 0.06 : -0.06));
      layout.dropOutlets.push({
        id: `DropOutlet_${pad(i)}`, index: i, t, p: inside(cls, t, theta, 0.985),
        radius: Math.max(0.7, R * 0.028),
      });
    }
  }

  /* --- liquid nitrogen -----------------------------------------------------------------------
   * Compact, dense, heavily insulated, and placed just aft of the CB: LN2 is ballast, and ballast
   * that sits slightly aft trims the nose-up tendency of a light returning ship. */
  {
    const n = cls.ln2Tanks;
    // Sized by what they hold, at LN2's own density of 807 kg/m3 — LESS dense than water, so a
    // tonne takes about a quarter MORE room than a tonne of water does.
    const capacityTonnes = cls.ln2TankCapacityTonnes / n;
    const volumeM3 = (capacityTonnes * 1000) / RHO_LN2;
    const radius = capsuleRadiusForVolume(volumeM3, 3.4);
    const rows = Math.max(1, Math.ceil(n / 2));
    // The row pitch comes from the tanks' PHYSICAL length plus air, never from a fixed span:
    // on the P-10000 twenty tanks at the old fixed span overlapped end to end. The two sides
    // are also staggered half a pitch so they read interleaved, not paired.
    const pitchT = (radius * 3.4 * 1.25) / cls.lengthM;
    const spanT = Math.max(0.13, pitchT * rows);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      const t = 0.56 + spanT * (row / rows) + (side > 0 ? spanT / (2 * rows) : 0);
      const theta = Math.PI * (side > 0 ? 1.22 : 1.78);
      layout.ln2Tanks.push({
        id: `LN2Tank_${pad(i)}`, index: i, t,
        p: inside(cls, t, theta, 0.55),
        radius, length: radius * 3.4,
        capacityTonnes, volumeM3,
      });
    }
  }

  /* --- cryogenic plant ------------------------------------------------------------------------
   * One train per district, laid out in process order along the length so the cutaway reads as a
   * sequence: ram intake forward, compression, cold box, expander, back to the tanks. */
  {
    const trains = cls.cryoTrains;
    const stages = [
      ['CryoAirIntake', 0.14, 'intake'],
      ['CryoCompressor', 0.22, 'compress'],
      ['CryoColdBox', 0.30, 'coldbox'],
      ['CryoExpander', 0.38, 'expand'],
    ];
    for (let ti = 0; ti < trains; ti++) {
      const theta = offCorridor(Math.PI * (0.62 + (1.76 * (ti + 0.5)) / trains),
        cls.maintenanceCorridors);
      const train = { id: `CryoTrain_${pad(ti)}`, index: ti, modules: [] };
      const trainMW = cls.cryogenicPowerMW / trains;
      const trainVol = trainMW / PACKAGING.cryoMWPerM3;
      for (const [base, t, role] of stages) {
        const id = `${base}_${pad(ti)}`;
        // The intake is a SKIN feature, so it is placed flush and sized so it cannot protrude.
        const flush = base === 'CryoAirIntake';
        const share = role === 'coldbox' ? 0.45 : role === 'compress' ? 0.35 : 0.10;
        let size = role === 'coldbox'
          ? boxScaleForVolume(trainVol * share, 2.2, 1.2, 1.6)
          : boxScaleForVolume(trainVol * share, 1.6, 0.6, 0.6);
        if (flush) size = Math.min(size, hullR(cls, stationX(cls, t)) * 0.22);
        // A ram intake faces FORWARD, so its disc lies in the y-z plane and needs radial room.
        // Placing it at the skin puts half the disc outside the aircraft; it is set inboard by
        // its own radius instead.
        const discR = flush ? size * 0.8 : 0;
        const localR = hullR(cls, stationX(cls, t)) * sectionScale(theta, cls.hull);
        const f = flush ? Math.max(0.2, (localR - discR * 1.25 - 0.6) / localR) : 0.55;
        const p = inside(cls, t, theta, f);
        const m = { id, role, train: ti, t, p, size, flush, powerMW: trainMW * share };
        layout.cryoModules.push(m);
        train.modules.push(m);
      }
      layout.cryoTrains.push(train);
    }
  }

  /* --- power ---------------------------------------------------------------------------------
   * Generators in separated fire-isolation zones (never adjacent, never sharing a bay with a
   * battery bank); batteries distributed through the structure so the bus is short and no single
   * event takes the store; HVDC buses run fore-aft as separated port and starboard pairs. */
  {
    for (let i = 0; i < cls.generators; i++) {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      const rows = Math.max(1, Math.ceil(cls.generators / 2));
      const t = 0.30 + (0.42 * (row + 0.5)) / rows;
      const theta = Math.PI * (side > 0 ? 1.06 : 1.94);
      const powerMW = cls.generatorContinuousPowerMW / cls.generators;
      layout.generators.push({
        id: `Generator_${pad(i)}`, index: i, t, side,
        p: inside(cls, t, theta, 0.70),
        // Sized from its rating and a packaging density, so a bigger class gets bigger sets
        // rather than sets that scale with the hull for no reason.
        size: boxScaleForVolume(powerMW / PACKAGING.generatorMWPerM3, 2.0, 1.1, 1.1),
        powerMW,
      });
    }
    const br = streamFor(cls.structuralSeed, 'batt');
    for (let i = 0; i < cls.batteryModules; i++) {
      const t = 0.16 + 0.68 * ((i + 0.5) / cls.batteryModules);
      const theta = (i * 2.39996 + 1.1) % (2 * Math.PI);
      const energyMWh = cls.batteryEnergyMWh / cls.batteryModules;
      layout.batteries.push({
        id: `BatteryModule_${pad(i)}`, index: i, t,
        p: inside(cls, t + jitter(br, 0.01), theta, 0.72),
        size: boxScaleForVolume((energyMWh * 1000) / PACKAGING.batteryKWhPerM3, 1.6, 1.0, 0.7),
        energyMWh,
      });
    }
    for (let i = 0; i < cls.hvdcBuses; i++) {
      const theta = Math.PI * (0.5 + (2 * (i + 0.5)) / cls.hvdcBuses);
      layout.hvdcBuses.push({
        id: `HVDCBus_${pad(i)}`, index: i, theta,
        path: [0.12, 0.32, 0.5, 0.68, 0.88].map((t) => inside(cls, t, theta, 0.86)),
      });
    }
  }

  /* --- hose, reels and pump pods ---------------------------------------------------------------
   * On the keel, spread along the length on the larger classes so several pods can work without
   * their hoses fouling one another. The reel is the hardpoint; the pod is the robust end. */
  {
    const n = cls.hoseReels;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.50 : 0.34 + (0.34 * i) / (n - 1);
      const theta = Math.PI * (1.5 + (n === 1 ? 0 : (i % 2 ? 0.10 : -0.10)));
      const p = inside(cls, t, theta, 0.99);
      layout.hoseReels.push({
        id: `HoseReel_${pad(i)}`, index: i, t, p,
        radius: Math.max(1.8, R * 0.085),
      });
      layout.pumpPods.push({
        id: `PumpPod_${pad(i)}`, index: i, reel: i, p,
        length: Math.max(3.2, R * 0.14), radius: Math.max(0.9, R * 0.045),
      });
    }
  }

  /* --- tail surfaces ---------------------------------------------------------------------------
   * X arrangement: no surface is in the wake of another at small angles, and a jammed surface
   * leaves three usable axes rather than removing one axis entirely. */
  {
    const n = cls.tailSurfaces;
    const base = cls.tailArrangement === 'plus' ? 0 : Math.PI / 4;
    const t = 0.88;
    for (let i = 0; i < n; i++) {
      const theta = base + (2 * Math.PI * i) / n;
      const root = inside(cls, t, theta, 1.0);
      layout.tailSurfaces.push({
        id: `TailSurface_${pad(i)}`, index: i, theta, t, p: root,
        span: Math.max(6, R * 0.62), chord: Math.max(5, L * 0.055),
      });
    }
  }

  /* --- perception, mind, safety ----------------------------------------------------------------
   * Sensing where it can see: forward cluster in the nose, downward clusters on the keel either
   * side of the water gear, quarter clusters for traffic and weather, one aft. Compute is split
   * into separated bays; the deterministic safety kernel is in neither of them. */
  {
    const spots = [
      ['SensorCluster_Nose', 0.045, Math.PI * 1.5, 'forward EO/IR, radar, air data'],
      ['SensorCluster_KeelFwd', 0.36, Math.PI * 1.5, 'downward EO/IR, lidar, water-surface sensing'],
      ['SensorCluster_KeelAft', 0.64, Math.PI * 1.5, 'downward EO/IR, drop monitoring'],
      ['SensorCluster_PortQtr', 0.30, Math.PI * 1.05, 'lateral radar, weather'],
      ['SensorCluster_StbdQtr', 0.30, Math.PI * 1.95, 'lateral radar, weather'],
      ['SensorCluster_Dorsal', 0.28, Math.PI * 0.5, 'communications arrays, sky-side weather'],
      ['SensorCluster_Tail', 0.93, Math.PI * 0.5, 'aft-looking traffic, comms diversity'],
    ];
    for (const [id, t, theta, desc] of spots) {
      layout.sensors.push({ id, t, theta, p: inside(cls, t, theta, 0.99), desc,
        size: Math.max(1.2, R * 0.05) });
    }
    layout.compute.push({
      id: 'VehicleMindCompute', t: 0.40, p: inside(cls, 0.40, Math.PI * 0.88, 0.42),
      size: Math.max(2, R * 0.09),
    });
    layout.compute.push({
      id: 'VehicleMindCompute_B', t: 0.58, p: inside(cls, 0.58, Math.PI * 2.12 % (2 * Math.PI), 0.42),
      size: Math.max(2, R * 0.09),
    });
    layout.compute.push({
      id: 'SafetyKernel', t: 0.49, p: inside(cls, 0.49, Math.PI * 1.5, 0.40),
      size: Math.max(1.6, R * 0.065),
    });
  }

  /* --- maintenance and logistics ----------------------------------------------------------------
   * Corridors are holes in the structure, so the density field routes material around them (they
   * enter anchorsFor with a negative weight). Keel first, then spine, then quarters. */
  {
    // These azimuths are also consumed by CORRIDOR_ROUTES above, so the cryo trains and the water
    // manifolds are placed off them rather than being nudged apart afterwards.
    const routes = CORRIDOR_ROUTES;
    for (let i = 0; i < cls.maintenanceCorridors; i++) {
      const theta = routes[i % routes.length];
      layout.corridors.push({
        id: `MaintenanceCorridor_${pad(i)}`, index: i, theta,
        radius: Math.max(1.1, R * 0.045),
        p: inside(cls, 0.5, theta, 0.74),
        path: [0.14, 0.30, 0.5, 0.70, 0.86].map((t) => inside(cls, t, theta, 0.74)),
      });
    }
    if (cls.tankerDock) {
      layout.tankerDock = {
        id: 'TankerDock', t: 0.22, p: inside(cls, 0.22, Math.PI * 0.5, 0.99),
        size: Math.max(2.4, R * 0.11),
      };
    }
  }

  /* --- local trim fans ----------------------------------------------------------------------
   * Many small units scattered over the skin. Individually negligible; collectively they are how
   * local gust load is shed without commanding a whole-body attitude change.
   *
   * Placed LAST among the skin equipment: the golden-angle spread knows nothing about the blower
   * ports, sensor clusters, keel gear or fin roots, and a proud-mounted fan must not sit inside
   * any of them. A colliding candidate walks onward around the same spiral until it is clear.
   */
  {
    const n = cls.localTrimFans;
    const fr = streamFor(cls.structuralSeed, 'fans');
    const dia = Math.max(1.6, R * 0.055);
    const keepOut = [];
    for (const mt of layout.mediumThrusters) keepOut.push({ p: mt.p, r: (mt.diameter / 2) * 1.25 + 0.6 });
    for (const s of layout.sensors) keepOut.push({ p: s.p, r: s.size * 1.9 });
    for (const h of layout.hoseReels) keepOut.push({ p: h.p, r: h.radius * 1.5 });
    for (const o of layout.dropOutlets) keepOut.push({ p: o.p, r: o.radius * 2.2 });
    for (const ts of layout.tailSurfaces) keepOut.push({ p: ts.p, r: ts.chord * 0.8 });
    if (layout.tankerDock) keepOut.push({ p: layout.tankerDock.p, r: layout.tankerDock.size * 1.4 });
    const clear = (p) => keepOut.every((o) =>
      Math.hypot(p[0] - o.p[0], p[1] - o.p[1], p[2] - o.p[2]) >= o.r + dia / 2);
    for (let i = 0; i < n; i++) {
      // A quasi-uniform spread: golden-angle in theta, stratified in t.
      const t = 0.10 + 0.80 * ((i + 0.5) / n) + jitter(fr, 0.012);
      const tc0 = Math.min(0.97, Math.max(0.03, t));
      let theta = (i * 2.39996) % (2 * Math.PI);
      let tc = tc0, p = null;
      for (let attempt = 0; attempt < 48; attempt++) {
        const localRf = hullR(cls, stationX(cls, tc)) * sectionScale(theta, cls.hull);
        // PROUD of the skin, not recessed — a trim fan is smaller than one skin grid cell, so
        // no aperture is cut for it. Proud by MORE than the duct's own back-cup seal depth,
        // or the skin plane crosses the open bore and hull colour shows inside the ring
        // (BLOWER-PORT-DIAGNOSIS.md, D5). The offset is DERIVED, not a second magic number:
        // cup seal depth + the solar/underside bands' lift + a visible margin.
        const proud = dia * DUCT_SEAL_OF_DIAMETER + localRf * (HULL_BAND_LIFT - 1) + dia * 0.03;
        p = inside(cls, tc, theta, (localRf + proud) / localRf);
        if (clear(p)) break;
        theta = (theta + 2.39996 * 0.5) % (2 * Math.PI);
        if (attempt % 8 === 7) {
          const k = Math.floor(attempt / 8) + 1;
          tc = Math.min(0.97, Math.max(0.03, tc0 + (k % 2 ? 1 : -1) * 0.02 * k));
        }
      }
      const thetaF = Math.atan2(p[2], -p[1]);
      const outward = [0, -Math.cos(thetaF), Math.sin(thetaF)];
      layout.trimFans.push({
        id: `LocalTrimFan_${pad(i, 3)}`,
        index: i, t, theta: thetaF, p, outward,
        diameter: dia,
        nominal: outward,
      });
    }
  }

  /* --- section joints and solar zones --------------------------------------------------------- */
  {
    for (let i = 1; i < cls.structuralSections; i++) {
      const t = i / cls.structuralSections;
      layout.sectionJoints.push({ id: `SectionJoint_${pad(i - 1)}`, index: i - 1, t,
        p: [stationX(cls, t), 0, 0], radius: hullR(cls, stationX(cls, t)) });
    }
    // The solar field is the upper surface between the nose and tail transitions, in bands.
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const t0 = 0.14 + (0.68 * i) / bands, t1 = 0.14 + (0.68 * (i + 1)) / bands;
      layout.solarZones.push({ id: `SolarZone_${pad(i)}`, index: i, t0, t1,
        areaM2: cls.solarAreaM2 / bands });
    }
  }

  /* --- interconnect piping ----------------------------------------------------------------------
   * The plumbing that makes the water and nitrogen systems read as SYSTEMS instead of
   * disconnected boxes: every reel feeds a manifold, every tank taps one, every drop outlet
   * hangs off one, and every LN2 tank runs back to a cryogenic train. Routed as short
   * point-to-point runs to the NEAREST trunk — conceptual plumbing, not a pipe-stress layout. */
  {
    const nearPt = (p, pts) => {
      let best = pts[0], bd = Infinity;
      for (const q of pts) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d < bd) { bd = d; best = q; }
      }
      return best;
    };
    const wr = Math.max(0.30, R * 0.014);
    const mans = layout.waterManifolds;
    if (mans.length) {
      // Each branch remembers WHICH trunk point it taps, so the trunks can be trimmed to
      // their junction span afterwards — a manifold that runs on past its last tank or
      // outlet is pipe to nowhere.
      const used = mans.map(() => ({ lo: Infinity, hi: -Infinity }));
      const nearestJ = (p) => {
        let best = null;
        for (let mi = 0; mi < mans.length; mi++) {
          const path = mans[mi].path;
          for (let pi = 0; pi < path.length; pi++) {
            const q = path[pi];
            const dd = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            if (!best || dd < best.d) best = { d: dd, q, mi, pi };
          }
        }
        return best;
      };
      const branch = (p, radius, kind) => {
        const j = nearestJ(p);
        used[j.mi].lo = Math.min(used[j.mi].lo, j.pi);
        used[j.mi].hi = Math.max(used[j.mi].hi, j.pi);
        // path is stored EQUIPMENT -> TRUNK; the driver flips flow direction per phase
        layout.waterPipes.push({ path: [p, j.q], radius, kind });
      };
      for (const h of layout.hoseReels) branch(h.p, wr * 1.25, 'riser');
      for (const t of layout.waterTanks) {
        branch([t.p[0], t.p[1], t.p[2] - t.radius * 0.85], wr, 'feed');
      }
      for (const o of layout.dropOutlets) branch(o.p, wr, 'outlet');
      // Trim each trunk to the span its junctions actually use; drop untapped trunks.
      for (let mi = 0; mi < mans.length; mi++) {
        const u = used[mi];
        if (!isFinite(u.lo)) continue;
        const path = mans[mi].path;
        const lo = Math.max(0, Math.min(u.lo, path.length - 2));
        const hi = Math.min(path.length - 1, Math.max(u.hi, lo + 1));
        mans[mi].path = path.slice(lo, hi + 1);
        mans[mi].p = mans[mi].path[Math.floor(mans[mi].path.length / 2)];
      }
      layout.waterManifolds = mans.filter((_, mi) => isFinite(used[mi].lo));
    }
    const cryoPts = layout.cryoModules.map((m) => m.p);
    if (cryoPts.length) {
      const nr = Math.max(0.24, R * 0.011);
      for (const t of layout.ln2Tanks) {
        const tap = [t.p[0], t.p[1], t.p[2] + t.radius * 0.85];   // LN2 fills from the top
        layout.ln2Pipes.push({ path: [tap, nearPt(tap, cryoPts)], radius: nr });
      }
    }
  }

  /* --- resolve placement collisions -------------------------------------------------------------
   * Every component family is placed by its own independent rule — batteries on a golden-angle
   * spiral, cryo stages on a per-train azimuth, generators in fire-isolation pairs. Independent
   * rules do not know about each other, so some of them land inside a maintenance corridor or
   * inside each other. This pass resolves that: each offender is moved along its local radial
   * until it is clear of the corridors AND of everything already placed, while staying inside the
   * hull. Margins here match scripts/audit.mjs, which is what checks the result. */
  {
    const obstacles = [];
    for (const c of layout.corridors) {
      for (let i = 0; i < c.path.length - 1; i++) {
        obstacles.push({ a: c.path[i], b: c.path[i + 1], r: c.radius });
      }
    }
    for (const m of layout.waterManifolds) {
      for (let i = 0; i < m.path.length - 1; i++) {
        obstacles.push({ a: m.path[i], b: m.path[i + 1], r: m.radius });
      }
    }
    for (const t of layout.waterTanks) obstacles.push({ p: t.p, r: t.radius * 1.6 });
    for (const t of layout.ln2Tanks) obstacles.push({ p: t.p, r: t.radius * 1.8 });
    for (const h of layout.hoseReels) obstacles.push({ p: h.p, r: h.radius * 1.3 });

    const distTo = (o, p) => (o.a ? segPointDist(o.a, o.b, p)
      : Math.hypot(p[0] - o.p[0], p[1] - o.p[1], p[2] - o.p[2]));
    const clearOf = (p, half) => obstacles.every((o) => distTo(o, p) >= o.r + half);

    const place = (item, half) => {
      if (!clearOf(item.p, half)) {
        const theta = Math.atan2(item.p[2], -item.p[1]);
        const x = item.p[0];
        const skin = hullR(cls, x) * sectionScale(theta, cls.hull);
        const r0 = Math.hypot(item.p[1], item.p[2]);
        let moved = false;
        // Inboard first, then outboard: the middle of the body has the most free room.
        for (const dir of [-1, 1]) {
          for (let step = 1; step <= 20 && !moved; step++) {
            const r = r0 + dir * step * half * 0.4;
            if (r < half * 1.15 || r + half > skin) continue;
            const q = [x, -r * Math.cos(theta), r * Math.sin(theta)];
            if (clearOf(q, half)) { item.p = q; moved = true; }
          }
          if (moved) break;
        }
      }
      // Whatever ends up here becomes an obstacle for the next item, so two nudged components
      // cannot both move into the same free space.
      obstacles.push({ p: item.p, r: half });
    };

    // Margins are the audit's circumscribing radii plus a little, so a pass here means a pass there.
    for (const g of layout.generators) place(g, g.size * Math.hypot(1.0, 0.55, 0.55) * 1.05);
    for (const m of layout.cryoModules) if (!m.flush) place(m, m.size * 1.15);
    for (const m of layout.compute) place(m, m.size * 1.0);
    for (const b of layout.batteries) place(b, b.size * Math.hypot(0.8, 0.5, 0.35) * 1.05);
  }

  void rnd; void profileR; void hullPoint;
  return layout;
}

/** Flatten the layout into a single {id → record} map for lookups by the drivers. */
export function layoutIndex(layout) {
  const m = new Map();
  for (const k of Object.keys(layout)) {
    const v = layout[k];
    if (Array.isArray(v)) for (const r of v) { if (r && r.id) m.set(r.id, r); }
    else if (v && v.id) m.set(v.id, v);
  }
  return m;
}
