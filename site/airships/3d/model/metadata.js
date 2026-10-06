/* Component metadata — the explanatory payload.
 *
 * Every selectable node has a record here. Selection, the DOM component list, the info panel, the
 * static figures and the accessibility text all read from this and never from the display name,
 * so a node can be renamed in the tree without breaking a caption.
 *
 * `claimLevel` is the most important field on this page and is not decoration:
 *
 *   known-physics         the behaviour follows from physics that is not in dispute
 *   reference-assumption  a number taken from the published ledger or the wildfire page
 *   conceptual-layout     an arrangement chosen to make the machine legible; not a design
 *   future-research       the thing does not exist and the open problem is named
 *
 * A component that would need a working vacuum cell to exist at all is `future-research`, however
 * ordinary its own engineering is. That is the honest reading: no flightworthy vacuum airship
 * exists, and the first physical gate is still one complete positively buoyant evacuated cell.
 *
 * MASS BUDGET. The homepage ledger's bet is that the entire dry vehicle equals the payload mass
 * (100 t of structure for 100 t of water). Nominal component masses below are that budget split
 * by system, so the parts sum to the ledger rather than to an invented total. They are allocations,
 * not weights.
 */

import { CATEGORIES } from '../core/nodes.js?v=91301eab';
import { ASSUMPTIONS } from './config.js?v=91301eab';

/** Fraction of the dry mass allowance each system gets. Sums to 1. */
export const MASS_SHARE = {
  fairing: 0.16, solar: 0.05, lattice: 0.30, frames: 0.04,   // structure + vacuum: 55%
  water: 0.12,
  cryo: 0.09,
  power: 0.14,
  propulsion: 0.08,
  avionics: 0.02,
};

const CLAIM = {
  physics: 'known-physics',
  ref: 'reference-assumption',
  layout: 'conceptual-layout',
  research: 'future-research',
};

/**
 * Templates keyed by node-id prefix. `n(cls, layout)` gives the instance count so per-item mass
 * and power divide correctly; `desc` may be a function of (cls, rec, layout).
 */
