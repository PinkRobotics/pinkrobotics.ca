/* The parts catalog — level 1 of the build.
 *
 * One entry per part the ship is made of, grouped tubes / connectors / skins. Everything
 * the committed cell model already knows is READ from it (stockBuild, MATERIALS, the saw
 * table); nothing the model computes is retyped here. Ship-scale entries carry numbers
 * from ship0Summary() in ship/model.js, mirrored in
 * research/analysis/vacuum-cell.py and held by make cellparity. Their `prov` lines
 * distinguish computed model output from unverified inputs. Status vocabulary:
 *
 *   proven      measured on, or billed against, the built article A
 *   decided     an operator decision on record — geometry known, some numbers [TO VERIFY]
 *   scoping     ship-scale analysis line — real physics, pre-coupon, pre-catalogue
 *   superseded  carried the article but ruled out for flight; kept because it happened
 *
 * The design of record for joints (operator, 2026-08-12): titanium, CLAMPED — split
 * clamshell sleeves that close radially around placed members and bond over the full
 * lap. The connectors tab leads with that design; the printed polymer node sits last,
 * as history.
 */
import { MATERIALS, CUT_SCHEDULE_MEASURED, NODE_MASS_MEASURED_KG,
         stockBuild, barrierKgPerM2, P_ATM,
         SHIP0, ship0, ship0Summary } from './model.js?v=fc85766f';

const sb = stockBuild();
/* THE SHIP PORT LANDED (2026-08-13): ship0Summary() is computed by ship/model.js,
 * mirrored in research/analysis/vacuum-cell.py, and held identical by
 * tools/check_cell_parity.py — so every ship figure below is now GATED, and the
 * scoping chips those numbers wore since 08-12 come off. What stays flagged is
 * what is genuinely unverified: the sigma worlds themselves (the coupon
 * campaign), eta, the Ti fitting masses — carried as [TO VERIFY] in the model. */
const S0 = ship0Summary();
const bestWorld = ship0('s1450', SHIP0.sfDeclared, null, null, false, false, 'favourable');

/* Linear masses from section geometry x the laminate density the model bills with. */
const linKgPerM = (odMm, wallMm, rho) => {
  const ro = odMm / 2000, ri = ro - wallMm / 1000;
  return Math.PI * (ro * ro - ri * ri) * rho;
};
const T700 = MATERIALS.T700_LAM;
const TI64 = MATERIALS.TI64;

/* Saw-table roll-ups, straight off the measured schedule. */
const sawnRows = CUT_SCHEDULE_MEASURED;
const fam = (name) => sawnRows.filter(r => r[0] === name);
const famM = (name) => fam(name).reduce((s, r) => s + r[1] * r[2] / 1000, 0);
const famCuts = (name) => fam(name).reduce((s, r) => s + r[2], 0);
const mainCuts = famCuts('octet') + famCuts('spoke') + famCuts('tie');
const mainM = famM('octet') + famM('spoke') + famM('tie');
const cutMin = Math.min(...sawnRows.map(r => r[1]));
const cutMax = Math.max(...sawnRows.map(r => r[1]));

/* The ship-0 summary the pages quote — GATED now: computed live by model.js's
 * ship0 port, parity-held to the Python record. Declared SF 1.2 with the SF 1.5
 * column beside it, as the house display rule requires. The mid sigma world
 * (1050 MPa) is the primary basis and remains [TO VERIFY by coupon]. */
