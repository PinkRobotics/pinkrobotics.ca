/* Central configuration for the conceptual airship family.
 *
 * EVERY speculative number in this system lives here. Components read config; they do not carry
 * constants of their own. If a figure, a label or a piece of geometry disagrees with this file,
 * this file is right and the other is a bug.
 *
 * PROVENANCE. Payload, displacement and the illustrative length/diameter are the same figures the
 * pinkrobotics.ca homepage ledger and the /airships page already publish (the P-100's ~180,000 m3
 * is the homepage's "220 tonnes of air at 1.225 kg/m3" premise, restated as an elongated body
 * instead of a 70 m sphere). Everything below that line — rotor counts, tank counts, cell sizes,
 * plant capacities, structural spacing — is CONCEPTUAL LAYOUT chosen to make the machine legible.
 * None of it is a completed engineering design and none of it is claimed as one. The claimLevel
 * field on each component's metadata says which is which, part by part.
 *
 * WHAT IS DELIBERATELY *NOT* UNIFORM SCALING. The three classes are one design family, not one
 * mesh at three sizes. Two physical arguments drive the differences:
 *   1. Rotor diameter is set by disc loading and by what can be built and gimballed, so it grows
 *      far more slowly than the hull. The P-10000 is 4.6x the P-100's length but its rotors are
 *      only ~2.3x, which is exactly why its thrust stations become a distributed network rather
 *      than a recognisable four-rotor layout.
 *   2. Structural cell size is set by buckling and by manufacture, not by vehicle size, so it
 *      grows slower still. The big ships therefore look *finer*-grained, not coarser — the sponge
 *      gets more cells, not bigger ones.
 */

/** Sea-level air density used for the buoyancy ledger. Matches the homepage figure. */
export const RHO_SL = 1.225;
/** Working-band air density (~1000 m). Matches the /airships page's CFG.rhoAir default. */
export const RHO_AIR = 1.10;
export const G = 9.81;

/**
 * Demonstration assumptions shared with the wildfire page. These are FALLBACKS: when the host page
 * owns them (it does), `setAssumptions()` overwrites them from the host so there is one source of
 * truth at runtime and this file is only the default for the standalone lab.
 */
export const ASSUMPTIONS = {
  eLN2: 0.45,        // kWh per kg to liquefy nitrogen from air. Exploratory range 0.30-0.80.
  eLN2Range: [0.30, 0.80],
  rtLN2: 0.50,       // electrical round-trip efficiency of the nitrogen store. Range 0.35-0.60.
  rtLN2Range: [0.35, 0.60],
  hoseHead: 250,     // m of vertical pumping head at the source
  pumpEta: 0.75,
  propEta: 0.70,
  Cd: 0.05,
  rhoAir: RHO_AIR,
  rhoSL: RHO_SL,
};

export function setAssumptions(patch) {
  Object.assign(ASSUMPTIONS, patch || {});
  return ASSUMPTIONS;
}

/* -------------------------------------------------------------------------------------------
 * Physical densities, and the packaging densities used to size machinery.
 *
 * COMPONENTS ARE SIZED BY WHAT THEY HOLD OR WHAT THEY DO, never by a fraction of the hull. Sizing
 * a tank as "13.5% of the hull radius" produces a tank that grows with the vehicle instead of with
 * its contents: on the P-10000 that made every water tank 4.4x too big and every LN2 tank 5.8x too
 * big, which is both a collision (they overlap) and a lie (the payload volume is TINY beside the
 * lifting volume, and that contrast is one of the things this model exists to show).
 * ------------------------------------------------------------------------------------------- */

/** Liquid nitrogen at 1 atm, kg/m3. Known physics. */
export const RHO_LN2 = 807;
export const RHO_WATER = 1000;

/**
 * Packaging densities for machinery modules — conceptual-layout assumptions, chosen to give
 * plausible box sizes, not sourced from a product.
 */
export const PACKAGING = {
  generatorMWPerM3: 0.30,     // a complete genset package including its cooling
  batteryKWhPerM3: 250,       // a packaged module, not bare cells
  cryoMWPerM3: 0.15,          // compression and cold-box plant
};

/**
 * Radius of a capsule (cylinder with domed ends) of total length `lengthRatio * r` that holds
 * `volM3`. For the 3.1:1 capsule used by the tanks that is V = 7.64 r^3.
 */
export function capsuleRadiusForVolume(volM3, lengthRatio = 3.1) {
  const k = Math.PI * (lengthRatio - 2) + (4 / 3) * Math.PI;
  return Math.cbrt(Math.max(1e-9, volM3) / k);
}