const TEMPLATES = [
  /* ---- structure and lift ---------------------------------------------------------------- */
  {
    prefix: 'OuterFairing', label: 'Outer aerodynamic fairing', category: 'structure',
    claim: CLAIM.layout, share: 'fairing', n: () => 1,
    desc: () =>
      'A lightweight weather, impact and flow-control skin over the structure, in serviceable ' +
      'panels. It is NOT the pressure boundary: it carries aerodynamic and weather loads only. ' +
      'The atmosphere is resisted by the sealed cells inside, each over its own small span.',
    related: ['SolarSkin', 'VacuumStructure'],
  },
  {
    prefix: 'SolarSkin', label: 'Solar collection skin', category: 'power',
    claim: CLAIM.ref, share: 'solar', n: () => 1,
    power: (cls) => (cls.solarAreaM2 * ASSUMPTIONS.solarWPerM2) / 1e6,
    desc: (cls) =>
      `The upper surface as a collection area — about ${cls.solarAreaM2.toLocaleString()} m² on ` +
      'this class. Sized from the published assumption, not from a panel layout. It is a ' +
      'contribution to the bus, not a propulsion source: at cruise it covers hotel load and a ' +
      'fraction of the cryogenic plant, not the rotors.',
    state: 'solarPowerMW',
  },
  {
    prefix: 'HullUnderside', label: 'High-visibility underside', category: 'structure',
    claim: CLAIM.layout, share: 'fairing', n: () => 1,
    desc: () =>
      'The lower half of the fairing, finished in high-visibility pink. This is a conspicuity ' +
      'choice, not styling: an aircraft working low over terrain is seen from below by other ' +
      'aircraft and from the ground, and a dark underside against dark ground is the hard case. ' +
      'It is the one place on the vehicle where the brand colour is doing a job.',
    related: ['OuterFairing', 'SolarSkin'],
  },
  {
    prefix: 'VacuumStructure', label: 'Vacuum structure (all)', category: 'vacuum',
    claim: CLAIM.research, share: 'lattice', n: () => 1,
    desc: () =>
      'The whole load-bearing volume: a three-dimensional lattice filled with many independently ' +
      'sealed evacuated cells. This is the part that does not exist. The first physical gate for ' +
      'the entire project is one complete evacuated cell that is positively buoyant — not a ship, ' +
      'not a section, one cell.',
    related: ['MacroFrame_00', 'VacuumCellModules'],
  },
  {
    prefix: 'MacroFrame', label: 'Ring frame', category: 'structure',
    claim: CLAIM.layout, share: 'frames', n: (cls) => cls.macroFrameCount + 1,
    desc: () =>
      'A deep transverse frame: outer ring, inner ring, radial webs. It holds the section shape ' +
      'against bending and gives the lattice something to react local loads into.',
  },
  {
    prefix: 'Longeron', label: 'Longitudinal load path', category: 'structure',
    claim: CLAIM.layout, share: 'frames', n: (cls) => cls.longerons,
    desc: () =>
      'Continuous fore-aft members just inside the fairing, where a given mass of material buys ' +
      'the most bending stiffness. They tie the ring frames into one beam.',
  },
  {
    prefix: 'Keel', label: 'Keel', category: 'structure',
    claim: CLAIM.layout, share: 'frames', n: () => 1,
    desc: () =>
      'The heaviest single run in the vehicle. It carries the hose reels, the pump-pod loads, the ' +
      'drop manifolds and the ground-handling reactions.',
  },
  {
    prefix: 'VacuumCellModule', label: 'Sealed vacuum cell (representative)', category: 'vacuum',
    claim: CLAIM.research, share: 'lattice', n: (cls) => Math.max(1, cls.approxCellCount),
    desc: (cls) =>
      `One evacuated cell of roughly ${cls.cellSizeM} m pitch. The drawn cells are ` +
      'REPRESENTATIVE — a readable sample, not the real count, which is on the order of ' +
      `${cls.approxCellCount.toLocaleString()} for this class. Each is independently sealed so ` +
      'that losing one is a local event.',
    state: 'failedComponents',
  },
  {
    prefix: 'SectionJoint', label: 'Section joint', category: 'maintenance',
    claim: CLAIM.layout, share: 'frames', n: (cls) => cls.structuralSections - 1,
    desc: (cls) =>
      `A boundary between replaceable structural districts — ${cls.structuralSections} of them on ` +
      'this class. Vacuum isolation valves, structural splices and service connections all cross ' +
      'here, so a damaged district can be isolated and, in principle, exchanged.',
  },
  {
    prefix: 'VacuumIsolationValve', label: 'Vacuum isolation valve', category: 'vacuum',
    claim: CLAIM.layout, share: 'frames', n: (cls) => cls.structuralSections * 4,
    desc: () =>
      'Closes a cell group off from its neighbours. The design objective is that a breach stays ' +
      'the size of the group it happened in. Containment is an objective here, not a result.',
  },

  /* ---- water ------------------------------------------------------------------------------ */
  {
    prefix: 'WaterTank', label: 'Water tank', category: 'water',
    claim: CLAIM.layout, share: 'water', n: (cls) => cls.waterTanks,
    desc: (cls, rec) =>
      `One of ${cls.waterTanks} tanks, about ${(cls.payloadTonnes / cls.waterTanks).toFixed(0)} t ` +
      'each, grouped about the centre of buoyancy in the lower half of the body. Distributed ' +
      'rather than single because one large tank is a free-surface problem, a single point of ' +
      'failure, and a torque generator the moment it empties unevenly.' +
      (rec && rec.ring !== undefined ? ` Ring ${rec.ring + 1}.` : ''),
    state: 'waterFraction',
    related: ['WaterManifold_00', 'DropOutlet_00'],
  },
  {
    prefix: 'WaterManifold', label: 'Fill and release manifold', category: 'water',
    claim: CLAIM.layout, share: 'water', n: (cls) => cls.waterTankRings,
    desc: () =>
      'Interconnects a ring of tanks for filling, for cross-levelling in flight, and for release. ' +
      'Isolation valves let a tank be taken out of the group.',
    state: 'waterFraction',
  },
  {
    prefix: 'DropOutlet', label: 'Distributed drop outlet', category: 'water',
    claim: CLAIM.layout, share: 'water', n: (cls) => cls.dropOutlets,
    desc: (cls) =>
      `One of ${cls.dropOutlets} outlets along the underside of the raft, spanning the water ` +
      'tanks and arranged symmetrically about the centre of buoyancy. Release is spread across ' +
      'them so mass leaves without a large unbalanced moment. There is no bomb bay — and no ' +
      'outlet through the hull, which nothing is allowed to pierce.',
    state: 'waterReleaseProgress',
  },
  {
    prefix: 'HoseReel', label: 'Hose reel and winch', category: 'water',
    claim: CLAIM.layout, share: 'water', n: (cls) => cls.hoseReels,
    desc: (cls) =>
      `Powered reel carrying the hose, its conductors and the pod. About ${cls.hoseReels} on this ` +
      'class, spaced along the keel so several pods can work without fouling.',
    state: 'hoseProgress',
    related: ['Hose_00', 'PumpPod_00'],
  },
  {
    prefix: 'Hose', label: 'Intake hose and tether', category: 'water',
    claim: CLAIM.physics, share: 'water', n: (cls) => cls.hoseReels,
    desc: () =>
      'A flexible line carrying water upward plus the power and communication conductors for the ' +
      'pod. It hangs as a loaded curve and takes tension; it is not a rigid pipe and cannot be ' +
      'drawn as one.',
    state: 'hoseProgress',
  },
  {
    prefix: 'PumpPod', label: 'Submerged pump pod', category: 'water',
    claim: CLAIM.physics, share: 'water', n: (cls) => cls.pumpPods,
    desc: (cls) =>
      'The robust water-contact end: redundant pump elements, intake screens, cameras and sonar, ' +
      'and small positioning thrusters. The pump is HERE, at the bottom, pushing water up — an ' +
      'onboard suction pump cannot lift water more than about 10 m of head no matter how powerful ' +
      `it is, and the working head on this class is ${cls.hoseLengthM} m. The pod can be ` +
      'released in an emergency.',
    state: 'pumpPodDepthM',
  },
  {
    prefix: 'AnchorWinch', label: 'Descent anchor winch', category: 'water',
    claim: CLAIM.layout, share: 'water', n: () => 1,
    desc: (cls) =>
      `One winch, on the keel at mid-length, carrying ${cls.anchorBagTonnes.toLocaleString('en-CA')} t on a ` +
      `${cls.anchorCableM} m cable. It is at the centre because anywhere else makes a pitching ` +
      'moment the size of the load.',
    state: 'anchorProgress',
    related: ['AnchorCable', 'AnchorBag'],
  },
  {
    prefix: 'AnchorCable', label: 'Descent anchor cable', category: 'water',
    claim: CLAIM.physics, share: 'water', n: () => 1,
    desc: (cls) => {
      const mn = Math.round(cls.anchorBagTonnes * 9.81 / 100) / 10;   // MN, one decimal
      return `Synthetic rope, not wire. ${cls.anchorBagTonnes.toLocaleString('en-CA')} t is about ${mn} MN, which ` +
        'in UHMWPE is a rope a few hundred millimetres across massing tens of tonnes, and in ' +
        'steel would mass an order of magnitude more. Synthetic rope is what makes hanging this ' +
        'much water from an aircraft cheap, as it did for deep-tow oceanography.';
    },
    state: 'anchorProgress',
  },
  {
    prefix: 'AnchorBag', label: 'Descent anchor bag', category: 'water',
    claim: CLAIM.research, share: 'water', n: () => 1,
    desc: (cls) =>
      `A collapsible bag holding ${cls.anchorBagTonnes.toLocaleString('en-CA')} t of lake water, lowered, filled ` +
      'and winched clear of the surface so the hull has something to pull down against. It is ' +
      'dumped back into the lake as soon as the tanks hold more than the descent needs, so ' +
      'nothing is carried away and nothing is manufactured. This is a Bambi bucket — the ' +
      'helicopter bucket in service since 1983 — at a scale nobody has built: commercial ones ' +
      'top out near 10 tonnes. The principle is unchanged and the engineering is not.',
    state: 'anchorFill',
  },
  {
    prefix: 'IntakeScreen', label: 'Intake screen', category: 'water',
    claim: CLAIM.layout, share: 'water', n: (cls) => cls.pumpPods,
    desc: () => 'Keeps debris and, as far as screening can, aquatic life out of the pump path.',
  },

  /* ---- cryogenic --------------------------------------------------------------------------- */
  {
    prefix: 'LN2Tank', label: 'Liquid-nitrogen tank', category: 'cryogenic',
    claim: CLAIM.layout, share: 'cryo', n: (cls) => cls.ln2Tanks,
    desc: (cls) =>
      `Insulated ballast store, about ${(cls.ln2TankCapacityTonnes / cls.ln2Tanks).toFixed(0)} t ` +
      'each. Nitrogen is dense, free from the air, and can be given back to the air. It is how a ' +
      'ship that just dropped its payload gets heavy again without carrying water it does not need.',
    state: 'ln2Fraction',
  },
  {
    prefix: 'CryoAirIntake', label: 'Cryogenic air intake', category: 'cryogenic',
    claim: CLAIM.physics, share: 'cryo', n: (cls) => cls.cryoTrains,
    desc: () => 'Ram intake, filtration, and water and CO₂ removal before compression.',
  },
  {
    prefix: 'CryoCompressor', label: 'Compression stage', category: 'cryogenic',
    claim: CLAIM.physics, share: 'cryo', n: (cls) => cls.cryoTrains,
    desc: () =>
      'Where most of the electrical energy goes, and where most of the heat comes out. The heat ' +
      'is rejected to the airstream.',
    state: 'cryogenicPowerMW',
  },
  {
    prefix: 'CryoColdBox', label: 'Cold box and separation', category: 'cryogenic',
    claim: CLAIM.physics, share: 'cryo', n: (cls) => cls.cryoTrains,
    desc: () =>
      'Precooling, nitrogen separation and liquefaction, with a cold-recovery loop returning cold ' +
      'from the outgoing stream. The demonstration assumption is about 0.45 kWh per kilogram ' +
      'liquefied, explored over 0.30–0.80.',
    state: 'cryogenicPowerMW',
  },
  {
    prefix: 'CryoExpander', label: 'Expansion turbine-generator', category: 'cryogenic',
    claim: CLAIM.physics, share: 'cryo', n: (cls) => cls.cryoTrains,
    desc: () =>
      'The discharge half: high-pressure liquid is pumped, warmed against ambient and waste heat, ' +
      'expanded through a turbine and returned to the atmosphere as gas. Ballast mass falls and ' +
      'some of the electricity comes back — about half, on the demonstration assumption. The ' +
      'store is a battery with a mass side effect, and it is a lossy one.',
    state: 'ln2RecoveryPowerMW',
  },

  /* ---- power ------------------------------------------------------------------------------- */
  {
    prefix: 'Generator', label: 'Generator module', category: 'power',
    claim: CLAIM.layout, share: 'power', n: (cls) => cls.generators,
    power: (cls) => cls.generatorContinuousPowerMW / cls.generators,
    desc: (cls) =>
      `One of ${cls.generators} liquid-fuelled generator modules in separated fire-isolation ` +
      'zones. The architecture is electrically driven and fuel-agnostic at the generator ' +
      'boundary: what burns is a choice made later, and nothing here commits it to diesel.',
    state: 'generatorPowerMW',
  },
  {
    prefix: 'BatteryModule', label: 'Battery module', category: 'power',
    claim: CLAIM.layout, share: 'power', n: (cls) => cls.batteryModules,
    desc: (cls) =>
      `One of ${cls.batteryModules} modules distributed through the structure — short bus runs, ` +
      'no single bay holding the whole store, and a transient buffer close to the loads that ' +
      'cause the transients.',
    state: 'batteryStateOfCharge',
  },
  {
    prefix: 'HVDCBus', label: 'HVDC bus', category: 'power',
    claim: CLAIM.layout, share: 'power', n: (cls) => cls.hvdcBuses,
    desc: (cls) =>
      `One of ${cls.hvdcBuses} fore-aft buses, separated and tie-able. Opening a tie sheds a ` +
      'district without shedding the vehicle.',
    state: 'failedComponents',
  },
  {
    prefix: 'BlackStart', label: 'Black-start store', category: 'power',
    claim: CLAIM.layout, share: 'power', n: () => 1,
    desc: () =>
      'A small independent store that can restart a generator with the main bus dead. It is also ' +
      'what keeps the deterministic safety functions alive in the total-power-loss case.',
  },

  /* ---- propulsion -------------------------------------------------------------------------- */
  {
    prefix: 'PrimaryRotorStation', label: 'Primary thrust station', category: 'propulsion',
    claim: CLAIM.layout, share: 'propulsion', n: (cls) => cls.primaryRotorStations,
    desc: (cls) =>
      `One of ${cls.primaryRotorStations} vectorable stations, each carrying ` +
      `${cls.rotorsPerStation} counter-rotating rotors of about ${cls.primaryRotorDiameterM} m on ` +
      'a common gimbal. Counter-rotating so the station produces thrust without producing net ' +
      'torque of its own.',
    state: 'desiredWrench',
  },
  {
    prefix: 'PrimaryRotorGimbal', label: 'Rotor gimbal', category: 'propulsion',
    claim: CLAIM.layout, share: 'propulsion', n: (cls) => cls.primaryRotorStations,
    desc: () =>
      'Swings the thrust axis from up through down and some way fore and aft. Vectoring is fast; ' +
      'the body it is pushing is not.',
  },
  {
    prefix: ['PrimaryRotorA', 'PrimaryRotorB', 'PrimaryRotor'], label: 'Primary rotor',
    category: 'propulsion', claim: CLAIM.layout, share: 'propulsion',
    n: (cls) => cls.primaryRotorStations * cls.rotorsPerStation,
    desc: (cls) => `About ${cls.primaryRotorDiameterM} m diameter. Low disc loading: these are ` +
      'lifting-body rotors trimming a mostly-buoyant vehicle, not the thing holding it up. The ' +
      'A and B rotors of a station turn opposite ways, so the station makes thrust without ' +
      'making torque of its own.',
  },
  {
    prefix: 'MediumThruster', label: 'Manoeuvring propulsor', category: 'propulsion',
    claim: CLAIM.layout, share: 'propulsion', n: (cls) => cls.mediumThrusters,
    desc: (cls) =>
      `One of ${cls.mediumThrusters} reversible ducted units set into the skin. They supply lateral ` +
      'and vertical trim authority without moving a primary station off its job.',
  },
  {
    prefix: 'LocalTrimFan', label: 'Local trim fan', category: 'propulsion',
    claim: CLAIM.layout, share: 'propulsion', n: (cls) => cls.localTrimFans,
    desc: (cls) =>
      `One of ${cls.localTrimFans}. Individually negligible. Collectively they are how a local gust ` +
      'load is shed without commanding a whole-body attitude change — which on a body this size ' +
      'would take a long time to start and longer to stop.',
  },
  {
    prefix: 'TailSurface', label: 'Tail control surface', category: 'control',
    claim: CLAIM.layout, share: 'propulsion', n: (cls) => cls.tailSurfaces,
    desc: (cls) =>
      `X arrangement, ${cls.tailSurfaces} surfaces: none sits in another's wake at small angles, ` +
      'and a jammed surface leaves three usable axes instead of deleting one. They are useful in ' +
      'proportion to airspeed, which is why they are not the answer at a hover.',
  },

  /* ---- sensing, compute, maintenance -------------------------------------------------------- */
  {
    prefix: 'SensorCluster', label: 'Sensor cluster', category: 'sensors',
    claim: CLAIM.layout, share: 'avionics', n: () => 7,
    desc: (cls, rec) =>
      (rec && rec.desc ? `${rec.desc[0].toUpperCase()}${rec.desc.slice(1)}. ` : '') +
      'EO/IR, radar, lidar, weather and air-data instrumentation as the position warrants.',
  },
  {
    prefix: 'VehicleMindCompute', label: 'Vehicle Mind compute', category: 'compute',
    claim: CLAIM.layout, share: 'avionics', n: () => 2,
    desc: () =>
      'Planning and perception: where to go, at what altitude, through what wind, at what energy ' +
      'cost. It is a distributed compute bay, not a brain. It PROPOSES; it does not command an ' +
      'actuator directly.',
    related: ['SafetyKernel'],
  },
  {
    prefix: 'SafetyKernel', label: 'Deterministic safety kernel', category: 'compute',
    claim: CLAIM.layout, share: 'avionics', n: () => 1,
    desc: () =>
      'Small, deterministic, outside the learned system, and sited in neither compute bay. Every ' +
      'actuator command passes it and it may refuse. The chain is: sensors → Mind planning → ' +
      'safety kernel → bounded local actuator controllers. Each controller enforces its own limits ' +
      'even if everything upstream is wrong.',
    related: ['VehicleMindCompute'],
  },
  {
    prefix: 'MaintenanceCorridor', label: 'Maintenance corridor', category: 'maintenance',
    claim: CLAIM.layout, share: 'frames', n: (cls) => cls.maintenanceCorridors,
    desc: () =>
      'A route through the structure for service robots and, in principle, people. It is a hole, ' +
      'so the surrounding structure has to thicken around it — visible in the load-path view.',
  },
  {
    prefix: 'TankerDock', label: 'Tanker docking point', category: 'maintenance',
    claim: CLAIM.layout, share: 'frames', n: () => 1,
    desc: () =>
      'Upper-surface connection for cooperative fuel transfer and spare pump-pod exchange from a ' +
      'tanker airship. Fleet logistics, not a demonstrated capability.',
  },
];