export const SHIP = {
  name: 'ship 0',
  diaM: S0.planOfRecord.diaM, lenM: S0.planOfRecord.lenM, fineness: SHIP0.fineness,
  volumeM3: S0.planOfRecord.vM3, hullM2: S0.planOfRecord.areaM2,
  liftT: S0.planOfRecord.liftSLT,
  massT: S0.mid.totalT, residualT: S0.mid.residualSLT, ratio: S0.mid.ratioSL,
  massSF15T: S0.worlds.s1050_sf15.totalT, ratioSF15: S0.worlds.s1050_sf15.ratioSL,
  ratioSF15Sigma1450: S0.worlds.s1450_sf15.ratioSL,
  ratioSigma742: S0.worlds.s742_sf12.ratioSL,
  // Lift falls as air warms: d(rho)/rho = -dT/T, so %/K is 100/T0. The old
  // windowK died with the positive residual — a temperature window only
  // exists on a basis that floats, and no page may imply one that does not.
  tempPctPerK: 100 / 288.15,
  worlds: S0.worlds,
  worldsFrame: S0.worldsFramePractice,
  giKnockdown: S0.giKnockdown, giKnockdownFrame: S0.giKnockdownFrame,
  giMarginHarsh: S0.checks.giMarginHarsh, giMarginFrame: S0.checks.giMarginFrame,
  ratioTarget: S0.mid.ratio2500,
  bestWorldRatioTarget: bestWorld.ratio2500,
  bestWorldShortfallT: -S0.worldsFramePractice.s1450_sf12.residualSLT,
  bestWorldShortfallTargetT: -bestWorld.residual2500T,
  bestWorldRatio: S0.worldsFramePractice.s1450_sf12.ratioSL,
  bestWorldResidualT: S0.worldsFramePractice.s1450_sf12.residualSLT,
  floatWindow: S0.floatWindow,
  floatWindowFrame: S0.floatWindowFrame,
  checks: S0.checks,
  prov: 'cell/model.js ship0Summary() — the gated post-refutation port (2026-08-13); '
      + 'sigma worlds AND the GI knockdown [TO VERIFY — the two campaigns ARE the float decision]',
};

/* THE WALL — the film-on-rings outer face that replaced the band of cells
 * (operator cascade 08-12/08-13). Population and sections computed, gated. */
export const WALL = {
  ringPitchM: S0.planOfRecord.ringPitchM, barPitchM: S0.planOfRecord.barPitchM,
  rings: S0.counts.rings, bars: S0.counts.bars,
  panels: S0.counts.panels, clamps: S0.counts.clamps,
  ringOdMm: S0.sections.ring.odMm, ringWallMm: S0.sections.ring.wallMm,
  ringMargin: S0.sections.ring.marginAtSF, ringGoverns: S0.sections.ring.governs,
  barOdMm: S0.sections.bar.odMm, barWallMm: S0.sections.bar.wallMm,
  filmGM2: S0.sections.filmGM2,
  clampEvery: SHIP0.clampEvery,
  prov: 'cell/model.js shipWall() — gated',
};

/* The superseded band-of-cells record, kept because it happened: what the wall
 * replaced, and what the replacement bought. History, not design. */
export const BAND = {
  arealKgM2Lo: 5.0, arealKgM2Hi: 10.7,     // the Kelvin band's ledger, by basis
  cells: 20000,                             // the census the tile pitch inherited
  perCellPushT: 7.2,
  superseded: true,
  prov: 'ship-scale analysis v2 §3/§7 — SUPERSEDED by the film-on-rings wall (08-13 cascade)',
};
export const GRID = {
  depthM: SHIP0.depthM, bayM: SHIP0.bayM,
  nLong: S0.planOfRecord.nLong, braceM: S0.planOfRecord.braceM,
  innerRings: S0.skeletonCounts.innerRings,
  thetaWebs: S0.skeletonCounts.thetaWebs,
  longOdMm: S0.sections.longeron.odMm, longWallMm: S0.sections.longeron.wallMm,
  hoopKPaM: Math.round(P_ATM * S0.planOfRecord.diaM / 2 / 1000), // P·R at the barrel
  bandCapKPaM: 67,                          // the dead band's own ceiling, kept for the history copy
  prov: 'cell/model.js shipSkeleton() — gated; the ring-plane webs are the 08-13 finding',
};