/** Edge scale `s` of a box of proportions (a,b,c)*s that holds `volM3`. */
export function boxScaleForVolume(volM3, a, b, c) {
  return Math.cbrt(Math.max(1e-9, volM3) / (a * b * c));
}

/* -------------------------------------------------------------------------------------------
 * Hull shape family.
 *
 * The body is axisymmetric-with-a-flattened-top: a profile radius r(x) revolved through a
 * cross-section whose upper half is slightly flattened to carry solar. One function pair —
 * profileR() and sectionScale() — is used by the skin, the frames, the lattice, the cell packing
 * and the SVG silhouette, so all five agree by construction.
 * ------------------------------------------------------------------------------------------- */

export const HULL_DEFAULT = {
  xMax: 0.36,        // station of the maximum section, as a fraction of length
  noseExp: 2.15,     // nose fullness: higher is blunter
  noseRoot: 2.0,
  tailExp: 2.55,     // tail fineness: higher is a longer, finer run-out
  tailRoot: 2.15,
  tailStub: 0.018,   // the tail does not close to a point; this is the stub radius / max radius
  noseStub: 0.010,
  topFlat: 0.13,     // fraction the upper surface is flattened by, for the solar field
  bottomFlat: 0.05,  // slight keel flattening where the water and hose gear mounts
};

/**
 * Hull radius at station t in [0,1] (0 = nose, 1 = tail), as a fraction of the maximum radius.
 * Two power-law lobes meeting at xMax with r = 1 and zero slope discontinuity in practice.
 */
export function profileR(t, h = HULL_DEFAULT) {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let r;
  if (u <= h.xMax) {
    const q = (h.xMax - u) / h.xMax;                       // 1 at the nose, 0 at max section
    r = Math.pow(1 - Math.pow(q, h.noseExp), 1 / h.noseRoot);
    r = Math.max(r, h.noseStub * (1 - q) + h.noseStub);
  } else {
    const q = (u - h.xMax) / (1 - h.xMax);                 // 0 at max section, 1 at the tail
    r = Math.pow(1 - Math.pow(q, h.tailExp), 1 / h.tailRoot);
    r = Math.max(r, h.tailStub);
  }
  return Math.max(0, Math.min(1, r));
}

/**
 * Cross-section radial scale at hull angle theta (0 = starboard, +pi/2 = up), as a fraction of the
 * circular radius. Flattens the top for the solar field and the keel slightly for the water gear.
 */
export function sectionScale(theta, h = HULL_DEFAULT) {
  const s = Math.sin(theta);
  if (s >= 0) return 1 - h.topFlat * s * s;
  return 1 - h.bottomFlat * s * s;
}

/** Cross-sectional area at station t, for the maximum radius R. Numeric over theta. */
export function sectionArea(t, R, h = HULL_DEFAULT, n = 72) {
  const r = profileR(t, h) * R;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * (i + 0.5)) / n;
    const rr = r * sectionScale(th, h);
    a += 0.5 * rr * rr * (2 * Math.PI / n);
  }
  return a;
}

/** Displaced volume of the hull, m3, by Simpson over stations. */
export function hullVolume(lengthM, maxRadiusM, h = HULL_DEFAULT, n = 200) {
  const N = n % 2 ? n + 1 : n;
  const dx = lengthM / N;
  let v = 0;
  for (let i = 0; i <= N; i++) {
    const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    v += w * sectionArea(i / N, maxRadiusM, h);
  }
  return (v * dx) / 3;
}

/** Longitudinal centre of buoyancy, measured from the nose in metres. */
export function hullCentroidX(lengthM, maxRadiusM, h = HULL_DEFAULT, n = 200) {
  const N = n % 2 ? n + 1 : n;
  const dx = lengthM / N;
  let m = 0, v = 0;
  for (let i = 0; i <= N; i++) {
    const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    const a = sectionArea(i / N, maxRadiusM, h);
    v += w * a;
    m += w * a * (i / N) * lengthM;
  }
  return v > 0 ? m / v : lengthM / 2;
}

/**
 * Solve for the maximum radius that makes the shaped hull displace exactly `targetM3` at the given
 * length. For a fixed length and a fixed profile the volume is exactly quadratic in R (every
 * section area scales with R^2), so the sqrt step is a one-shot solve; the loop only exists to
 * hold the invariant if the profile ever becomes R-dependent.
 */
export function radiusForVolume(lengthM, targetM3, h = HULL_DEFAULT) {
  let R = Math.sqrt(targetM3 / (lengthM * Math.PI)) * 2;   // rough start
  for (let i = 0; i < 3; i++) {
    const v = hullVolume(lengthM, R, h);
    if (!(v > 0)) break;
    R *= Math.sqrt(targetM3 / v);
  }
  return R;
}