/**
 * Find the template whose prefix matches a node id. `prefix` may be a list; the longest match
 * wins, so `PrimaryRotorStation_02` never falls through to the `PrimaryRotor` template.
 */
export function templateFor(id) {
  let best = null, bestLen = -1;
  for (const t of TEMPLATES) {
    for (const p of Array.isArray(t.prefix) ? t.prefix : [t.prefix]) {
      if ((id === p || id.startsWith(p + '_')) && p.length > bestLen) { best = t; bestLen = p.length; }
    }
  }
  return best;
}

/**
 * Build the id → metadata map for a resolved class and its layout.
 * @returns {Map<string, object>}
 */
export function buildMetadata(cls, layout, index) {
  const dry = cls.structureAllowanceTonnes;
  const byId = new Map();
  const seen = new Set();

  for (const id of index) {
    const t = templateFor(id);
    if (!t) continue;
    const rec = layout && layout._index ? layout._index.get(id) : null;
    const count = Math.max(1, t.n(cls, layout));
    const suffix = id.includes('_') ? id.slice(id.lastIndexOf('_') + 1) : '';
    const md = {
      id,
      label: count > 1 && suffix
        ? `${t.label} ${suffix.replace(/^0+(?=\d)/, '')}`
        : t.label,
      category: t.category,
      description: typeof t.desc === 'function' ? t.desc(cls, rec, layout) : t.desc,
      claimLevel: t.claim,
      nominalMassTonnes: t.share ? +(dry * MASS_SHARE[t.share] / count).toFixed(2) : undefined,
      nominalPowerMW: t.power ? +t.power(cls).toFixed(2) : undefined,
      currentStateField: t.state,
      relatedComponents: t.related,
    };
    byId.set(id, md);
    seen.add(t.prefix);
  }
  return byId;
}

/**
 * Completeness check used by the tests: every selectable id has metadata, every metadata record
 * has the required fields, every category is legal, and the mass shares still sum to one.
 */
export function checkMetadata(meta, selectableIds) {
  const errs = [];
  const share = Object.values(MASS_SHARE).reduce((a, b) => a + b, 0);
  if (Math.abs(share - 1) > 1e-6) errs.push(`MASS_SHARE sums to ${share}, not 1`);
  for (const id of selectableIds) {
    const m = meta.get(id);
    if (!m) { errs.push(`no metadata for selectable node ${id}`); continue; }
    if (!m.label) errs.push(`${id}: missing label`);
    if (!CATEGORIES.includes(m.category)) errs.push(`${id}: bad category ${m.category}`);
    if (!m.description || m.description.length < 40) errs.push(`${id}: description too thin`);
    if (!['known-physics', 'reference-assumption', 'conceptual-layout', 'future-research']
      .includes(m.claimLevel)) errs.push(`${id}: bad claimLevel ${m.claimLevel}`);
  }
  return errs;
}

export { TEMPLATES };