/* The committed article, read live from the model so this page can never disagree
 * with the explorer next door. */
export const ARTICLE = {
  spanM: sb.spanM,
  totalKg: sb.totalKg,
  kgPerM3: sb.kgPerM3,
  sawnM: sb.sawnM,
  pipeCount: sb.pipeCount,
  printedNodes: sb.printedNodes,
  nodesKg: sb.nodesKg,
  skinKg: sb.skinKg,
  tubeKg: sb.totalKg - sb.nodesKg - sb.skinKg,
  displacedAirG: sb.displacedAirKg * 1000,
};

export const CATS = [
  { id: 'tubes', name: 'Tubes' },
  { id: 'connectors', name: 'Connectors' },
  { id: 'skins', name: 'Skins' },
];

export const CATALOG = [
  /* ------------------------------------------------ tubes ------------------------------ */
  {
    id: 'tube-main', cat: 'tubes',
    name: 'Main cell tube',
    status: 'proven',
    role: 'The octet frame, the spokes, and the ties of one cell — the member family that '
        + 'carries the crush of the sky on the smallest article.',
    story: 'Every one of these in the built article is on a measured saw table; the model '
        + 'bills the schedule, not an idealisation.',
    draw: { kind: 'tube', odMm: sb.odM * 1000, wallMm: (sb.odM - sb.idM) * 500, cutMm: cutMax },
    specs: [
      { k: 'Bore', v: `${(sb.odM * 1000).toFixed(0)} × ${(sb.idM * 1000).toFixed(0)}`, u: 'mm od × id' },
      { k: 'Construction', v: 'roll-wrapped T700 carbon', u: '' },
      { k: 'Linear mass', v: (linKgPerM(sb.odM * 1000, (sb.odM - sb.idM) * 500, T700.rho) * 1000).toFixed(1), u: 'g/m' },
      { k: 'Cuts in one cell', v: `${mainCuts}`, u: `pieces, ${cutMin.toFixed(0)}–${cutMax.toFixed(0)} mm` },
      { k: 'Sawn per cell', v: mainM.toFixed(1), u: 'm' },
    ],
    prov: 'cell/model.js stockBuild() + CUT_SCHEDULE_MEASURED (article A, as sawn)',
    flags: [],
  },
  {
    id: 'tube-rim', cat: 'tubes',
    name: 'Rim tube',
    status: 'proven',
    role: 'The cell’s outer edges, where the skin’s dihedral pull lands — a heavier '
        + 'bore than the interior because the film asks twice what a spoke does.',
    story: 'Two tube SKUs per cell, not one: the rim earned its own section the day the '
        + 'film loads were solved rather than smeared.',
    draw: { kind: 'tube', odMm: sb.rimOdM * 1000, wallMm: 1, cutMm: fam('rim')[0][1] },
    specs: [
      { k: 'Bore', v: `${(sb.rimOdM * 1000).toFixed(0)} × ${(sb.rimOdM * 1000 - 2).toFixed(0)}`, u: 'mm od × id' },
      { k: 'Construction', v: 'roll-wrapped T700 carbon', u: '' },
      { k: 'Linear mass', v: (linKgPerM(sb.rimOdM * 1000, 1, T700.rho) * 1000).toFixed(1), u: 'g/m' },
      { k: 'Cuts in one cell', v: `${famCuts('rim')}`, u: 'pieces' },
      { k: 'Sawn per cell', v: famM('rim').toFixed(1), u: 'm' },
    ],
    prov: 'cell/model.js stockBuild() + CUT_SCHEDULE_MEASURED (article A, as sawn)',
    flags: [],
  },
  {
    id: 'tube-ring', cat: 'tubes',
    name: 'Hoop ring pipe',
    status: 'decided',
    role: 'The wall itself, in the hoop direction: a continuous curved ring every '
        + 'half-metre of meridian, carrying its strip of the sky as pure compression '
        + '— the funicular case, which is the whole reason the wall is rings.',
    story: 'Moulded curved in-house — curvature, not continuity of straight stock: '
        + 'bending straight tube to this radius would lock a third of the working '
        + 'stress in before the first pump-down.',
    draw: { kind: 'tube', odMm: S0.sections.ring.odMm, wallMm: S0.sections.ring.wallMm, cutMm: 2000 },
    specs: [
      { k: 'Bore', v: `${S0.sections.ring.odMm.toFixed(0)} od × wall ${S0.sections.ring.wallMm.toFixed(1)}`, u: 'mm' },
      { k: 'Construction', v: 'roll-wrapped T700, moulded curved', u: '' },
      { k: 'Linear mass', v: linKgPerM(S0.sections.ring.odMm, S0.sections.ring.wallMm, T700.rho).toFixed(2), u: 'kg/m' },
      { k: 'Runs at', v: `${S0.sections.ring.runsAtMPa.toFixed(0)}`, u: `MPa (${S0.sections.ring.governs}-governed, margin ${S0.sections.ring.marginAtSF.toFixed(2)} at declared SF)` },
      { k: 'Ship set', v: `${S0.counts.barrelRings.toLocaleString('en-US')} + ${(S0.counts.rings - S0.counts.barrelRings).toLocaleString('en-US')}`, u: 'barrel rings + cap-grid hoops' },
    ],
    prov: 'cell/model.js shipWall() — gated by cellparity',
    flags: ['sigma world [TO VERIFY] — the coupon campaign decides which column is real'],
  },
  {
    id: 'tube-bar', cat: 'tubes',
    name: 'Cross-bar pipe',
    status: 'decided',
    role: 'The meridional half of the wall grid: continuous bars one ring-diameter '
        + 'outboard, holding adjacent rings apart against the film’s pull and '
        + 'squaring the panels so the membrane carries pressure both ways.',
    story: 'Sized for the worst case — every panel handing its whole load to its bar '
        + 'first — and it is still the lightest structural member on the ship.',
    draw: { kind: 'tube', odMm: S0.sections.bar.odMm, wallMm: S0.sections.bar.wallMm, cutMm: 2000 },
    specs: [
      { k: 'Bore', v: `${S0.sections.bar.odMm.toFixed(0)} od × wall ${S0.sections.bar.wallMm.toFixed(1)}`, u: 'mm' },
      { k: 'Duty', v: 'bending between rings', u: 'end-span worst case' },
      { k: 'Linear mass', v: linKgPerM(S0.sections.bar.odMm, S0.sections.bar.wallMm, T700.rho).toFixed(2), u: 'kg/m' },
      { k: 'Ship set', v: `${S0.counts.bars.toLocaleString('en-US')}`, u: 'bars, pole to pole' },
    ],
    prov: 'cell/model.js shipWall() — gated by cellparity',
    flags: [],
  },
  {
    id: 'tube-longeron', cat: 'tubes',
    name: 'Longeron pipe',
    status: 'decided',
    role: 'The inner wall’s axial columns: all of the caps’ thrust — the atmosphere '
        + 'pressing the two ends together — carried as compression down the barrel, '
        + 'braced every bay by the inner rings.',
    story: 'They stop at the dome junction: under the caps the meridional load is the '
        + 'cap grid’s own job, and pricing both was a 23-tonne error the scoping tool '
        + 'caught in its own first draft.',
    draw: { kind: 'tube', odMm: S0.sections.longeron.odMm, wallMm: S0.sections.longeron.wallMm, cutMm: 2000 },
    specs: [
      { k: 'Bore', v: `${S0.sections.longeron.odMm.toFixed(0)} od × wall ${S0.sections.longeron.wallMm.toFixed(1)}`, u: 'mm' },
      { k: 'Governing', v: S0.sections.longeron.governs, u: `margin ${S0.sections.longeron.marginAtSF.toFixed(2)} at declared SF` },
      { k: 'Linear mass', v: linKgPerM(S0.sections.longeron.odMm, S0.sections.longeron.wallMm, T700.rho).toFixed(2), u: 'kg/m' },
      { k: 'Ship set', v: `${S0.skeletonCounts.longerons}`, u: 'columns' },
    ],
    prov: 'cell/model.js shipSkeleton() — gated by cellparity',
    flags: ['sigma world [TO VERIFY] — coupon campaign'],
  },
  {
    id: 'tube-web', cat: 'tubes',
    name: 'Web tube — two families',
    status: 'decided',
    role: 'The fan webs lace the walls in meridional planes (ring bracing, beam '
        + 'shear); the ring-plane diagonals — the member the 08-13 checks found '
        + 'missing — give the sandwich the circumferential shear that ovalization '
        + 'stiffness actually rides on.',
    story: 'The fan was drawn for a job it could not do: every diagonal lived in a '
        + 'meridional plane, so the two walls could not act as one deep ring. The '
        + 'general-instability check found the gap and priced the fix at single-digit '
        + 'tonnes.',
    draw: { kind: 'tube', odMm: 30, wallMm: 1.5, cutMm: 3400 },
    specs: [
      { k: 'Fan pitch', v: `${2 * SHIP0.kFan}`, u: 'diagonals per column per bay' },
      { k: 'Ring-plane set', v: `${S0.skeletonCounts.thetaWebs.toLocaleString('en-US')}`, u: 'diagonals' },
      { k: 'Duty', v: 'shear', u: 'meridional + ring-plane' },
    ],
    prov: 'cell/model.js shipSkeleton() — gated; ring-plane family = the 08-13 finding',
    flags: ['fan brace rule (2%) conservative — a stiffness-based rule could halve it'],
  },

  /* ---------------------------------------------- connectors --------------------------- */
  /* Design of record first; history last. */
  {
    id: 'conn-ti-sleeve', cat: 'connectors',
    name: 'Ti clamp sleeve',
    status: 'decided',
    role: 'The flight joint: a sintered titanium clamshell, split along its length, that '
        + 'clamps radially around tube and stub after placement and bonds over the full '
        + 'lap — the last member of a loop never has to slide where it cannot.',
    story: 'The main load path never crosses the seam — each half carries its half-'
        + 'circumference of glue. The seam only keeps the clamp closed: dovetail, pin, '
        + 'or a wrap of tow.',
    draw: { kind: 'sleeve', odMm: 12, wallMm: 1, lapMm: 10 },
    specs: [
      { k: 'Material', v: 'Ti-6Al-4V, sintered', u: `${TI64.rho} kg/m³` },
      { k: 'Wall', v: '1.0', u: 'mm' },
      { k: 'Closure', v: 'clamped', u: 'split clamshell, radial' },
      { k: 'Bonded lap', v: '8–11', u: 'mm per end' },
      { k: 'Set per cell', v: '0.42–0.60', u: 'kg' },
    ],
    prov: 'operator decision 08-12 · metal-joint report §5 (set-mass lower bounds)',
    flags: ['set mass [TO VERIFY] — central body + adhesive unpriced', 'seam capture detail undesigned'],
  },
  {
    id: 'conn-ti-gridnode', cat: 'connectors',
    name: 'Ti grid node',
    status: 'scoping',
    role: 'Where chord pipes meet: a cluster of the same clamped titanium sleeves, '
        + 'scaled to swallow meganewton loads at the ring-longeron-diagonal crossings.',
    story: 'Chunky enough that sintering stops being the process — at thousands of '
        + 'these, investment casting takes over and the printed part becomes the pattern.',
    draw: { kind: 'node', arms: 6, hubMm: 160 },
    specs: [
      { k: 'Material', v: 'Ti-6Al-4V, cast or sintered', u: '' },
      { k: 'Closure', v: 'clamped', u: 'split sleeves at every arm' },
      { k: 'Ship set', v: '≈7,000', u: 'nodes' },
      { k: 'Unit mass', v: '≈2.5', u: 'kg' },
      { k: 'Loads', v: '0.5–6', u: 'MN member class' },
    ],
    prov: 'ship-scale analysis v2 §6 (η_mass joint fraction) · production machinery note',
    flags: ['scoping — SHIP-3 order owns this'],
  },
  {
    id: 'conn-bond', cat: 'connectors',
    name: 'The bonded lap',
    status: 'decided',
    role: 'The glue line inside every clamp, promoted to a part: it carries the member '
        + 'load in shear and it is also the gas seal that lets a cell hold vacuum for months.',
    story: 'Cured under vacuum bagging — the atmosphere is the clamp while the clamp '
        + 'cures. In service every joint cavity reads on the cell’s own gauge, so a '
        + 'failing bond announces itself.',
    draw: { kind: 'lap', odMm: 10, lapMm: 10 },
    specs: [
      { k: 'Working shear', v: '20', u: 'MPa, aged allowable' },
      { k: 'Lap length', v: '8–11', u: 'mm' },
      { k: 'One lap carries', v: '≈6', u: 'kN on the main bore' },
      { k: 'Cure clamp', v: '1 atm', u: 'vacuum bag' },
    ],
    prov: 'metal-joint report (lap sizing) · joint-load report (mechanism)',
    flags: ['τ = 20 MPa unsourced — qualification campaign line'],
  },
  {
    id: 'conn-tie', cat: 'connectors',
    name: 'Crossing clamp',
    status: 'decided',
    role: 'The interface, as ruled: the film lies on the hoop chords and the cross-bars '
        + 'run continuous over them; a split titanium clamp holds each crossing it is '
        + 'given. Sparse and staggered — roughly every two metres, one crossing in four.',
    story: 'The load never asks for it: inside is vacuum, so the push is always inward '
        + 'and every crossing sits permanently in bearing. The clamps are there for the '
        + 'states with no pressure at all — erection, handling, maintenance — because the '
        + 'wall has to stand as a structure before it is ever pumped down.',
    draw: { kind: 'seat' },
    specs: [
      { k: 'Crossing', v: 'continuous over continuous', u: 'nothing drilled, cut or woven' },
      { k: 'Spacing', v: 'every ~2 m, staggered', u: '1 crossing in 4, ~1/m²' },
      { k: 'Duty', v: 'unpressurised states', u: 'erection, handling, maintenance' },
      { k: 'Under load', v: 'bearing only', u: 'the push never reverses' },
      { k: 'Ship set', v: 'order 10⁵', u: 'seats' },
    ],
    prov: 'band-outside ruling 08-12 (operator) — supersedes the hang/tie variant',
    flags: ['seat pad + strap detail [TO VERIFY] — SHIP-2/3; seats-per-cell governs joint concentration'],
  },
  {
    id: 'conn-printed-node', cat: 'connectors',
    name: 'Printed polymer node',
    status: 'superseded',
    role: 'The many-arm printed hub that holds the built article together today — '
        + 'measured, weighed, and photographed from every side.',
    story: 'It carried the pump-down, and it is ruled out for flight: the polymer fails '
        + 'its own strength screen and drinks water into a months-hold vacuum. Titanium '
        + 'clamps replace it.',
    draw: { kind: 'node', arms: 7, hubMm: 46 },
    specs: [
      { k: 'Set per cell', v: `${sb.printedNodes}`, u: 'joints' },
      { k: 'Set mass', v: NODE_MASS_MEASURED_KG.toFixed(3), u: 'kg, measured' },
      { k: 'Share of tube mass', v: '≈30', u: '% — target is 15' },
      { k: 'Material', v: 'PAHT-CF, printed', u: '' },
    ],
    prov: 'cell/model.js NODE_MASS_MEASURED_KG (weighed set) · metal-joint report (the ruling)',
    flags: ['dead for flight — strength screen + hygroscopic reservoir'],
  },

  /* ------------------------------------------------ skins ------------------------------ */
  {
    id: 'skin-cell-film', cat: 'skins',
    name: 'Cell film',
    status: 'decided',
    role: 'The membrane that turns a frame into a vessel: Zylon-class high-modulus film, '
        + 'pre-formed into its solved dome shape so the sky loads it as a drum, not as a '
        + 'wrinkle.',
    story: 'The gore study measured flat cutting to death — even twelve gores per panel '
        + 'miss the elastic budget. The net keeps its proven outline and is formed.',
    draw: { kind: 'film', layers: [{ name: 'Zylon-class film', gsm: barrierKgPerM2(sb.spanM) * 1000 }] },
    specs: [
      { k: 'Per cell', v: (sb.skinKg * 1000).toFixed(0), u: 'g' },
      { k: 'Areal mass', v: (barrierKgPerM2(sb.spanM) * 1000).toFixed(1), u: 'g/m² (law, at article span)' },
      { k: 'Forming', v: '2 dies · 14 pressings', u: 'per cell class' },
    ],
    prov: 'cell/model.js barrierKgPerM2 + stockBuild().skinKg · gen_skin gore study',
    flags: ['formed-dome strain is a stated requirement, not a solved process'],
  },
  {
    id: 'skin-pvd', cat: 'skins',
    name: 'Barrier metallisation',
    status: 'decided',
    role: 'The nanometres of metal that make polymer film into a vacuum wall: '
        + 'permeation drops orders of magnitude for grams per square metre.',
    story: 'House doctrine from the seal arc: PVD plus impregnation is the barrier; '
        + 'tape is not a seal.',
    draw: { kind: 'film', layers: [{ name: 'PVD metal', gsm: 3 }, { name: 'carrier film', gsm: 12 }] },
    specs: [
      { k: 'Areal mass', v: '2–5', u: 'g/m²' },
      { k: 'Applied by', v: 'roll-to-roll PVD', u: 'bought as coated web' },
    ],
    prov: 'barrier doctrine (research/notes seal arc) · viz handoff register',
    flags: [],
  },
  {
    id: 'skin-void', cat: 'skins',
    name: 'Void terminal skin',
    status: 'scoping',
    role: 'The innermost surface of the ship: everything inboard of the band already '
        + 'sits near vacuum, so the core needs only a whisper of a wall.',
    story: 'Ten grams per square metre bounding a hundred and eighty thousand cubic '
        + 'metres of nothing — the cheapest wall in the whole machine.',
    draw: { kind: 'film', layers: [{ name: 'terminal skin', gsm: 10 }] },
    specs: [
      { k: 'Areal mass', v: '≈10', u: 'g/m²' },
      { k: 'Differential', v: '≤1', u: 'kPa' },
    ],
    prov: 'ship-scale analysis v2 §4 (band hangs, void skin line)',
    flags: ['scoping line'],
  },
  {
    id: 'skin-weather', cat: 'skins',
    name: 'Weather jacket',
    status: 'scoping',
    role: 'The outermost skin: sun, rain, hail, and the livery. Not a pressure part — '
        + 'the atmosphere is carried three layers further in.',
    story: 'Where the paint goes, eventually. Level six owns the look.',
    draw: { kind: 'film', layers: [{ name: 'jacket + finish', gsm: 50 }] },
    specs: [
      { k: 'Areal class', v: '≈50', u: 'g/m² (with skins/misc line)' },
    ],
    prov: 'ship-scale analysis v2 §7 (skins/weather 0.05 kg/m² scoping line)',
    flags: ['scoping line'],
  },
];

export const byCat = (catId) => CATALOG.filter(e => e.cat === catId);