/* -------------------------------------------------------------------------------------------
 * The three classes.
 * ------------------------------------------------------------------------------------------- */

/** @typedef {'P100'|'P1000'|'P10000'} AirshipClassId */

const CLASS_SPECS = {
  P100: {
    id: 'P100',
    name: 'P-100',
    payloadTonnes: 100,
    displacementM3: 180000,
    lengthM: 177,
    nominalDiameterM: 44,          // the published illustrative figure, for cross-checking
    use: 'Initial attack and small incidents close to water',

    // --- actuation -------------------------------------------------------------------------
    primaryRotorStations: 4,       // two per side, forward and aft of the maximum section
    rotorsPerStation: 2,           // counter-rotating pair on a common gimbal
    primaryRotorDiameterM: 20,
    publishedDiscAreaM2: 2500,   // /airships page CLASSES.P100.diskM2
    stationLayout: 'quad',         // 'quad' | 'hex' | 'network'
    mediumThrusters: 8,
    mediumThrusterDiameterM: 7,
    localTrimFans: 48,
    tailArrangement: 'x',          // 'x' | 'plus' | 'invertedY'
    tailSurfaces: 4,

    // --- water -----------------------------------------------------------------------------
    waterTanks: 8,
    waterTankRings: 2,
    dropOutlets: 12,
    pumpPods: 1,
    hoseReels: 1,
    fillRateM3s: 0.5,

    // --- cryogenic -------------------------------------------------------------------------
    cryoTrains: 1,
    ln2Tanks: 4,
    ln2TankCapacityTonnes: 30,
    cryogenicPowerMW: 6,

    // --- power -----------------------------------------------------------------------------
    generators: 2,
    generatorContinuousPowerMW: 8,
    batteryModules: 12,
    batteryEnergyMWh: 20,
    batteryPeakPowerMW: 30,
    solarAreaM2: 6000,
    hvdcBuses: 2,

    // --- structure -------------------------------------------------------------------------
    macroFrameCount: 9,
    longerons: 12,
    structuralSections: 5,         // replaceable districts along the length
    cellSizeM: 9,                  // representative sealed-cell pitch
    structuralDensity: 1.0,
    structuralSeed: 1747,
    maintenanceCorridors: 2,
    tankerDock: true,

    // --- motion envelope (illustrative; drives how measured the body looks) -----------------
    maxPitchRateDegS: 1.8,
    maxYawRateDegS: 2.2,
    maxRollRateDegS: 1.4,

    visualDetail: { closeCellModules: 260, mediumCellModules: 90, mapTrianglesTarget: 900 },
  },

  P1000: {
    id: 'P1000',
    name: 'P-1000',
    payloadTonnes: 1000,
    displacementM3: 1.8e6,
    lengthM: 380,
    nominalDiameterM: 95,
    use: 'Sustained delivery on project fires and fires of note',

    primaryRotorStations: 6,
    rotorsPerStation: 2,
    primaryRotorDiameterM: 36,
    publishedDiscAreaM2: 12000,  // /airships page CLASSES.P1000.diskM2
    stationLayout: 'hex',
    mediumThrusters: 16,
    mediumThrusterDiameterM: 11,
    localTrimFans: 96,
    tailArrangement: 'x',
    tailSurfaces: 4,

    waterTanks: 16,
    waterTankRings: 3,
    dropOutlets: 24,
    pumpPods: 4,
    hoseReels: 4,
    fillRateM3s: 3,

    cryoTrains: 2,
    ln2Tanks: 8,
    ln2TankCapacityTonnes: 150,
    cryogenicPowerMW: 30,

    generators: 4,
    generatorContinuousPowerMW: 40,
    batteryModules: 28,
    batteryEnergyMWh: 120,
    batteryPeakPowerMW: 150,
    solarAreaM2: 28000,
    hvdcBuses: 4,

    macroFrameCount: 13,
    longerons: 16,
    structuralSections: 7,
    cellSizeM: 12,
    structuralDensity: 1.05,
    structuralSeed: 3391,
    maintenanceCorridors: 4,
    tankerDock: true,

    maxPitchRateDegS: 1.1,
    maxYawRateDegS: 1.4,
    maxRollRateDegS: 0.9,

    visualDetail: { closeCellModules: 380, mediumCellModules: 130, mapTrianglesTarget: 900 },
  },

  P10000: {
    id: 'P10000',
    name: 'P-10000',
    payloadTonnes: 10000,
    displacementM3: 1.8e7,
    lengthM: 820,
    nominalDiameterM: 205,
    use: 'Campaign fires, long hauls, and moving water between regions',

    // The four-rotor reading breaks down here on purpose: fourteen stations distributed over the
    // length, none of them individually decisive.
    primaryRotorStations: 14,
    rotorsPerStation: 2,
    // 85 m discs: the page respecced this class (2026-08-08) so a full 10,000 t dump can be
    // pushed back down on rotors alone — no retained descent ballast. Adjacent stations sit
    // ~90 m apart, so 85 m is as large as the discs can go without touching.
    primaryRotorDiameterM: 85,
    publishedDiscAreaM2: 160000,  // /airships page CLASSES.P10000.diskM2
    stationLayout: 'network',
    mediumThrusters: 32,
    mediumThrusterDiameterM: 15,
    localTrimFans: 220,
    tailArrangement: 'x',
    tailSurfaces: 4,

    waterTanks: 40,
    waterTankRings: 4,
    dropOutlets: 48,
    pumpPods: 6,
    hoseReels: 6,
    fillRateM3s: 15,

    cryoTrains: 5,
    ln2Tanks: 20,
    ln2TankCapacityTonnes: 700,
    cryogenicPowerMW: 100,

    generators: 10,
    generatorContinuousPowerMW: 150,
    batteryModules: 60,
    batteryEnergyMWh: 500,
    batteryPeakPowerMW: 500,
    solarAreaM2: 120000,
    hvdcBuses: 6,

    macroFrameCount: 19,
    longerons: 20,
    structuralSections: 11,
    cellSizeM: 16,
    structuralDensity: 1.12,
    structuralSeed: 8123,
    maintenanceCorridors: 8,
    tankerDock: true,

    maxPitchRateDegS: 0.6,
    maxYawRateDegS: 0.8,
    maxRollRateDegS: 0.5,

    visualDetail: { closeCellModules: 520, mediumCellModules: 170, mapTrianglesTarget: 900 },
  },
};

export const CLASS_IDS = ['P100', 'P1000', 'P10000'];

/**
 * Resolve a class spec into the derived geometry every other module consumes.
 *
 * The radius is SOLVED so the shaped hull displaces exactly `displacementM3` — the published lift
 * premise is the invariant, and the maximum diameter is whatever that costs. The nominal diameter
 * stays in the spec so `validateClass` can report the difference instead of hiding it.
 */
export function resolveClass(id, overrides = {}) {
  const spec = CLASS_SPECS[id];
  if (!spec) throw new Error(`unknown airship class: ${id}`);
  const c = { ...spec, ...overrides };
  c.hull = { ...HULL_DEFAULT, ...(overrides.hull || {}) };

  c.maxRadiusM = radiusForVolume(c.lengthM, c.displacementM3, c.hull);
  c.diameterM = c.maxRadiusM * 2;
  c.finenessRatio = c.lengthM / c.diameterM;
  c.volumeM3 = hullVolume(c.lengthM, c.maxRadiusM, c.hull);
  c.centroidXFromNoseM = hullCentroidX(c.lengthM, c.maxRadiusM, c.hull);
  // Model origin sits at the centre of buoyancy: station x = 0 there, nose at +xNose.
  c.xNose = c.centroidXFromNoseM;
  c.xTail = c.centroidXFromNoseM - c.lengthM;

  // Lift ledger — the same arithmetic the homepage prints.
  c.displacedAirTonnes = (c.displacementM3 * RHO_SL) / 1000;
  c.structureAllowanceTonnes = c.payloadTonnes;         // the ledger's bet: structure = payload
  c.surplusTonnes = c.displacedAirTonnes - c.structureAllowanceTonnes;
  c.reserveTonnes = c.surplusTonnes - c.payloadTonnes;

  // Payload volume, for the scale scene: 1 t of water is 1 m3.
  c.payloadVolumeM3 = c.payloadTonnes;
  c.payloadCubeEdgeM = Math.cbrt(c.payloadVolumeM3);

  // Representative cell count. Cell pitch is a manufacturing constant, not a scaled dimension,
  // which is why the big ships read as finer-grained rather than as enlargements.
  c.approxCellCount = Math.round(c.volumeM3 / Math.pow(c.cellSizeM, 3));

  // Total primary disc area. Rotor diameter is chosen so this lands on the disc area the
  // /airships page already publishes for the class, because that number drives its descent-power
  // arithmetic — the 3D model must not quietly disagree with the page it illustrates.
  c.totalDiscAreaM2 = c.primaryRotorStations * c.rotorsPerStation *
    Math.PI * Math.pow(c.primaryRotorDiameterM / 2, 2);
  c.sectionLengthM = c.lengthM / c.structuralSections;

  return c;
}

/** Station coordinate (metres, model frame) from a normalised hull station t in [0,1]. */
export const stationX = (c, t) => c.xNose - t * c.lengthM;
/** Inverse of stationX. */
export const stationT = (c, x) => (c.xNose - x) / c.lengthM;
/** Hull radius in metres at model-frame x. */
export const hullR = (c, x) => profileR(stationT(c, x), c.hull) * c.maxRadiusM;
/** Hull surface point at model-frame x and hull angle theta. */
export function hullPoint(c, x, theta) {
  const r = hullR(c, x) * sectionScale(theta, c.hull);
  return [x, -r * Math.cos(theta), r * Math.sin(theta)];
}

/* Duct proportions that TWO files must agree on. A trim fan gets no aperture (it is smaller
 * than a skin grid cell) — it stands proud instead, and the only thing hiding the hull from
 * its bore is the duct's own back cup, which ductHousingGeom attaches depthRatio·R behind the
 * duct centre. layout.js must therefore mount the fan proud by MORE than that seal depth.
 * These lived as magic numbers in build.js and layout.js and drifted (see
 * BLOWER-PORT-DIAGNOSIS.md, D5); this is their one home now. */
export const TRIM_FAN_DEPTH_RATIO = 0.45;
export const DUCT_SEAL_OF_DIAMETER = TRIM_FAN_DEPTH_RATIO / 2;   // seal depth as dia fraction
/** The solar/underside bands draw this factor proud of the fairing (hullBandGeom's lift). */
export const HULL_BAND_LIFT = 1.004;

/**
 * Validate a resolved class. Returns a list of problems — empty means consistent. Used by the
 * tests and printed by the lab, so a bad override is visible rather than silently drawn.
 */
export function validateClass(c) {
  const errs = [];
  const req = ['payloadTonnes', 'displacementM3', 'lengthM', 'primaryRotorStations',
    'waterTanks', 'ln2Tanks', 'generators', 'macroFrameCount', 'cellSizeM'];
  for (const k of req) {
    if (!(typeof c[k] === 'number' && isFinite(c[k]) && c[k] > 0)) {
      errs.push(`${c.id}: ${k} must be a positive number (got ${c[k]})`);
    }
  }
  const volErr = Math.abs(c.volumeM3 - c.displacementM3) / c.displacementM3;
  if (volErr > 0.001) {
    errs.push(`${c.id}: solved hull displaces ${Math.round(c.volumeM3)} m3, ` +
      `${(volErr * 100).toFixed(2)}% off the ${c.displacementM3} m3 premise`);
  }
  // The published illustrative diameter and the solved one should agree to a few percent; the
  // shaped hull is not a pure prolate spheroid, so exact agreement would be suspicious.
  const dErr = Math.abs(c.diameterM - c.nominalDiameterM) / c.nominalDiameterM;
  if (dErr > 0.12) {
    errs.push(`${c.id}: solved diameter ${c.diameterM.toFixed(1)} m is ${(dErr * 100).toFixed(1)}% ` +
      `from the published ${c.nominalDiameterM} m — the profile or the premise moved`);
  }
  if (c.finenessRatio < 2 || c.finenessRatio > 9) {
    errs.push(`${c.id}: fineness ratio ${c.finenessRatio.toFixed(2)} outside the plausible 2-9 band`);
  }
  if (c.primaryRotorDiameterM > c.diameterM * 1.2) {
    errs.push(`${c.id}: rotors (${c.primaryRotorDiameterM} m) wider than the hull allows`);
  }
  if (c.publishedDiscAreaM2) {
    const aErr = Math.abs(c.totalDiscAreaM2 - c.publishedDiscAreaM2) / c.publishedDiscAreaM2;
    if (aErr > 0.10) {
      errs.push(`${c.id}: primary disc area ${Math.round(c.totalDiscAreaM2)} m2 is ` +
        `${(aErr * 100).toFixed(1)}% from the published ${c.publishedDiscAreaM2} m2`);
    }
  }
  if (c.cellSizeM > c.maxRadiusM) {
    errs.push(`${c.id}: cell pitch ${c.cellSizeM} m exceeds the hull radius — no sponge left`);
  }
  return errs;
}

/** All three classes, resolved. */
export const classes = () => CLASS_IDS.map((id) => resolveClass(id));
export const rawSpec = (id) => CLASS_SPECS[id];
