/* The cell explorer — one continuous walk from the printer nozzle to the hull.
 *
 * Seven levels, real metres at every one of them: a 0.6 mm extrusion track is 0.0006 units
 * wide, the hull is its full length in units. Most levels are their own scene graph; travel
 * between them is a camera dive with a cross-fade, which is what keeps depth precision honest
 * across five and a half orders of magnitude — no single world has to hold both.
 *
 * The exception is a STAGE level: one that builds nothing and displays the cell's scene graph
 * instead. The four finest levels — the connectors, the tube, the skin and the cell — are all
 * stages, so a dive between any two of them is not a cross-fade at all: the article stands
 * still at fade 1 and only the camera moves. That is why they are ordered by how tightly they
 * frame it (a joint, a member, a face, the whole cell) rather than by anything else; a level
 * that framed WIDER than the one below it would make a dive-in read as a zoom-out. A stage
 * level may declare a TOUR: a generated list of stops the camera flies between, with
 * everything that is not the current subject dimmed by its per-instance tint.
 *
 * Every number shown anywhere on this page is computed by cell/model.js, the same module
 * the 2D explainer runs and the same physics tools/check_cell_parity.py holds identical to
 * research/analysis/vacuum-cell.py. Nothing here is typed in.
 *
 * The geometry is honest about which design instance it shows:
 *   levels 0-3  the DEMONSTRATOR — PAHT-CF, 0.6 mm nozzle, 251 mm struts, as printed
 *   levels 4-6  the FLIGHT REFERENCE — M60J-class laminate at 2 m cells, level-2 hierarchy
 * and the panel says so at every level.
 */

import * as CELL from './model.js?v=762fdcfd';
import * as G from './explorer-geom.js?v=762fdcfd';
// The 51 printed joints grouped into their five families, and the 216 members grouped into
// the cuts they are sawn to — both straight out of the manifest the joint generator wrote.
// Generated, never typed: `python3 tools/gen_node_families.py`.
import {
  FAMILIES as NODE_FAMILIES, FAMILY_ORDER, NODE_TOTALS, JOINT, CUT_GROUPS, ASSEMBLY,
} from './nodes.generated.js?v=762fdcfd';
// The 51 joints as real meshes — the display field for the article, plus the five family
// representatives at print resolution for the connector tour. Generated, never modelled:
// `python3 tools/gen_display_meshes.py`.
/* The display meshes are 6.5 MB — the joint-scale levels' data, not the ship's. They
 * load on demand so a page that never leaves The Ship (the front-page hero mounts in
 * lite mode) never fetches them. The viewer page awaits loadNodemeshes() before it
 * mounts, which is the same ordering the old static import enforced. */
let NODEMESHES = null;
export function loadNodemeshes() {
  return import('./nodemeshes.generated.js?v=762fdcfd')
    .then((m) => { NODEMESHES = m.NODEMESHES; return NODEMESHES; });
}
// The film's pressure-formed shape over all 72 panels — the loaded skin, solved by the
// membrane FEM in tools/gen_skin.py. Generated, never modelled: `python3 tools/gen_skin.py`.
import { SKIN } from './skin.generated.js?v=762fdcfd';
// SHIP-SCALE FIGURES, from the blueprint page's own data module — typed once there, with
// provenance comments and scoping status, until ship.js lands under the gates (see
// docs/working/26-08-12-seven-levels-handoff.md §4b). The ship level draws FROM these so
// the drawn population and the quoted population are one number. model.js stays the cell's.
import { SHIP, BAND, GRID, WALL } from './catalog.js?v=762fdcfd';
import { node, addChild, updateWorld, walk } from '../3d/core/nodes.js?v=5bcbf32c';
import { createRenderer, isWebGL2Available } from '../3d/render/gl.js?v=5bcbf32c';
import {
  createCamera, orbit, dolly, pan, viewMatrix, projMatrix,
} from '../3d/render/camera.js?v=5bcbf32c';
import { TOKENS, mix } from '../3d/render/palette.js?v=5bcbf32c';
import { resolveClass, profileR, sectionScale } from '../3d/model/config.js?v=5bcbf32c';
import { clamp, lerp, lerp3, easeInOut, smoothstep } from '../3d/core/math.js?v=5bcbf32c';
import { boxSegs, transformSegs } from '../3d/model/geom.js?v=5bcbf32c';
import { m4compose, m4transform } from '../3d/core/math.js?v=5bcbf32c';

/* ---------- explorer materials (styleFor supplies these; palette keys work too) --------------- */

// The bead, the nozzle, the magnified wall coupon and the lone strut went with the three
// diagram levels that drew them — those levels now tour the article itself, so nothing
// here is a stand-in for a part any more.
const XM = {
  nodeBall: { kind: 'surface', color: '#6a6b76', spec: 0.35, opacity: 1 },
  // The hybrid article's two material families, told apart at a glance (the designer
  // asked): purchased roll-wrapped carbon pipe — dark, glossy — and the printed polymer
  // joints and their sockets in printed bone.
  pipe: { kind: 'surface', color: '#606874', spec: 0.52, opacity: 1 },
  // The rim is a different part doing a different job — bigger section, tougher fibre,
  // because the film loads the cell's own edges in bending rather than compression.
  pipeRim: { kind: 'surface', color: '#7d8796', spec: 0.46, opacity: 1 },
  printed: { kind: 'surface', color: TOKENS.bone, spec: 0.22, opacity: 1 },
  // The centreline of a pipe the parts view is hiding: annotation, not hardware, so it
  // sits at the faint end of the palette, below the lattice lines it stands in for.
  pipeGhost: { kind: 'line', color: TOKENS.muted, weight: 1.0, opacity: 0.5 },
  membrane: { kind: 'glass', color: '#9aa2b8', opacity: 0.05 },
  membraneLoaded: { kind: 'glass', color: TOKENS.warm, opacity: 0.18 },
  // Photovoltaic skin on the hull's sun side — dark blue-grey, glossier than film.
  solar: { kind: 'surface', color: '#2a4a6d', spec: 0.78, opacity: 1 },
  // Cryo/N2 tankage — cool glass, read clearly apart from the pink water.
  cryo: { kind: 'glass', color: '#7aa2c8', opacity: 0.26 },
  kelvinGhost: { kind: 'glass', color: '#7aa2c8', opacity: 0.07 },
  // The band as the ship wears it: an opaque skin of film-wrapped cells. Bone-grey rather
  // than pink because at ship range you are looking at the weathered outside of the wall,
  // not at a load diagram — the colour code (pink = loaded film) belongs to the sections.
  sealedWall: { kind: 'surface', color: '#8f96a3', spec: 0.30, opacity: 1 },
  fairing: { kind: 'glass', color: '#54555f', opacity: 0.16 },
  band: { kind: 'glass', color: TOKENS.cool, opacity: 0.14 },
  bulkhead: { kind: 'glass', color: TOKENS.bone, opacity: 0.14 },
  machine: { kind: 'surface', color: '#6a6b76', spec: 0.35, opacity: 1 },
  latticeLine: { kind: 'line', color: TOKENS.muted, weight: 0.9, opacity: 0.55 },
  latticeFaint: { kind: 'line', color: TOKENS.faint, weight: 0.7, opacity: 0.35 },
  kelvinEdge: { kind: 'line', color: TOKENS.muted, weight: 1.0, opacity: 0.6 },
  frameLine: { kind: 'line', color: TOKENS.bone, weight: 1.6, opacity: 0.95 },
  eulerGhost: { kind: 'line', color: TOKENS.warm, weight: 2.2, opacity: 0.9 },
  scaleTick: { kind: 'line', color: TOKENS.bone, weight: 1.4, opacity: 0.9 },
};

/* ---------- the purchased schedule: what the model's members become on a saw ------------------- */

/* A CHOICE, declared here so the gate holds the arithmetic instead of the assumption: the
 * kerf an abrasive slitting disc takes out of carbon tube, and the length these sections
 * are sold in. The stick count is insensitive to the kerf between 1 and 3 mm — eight of
 * the longest cut plus eight kerfs is 1,798 mm against a 2,000 mm stick either way. */
const KERF_MM = 2.0;
const STOCK_LEN_M = 2.0;

/** First-fit decreasing on one SKU's cuts, charging one kerf per piece. Not optimal and
 * not claimed to be — it is the order somebody cutting by hand works in, and it is
 * stable, which a smarter packer would not be. */
function packSticks(groups, stockMm, kerfMm) {
  const items = [];
  for (const g of groups) for (let i = 0; i < g.count; i++) items.push(g.cutMm);
  items.sort((a, b) => b - a);
  const left = [];
  for (const it of items) {
    let placed = false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] >= it + kerfMm) { left[i] -= it + kerfMm; placed = true; break; }
    }
    if (!placed) left.push(stockMm - (it + kerfMm));
  }
  return left.length;
}

/* THE CUT SCHEDULE, assembled from the two authorities that own its halves.
 *
 * cell/model.js owns the NOMINAL lengths — a member is centre to centre between two
 * lattice points, the conservative physics length — and the two SKUs. The node manifest
 * owns the CUTS: since the frame sank, a member's true length depends on each end's own
 * sink, which the model does not know and cannot derive, so tools/gen_node_families.py
 * carries manifest.cutList's own saw lengths through to the page (proven row by row at
 * generation) beside the seat deductions. The visible difference between nominal-less-seats
 * and the true cut IS the sink, and it is published per group as sinkShortMm rather than
 * left for a builder to discover at the saw.
 *
 * The remaining arithmetic happens here, once, on top of both — a saw schedule is not
 * physics and does not belong in the parity-gated model. tools/check_explorer.py recomputes
 * every line of it in Python from the article graph and the manifest, and closes the loop
 * on the one derived dimension by checking that the centre-to-centre mass computed from
 * these sections equals stockBuild().pipeKg.
 */
function cutSchedule(stock, mat) {
  const wallM = (stock.odM - stock.idM) / 2;
  // The rim SKU's bore is DERIVED from the claim the page makes about it — both SKUs carry
  // the same 1.0 mm wall — rather than typed a second time. If the model ever moves the
  // rim to a different wall this goes wrong, which is why the gate checks the mass closure.
  const SKU = {
    main: { odM: stock.odM, idM: stock.idM },
    rim: { odM: stock.rimOdM, idM: stock.rimOdM - 2 * wallM },
  };
  const sectionM2 = (s) => Math.PI * ((s.odM / 2) ** 2 - (s.idM / 2) ** 2);
  const lengthOf = { long: stock.pipeCutM, short: stock.shortCutM };
  const groups = {};
  for (const key of CUT_GROUPS.order) {
    const g = CUT_GROUPS.groups[key];
    const s = SKU[g.sku];
    const memberMm = lengthOf[g.lengthKey] * 1000;
    const cutMm = g.cutMm;                   // the manifest's own saw length, not derived
    const kgPerM = sectionM2(s) * mat.rho;
    groups[key] = {
      ...g, memberMm, cutMm, kgPerM,
      sinkShortMm: memberMm - g.deductMm - cutMm,
      odMm: s.odM * 1000, idMm: s.idM * 1000, wallMm: (s.odM - s.idM) / 2 * 1000,
      sectionMm2: sectionM2(s) * 1e6,
      cutM: cutMm * g.count / 1000,
      memberM: memberMm * g.count / 1000,
      cutKg: kgPerM * cutMm * g.count / 1000,
      // Centre-to-centre mass per group — the span the physics uses, kept for the copy
      // that names the difference; the BILL is cutKg, and the gate holds cutKg's total
      // to the model's own pipeKg.
      memberKg: kgPerM * memberMm * g.count / 1000,
    };
  }
  const all = CUT_GROUPS.order.map(k => groups[k]);
  const sum = (f, gs = all) => gs.reduce((t, g) => t + f(g), 0);
  const skus = {};
  for (const sku of ['main', 'rim']) {
    const gs = all.filter(g => g.sku === sku);
    skus[sku] = {
      odMm: gs[0].odMm, idMm: gs[0].idMm, wallMm: gs[0].wallMm,
      sectionMm2: gs[0].sectionMm2, kgPerM: gs[0].kgPerM,
      // As BOUGHT, against the co-critical R/t the model would pick. A catalogue section
      // is nowhere near it, and saying so is the honest version of "we buy stock".
      rOverT: (gs[0].odMm / 2) / gs[0].wallMm,
      cuts: sum(g => g.count, gs), cutM: sum(g => g.cutM, gs),
      sticks: packSticks(gs, STOCK_LEN_M * 1000, KERF_MM),
      // Keeping each length on its own stick — no mixing, which is how a shop that cuts
      // one length at a time actually works — costs whole sticks. Worth stating.
      sticksUnmixed: sum(g => Math.ceil(
        g.count / Math.floor(STOCK_LEN_M * 1000 / (g.cutMm + KERF_MM))), gs),
    };
  }
  const sticks = skus.main.sticks + skus.rim.sticks;
  const purchasedM = sticks * STOCK_LEN_M;
  const cutM = sum(g => g.cutM), memberM = sum(g => g.memberM);
  // The model's Euler margin is quoted on the centre-to-centre length. The member is
  // really held at its shoulders, over the cut — and Pcr goes as 1/L², so the published
  // figure is the conservative one by exactly (member/cut)². Quoted for the interior cut,
  // which is the run the model's own per-strut demand is about.
  const ref = groups[CUT_GROUPS.order[0]];
  return {
    kerfMm: KERF_MM, stockLenM: STOCK_LEN_M,
    order: CUT_GROUPS.order, groups, skus,
    lengths: new Set(all.map(g => g.cutMm.toFixed(2))).size,
    members: CUT_GROUPS.members,
    cutM, memberM, insideJointsM: memberM - cutM,
    cutKg: sum(g => g.cutKg), memberKg: sum(g => g.memberKg),
    sticks, purchasedM, sticksUnmixed: skus.main.sticksUnmixed + skus.rim.sticksUnmixed,
    purchasedKg: skus.main.sticks * STOCK_LEN_M * skus.main.kgPerM
               + skus.rim.sticks * STOCK_LEN_M * skus.rim.kgPerM,
    offcutPct: 100 * (1 - cutM / purchasedM),
    freeLenMm: ref.cutMm,
    eulerFreeX: stock.eulerMarginPinned * (ref.memberMm / ref.cutMm) ** 2,
    eulerFreeGainX: (ref.memberMm / ref.cutMm) ** 2,
  };
}

/* ---------- the membrane: the model's own film arithmetic, composed ---------------------------- */

/* THE SKIN, out of cell/model.js and nowhere else — but through parts of it the model does
 * not return. filmEdgeLoads computes each panel's membrane tension inside a closure and
 * throws it away, keeping only the line loads it needs.
 *
 * Rather than write a second copy of that arithmetic here, every quantity below is pulled
 * back OUT of barrierKgPerM2, which is the same bulge geometry with the same default h/a:
 * what it returns is rhoF · P_ATM · rBulge / (2 · sigma_allow), so
 *     rhoF = 1, sigmaF = sf = eff = 1   ->   P_ATM · rBulge / 2, the membrane TENSION
 *     rhoF = 1                          ->   the film's THICKNESS, in metres
 * and the bulge radius, sin α and the bulge depth all follow from the tension. Move the
 * model's bulge fraction and every one of them moves with it, which a transcribed copy
 * would not. The one constant written down here is the cell's own hexagon-hexagon
 * dihedral, which is geometry rather than a modelling choice.
 */
function skinBlock(span, stock, edge) {
  const f = CELL.kelvinFaces(span);
  const panel = (frac) => 2 * frac * f.edgeM;         // barrierKgPerM2's own convention
  const tensionAt = (p) => CELL.barrierKgPerM2(p, { rhoF: 1, sigmaF: 1, sf: 1, eff: 1 });
  const thickness = (p) => CELL.barrierKgPerM2(p, { rhoF: 1 });
  const rBulge = (p) => 2 * tensionAt(p) / CELL.P_ATM;
  const depth = (p) => {
    const R = rBulge(p), a = p / 2;
    return R - Math.sqrt(R * R - a * a);              // circular segment, from its radius
  };
  const hexP = panel(CELL.PANEL.hexSpoked);
  const sqP = panel(CELL.PANEL.squareSpoked);
  const bareP = panel(CELL.PANEL.hexUnbraced);
  // sin α = panel half-span / bulge radius, and it is the SAME at every panel size — both
  // scale with the panel — which is the one convenient thing about this problem.
  const sinA = (hexP / 2) / rBulge(hexP);
  const rows = edge.rows;
  return {
    hexM2: f.hexM2, sqM2: f.sqM2, areaM2: f.areaM2,
    hexTotalM2: edge.hexFaces * f.hexM2, sqTotalM2: edge.squareFaces * f.sqM2,
    hexSharePct: 100 * edge.hexFaces * f.hexM2 / f.areaM2,
    hexPanelMm: hexP * 1000, sqPanelMm: sqP * 1000, barePanelMm: bareP * 1000,
    hexArealGM2: CELL.barrierKgPerM2(hexP) * 1000,
    sqArealGM2: CELL.barrierKgPerM2(sqP) * 1000,
    // The stress the model actually works the fibre to: tension over thickness, which is
    // the fibre strength after the safety factor and the laminate efficiency have both
    // been taken out of it. Recovered rather than transcribed — those three constants are
    // barrierKgPerM2's defaults and it does not export them.
    allowMPa: tensionAt(hexP) / thickness(hexP) / 1e6,
    // h/a, read back off the geometry: the bulge fraction every film number assumes.
    bulgeFrac: depth(hexP) / (hexP / 2),
    hexThicknessUm: thickness(hexP) * 1e6, sqThicknessUm: thickness(sqP) * 1e6,
    hexFilmG: edge.hexFaces * f.hexM2 * CELL.barrierKgPerM2(hexP) * 1000,
    sqFilmG: edge.squareFaces * f.sqM2 * CELL.barrierKgPerM2(sqP) * 1000,
    filmG: CELL.filmKg(span) * 1000,
    tensionHex: tensionAt(hexP), tensionSq: tensionAt(sqP), tensionBare: tensionAt(bareP),
    sinAlpha: sinA, alphaDeg: Math.asin(sinA) * 180 / Math.PI,
    // The truncated octahedron's hexagon-hexagon interior angle. filmEdgeLoads uses the
    // same arccos(-1/3) as thHH and does not return it; it is a property of the shape, not
    // a modelling choice, and the page names it as the reason the two tensions add.
    dihedralDeg: Math.acos(-1 / 3) * 180 / Math.PI,
    wBare: rows[0].lineLoadNPerM, wRim: rows[1].lineLoadNPerM,
    wSpoke: rows[3].lineLoadNPerM, wSqTie: rows[5].lineLoadNPerM,
    doublingX: rows[1].lineLoadNPerM / rows[3].lineLoadNPerM,
    bulgeHexMm: depth(hexP) * 1000, bulgeSqMm: depth(sqP) * 1000,
    bulgeBareMm: depth(bareP) * 1000,
    bulgeLostL: edge.bulgeVolumeLostPct / 100 * stock.enclosedL,
    // WHAT A PAD COULD COLLECT, and it is why there is no pad: a disc only picks up what
    // the film's tension hands it around its own perimeter, 2·π·r·T·sin α. The manifest
    // ships pad_r = 0; the six spokes carry the hub's share instead.
    padCollectsN: Math.PI * (CELL.PAD_R_M * 2) * tensionAt(hexP) * sinA,
    padNeedsDiaMm: 1000 * edge.hubShareN / (Math.PI * tensionAt(hexP) * sinA),
  };
}

/* THE LEDGER — mass against the air, the page's own summary of the only fight that
 * matters. Every row is derived: the breakdown comes off the cut schedule's single-family
 * groups and the manifest's joint families (primary = the octet's own lattice, secondary =
 * the boundary apparatus the odd-n article carries), the air comes off the model's ISA
 * density at each altitude, and the pressure is recovered from that same density through
 * the ISA identity p = rho·R·T rather than typed — at sea level it reproduces P_ATM to
 * the pascal, which is the check that it is the same atmosphere. */
function weighBlock(demo, stock, cuts, skin, altM) {
  const V = demo.enclosedL / 1000;
  const VL = SKIN.numbers.dispLoadedM3;   // the article once the film dishes in (#63)
  const A = skin.areaM2;
  const at = (h) => {
    const rho = CELL.rhoAir(h);
    const p = rho * 287.05 * (288.15 - 0.0065 * h);
    return { airKg: rho * V, airLoadedKg: rho * VL, forceTf: p * A / 9806.65, pKPa: p / 1000 };
  };
  const sl = at(0), up = at(altM);
  let tubePriKg = 0, tubeSecKg = 0;
  for (const k of Object.keys(cuts.groups)) {
    const g = cuts.groups[k];
    if (Object.keys(g.kinds)[0] === 'octet') tubePriKg += g.cutKg;
    else tubeSecKg += g.cutKg;
  }
  const jKg = (keys) => keys.reduce((t, k) => t + NODE_FAMILIES[k].massGSum, 0) / 1000;
  const jointPriKg = jKg(['lattice-12', 'lattice-11', 'lattice-8']);
  const jointSecKg = jKg(['rimVertex-7', 'hexHub-9']);
  const filmKg = skin.filmG / 1000;
  const totalKg = stock.totalKg;
  return {
    totalKg, filmG: skin.filmG,
    tubePriKg, tubeSecKg, jointPriKg, jointSecKg,
    sumKg: tubePriKg + tubeSecKg + jointPriKg + jointSecKg + filmKg,
    airSLG: sl.airKg * 1000, airUpG: up.airKg * 1000,
    overSLx: totalKg / sl.airKg, overUpx: totalKg / up.airKg,
    shedSLKg: totalKg - sl.airKg, shedUpKg: totalKg - up.airKg,
    forceSLTf: sl.forceTf, forceUpTf: up.forceTf,
    pSLKPa: sl.pKPa, pUpKPa: up.pKPa,
    // The pumped-down article: every panel's bowl is open to the sky, so the displaced
    // volume — and with it the float target — belongs to the LOADED shape.
    // Both numbers in this row are the skin tool's, at the span the article is CUT to
    // (709.00) — the air rows above keep the model's printer-chain span. Mixing the two
    // inside one row made 159.8-of-177.9 read as an 10.2% dish when the solve says 10.35.
    dispL: SKIN.numbers.dispNominalM3 * 1000, dispLoadedL: VL * 1000,
    dishPct: SKIN.numbers.dishPct,
    airSLLoadedG: sl.airLoadedKg * 1000, airUpLoadedG: up.airLoadedKg * 1000,
    overSLLoadedx: totalKg / sl.airLoadedKg, overUpLoadedx: totalKg / up.airLoadedKg,
  };
}

/* ---------- everything the page displays, computed in one place ------------------------------- */

const P100 = resolveClass('P100');

// The loaded-skin morph handle — set once when the stage cell is built (buildCell runs
// once; the four stage levels share its scene graph).
let LOADED_SKIN = null;

export function computeCtx(matKey = 'PAHT_Z', altM = 2500) {
  const M = CELL.MATERIALS;
  const m = M[matKey] || M.PAHT_Z;
  matKey = M[matKey] ? matKey : 'PAHT_Z';
  const wall = CELL.rhoAir(altM);
  const wallWork = CELL.rhoAir(2500);
  const paht = M.PAHT_Z;
  const chain = CELL.printerChain(paht);
  const design = chain.find(r => r.designPoint);
  const demo = CELL.demonstrator(paht);
  const ladRef = CELL.ladder(M.M60J_LAM);
  const ladSel = CELL.ladder(m);
  const graded = CELL.gradedPressure(M.M60J_LAM, wallWork);
  const shapes = CELL.cellShapes();
  const sw = CELL.sharedWall(2.0);
  const tSel = CELL.tubeStrut(m);
  const tRef = CELL.tubeStrut(M.M60J_LAM);
  const stock = CELL.stockBuild();
  const edge = CELL.filmEdgeLoads(demo.spanM);
  const cuts = cutSchedule(stock, M.T700_LAM);
  const skin = skinBlock(demo.spanM, stock, edge);
  // The loaded skin (#63), straight off the generated module: the solved sag per
  // panel class, tensions at both altitudes, the displacement debit, the clearance
  // to the frame, and the gore study's verdict numbers.
  Object.assign(skin, {
    loadedSagHexMm: SKIN.numbers.sagHexMm, loadedSagSqMm: SKIN.numbers.sagSqMm,
    loadedTHexSL: SKIN.numbers.tHexSLNpm, loadedTSqSL: SKIN.numbers.tSqSLNpm,
    loadedTHex2500: SKIN.numbers.tHex2500Npm, loadedTSq2500: SKIN.numbers.tSq2500Npm,
    loadedDishPct: SKIN.numbers.dishPct, loadedDispL: SKIN.numbers.dispLoadedM3 * 1000,
    loadedDishL: SKIN.numbers.dishM3 * 1000,
    loadedClearanceMm: SKIN.numbers.clearanceMm,
    loadedDomeAreaM2: SKIN.numbers.domeAreaM2,
    goredPieces: SKIN.numbers.goredPiecesAtK12,
    goredSeamM: SKIN.numbers.goredSeamAtK12M,
    goreResHexPct: SKIN.numbers.goreStudyPctHex['12'],
    goreResSqPct: SKIN.numbers.goreStudyPctSq['12'],
    strainNeedPct: SKIN.numbers.strainFlatPct, strainHavePct: SKIN.numbers.strainBudgetPct,
    formedDies: SKIN.numbers.formedDies, formedPressings: SKIN.numbers.formedPressings,
  });
  const totals = {};
  for (const [k, mm] of Object.entries(M)) {
    const ts = CELL.totalShell(mm, 2.0);
    totals[k] = { name: mm.name, total: ts.total, lattice: ts.lattice, nodes: ts.nodes,
                  film: ts.film, margin: wallWork / ts.total, floats: ts.total < wallWork,
                  ROverT: ts.detail.tubeROverT, printable: mm.printable };
  }
  return {
    matKey, altM, m, wall, wallWork,
    chain, design, demo,
    ladRef, ladSel, graded, shapes, sw,
    tSel, tRef, totals,
    breach: CELL.breach(matKey === 'AEROGEL' ? 'M60J_LAM' : matKey, altM),
    orthoPenalty: CELL.ORTHO_PENALTY,
    sf: CELL.LATTICE_SF,
    selTotal: totals[matKey],
    level2: { total: ladRef[2].total, margin: wallWork / ladRef[2].total },
    level1: { total: ladRef[1].total, margin: wallWork / ladRef[1].total },
    envFilm: CELL.envelopeFilmKgPerM3(),
    weightless: CELL.weightlessArticle(wallWork),
    wCFF: CELL.weightlessArticle(wallWork).find(r => r.key === 'CFF'),
    wM60: CELL.weightlessArticle(wallWork).find(r => r.key === 'M60J_LAM'),
    wT700: CELL.weightlessArticle(wallWork).find(r => r.key === 'T700_LAM'),
    stock, edge,
    // The printed joints, per family, straight from the manifest of the meshes that were
    // written. NOT from model.js — it carries one number out of the whole manifest
    // (NODE_MASS_MEASURED_KG) and a browser cannot read the manifest itself.
    fam: NODE_FAMILIES, nodes: NODE_TOTALS, joint: JOINT,
    // The saw schedule and the membrane: model lengths and manifest seat depths in one
    // case, the model's own film arithmetic recovered from barrierKgPerM2 in the other.
    cuts, skin,
    weigh: weighBlock(demo, stock, cuts, skin, altM),
    padDiaMm: CELL.PAD_R_M * 2000,
    pahtRho: CELL.MATERIALS.PAHT_Z.rho,
    // The fibre the purchased tube is priced as, named by the model rather than by the
    // copy — the mass, the section and the Euler margin all come off this row.
    tubeMat: M.T700_LAM.name,
    // The iteration ladder for the ARTICLE itself: same geometry, better material, deeper
    // hierarchy, until it floats. Generated per material from the same ladder physics.
    floatPath: [['PAHT_Z', 'PAHT-CF, printed (this article)'],
      ['CFF', 'continuous fibre, printed'],
      ['T700_LAM', 'T700, wound'],
      ['M60J_LAM', 'M60J-class, wound']].map(([k, label]) => {
      const lad = CELL.ladder(M[k]);
      const first = lad.find(rr => rr.total < wallWork);
      return { key: k, label,
               level: first ? first.levels : null,
               total: first ? first.total : null,
               margin: first ? wallWork / first.total : null,
               yieldCapped: first ? first.yieldCapped : false };
    }),
    plenum: CELL.pumpedPlenum(),
    plenumHalf: CELL.pumpedPlenum().find(r => r.plenumAtm === 0.5),
    hull: { lengthM: P100.lengthM, volumeM3: CELL.HULL_VOLUME_M3 },
    paht: { zSigmaMPa: CELL.MATERIALS.PAHT_Z.sigma / 1e6,
            zEGPa: CELL.MATERIALS.PAHT_Z.E / 1e9,
            xySigmaMPa: CELL.MATERIALS.PAHT_XY.sigma / 1e6,
            xyEGPa: CELL.MATERIALS.PAHT_XY.E / 1e9 },
  };
}

/* ---------- the seven levels ------------------------------------------------------------------ */
/* Ordered fine -> coarse. Each builder returns { root, labels } built in real metres. */

function inst(parent, spec, xf, count, opts = {}) {
  const n = addChild(parent, node({ category: 'vacuum', selectable: false, ...spec }));
  n.inst = {
    xf, count,
    tint: opts.tint || (() => { const t = new Float32Array(count * 4); t.fill(1); return t; })(),
    ids: opts.ids || null,
    pickable: !!opts.ids,
    dirty: true,
  };
  return n;
}

function lineNode(parent, id, segs, xmat, weights = null) {
  const n = addChild(parent, node({
    id, category: 'vacuum', selectable: false,
    geom: G.lines(segs, weights), draw: 'lines',
  }));
  n.xmat = xmat;
  return n;
}

function solidNode(parent, id, geom, xmat, extra = {}) {
  const n = addChild(parent, node({ id, category: 'vacuum', selectable: false, geom, ...extra }));
  n.xmat = xmat;
  return n;
}

/** THE JOINTS ARE THE GENERATOR'S OWN MESHES now, not stand-ins. Every "printed" thing in
 * the cell used to be a sphere plus twelve lathed socket cones, and three separate defects
 * the designer found by eye — a hub resized four times, a rim with no receivers,
 * interference inside the sockets — were all artifacts of those stand-ins. The meshes come
 * out of cell/nodemeshes.generated.js, grown by the same SDF rule as the print STLs
 * (`python3 tools/gen_display_meshes.py`), quantized to 0.05 mm about each joint's centre.
 *
 * Decoded here in millimetres and scaled straight into drawn metres. The meshes are LOCAL
 * — article orientation, origin at the joint's own centre — and are placed at the page's
 * own drawn points: the render's half-pitch is 0.14% off the generator's, and a mesh
 * placed at generator coordinates would open a seam against every pipe. */
function meshGeom(rec) {
  const meta = NODEMESHES.meta;
  const bytes = (b64) => {
    const s = atob(b64);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  };
  const q = new Uint16Array(bytes(rec.v).buffer);
  const pos = new Float32Array(q.length);
  const k = meta.quantStepMm / 1000, o = meta.quantOriginMm / 1000;
  for (let i = 0; i < q.length; i++) pos[i] = q[i] * k + o;
  return G.solid(pos, new Uint32Array(new Uint16Array(bytes(rec.i).buffer)));
}

/* A STAGE level: one that shows the cell instead of building a scene of its own.
 *
 * All three of the levels below the cell were diagrams of the article standing next to the
 * article: a lone 251 mm strut with stub arms, a magnified ring of tube wall, a stack of
 * print beads under a nozzle. Each was drawn from its own numbers, and none of them could
 * be wrong in a way the page would notice. They now tour the real cell instead — the
 * joints it prints, the cuts it is sawn from, the faces its film spans — so they build
 * nothing: this shell exists only so `built[i]` keeps its shape (root, labels, level,
 * fade) and the build loop, the render loop and styleFor stay untouched. built[3] holds
 * the single scene graph every stage level displays.
 *
 * NOT a second reference to the cell's root object. renderBody pushes each root into the
 * frame's children, so the same object appearing in two records would draw and shade the
 * article twice, and `walk(b.root, n => n._fadeRoot = b)` would have stamped only one of
 * them — the fade would then track the wrong level's number.
 */
function buildStageShell(id, ctx) {
  const root = node({ id: `L_${id}`, category: 'vacuum', selectable: false });
  if (id === 'track' && ctx) flatSkin(root, ctx);
  return { root, labels: [] };
}

/** THE SKIN, UNFOLDED — a real net, not a layout.
 *
 *  The designer will laser-cut from this, fold it around the tube frame and tape it closed,
 *  so it has to fold back into a cell. It does: the fourteen faces are hinged along a
 *  spanning tree of the face-adjacency graph — 13 folds, 23 cuts of the 36 edges — and each
 *  face's pose at animation parameter u is
 *      T_child(u) = T_parent(u) · R(hinge, theta*u)
 *  with the hinge taken in the ORIGINAL cell frame and theta the signed angle about it that
 *  carries the child's normal onto the parent's. Both faces live in the same frame, so the
 *  local rotation composes on the right. At u = 0 it is the cell; at u = 1 every face is
 *  coplanar with the root; and every frame between is a rigid motion of each panel, which is
 *  what makes it read as folding rather than morphing.
 *
 *  VERIFIED OFFLINE BEFORE THIS WAS WRITTEN, because a net that self-overlaps cannot be cut
 *  and the animation looks perfect either way: all fourteen roots give ZERO overlapping face
 *  pairs and coplanarity to 4e-16. A truncated octahedron unfolds cleanly from any face.
 */
function buildNet(span) {
  const { verts, squares, hexes } = G.kelvinFaces(span);
  const faces = [...squares, ...hexes];
  const adj = faces.map(() => []);
  for (let i = 0; i < faces.length; i++) {
    for (let k = i + 1; k < faces.length; k++) {
      const sh = faces[i].loop.filter(v => faces[k].loop.includes(v));
      if (sh.length === 2) { adj[i].push([k, sh]); adj[k].push([i, sh]); }
    }
  }
  const ROOT = 0;                     // any face works; a square keeps the net compact
  const parent = faces.map(() => -1), hinge = faces.map(() => null), order = [ROOT];
  const seen = new Set([ROOT]);
  for (let q = 0; q < order.length; q++) {
    for (const [k, e] of adj[order[q]]) {
      if (seen.has(k)) continue;
      seen.add(k); parent[k] = order[q]; hinge[k] = e; order.push(k);
    }
  }
  return { verts, faces, parent, hinge, order, root: ROOT,
           folds: faces.length - 1, cuts: 36 - (faces.length - 1) };
}

/** Each face's (rotation, translation) at u, plus the net's own in-plane basis. */
function netPose(net, u) {
  const { verts, faces, parent, hinge, order, root } = net;
  const M = [];
  M[root] = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]];
  for (const f of order.slice(1)) {
    const [ia, ib] = hinge[f], A = verts[ia];
    const ax = norm(sub(verts[ib], A));
    const nf = faces[f].normal, np2 = faces[parent[f]].normal;
    const ang = Math.atan2(dot(cross(nf, np2), ax), dot(nf, np2)) * u;
    const R = rotAxis(ax, ang);
    const [Rp, Tp] = M[parent[f]];
    // rotate about the LINE through A, then carry by the parent's accumulated pose
    const t0 = sub(A, mat3(R, A));
    M[f] = [mat3mul(Rp, R), add(mat3(Rp, t0), Tp)];
  }
  // SHOW THE SKY SIDE (operator, 08-13): flat, the net used to land inside-up —
  // the dark face of a film whose whole point is its bright outer surface. The
  // net now turns half a page about the root face's own in-plane axis as it
  // opens (pi times u, about the line through the root's first edge): a RIGID
  // motion, so the offline guarantees — planarity, areas, zero overlaps — ride
  // along untouched, and at u = 0 it is still exactly the cell.
  if (u !== 0) {
    const rl = net.faces[root].loop;
    const A2 = verts[rl[0]];
    const ax2 = norm(sub(verts[rl[1]], A2));
    const Rf = rotAxis(ax2, Math.PI * u);
    const tA = sub(A2, mat3(Rf, A2));
    for (const f of order) {
      const [R0, T0] = M[f];
      M[f] = [mat3mul(Rf, R0), add(mat3(Rf, T0), tA)];
    }
  }
  return M;
}

function flatSkin(root, ctx) {
  const span = ctx.demo.spanM;
  const net = buildNet(span);
  const g = { net, span, u: 0, sheet: null, cuts: null, folds: null };
  const sheet = solidNode(root, 'FlatSkin', netGeom(net, 0).solid,
    { kind: 'surface', color: '#8fb6dc', spec: 0.10, opacity: 1 });
  sheet.skinPart = 'surface';
  // MATCH THE CELL GROUP'S POSE. buildCell rotates its whole group so one strut lands on the
  // strut level's tube for the dive (cg.r below); the net has to carry the same rotation or it
  // sits beside the cell as a second, misaligned copy — which is exactly how it shipped once.
  sheet.p = CELL_CENTRE.slice();
  sheet.r = [-Math.PI / 4, 0, -Math.PI / 2];
  const cuts = lineNode(root, 'FlatSkinCuts', netGeom(net, 0).cutSegs, XM.kelvinEdge);
  cuts.p = CELL_CENTRE.slice();
  cuts.r = [-Math.PI / 4, 0, -Math.PI / 2];
  g.sheet = sheet; g.cuts = cuts;
  root.net = g;
  return g;
}

/** The net's geometry at u: one solid for the panels, one line set for the cut edges. */
function netGeom(net, u) {
  const M = netPose(net, u);
  const { verts, faces } = net;
  const pos = [], idx = [], cutSegs = [];
  faces.forEach((f, fi) => {
    const [R, T] = M[fi];
    const P = f.loop.map(i => add(mat3(R, verts[i]), T));
    const c = P.reduce((s2, p) => add(s2, [p[0] / P.length, p[1] / P.length, p[2] / P.length]),
      [0, 0, 0]);
    const base = pos.length / 3;
    pos.push(c[0], c[1], c[2]);
    for (const p of P) pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < P.length; i++) {
      idx.push(base, base + 1 + i, base + 1 + (i + 1) % P.length);
      cutSegs.push([P[i], P[(i + 1) % P.length]]);
    }
  });
  return { solid: G.solid(new Float32Array(pos), new Uint32Array(idx)), cutSegs };
}

const rotAxis = (a, ang) => {
  const [x, y, z] = a, c = Math.cos(ang), s2 = Math.sin(ang), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s2, x * z * C + y * s2,
    y * x * C + z * s2, c + y * y * C, y * z * C - x * s2,
    z * x * C - y * s2, z * y * C + x * s2, c + z * z * C];
};
const mat3 = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
  R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mat3mul = (A, B) => {
  const O = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    O[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return O;
};
const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const scale = (p, s) => [p[0] * s, p[1] * s, p[2] * s];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0]];
const norm = (p) => { const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l]; };

/* L3 — the cell: the printable demonstrator, 354 mm, 44 litres of nothing. */
function buildCell(ctx) {
  // The meshes arrive by loadNodemeshes(); a mount that builds this level without them
  // is a wiring bug, and a quiet one — joints would simply not draw. Fail loudly instead.
  if (!NODEMESHES) throw new Error('buildCell before loadNodemeshes() resolved — await it before mounting (lite mounts never build the cell)');
  const root = node({ id: 'L_cell', category: 'vacuum', selectable: false });
  const p = CELL.DEMO_PITCH_PINNED_M;         // the BUILT article's pitch, pinned
  const L = CELL.DEMO_STRUT_PINNED_M;         // (the chain's live optimum may move)
  // DRAW THE ARTICLE WE ARE ACTUALLY SPECIFYING. Radii come from the cut schedule's own
  // SKUs per group below — this level once took a single radius from the printer chain's
  // O33 tube and drew pipes passing through pipes, an article that could not be built.
  // THE JOINTS ARE THE GENERATED MESHES — the ball-and-cone era is over. A sphere plus
  // twelve lathed cones stood in for every printed part, and the whole history of that
  // stand-in was the designer catching its artifacts one by one: a hub inflated three
  // times to hide collar crossings that the real blended body never has, receivers missing
  // at the rim, bores looking through their neighbours. Each joint now draws
  // gen_nodes' own field (cell/nodemeshes.generated.js), so what the eye inspects and what
  // the printer receives are the same rule. The pipes are drawn to the CUT SCHEDULE:
  // each end stops at its own joint's slot base — the seat the pipe really butts on —
  // rather than at a uniform socket length that existed to meet the cones.
  const span = ctx.demo.spanM;                      // the Kelvin article, across its squares
  // THE DEMONSTRATOR IS THE DESIGN'S OWN SHAPE — a Kelvin cell, not a cube. (The first
  // build printed one cubic octet cell; the designer asked "why is it a cube" within a
  // day.) The lattice is the exact integer construction the model counts: nodes at
  // half-pitch positions u (integers, max|u| <= 2, sum|u| <= 3), struts on <110> steps,
  // 38 boundary nodes landing exactly in the faces where the skin bonds on.
  const cg = addChild(root, node({ id: 'CellGroup', category: 'vacuum', selectable: false }));
  cg.r = [-Math.PI / 4, 0, -Math.PI / 2];
  cg.p = [-p * Math.SQRT2 / 4, 0, 0];
  const half = p / 2;
  // FCC ONLY (even coordinate sum) — the phantom interleaved twin the first cut drew was
  // half of why the lattice looked so heavy.
  const inside = (u) => Math.max(Math.abs(u[0]), Math.abs(u[1]), Math.abs(u[2])) <= 2 &&
    Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2]) <= 3 &&
    ((u[0] + u[1] + u[2]) % 2 + 2) % 2 === 0;
  const uNodes = [];
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
    if (inside([x, y, z])) uNodes.push([x, y, z]);
  }
  const STEPS = [];
  for (const [sa, sb] of [[1, 1], [1, -1]]) STEPS.push([sa, sb, 0], [sa, 0, sb], [0, sa, sb]);
  const uKey = (u) => `${u[0]},${u[1]},${u[2]}`;
  const uSet = new Set(uNodes.map(uKey));
  // The hero strut: u (0,0,0) -> (0,1,1) — direction (0,1,1)/sqrt2, which the group euler
  // maps onto +x with its midpoint at the world origin. It was the handoff member for a
  // dive that used to cross-fade into a lone drawn tube; that level tours the real article
  // now and there is nothing to hand off to. It stays for the two reasons that are still
  // true: the group's whole placement is keyed to it (CELL_SHIFT is what puts it at the
  // origin, and the orbit target undoes exactly that), and it is the one member tessellated
  // finely enough to survive being framed from 25 mm away.
  const HERO = ['0,0,0', '0,1,1'];
  const pts = [], pairs = [];
  let heroPair = null;
  // EVERY JOINT AT ITS TRUE POSITION — which since the SUNKEN FRAME is the generator's own
  // sunken one, not the lattice point. The sphere-era insets were a patch and stayed gone;
  // this is the opposite thing, the article itself: gen_nodes.boundary_frame sinks every
  // boundary node along its land-normal bisector until its sockets clear the cell faces
  // (7.6 mm at a single land, 12.3 mm at the corners), a land post carries the mating flat
  // back up to the nominal plane, and the film drapes over the sunken frame pinned at the
  // post tops. The mesh module publishes each joint's own sinkMm — the generator's number,
  // never re-derived here — and the sink is applied AT THE SOURCE POINTS, so members,
  // seats, ghosts and parts all follow the same displaced article. Drawn without it, every
  // boundary joint floats off its own pipes by its whole sink.
  const sinkOf = new Map(NODEMESHES.nodes.map((m2) =>
    [`${m2.role}|${m2.u.join(',')}`, m2.sinkMm.map((x) => x / 1000)]));
  const sunk = (role, u, pt) => {
    const s = sinkOf.get(`${role}|${u.join(',')}`);
    return s ? [pt[0] + s[0], pt[1] + s[1], pt[2] + s[2]] : pt;
  };
  for (const u of uNodes) {
    pts.push(sunk('lattice', u, [u[0] * half, u[1] * half, u[2] * half]));
  }
  const uIndex = new Map(uNodes.map((u, i) => [uKey(u), i]));
  // THE ARTICLE'S OWN CONNECTION GRAPH, recorded while it is drawn, so a tour can fly to a
  // joint and dim everything that is not it. Two things are counted per printed joint:
  // its member-ends (ALL of them, including the 36 rim edges, which draw no socket cone of
  // their own — arm counts read off the drawn sockets would say 4 at a rim vertex and the
  // page's arm histogram would stop matching the manifest's), and the instance indices it
  // owns across every instanced node in the cell.
  const armCount = new Map();               // owner key -> member-ends
  const instOf = new Map();                 // owner key -> [[node id, instance index], ..]
  const bump = (k) => armCount.set(k, (armCount.get(k) || 0) + 1);
  const own = (k, id, i) => {
    if (!instOf.has(k)) instOf.set(k, []);
    instOf.get(k).push([id, i]);
  };
  const rvKey = (k2) => `rv:${k2}`;
  // AND THE MEMBERS, the same way. A cut length is a property of a member's two ENDS — the
  // seat depth at each — so the tube tour needs every member's pair of joint keys, not just
  // a count. Recorded where each one is drawn, so the schedule can never describe members
  // the page did not put on the screen.
  const memberRecs = [];
  const addMember = (kind, keyA, keyB, A, B) => {
    const rec = {
      kind, keys: [keyA, keyB], ends: [A, B],
      mid: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2],
      // Filled when the pipes are drawn: a member's pipe instance lives in its CUT GROUP's
      // node, and which group that is depends on both ends' seat depths — which are not
      // known until every joint's arm count is.
      inst: [],
    };
    memberRecs.push(rec);
    return rec;
  };
  for (const u of uNodes) {
    for (const s of STEPS) {
      const v = [u[0] + s[0], u[1] + s[1], u[2] + s[2]];
      if (!uSet.has(uKey(v))) continue;
      // STEPS holds one direction of each <110> pair, so this loop visits every octet
      // member exactly once — both of its ends have to be counted here.
      bump(uKey(u)); bump(uKey(v));
      const pair = [uIndex.get(uKey(u)), uIndex.get(uKey(v))];
      const isHero = (uKey(u) === HERO[0] && uKey(v) === HERO[1]) ||
                     (uKey(u) === HERO[1] && uKey(v) === HERO[0]);
      if (isHero) heroPair = pair; else pairs.push(pair);
      addMember('octet', uKey(u), uKey(v), pts[pair[0]],
        pts[pair[1]]).hero = isHero;
    }
  }

  // THE RIM FRAME: the hexagons have no lattice nodes (their centres belong to the dual
  // lattice), so the article frames its skin along its own 36 edges — each edge exactly
  // one strut long, on the EXACT edge, which is where gen_nodes puts it: the rim vertex
  // joint sits at the corner with three flat lands, and its rim arms leave along the
  // edges themselves. (The tubes were once inset along the edge bisectors "so the mating
  // faces stay flat" — a sphere-era patch that tilted every rim pipe off its socket. The
  // real rim tube DOES stand proud of the two faces meeting at its edge; the film tents
  // over it, and pricing that tenting is exactly what filmEdgeLoads exists for.)
  const rimEdges = G.kelvinEdges(span);
  const rimPts = [], rimPairs = [];
  let rp = 0;
  const rimVertMap = new Map();
  for (const [A0, B0] of rimEdges) {
    // Each endpoint IS a rim vertex: key it by its NOMINAL coordinate (the identity the
    // dedupe and the mesh lookup share), then sink the drawn point by that vertex's own
    // frame. The corner joints sink 12.3 mm along the corner bisector and the rim pipes
    // must follow them, seat to seat, or the rim floats over empty sockets.
    const ends = [], sunkAB = [];
    for (const v of [A0, B0]) {
      const k2 = v.map(x => x.toFixed(6)).join(',');
      const sv = sunk('rimVertex', v.map(x => Math.round(x / half)), v);
      sunkAB.push(sv);
      if (!rimVertMap.has(k2)) rimVertMap.set(k2, []);
      rimVertMap.get(k2).push(sv);
      bump(rvKey(k2));
      ends.push(rvKey(k2));
    }
    rimPts.push(sunkAB[0], sunkAB[1]);
    rimPairs.push([rp, rp + 1]);
    rp += 2;
    addMember('rim', ends[0], ends[1], sunkAB[0], sunkAB[1]);
  }
  // Rim vertex cores: every edge contributes the same true corner now, so the average IS
  // the Kelvin vertex, kept as an average only so the map's shape does not change.
  const rimCorePts = [];
  const rimIdxOf = new Map();
  for (const [k2, copies] of rimVertMap) {
    const c2 = [0, 0, 0];
    for (const v of copies) { c2[0] += v[0]; c2[1] += v[1]; c2[2] += v[2]; }
    rimIdxOf.set(k2, rimCorePts.length);
    rimCorePts.push([c2[0] / copies.length, c2[1] / copies.length, c2[2] / copies.length]);
  }
  // VERTEX TIES — the load path the designer caught missing (2026-08-10). The 24 rim
  // vertices are dual-lattice sites (coordinate sum odd), so the rim cage never touched
  // the octet: the two structures shared only the 6 square-centre nodes — "only touches
  // the face on the points of a cube", verbatim, and correct. Two printed ties per
  // vertex bind it to its nearest even-parity nodes: zero the +-1 coordinate (the
  // square-centre node) and step the +-2 coordinate inward (a cuboctahedron node).
  const tiePts = [], tiePairs = [];
  let tp = 0;
  const rimU = new Map();                   // rim vertex key -> its half-pitch integer u
  [...rimVertMap.keys()].forEach((k2, idx) => {
    const world = k2.split(',').map(Number);
    const u = world.map(x => Math.round(x / half));
    rimU.set(k2, u);
    const core = rimCorePts[idx];
    const tA = u.map(x => Math.abs(x) === 1 ? 0 : x);
    const tB = u.map(x => Math.abs(x) === 2 ? x - Math.sign(x) : x);
    // tA zeroes the +-1 coordinate, so it lands on the square-face centre and the tie lies
    // IN that square's plane — it is one of the 24 the model counts as bracing the squares
    // into four triangles. tB steps inward and leaves the plane. Tagged here rather than
    // re-derived later: the skin level's square stop lights exactly the in-plane ones.
    for (const [t, inPlane] of [[tA, true], [tB, false]]) {
      const ti = uIndex.get(uKey(t));
      if (ti === undefined) continue;
      tiePts.push(core, pts[ti]);
      tiePairs.push([tp, tp + 1]);
      tp += 2;
      bump(rvKey(k2)); bump(uKey(uNodes[ti]));
      addMember('tie', rvKey(k2), uKey(uNodes[ti]), core, pts[ti]).inPlane = inPlane;
    }
  });
  // HEX-CENTRE TRIPODS — the designer's second catch: after the vertex ties, the eight
  // hexagon faces were still bare membrane spans. Each face centre (a dual site at n=1)
  // gets a printed node on the plane itself, plus three <100> half-step ties
  // to the cuboctahedron nodes — halving the skin's unsupported span and giving mating
  // cells a shared bond point at every hexagon centre.
  const hexCorePts = [], hexU = [];
  const spokePts = [], spokePairs = [];
  let kp = 0;
  // THE FACES THE FILM SPANS, recorded as the frame that carries them is built: the
  // centre and the outward normal. The skin level tours these, and a face that was not
  // drawn cannot be toured. The hub joint sits AT the face centre — its land is the face
  // plane, exactly as gen_nodes truncates it; the old inset beneath the plane was the
  // sphere-era patch and it bent every spoke and tripod prop off its socket's axis.
  const faceRecs = [];
  const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c3 = [sx * half, sy * half, sz * half];
    const inv3 = 1 / Math.sqrt(3);
    // The JOINT sinks beneath the face (its land post reaches back up); the FACE the film
    // spans stays the nominal plane, so faceRecs keeps c3 while the hub core takes the
    // generator's sink.
    const core = sunk('hexHub', [sx, sy, sz], c3.slice());
    const hubKey = `hh:${hexCorePts.length}`;
    hexU.push([sx, sy, sz]);
    hexCorePts.push(core);
    faceRecs.push({ kind: 'hexagon', centre: c3,
                    normal: [sx * inv3, sy * inv3, sz * inv3] });
    for (const t of [[0, sy, sz], [sx, 0, sz], [sx, sy, 0]]) {
      const ti = uIndex.get(uKey(t));
      if (ti === undefined) continue;
      tiePts.push(core, pts[ti]);
      tiePairs.push([tp, tp + 1]);
      tp += 2;
      bump(hubKey); bump(uKey(uNodes[ti]));
      addMember('tie', hubKey, uKey(uNodes[ti]), core, pts[ti]);
    }
    // HEXAGON SPOKES — the designer's third catch, and the sharpest: "the main faces are
    // actually still unsupported (the smaller faces are supported by secondary structures
    // already)". Exactly so. Twenty-four of the forty-eight vertex ties lie IN the square
    // face planes and brace each square into four triangles; the eight hexagons had
    // nothing in plane at all, and the bending check says the rim was failing at 0.84
    // atmospheres because of it. Six radial spokes per hexagon, each the same 251 mm cut
    // as every primary — the hexagon's circumradius IS the strut length.
    const sgn = [sx, sy, sz];
    for (const w of PERMS) {
      const key = [0, 1, 2].map(q => (sgn[q] * w[q] * half).toFixed(6)).join(',');
      const vi = rimIdxOf.get(key);
      if (vi === undefined) continue;
      spokePts.push(core, rimCorePts[vi]);
      spokePairs.push([kp, kp + 1]);
      kp += 2;
      bump(hubKey); bump(rvKey(key));
      addMember('spoke', hubKey, rvKey(key), core, rimCorePts[vi]);
    }
  }
  // The six squares, the other half of the surface. Their centres ARE lattice sites — the
  // nodes with a coordinate at the limit — which is why a square closes with one printed
  // part and a hexagon needs a hub invented for it.
  for (const u of uNodes) {
    const q = u.findIndex(x => Math.abs(x) === 2);
    if (q < 0 || u.filter(x => x !== 0).length !== 1) continue;
    const n3 = [0, 0, 0];
    n3[q] = Math.sign(u[q]);
    faceRecs.push({ kind: 'square', centre: [u[0] * half, u[1] * half, u[2] * half],
                    normal: n3 });
  }
  // GHOST AXES — drawn only when the parts view hides the pipes. Without them the joints
  // read as a scatter.
  const ghostSegs = pairs.concat([heroPair]).map(([ia, ib]) => [pts[ia], pts[ib]])
    .concat(rimPairs.map(([ia, ib]) => [rimPts[ia], rimPts[ib]]))
    .concat(spokePairs.map(([ia, ib]) => [spokePts[ia], spokePts[ib]]))
    .concat(tiePairs.map(([ia, ib]) => [tiePts[ia], tiePts[ib]]));
  const ghosts = lineNode(cg, 'PipeGhosts', ghostSegs, XM.pipeGhost);
  ghosts.partFamily = 'ghost';
  // The skin, with THREE modes (a viewer asked): solid — the sealed article as an object;
  // transparent — structure visible through it; off. styleFor supplies the material per
  // mode; the cutaway slider cuts through all of them.
  // THE MEMBRANE IS DRAWN ON THE TRUE PLANES, and the hardware stands through it where
  // the real hardware stands through the real planes. This surface has been drawn proud
  // twice — 1.2% for the sphere-era stand-ins, then 2.4% to clear the collars — and each
  // offset traded one lie for another: first the glass sliced through the joints, then it
  // floated 8.5 mm off the corner lands it is bonded to ("far away from skin"). The film
  // bonds to the frame lines IN the face planes, bulges inward between them, and tents
  // over the rim tubes at the edges; a flat surface at the true span is the closest one
  // surface gets to that, and a rim tube poking through the glass is the tenting, not a
  // clash. skin.areaM2 and the film mass come from the model, not from this geometry.
  //
  // 0.15% proud — half a millimetre, a film thickness of daylight — and NOT exactly 1.0:
  // the boundary lands are snapped EXACTLY onto these same planes, and two coplanar
  // surfaces z-fight, which painted every hub land as a flickering white-and-brown patch
  // in the shape of its own hexagon. Touching and coincident are different things to a
  // depth buffer.
  const skin = solidNode(cg, 'CellSkin', G.kelvinGeom(span * 1.0015), XM.kelvinGhost);
  skin.skinPart = 'surface';
  // THE LOADED SKIN (#63): the same film pumped down, every panel dished to the membrane
  // shape tools/gen_skin.py solved (T = pR/2 at the analysis' own R = 2.125 r). Two fixed
  // position buffers — slack (every panel in its face plane) and formed (offset w along
  // the inward normal) — and the pump-down lerps between them into a fresh geometry
  // record, which is the unfold's own update pattern. Held half a millimetre proud of
  // the nominal planes for the same z-fighting reason CellSkin is.
  LOADED_SKIN = (() => {
    const OUT = 0.0005;
    const pos0 = [], pos1 = [], idx = [];
    for (const pl of SKIN.placements) {
      const c = SKIN.classes[pl[0]];
      const [ox, oy, oz, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz] = pl.slice(1);
      const base = pos0.length / 3;
      for (let i = 0; i < c.w.length; i++) {
        const x = c.pos[2 * i], y = c.pos[2 * i + 1], w = c.w[i];
        const px = ox + x * e1x + y * e2x + OUT * nx;
        const py = oy + x * e1y + y * e2y + OUT * ny;
        const pz = oz + x * e1z + y * e2z + OUT * nz;
        pos0.push(px, py, pz);
        pos1.push(px - w * nx, py - w * ny, pz - w * nz);
      }
      for (const t of c.tris) idx.push(base + t);
    }
    const flat = new Float32Array(pos0), full = new Float32Array(pos1);
    const index = new Uint32Array(idx);
    const nodeRef = solidNode(cg, 'CellSkinLoaded', G.solid(flat.slice(), index), XM.kelvinGhost);
    nodeRef.skinPart = 'surface';
    return { nodeRef, flat, full, index, at: -1 };
  })();
  const seams = lineNode(cg, 'CellSkinSeams', G.kelvinEdges(span),
    { kind: 'line', color: TOKENS.bone, weight: 1.2, opacity: 0.7 });
  seams.skinPart = 'seams';
  // THE 51 PRINTED JOINTS, as records a tour can aim at. World position comes from the
  // DRAWN local point pushed through the cell group's own matrix — never a second copy of
  // cg.r / cg.p, so the tour aims at what is on the screen by construction.
  const cgM = m4compose(cg.p, cg.r, 1);
  const parts = [];
  // EACH JOINT IS ITS GENERATED MESH, matched on (role, integer u) — the one identity the
  // render and the generator agree on exactly (their pitches differ by 0.14%, so nothing
  // else would). One scene node per joint, instanced with count 1: every mesh is unique,
  // which rules out shared-geometry instancing, and the per-instance TINT is what lets a
  // tour dim one joint against the rest at all — dimOf returns 1 for instanced nodes.
  // The five family representatives get a SECOND node each, the print-resolution mesh
  // with its open sockets, bores and ribs; styleFor swaps it in for the display mesh
  // only while the connector tour is framing that family, so the joint under the camera
  // is the printed part and the other fifty stay light.
  const meshOf = new Map(NODEMESHES.nodes.map((m2) => [`${m2.role}|${m2.u.join(',')}`, m2]));
  const repFamOf = new Map(FAMILY_ORDER.map((k) => [NODE_FAMILIES[k].repFile, k]));
  // Every scene node the assembly animation may move, by id — recorded where each one is
  // created, never rediscovered by walking the graph and guessing from id strings.
  const animNodes = new Map();
  const addPart = (key, role, u, local) => {
    const rec = meshOf.get(`${role}|${u.join(',')}`);
    if (rec) {                 // the gate counts drawn joints; a miss must not kill the page
      const xf2 = new Float32Array(16);
      m4compose(local, [0, 0, 0], 1, xf2);
      const jm = inst(cg, { id: `Joint_${rec.file.slice(5, 7)}` }, xf2.slice(), 1);
      jm.geom = meshGeom(rec);
      jm.xmat = XM.printed;
      jm.partFamily = 'printed';
      own(key, jm.id, 0);
      animNodes.set(jm.id, jm);
      const famKey = repFamOf.get(rec.file);
      if (famKey) {
        jm.dispRepOf = famKey;
        const rep = inst(cg, { id: `RepJoint_${famKey}` }, xf2.slice(), 1);
        rep.geom = meshGeom(NODEMESHES.reps[famKey]);
        rep.xmat = XM.printed;
        rep.partFamily = 'printed';
        rep.repFam = famKey;
        own(key, rep.id, 0);
      }
    }
    parts.push({
      key, role, u,
      arms: armCount.get(key) || 0,
      pos: m4transform(cgM, local),
      local: local.slice(),
      inst: instOf.get(key) || [],
    });
  };
  uNodes.forEach((u, i) => addPart(uKey(u), 'lattice', u, pts[i]));
  [...rimVertMap.keys()].forEach((k2, i) =>
    addPart(rvKey(k2), 'rimVertex', rimU.get(k2), rimCorePts[i]));
  hexCorePts.forEach((c3, i) => addPart(`hh:${i}`, 'hexHub', hexU[i], c3));
  // THE PIPES, drawn to the cut schedule. Every member's tube runs SEAT TO SEAT: each end
  // stops where its own joint's slot base puts the seat the pipe butts on, so the tube on
  // screen is the sawn cut, not a centre-to-centre line with its ends hidden inside the
  // old cones. Members group by (SKU, length class, both ends' seat depth) — the same
  // signature the generated schedule carries — one instanced node per group, geometry cut
  // to the group's own length. Instances stretch axially onto their drawn span: the drawn
  // pitch sits 0.14% off the generator's, and a pipe end hanging short of its
  // cup would read as "not connected". The ties are the same purchased 10 x 8 SKU as
  // every primary and the MOST loaded members in the article — a tripod leg takes
  // 3,183 N against a primary's 3,372 N crush demand.
  const famOf2 = new Map(parts.map((p2) => [p2.key, NODE_FAMILIES[`${p2.role}-${p2.arms}`]]));
  const wallM = (ctx.stock.odM - ctx.stock.idM) / 2;
  // (SKU, length class, deduction) is no longer a unique signature: the sink saws the 36
  // rim edges to TWO lengths off ONE deduction, because hexagon-hexagon and square-hexagon
  // corners settle along different bisectors. Where the signature holds several groups the
  // member's own DRAWN length decides — the drawn article is the sunken one, the candidate
  // groups differ by 1.1 mm, and the 0.14% pitch offset between the render and the
  // generator moves a 242 mm member 0.34 mm, three times finer than the split.
  const sigOf = new Map();
  for (const k of CUT_GROUPS.order) {
    const g = CUT_GROUPS.groups[k];
    const sig = `${g.sku}|${g.lengthKey}|${g.deductMm.toFixed(2)}`;
    if (!sigOf.has(sig)) sigOf.set(sig, []);
    sigOf.get(sig).push(k);
  }
  const pipeGroups = new Map(CUT_GROUPS.order.map((k) => [k, []]));
  for (const rec of memberRecs) {
    const a = famOf2.get(rec.keys[0]), b = famOf2.get(rec.keys[1]);
    if (!a || !b) continue;
    const sku = rec.kind === 'rim' ? 'rim' : 'main';
    const lengthKey = rec.kind === 'tie' ? 'short' : 'long';
    const cands = sigOf.get(`${sku}|${lengthKey}|${(a.slotBaseMm + b.slotBaseMm).toFixed(2)}`);
    if (cands === undefined) continue;    // the gate counts group membership; see below
    let gk = cands[0];
    if (cands.length > 1) {
      const [A, B] = rec.ends;
      const drawnMm = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * 1000;
      gk = cands.reduce((best, k) =>
        Math.abs(drawnMm - CUT_GROUPS.groups[k].trueMemberMm) <
        Math.abs(drawnMm - CUT_GROUPS.groups[best].trueMemberMm) ? k : best, gk);
    }
    rec.group = gk;
    rec.seats = [a.slotBaseMm / 1000, b.slotBaseMm / 1000];
    pipeGroups.get(gk).push(rec);
  }
  const seatSpan = (rec) => {
    const [A, B] = rec.ends;
    const d = norm(sub(B, A));
    return [add(A, [d[0] * rec.seats[0], d[1] * rec.seats[0], d[2] * rec.seats[0]]),
            sub(B, [d[0] * rec.seats[1], d[1] * rec.seats[1], d[2] * rec.seats[1]])];
  };
  for (const [gk, recs] of pipeGroups) {
    if (!recs.length) continue;
    const g = ctx.cuts.groups[gk];
    const gp = [], gpairs = [];
    for (const rec of recs) {
      if (rec.hero) continue;            // the hero keeps its own finer node, same schedule
      const [sA, sB] = seatSpan(rec);
      gp.push(sA, sB);
      gpairs.push([gp.length - 2, gp.length - 1]);
      rec.inst.push([`Pipes_${gk}`, gpairs.length - 1]);
    }
    const cutM = g.cutMm / 1000;
    if (gpairs.length) {
      const gi = G.strutInstances(gp, gpairs, 0, cutM);
      const pn = inst(cg, { id: `Pipes_${gk}` }, gi.xf, gi.count);
      pn.geom = G.tubeArcGeom(g.odMm / 2000, wallM, cutM, 360, g.sku === 'rim' ? 22 : 20);
      pn.xmat = g.sku === 'rim' ? XM.pipeRim : XM.pipe;
      pn.partFamily = 'pipe';
      animNodes.set(pn.id, pn);
    }
    const heroRec = recs.find((rec) => rec.hero);
    if (heroRec) {
      const hi = G.strutInstances(seatSpan(heroRec), [[0, 1]], 0, cutM);
      const hero = inst(cg, { id: 'HeroStrut' }, hi.xf, 1);
      hero.geom = G.tubeArcGeom(g.odMm / 2000, wallM, cutM, 360, 28);
      hero.xmat = XM.pipe;
      hero.partFamily = 'pipe';
      heroRec.inst.push(['HeroStrut', 0]);
      animNodes.set('HeroStrut', hero);
    }
  }
  // The members and the faces get the same treatment as the joints: their positions are
  // the DRAWN ones, pushed through the group's own matrix, so a tour aims at what is on
  // the screen rather than at a second computation of where it ought to be.
  // A face's outward normal needs no transform of its own: the cell is convex about its
  // own centre, so the direction from that centre to a face's centre IS its normal — which
  // is exactly what the tour's pose helper already works from.
  for (const mrec of memberRecs) mrec.pos = m4transform(cgM, mrec.mid);
  for (const frec of faceRecs) frec.pos = m4transform(cgM, frec.centre);

  /* THE ASSEMBLY, PLAYABLE. The timeline is the prover's own build order — ASSEMBLY in
   * the generated module is A3's inside-out sequence, the one proven to give every member
   * a clear path at its own turn — with each joint flying in just before the first member
   * that needs it. Nothing here invents choreography: tree members slide home axially the
   * way A4 sweeps them, closing members arrive tilted at their own kinematic entry angle
   * (from their cut and swing relief, the same identity P8 sweeps) and rotate down onto
   * their pilots. The default state is FULLY ASSEMBLED and every seated matrix is a byte
   * copy of the one the article was built with, so nothing outside the animation can tell
   * it exists; the pile poses are hashed deterministically (the strutInstances jitter
   * idiom — never Math.random, or the gate could not reproduce a frame). */
  const assembly = (() => {
    const uOfKey = new Map(parts.map((p2) => [p2.key, p2.u]));
    const partByU = new Map(parts.map((p2) => [p2.u.join(','), p2]));
    const pairKey = (ua, ub, fam) =>
      [ua.join(','), ub.join(',')].sort().join('|') + '|' + fam;
    const recByPair = new Map();
    for (const rec of memberRecs) {
      const ua = uOfKey.get(rec.keys[0]), ub = uOfKey.get(rec.keys[1]);
      if (ua && ub) recByPair.set(pairKey(ua, ub, rec.kind), rec);
    }
    const h = (i, s) => {
      const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    // World "down" in the cell group's local frame, so the pile lies on the floor the
    // viewer actually sees whatever the group's own rotation is.
    const dn = norm([-cgM[2], -cgM[6], -cgM[10]]);
    const e1 = norm(cross(dn, Math.abs(dn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const e2 = cross(dn, e1);
    const evs = [];
    const seenJ = new Set();
    for (const row of ASSEMBLY) {
      const rec = recByPair.get(pairKey(row.a, row.b, row.fam));
      if (!rec || !rec.inst.length) continue;    // the gate counts events; a miss shows there
      // A TREE MEMBER CARRIES ITS ARRIVING JOINT. A4's proven free motion is the arriving
      // node retracting along the parent axis WITH its member, so the pair fly and slide
      // in together — which is also what stops the pipe passing through a joint already
      // seated on its own slide line, the clip the designer caught on the first cut.
      let rider = null;
      const arrKey = row.arriving ? row.arriving.join(',') : null;
      if (arrKey && !seenJ.has(arrKey)) {
        const p2 = partByU.get(arrKey);
        if (p2 && p2.inst.length) { rider = p2; seenJ.add(arrKey); }
      }
      for (const uu of [row.a, row.b]) {
        const us = uu.join(',');
        if (seenJ.has(us)) continue;
        seenJ.add(us);
        const p2 = partByU.get(us);
        if (p2 && p2.inst.length) evs.push({ kind: 'joint', part: p2 });
      }
      evs.push({ kind: 'member', rec, closing: row.closing, rider,
                 escape: row.dir ? norm(row.dir) : null, arrKey });
    }
    const N = evs.length;
    const w = Math.max(0.02, 9 / Math.max(N, 1));
    // THE GUIDE CAPTIONS. The designer's brief: usable as an assembly guide, so every
    // event names the PART — the joint's own STL name, the pipe's family and saw length —
    // and where it connects, by the STL names of the joints at both ends. Nothing here is
    // prose someone typed: files come off the mesh manifest, cuts off the schedule, the
    // swing angle off the same kinematic identity the animation flies.
    const partByKey = new Map(parts.map((p2) => [p2.key, p2]));
    const fileOf = (p2) => {
      const r2 = meshOf.get(`${p2.role}|${p2.u.join(',')}`);
      return r2 ? r2.file.replace('.stl', '') : p2.key;
    };
    const famName = (p2) => {
      const f2 = NODE_FAMILIES[`${p2.role}-${p2.arms}`];
      return f2 ? f2.name : p2.role;
    };
    const pileAt = (i, salt) => {
      const r = span * 0.55 * Math.sqrt(h(i, 1 + salt));
      const th = 2 * Math.PI * h(i, 2 + salt);
      return add(scale(dn, span * (0.66 + 0.14 * h(i, 3 + salt))),
                 add(scale(e1, r * Math.cos(th)), scale(e2, r * Math.sin(th))));
    };
    // The flight from the pile arcs OUTSIDE the article: a straight lerp from under the
    // cell to a staging point on the far side transits the half-built frame. The control
    // point sits on the bisector of the two radial directions, pushed past the article's
    // own radius, so the quadratic bows around rather than through.
    const wayFor = (pile, stage) => {
      const dp = norm(pile), ds = norm(stage);
      let m = add(dp, ds);
      if (Math.hypot(...m) < 0.3) m = e1;          // opposite sides: swing wide laterally
      return scale(norm(m), span * 0.85);
    };
    evs.forEach((ev, i) => {
      ev.t0 = (N > 1 ? i / (N - 1) : 0) * (1 - w);
      ev.t1 = ev.t0 + w;
      ev.pile = pileAt(i, 0);
      ev.tumbleAxis = norm([h(i, 4) - 0.5, h(i, 5) - 0.5, h(i, 6) - 0.5]);
      ev.tumbleAng = (0.5 + 1.5 * h(i, 7)) * Math.PI;
      if (ev.kind === 'joint') {
        const [nid] = ev.part.inst[0];               // [0] is Joint_XX; reps come after
        ev.node = animNodes.get(nid);
        ev.idx = 0;
        ev.seated = ev.node ? ev.node.inst.xf.slice(0, 16) : null;
        if (ev.seated) {
          const sp = [ev.seated[12], ev.seated[13], ev.seated[14]];
          ev.way = wayFor(ev.pile, sp);
        }
        ev.cap1 = `place ${fileOf(ev.part)} — ${famName(ev.part)}`;
        ev.cap2 = 'set down first: the build’s seed — every other joint rides in on '
          + 'its own tree member';
        ev.cap = `${ev.cap1} · ${ev.cap2}`;
      } else {
        const [nid, idx] = ev.rec.inst[0];
        ev.node = animNodes.get(nid);
        ev.idx = idx;
        ev.seated = ev.node ? ev.node.inst.xf.slice(idx * 16, idx * 16 + 16) : null;
        if (!ev.seated) return;
        const m = ev.seated;
        const seatPos = [m[12], m[13], m[14]];
        ev.outN = norm(seatPos);
        const axis = norm([m[0], m[1], m[2]]);       // column 0: the pipe's stretched axis
        // THE APPROACH LINE IS THE PROOF'S OWN. A tree member with its rider slides on
        // the parent axis (A4); everything else flies in along its REVERSED escape — the
        // one straight line A3 verified clear of every part placed before this turn. The
        // outward radial is only the fallback for rows a stale report left bare.
        // THE SETTLE IS THE MODEL'S OWN MOTION, at its own scale — the designer's catch:
        // the swing angle is computed for a member ALREADY IN ITS GAP, pivoting about its
        // own middle, so the flight must deliver the part TO the seat first and the swing
        // then happens in place. A closing member therefore stages AT its seated midpoint
        // (tilted, P8's entry pose) and the settle is pure rotation; a tree pair stages
        // one real engagement out along the parent axis — the stub plus its relief room,
        // off the manifest, not a theatrical distance — and slides that far home.
        if (ev.rider) {
          const arr0 = uOfKey.get(ev.rec.keys[0]);
          const arrIsEnd0 = arr0 && arr0.join(',') === ev.arrKey;
          const [A, B] = ev.rec.ends;
          ev.approach = norm(arrIsEnd0 ? sub(A, B) : sub(B, A));
          ev.reach = (JOINT.stubMm + 8) / 1000;
        } else {
          ev.approach = ev.escape || ev.outN;
          ev.reach = ev.closing ? 0 : (JOINT.stubMm + 8) / 1000;
        }
        ev.stage = ev.reach > 0 ? add(seatPos, scale(ev.approach, ev.reach))
                                : seatPos.slice();
        ev.way = wayFor(ev.pile, ev.stage);
        let ta = cross(axis, ev.approach);
        if (Math.hypot(...ta) < 1e-6) {
          ta = cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
        }
        ev.tiltAxis = norm(ta);
        // The closing entry tilt is the sweep's own identity: acos(1 - 2*s_eff/P) on the
        // member's own cut, with its own swing relief off the pilot. Drawn TRUE, not
        // exaggerated — the animation is the proof played back, not an illustration.
        ev.phi = 0;
        if (ev.closing && ev.rec.group) {
          const g = CUT_GROUPS.groups[ev.rec.group];
          const sEff = Math.max(0.2, JOINT.closingEndsMm - g.swingReliefMm);
          ev.phi = Math.acos(clamp(1 - 2 * sEff / g.cutMm, -1, 1));
        }
        if (ev.rider) {
          const [rnid] = ev.rider.inst[0];
          ev.riderNode = animNodes.get(rnid);
          ev.riderSeated = ev.riderNode ? ev.riderNode.inst.xf.slice(0, 16) : null;
          if (ev.riderSeated) {
            const rs = [ev.riderSeated[12], ev.riderSeated[13], ev.riderSeated[14]];
            ev.riderPile = pileAt(i, 11);
            ev.riderStage = add(rs, scale(ev.approach, ev.reach));
            ev.riderWay = wayFor(ev.riderPile, ev.riderStage);
            ev.riderTumbleAxis = norm([h(i, 15) - 0.5, h(i, 16) - 0.5, h(i, 17) - 0.5]);
            ev.riderTumbleAng = (0.5 + 1.5 * h(i, 18)) * Math.PI;
          }
        }
        const pa = partByKey.get(ev.rec.keys[0]), pb = partByKey.get(ev.rec.keys[1]);
        const g = ev.rec.group ? CUT_GROUPS.groups[ev.rec.group] : null;
        ev.cap1 = `${ev.rec.kind} pipe`
          + (g ? ` · cut ${g.cutMm.toFixed(2)} mm (${ev.rec.group})` : '');
        ev.cap2 = (pa && pb ? `joins ${fileOf(pa)} ↔ ${fileOf(pb)}` : '')
          + (ev.rider ? ` · carries ${fileOf(ev.rider)} in with it` : '')
          + (ev.closing && ev.phi
              ? ` · swings in at ${(ev.phi * 180 / Math.PI).toFixed(1)}°`
              : ' · slides on axially');
        ev.cap = `${ev.cap1} · ${ev.cap2}`;
      }
    });
    const aa3 = (ax, ang, out) => {                  // 3x3 axis-angle, column-major
      const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
      const [x, y, z] = ax;
      out[0] = t * x * x + c;     out[1] = t * x * y + s * z; out[2] = t * x * z - s * y;
      out[3] = t * x * y - s * z; out[4] = t * y * y + c;     out[5] = t * y * z + s * x;
      out[6] = t * x * z + s * y; out[7] = t * y * z - s * x; out[8] = t * z * z + c;
    };
    const mul3 = (a, b, out) => {
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
        out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
      }
    };
    const R1 = new Float64Array(9), R2 = new Float64Array(9), Rt = new Float64Array(9);
    const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const bez = (A, W, B, p) => {
      const q = 1 - p, a = q * q, b = 2 * q * p, c = p * p;
      return [a * A[0] + b * W[0] + c * B[0],
              a * A[1] + b * W[1] + c * B[1],
              a * A[2] + b * W[2] + c * B[2]];
    };
    // ---- collision geometry, for the sweep and the planner ----
    const segDist = (P1, Q1, P2, Q2) => {
      // Closest distance between two segments — the standard clamped closed form.
      const d1 = sub(Q1, P1), d2 = sub(Q2, P2), r = sub(P1, P2);
      const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
      let s, t;
      if (a <= 1e-12 && e <= 1e-12) return Math.hypot(...r);
      if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
      else {
        const c = dot(d1, r);
        if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
        else {
          const b = dot(d1, d2), den = a * e - b * b;
          s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
          t = (b * s + f) / e;
          if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
          else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
        }
      }
      const c1 = add(P1, scale(d1, s)), c2 = add(P2, scale(d2, t));
      return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
    };
    const ptSegDist = (P, A, B) => segDist(P, P, A, B);
    // The joint's collision body: a sphere around the blended central mass — core, collar
    // reach and a little blend. Tree stubs stick past it and are accepted: a fast flight
    // crossing a bare 4 mm spigot does not read as a violation, a pipe through the body
    // does. Derived from the manifest's own parameters, not typed.
    const R_JOINT = (JOINT.coreRMm + JOINT.lipMm + 2.0) / 1000;
    const writePose = (seated, node, idx, Rm, pos) => {
      // Rotate the seated matrix's three columns — per-instance stretch rides in their
      // norms and must survive, or a pipe changes length mid-flight — then replace the
      // translation with the animated one.
      const xf = node.inst.xf, off = idx * 16;
      for (let c = 0; c < 3; c++) {
        const x = seated[c * 4], y = seated[c * 4 + 1], z = seated[c * 4 + 2];
        xf[off + c * 4] = Rm[0] * x + Rm[3] * y + Rm[6] * z;
        xf[off + c * 4 + 1] = Rm[1] * x + Rm[4] * y + Rm[7] * z;
        xf[off + c * 4 + 2] = Rm[2] * x + Rm[5] * y + Rm[8] * z;
        xf[off + c * 4 + 3] = seated[c * 4 + 3];
      }
      xf[off + 12] = pos[0]; xf[off + 13] = pos[1]; xf[off + 14] = pos[2];
      xf[off + 15] = seated[15];
    };
    const rotFor = (axis1, ang1, axis2, ang2) => {
      if (ang1 > 1e-6 && ang2 > 1e-6) {
        aa3(axis1, ang1, R1); aa3(axis2, ang2, R2); mul3(R1, R2, Rt); return Rt;
      }
      if (ang1 > 1e-6) { aa3(axis1, ang1, R1); return R1; }
      if (ang2 > 1e-6) { aa3(axis2, ang2, R2); return R2; }
      return I3;
    };
    // Per-member capsule: half-length column (stretch included) and radius, off the group.
    for (const ev of evs) {
      if (ev.kind === 'member' && ev.seated && ev.rec.group) {
        const g = CUT_GROUPS.groups[ev.rec.group];
        const hl = g.cutMm / 2000;
        ev.c0h = [ev.seated[0] * hl, ev.seated[1] * hl, ev.seated[2] * hl];
        ev.rPipe = g.odMm / 2000;
      }
    }
    /* ---- THE POSES, one authority. The animation draws exactly these and the sweep
     * below tests exactly these, so "the sweep passed" is a statement about the motion
     * on screen, not about a lookalike. ---- */
    // The window splits 75/25: the long flight brings the part to the work, then the
    // short true motion fits it — a swing rotating in place about the member's middle
    // (P8's identity, at its computed entry angle) or a slide over one real engagement.
    const FLY_END = 0.75;
    const memberPose = (ev, a) => {
      const seatPos = [ev.seated[12], ev.seated[13], ev.seated[14]];
      let pos, tumble = 0, q = 0;
      let tilt = ev.closing ? ev.phi : 0;
      if (a < FLY_END) {
        const p = easeInOut(a / FLY_END);
        pos = bez(ev.pile, ev.way, ev.stage, p);
        tumble = ev.tumbleAng * (1 - p);
      } else {
        q = easeInOut((a - FLY_END) / (1 - FLY_END));
        pos = lerp3(ev.stage, seatPos, q);
        tilt *= (1 - q);
      }
      return { pos, Rm: rotFor(ev.tumbleAxis, tumble, ev.tiltAxis, tilt), q };
    };
    const riderPose = (ev, a, q) => {
      const rSeat = [ev.riderSeated[12], ev.riderSeated[13], ev.riderSeated[14]];
      if (a < FLY_END) {
        const p = easeInOut(a / FLY_END);
        return { pos: bez(ev.riderPile, ev.riderWay, ev.riderStage, p),
                 Rm: rotFor(ev.riderTumbleAxis, ev.riderTumbleAng * (1 - p), null, 0) };
      }
      return { pos: lerp3(ev.riderStage, rSeat, q), Rm: I3 };
    };
    const jointPose = (ev, a) => {
      const seatPos = [ev.seated[12], ev.seated[13], ev.seated[14]];
      const p = easeInOut(a);
      return { pos: bez(ev.pile, ev.way, seatPos, p),
               Rm: rotFor(ev.tumbleAxis, ev.tumbleAng * (1 - p), null, 0) };
    };
    // The moving part is LIT and everything else steps back: flying parts full and warm,
    // seated parts quiet, still-piled parts quieter — written straight into the instance
    // tints (RGB, never alpha — the shader discards vTint.a). The group reading owns the
    // tints when the article is whole; stepAssemble re-applies it on arrival.
    const setTint = (node, idx, r, g2, b) => {
      const tn = node.inst.tint, o = idx * 4;
      tn[o] = r; tn[o + 1] = g2; tn[o + 2] = b;
    };
    const tintFor = (ev, a, on) => {
      if (a >= 1) { setTint(ev.node, ev.idx, 0.6, 0.6, 0.6); }
      else if (a <= 0) { setTint(ev.node, ev.idx, 0.35, 0.35, 0.35); }
      else { setTint(ev.node, ev.idx, 1.0, on ? 0.75 : 1.0, on ? 0.9 : 1.0); }
      if (ev.riderNode) {
        const o2 = a >= 1 ? 0.6 : a <= 0 ? 0.35 : 1.0;
        if (a > 0 && a < 1) setTint(ev.riderNode, 0, 1.0, on ? 0.75 : 1.0, on ? 0.9 : 1.0);
        else setTint(ev.riderNode, 0, o2, o2, o2);
      }
    };
    function apply(t, guide) {
      // Plan on first real use, not at page load: ~a quarter second of sweeping and
      // replanning, memoised, spent the first time anything actually animates.
      if (!planStats && (t < 1 || guide)) plan();
      const touched = new Set();
      const done = !guide && t >= 1;
      evs.forEach((ev, i) => {
        if (!ev.node || !ev.seated) return;
        // GUIDE MODE: one part at a time — everything before it seated, everything after
        // it still in the pile, the part itself at exactly the scrubbed instant. This is
        // also the sweep's own model (a strict prefix seated, one body moving), so guide
        // mode is the most literally proven view the page has.
        const a = guide
          ? (i < guide.idx ? 1 : i > guide.idx ? 0 : clamp(guide.alpha, 0, 1))
          : clamp((t - ev.t0) / (ev.t1 - ev.t0), 0, 1);
        if (a >= 1) {                                // seated EXACTLY: byte-copied back
          ev.node.inst.xf.set(ev.seated, ev.idx * 16);
          touched.add(ev.node);
          if (ev.riderNode && ev.riderSeated) {
            ev.riderNode.inst.xf.set(ev.riderSeated, 0);
            touched.add(ev.riderNode);
          }
          if (!done) tintFor(ev, 1, false);
          return;
        }
        if (!done) tintFor(ev, a, true);
        if (ev.kind === 'joint') {
          const jp = jointPose(ev, a);
          writePose(ev.seated, ev.node, ev.idx, jp.Rm, jp.pos);
          touched.add(ev.node);
          return;
        }
        const mp = memberPose(ev, a);
        writePose(ev.seated, ev.node, ev.idx, mp.Rm, mp.pos);
        touched.add(ev.node);
        // The rider joint moves with its member — the pair arrive as one part, A4's own
        // proven motion.
        if (ev.riderNode && ev.riderSeated) {
          const rp = riderPose(ev, a, mp.q);
          writePose(ev.riderSeated, ev.riderNode, 0, rp.Rm, rp.pos);
          touched.add(ev.riderNode);
        }
      });
      for (const n of touched) n.inst.dirty = true;
    }
    /* ---- THE SWEEP AND THE PLANNER. The designer's charge was fair: the first cut threw
     * parts at their seats and hoped. Now every event's whole trajectory — fly arc and
     * settle line, pipe capsule and joint sphere, rider included — is swept against every
     * part already seated at that moment of the timeline, and any event whose arc fouls
     * is REPLANNED from a candidate set (wider arcs, higher arcs, swung arcs) until its
     * flight sweeps clean; if nothing in the set clears, the least-fouling arc is taken
     * and the residue is REPORTED, never hidden. Co-flying neighbours are not checked
     * against each other — they are loose formation in fast transit — and the settle
     * lines are not replanned, because they are the prover's own: what the sweep finds
     * there is published as settleWorstMm and gated. Deterministic throughout, so the
     * gate reproduces every frame of it. ---- */
    const applyR3 = (Rm, v) => [Rm[0] * v[0] + Rm[3] * v[1] + Rm[6] * v[2],
                                Rm[1] * v[0] + Rm[4] * v[1] + Rm[7] * v[2],
                                Rm[2] * v[0] + Rm[5] * v[1] + Rm[8] * v[2]];
    const seatedBodies = (ev) => {
      const out = [];
      if (!ev.seated) return out;
      const p = [ev.seated[12], ev.seated[13], ev.seated[14]];
      if (ev.kind === 'joint') out.push({ sph: p, r: R_JOINT });
      else if (ev.c0h) {
        out.push({ A: sub(p, ev.c0h), B: add(p, ev.c0h), r: ev.rPipe });
        if (ev.riderSeated) {
          out.push({ sph: [ev.riderSeated[12], ev.riderSeated[13], ev.riderSeated[14]],
                     r: R_JOINT });
        }
      }
      return out;
    };
    const movingPen = (ev, a, bodies) => {
      let worst = 0;
      const test = (mv) => {
        for (const b of bodies) {
          let d;
          if (mv.sph && b.sph) d = Math.hypot(...sub(mv.sph, b.sph));
          else if (mv.sph) d = ptSegDist(mv.sph, b.A, b.B);
          else if (b.sph) d = ptSegDist(b.sph, mv.A, mv.B);
          else d = segDist(mv.A, mv.B, b.A, b.B);
          const pen = (mv.r + b.r) - d;
          if (pen > worst) worst = pen;
        }
      };
      if (ev.kind === 'joint') {
        test({ sph: jointPose(ev, a).pos, r: R_JOINT });
      } else {
        const mp = memberPose(ev, a);
        if (ev.c0h) {
          const c = applyR3(mp.Rm, ev.c0h);
          test({ A: sub(mp.pos, c), B: add(mp.pos, c), r: ev.rPipe });
        }
        if (ev.riderNode && ev.riderSeated) {
          test({ sph: riderPose(ev, a, mp.q).pos, r: R_JOINT });
        }
      }
      return worst;
    };
    const FLY_AS = [];
    for (let s2 = 1; s2 <= 14; s2++) FLY_AS.push(FLY_END * s2 / 14.5);
    const SETTLE_AS = [];
    for (let s2 = 1; s2 <= 10; s2++) SETTLE_AS.push(FLY_END + (1 - FLY_END) * s2 / 10.5);
    const sweepEvent = (ev, bodies) => {
      let fly = 0, settle = 0;
      for (const a of FLY_AS) fly = Math.max(fly, movingPen(ev, a, bodies));
      if (ev.kind === 'member') {
        for (const a of SETTLE_AS) settle = Math.max(settle, movingPen(ev, a, bodies));
      }
      return { fly, settle };
    };
    const rotAbout = (axis, v, ang) => { aa3(axis, ang, R1); return applyR3(R1, v); };
    let planStats = null;
    function plan() {
      if (planStats) return planStats;
      const TOL = 0.0005;                            // half a millimetre reads as touching
      let replanned = 0, flyViol = 0, flyWorst = 0, settleWorst = 0;
      const bodies = [];
      let nextSeated = 0;
      for (const ev of evs) {
        while (nextSeated < evs.length && evs[nextSeated].t1 <= ev.t0 + 1e-9) {
          for (const b of seatedBodies(evs[nextSeated])) bodies.push(b);
          nextSeated++;
        }
        if (!ev.node || !ev.seated) continue;
        const way0 = ev.way, rway0 = ev.riderWay;
        const cands = [0, 1.25, 1.5, 0.45, -0.45, 0.9, -0.9, 1.85];
        let best = null, bestPen = Infinity;
        for (const c of cands) {
          if (c === 0) { ev.way = way0; if (rway0) ev.riderWay = rway0; }
          else if (c > 1) {                          // wider and higher
            ev.way = scale(way0, c);
            if (rway0) ev.riderWay = scale(rway0, c);
          } else {                                   // swung about the pile's own vertical
            ev.way = rotAbout(dn, scale(way0, 1.3), c * 2);
            if (rway0) ev.riderWay = rotAbout(dn, scale(rway0, 1.3), c * 2);
          }
          const r = sweepEvent(ev, bodies);
          if (r.fly < bestPen) { bestPen = r.fly; best = { way: ev.way, rway: ev.riderWay, r }; }
          if (r.fly <= TOL) break;
        }
        ev.way = best.way;
        if (rway0) ev.riderWay = best.rway;
        if (bestPen > TOL) flyViol++;
        if (best.way !== way0) replanned++;
        flyWorst = Math.max(flyWorst, bestPen);
        settleWorst = Math.max(settleWorst, best.r.settle);
      }
      planStats = {
        events: evs.length, replanned, flyViolations: flyViol,
        flyWorstMm: Math.round(flyWorst * 1e4) / 10,
        settleWorstMm: Math.round(settleWorst * 1e4) / 10,
      };
      return planStats;
    }
    const riders = evs.filter((e) => e.riderNode && e.riderSeated).length;
    return {
      apply, plan,
      windows: evs.map((ev) => ({ t0: ev.t0, t1: ev.t1, cap: ev.cap || '',
                                  cap1: ev.cap1 || '', cap2: ev.cap2 || '' })),
      counts: {
        joints: evs.filter((e) => e.kind === 'joint').length + riders,
        members: evs.filter((e) => e.kind === 'member').length,
        riders,
        provenApproaches: evs.filter((e) => e.kind === 'member'
          && (e.escape || e.rider)).length,
      },
      /** For the gate: how far the animated state sits from the seated one, measured off
       * the live instance buffers against the byte-cached seated matrices. */
      probe() {
        let displaced = 0, maxD = 0;
        const meas = (node, idx, seated) => {
          const xf = node.inst.xf, off = idx * 16;
          const d = Math.hypot(xf[off + 12] - seated[12],
                               xf[off + 13] - seated[13],
                               xf[off + 14] - seated[14]);
          if (d > 1e-9) displaced++;
          if (d > maxD) maxD = d;
        };
        for (const ev of evs) {
          if (!ev.node || !ev.seated) continue;
          meas(ev.node, ev.idx, ev.seated);
          if (ev.riderNode && ev.riderSeated) meas(ev.riderNode, 0, ev.riderSeated);
        }
        return { displaced, maxDispM: maxD };
      },
    };
  })();

  return {
    root,
    parts, members: memberRecs, faces: faceRecs, cgM, cellGroup: cg, assembly,
    // What a single joint occupies, measured on the meshes actually drawn: the farthest
    // vertex any joint carries (a tree stub's tip, ~39 mm out), so the connector tour
    // frames the whole part — arms and all — rather than the old cone-length guess.
    partRadius: Math.max(...NODEMESHES.nodes.map((m2) => m2.reachMm)) / 1000,
    // What ONE MEMBER occupies, and what ONE FACE does: the tube level frames a 251 mm cut
    // whole, the skin level frames a hexagon across its corners (its circumradius is the
    // edge, which is the same 251 mm — the one coincidence this cell is built on).
    memberRadius: L * 0.62,
    faceRadius: span / (2 * Math.SQRT2) * 1.18,
    span,
    labels: [
      // Anchored off the upper-left shoulder, not the apex: the apex projects to
      // top-centre of the viewport, which the assemble control owns now — the label
      // keep-out clears the article's silhouette, and knows nothing about DOM.
      { p: [-span * 0.30, -span * 0.30, span * 0.52], t: `${(span * 1000).toFixed(0)} mm — ${ctx.demo.enclosedL.toFixed(0)} L of nothing`, s: `dark: every member is purchased carbon, ${ctx.stock.pipeCount} cuts of one SKU — light: the ${ctx.demo.printedNodes} printed joints, and nothing else` },
      { p: [span * 0.42, 0, -span * 0.30], t: 'every face braced in its own plane', s: 'the designer caught both: 48 vertex ties bind the once-islanded rim into the lattice, and every hexagon centre carries a printed node on a 3-tie tripod — halving the skin span; every boundary joint sinks beneath its faces and pins the skin at a flat-topped land post' },
      { p: [-span * 0.45, -span * 0.28, span * 0.12], t: 'evacuate, then SEAL', s: 'no valve, no pump aboard — permanence is the design' },
      { p: [span * 0.30, span * 0.40, span * 0.34], t: 'the bench article', s: 'sealed under vacuum in the chamber, then carried out into one atmosphere — nothing is pumped down afterwards, because there is no valve' },
    ],
  };
}

/* L4 — THE COMPARTMENTS: the ship's own void, divided. The last warp on the
 * ladder is gone — this level zooms INTO ship 0 (same generators, whole ship
 * faint) and shows the breach doctrine the cascade ruled: membranes at
 * super-panel pitch across the void, so a holed wall costs a compartment and
 * not the ship. Policy — pitch, valves, cascade rules — is SHIP-5's and the
 * panel says so; the membranes here are the doctrine drawn, not a sizing.
 * Click a compartment to flood it; the neighbours' membranes catch the
 * differential exactly the way the interior films of the cell era did. */
const COMPARTMENTS = 6;                      // drawn doctrine — SHIP-5 owns the number

function buildArray(ctx) {
  const root = node({ id: 'L_array', category: 'vacuum', selectable: false });
  const D = shipDims();
  const bones = shipSkeletonSegs(D);
  // The whole ship, faint — the level is a zoom, never a warp.
  lineNode(root, 'CompGhostFrame',
    segLines([...bones.hoops.filter((_, i) => i % 6 === 0),
              ...bones.longs.filter((_, i) => i % 2 === 0)]), XM.latticeFaint);
  const prof = [];
  for (let i = 0; i <= 40; i++) {
    const st = shipStation(D, D.total * i / 40);
    prof.push([st.x, Math.max(0.01, st.r)]);
  }
  solidNode(root, 'CompHull', latheWithScale(prof, 40, () => 1),
    { kind: 'glass', color: '#7d8698', opacity: 0.05 });

  // The compartment slabs — pickable, one per bay group. Instanced cylinders of
  // glass; flooding one tints it warm and its two bounding membranes carry the
  // differential (drawn brighter), the doctrine in one click.
  const xs = [];
  for (let i = 0; i <= COMPARTMENTS; i++) {
    xs.push(-SHIP.lenM / 2 + SHIP.lenM * i / COMPARTMENTS);
  }
  const slabXf = new Float32Array(COMPARTMENTS * 16);
  const tint = new Float32Array(COMPARTMENTS * 4);
  const ids = [];
  const slabCentres = [];
  for (let i = 0; i < COMPARTMENTS; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    slabCentres.push([cx, 0, 0]);
    const m = new Float32Array(16);
    m4compose([cx, 0, 0], [0, 0, 0], 1, m);
    slabXf.set(m, i * 16);
    tint.set([1, 1, 1, 1], i * 4);
    ids.push(`Cell_${i}`);
  }
  const cells = inst(root, { id: 'KelvinCells' }, slabXf, COMPARTMENTS, { tint, ids });
  // Each slab: a squat glass cylinder inside the void radius, gap between them.
  const slabLen = SHIP.lenM / COMPARTMENTS - 1.2;
  const rIn = D.R - GRID.depthM - 0.6;
  cells.geom = (() => {
    const pos = [], idx = [];
    const SEGC = 36;
    for (const xoff of [-slabLen / 2, slabLen / 2]) {
      const base = pos.length / 3;
      for (let j = 0; j < SEGC; j++) {
        const th = 2 * Math.PI * j / SEGC;
        pos.push(xoff, -rIn * Math.cos(th) * 0.72, rIn * Math.sin(th) * 0.72);
      }
      void base;
    }
    for (let j = 0; j < SEGC; j++) {
      const a = j, b = (j + 1) % SEGC, c = SEGC + j, d = SEGC + (j + 1) % SEGC;
      idx.push(a, c, d, a, d, b);
    }
    return G.solid(new Float32Array(pos), new Uint32Array(idx));
  })();
  cells.xmat = { kind: 'glass', color: '#8fb6dc', opacity: 0.10 };
  cells.selectable = true;

  // The membranes: one disc at every boundary station, glass, drawn as film —
  // pink is the code for LOADED film, and a membrane only loads when its
  // neighbour floods, so they rest cool and blush on breach (applyBreach).
  const memSegs = [];
  const discs = [];
  for (let i = 0; i <= COMPARTMENTS; i++) {
    const x = xs[i];
    // radius at this station, one depth in
    let r = 0.01;
    {
      // invert x -> station radius by sampling the meridian
      let best = 1e9;
      for (let k = 0; k <= 200; k++) {
        const st = shipStation(D, D.total * k / 200);
        if (Math.abs(st.x - x) < best) { best = Math.abs(st.x - x); r = Math.max(0.01, st.r - GRID.depthM); }
      }
    }
    if (r < 3) continue;
    discs.push([x, r]);
    const SEGC = 48;
    for (let j = 0; j < SEGC; j++) {
      const t0 = 2 * Math.PI * j / SEGC, t1 = 2 * Math.PI * (j + 1) / SEGC;
      memSegs.push([[x, -r * Math.cos(t0), r * Math.sin(t0)],
                    [x, -r * Math.cos(t1), r * Math.sin(t1)]]);
      // a light radial web of cords — a membrane, not a wall
      if (j % 6 === 0) memSegs.push([[x, 0, 0], [x, -r * Math.cos(t0), r * Math.sin(t0)]]);
    }
  }
  lineNode(root, 'CompMembranes', memSegs,
    { kind: 'line', color: TOKENS.cool, weight: 1.1, opacity: 0.55 });

  return {
    root,
    centres: slabCentres.map((p2) => ({ p: p2 })), cellsNode: cells,
    span: SHIP.lenM / COMPARTMENTS, openIdx: 1, farIdx: COMPARTMENTS - 2,
    labels: [
      { p: [0, 0, D.R * 1.25], t: 'the void, divided', s: 'membranes at compartment pitch — a holed wall costs one compartment of vacuum, never the ship. SHIP-5 owns the pitch and the valve doctrine; this is the doctrine drawn' },
      { p: [-SHIP.lenM * 0.28, 0, -D.R * 1.1], t: 'click a compartment to flood it', s: 'its membranes catch one atmosphere of differential and hand the load to the rings they terminate on — the same trick the cell era played, one scale up' },
      { p: [SHIP.lenM * 0.3, 0, D.R * 0.9], t: 'membranes, not trusses', s: 'nothing structural crosses the void — the ruled exceptions are tension only: these films, and the spokes' },
    ],
  };
}

/* ---------- ship 0's surface — ONE generator, shared by every level that shows it -----------------

   The operator's rule for the ladder: each level ZOOMS INTO a component of the one
   airship; it never warps to a new scene. So the grid level superimposes a lit patch of
   the SAME surface on the whole ship drawn faint, and everything either level draws is
   computed here exactly once — the patch and the whole cannot drift apart. */

function shipDims() {
  // EVERY DIMENSION FROM THE GATED MODEL now (the ship.js port, 2026-08-13):
  // WALL carries the ruled 0.5 m pitches and the computed populations, GRID the
  // skeleton's — so the drawn geometry and the parity-held record are one thing.
  // The old derivation from BAND.cells died with the tiles: the 20,000-cell
  // census was the hex-tile fossil, and the wall is rings + bars + one film.
  const R = SHIP.diaM / 2;
  const cylL = SHIP.lenM - SHIP.diaM;
  const area = 2 * Math.PI * R * cylL + 4 * Math.PI * R * R;
  const sCap = Math.PI * R / 2;
  const total = 2 * sCap + cylL;
  const nBays = Math.max(2, Math.round(total / GRID.bayM));
  const rowY = WALL.ringPitchM;              // ring pitch — ruled, sweep-confirmed
  const crossM = WALL.barPitchM;             // square panels — ruled
  const pitch = crossM;                      // panel pitch around the girth
  const panels = WALL.panels;                // quoted population = model population
  return { R, cylL, pitch, sCap, total, nBays, rowY, crossM, panels, area };
}

/* Meridian station at arc length s from the nose pole: axial x, ring radius r, outward
 * normal and tailward tangent in the (x, radial) plane. */
function shipStation(D, s) {
  if (s <= D.sCap) {
    const a = s / D.R;
    return { x: -D.cylL / 2 - D.R * Math.cos(a), r: D.R * Math.sin(a),
             nx: -Math.cos(a), nr: Math.sin(a), tx: Math.sin(a), tr: Math.cos(a) };
  }
  if (s <= D.sCap + D.cylL) {
    return { x: -D.cylL / 2 + (s - D.sCap), r: D.R, nx: 0, nr: 1, tx: 1, tr: 0 };
  }
  const b = (s - D.sCap - D.cylL) / D.R;
  return { x: D.cylL / 2 + D.R * Math.sin(b), r: D.R * Math.cos(b),
           nx: Math.sin(b), nr: Math.cos(b), tx: Math.cos(b), tr: -Math.sin(b) };
}

/* Every TILE on the wall: centre, right-handed basis (Z outward), and its (s, th)
 * surface coordinates, so a level can light a patch of them.
 *
 * A tile is the operator's wall unit (08-12 cascade): a rim frame holding one panel of
 * loaded film, short legs, and ONE saddle bracket clamped to the hoop chord beneath it.
 * Not a cell — nothing behind the outer barrier is sealed, so there is no vessel here,
 * no interior film and no per-tile pump-down. Placement is unchanged: the tile grid IS
 * the old cell grid, because the pitch is what breaks the film into panels. */
function shipCellPlacements(D) {
  const out = [];
  const inset = 0;                           // the film sits ON the rings now
  const nRings = Math.round(D.total / D.rowY);
  for (let i = 0; i <= nRings; i++) {
    const s = D.total * i / nRings;
    const st = shipStation(D, s);
    const m = Math.round(2 * Math.PI * st.r / D.pitch);
    if (m < 3) continue;                        // the poles get single cells below
    for (let j = 0; j < m; j++) {
      const th = 2 * Math.PI * j / m;
      const u = [0, -Math.cos(th), Math.sin(th)];
      const n = [st.nx, st.nr * u[1], st.nr * u[2]];
      const tm = [st.tx, st.tr * u[1], st.tr * u[2]];
      const thop = [0, -Math.sin(th), -Math.cos(th)];   // negated: keeps (X, Y, Z) right-handed
      out.push({ p: [st.x - n[0] * inset, st.r * u[1] - n[1] * inset, st.r * u[2] - n[2] * inset],
                 X: thop, Y: tm, Z: n, s, th });
    }
  }
  out.push({ p: [-(SHIP.lenM / 2 - inset), 0, 0], X: [0, 0, 1], Y: [0, 1, 0], Z: [-1, 0, 0], s: 0, th: 0 });
  out.push({ p: [SHIP.lenM / 2 - inset, 0, 0], X: [0, 0, -1], Y: [0, 1, 0], Z: [1, 0, 0], s: D.total, th: 0 });
  return out;
}

const cellsToXf = (cells) => {
  const xf = new Float32Array(cells.length * 16);
  cells.forEach((c, i) => {
    xf.set([c.X[0], c.X[1], c.X[2], 0, c.Y[0], c.Y[1], c.Y[2], 0,
            c.Z[0], c.Z[1], c.Z[2], 0, c.p[0], c.p[1], c.p[2], 1], i * 16);
  });
  return xf;
};

/* The endoskeleton at its recorded pitches: hoop rings every bay on BOTH walls, longerons
 * along the meridians, one Warren diagonal per bay per column. Offsets follow the rulings:
 * the outer chord wall one cell under the surface (cells sit face-down on it), the inner
 * wall GRID.depthM further in. Segments carry (s, th) for the same reason the cells do. */
function shipSkeletonSegs(D) {
  // THE COMPLETE SKELETON, post-correction (08-13): every member class the gated
  // model prices is drawn, and only those. Outer rings at panel pitch; inner
  // rings at bay pitch; longerons on the inner wall over the BARREL plus the
  // junction overlap only (under the caps the meridional load is the cap grid's
  // own — pricing both was the 23-tonne error the scoping tool caught); the
  // meridional fan per column per bay; the RING-PLANE X-webs (the member class
  // the checks found missing — without them the two walls cannot act as one
  // deep ring); the junction shear diagonals at both dome edges; and the
  // LICENSED SPOKES — diametral tension cords at every bay plane, the Winkler
  // foundation that fights the low-n ovalization modes at fibre weight.
  const wallOff = 0, innerOff = GRID.depthM;
  const outerRings = [];
  {
    const nRings = Math.round(D.total / D.rowY);
    for (let i = 0; i <= nRings; i++) outerRings.push(D.total * i / nRings);
  }
  // EVERY OUTER ATTACHMENT LANDS ON A RING (operator catch, 08-13 morning: "the
  // webs don't line up to the top hoops"). Bay midpoints and junction stations
  // are not multiples of the drawn ring pitch, so an unsnapped web ended in the
  // film between hoops — a joint the real wall does not have. The grid level
  // always drew this correctly; now the whole-ship skeleton does too.
  const outerStep = D.total / Math.round(D.total / D.rowY);
  const snapOuter = (s) =>
    Math.max(0, Math.min(D.total, Math.round(s / outerStep) * outerStep));
  const innerRings = [];
  for (let i = 0; i <= D.nBays; i++) innerRings.push(D.total * i / D.nBays);
  const point = (s, off, th) => {
    const st = shipStation(D, s);
    const r = st.r - st.nr * off;
    return [st.x - st.nx * off, -r * Math.cos(th), r * Math.sin(th), r];
  };
  const hoops = [], hoopsInner = [], longs = [], webs = [], thetas = [],
    junctions = [], spokes = [];
  const SEG = 64, NLONG = GRID.nLong, RMIN = 2;
  const ringPass = (rings, off, out) => {
    for (const s of rings) {
      if (point(s, off, 0)[3] < RMIN) continue;
      let prev = null;
      for (let j = 0; j <= SEG; j++) {
        const th = 2 * Math.PI * j / SEG;
        const q = point(s, off, th);
        if (prev) out.push({ a: [prev[0], prev[1], prev[2]], b: [q[0], q[1], q[2]], off, s, th });
        prev = q;
      }
    }
  };
  ringPass(outerRings, wallOff, hoops);
  ringPass(innerRings, innerOff, hoopsInner);
  // Longerons: BARREL + sqrt(R*T) overlap, inner wall, one per column.
  const over = Math.sqrt(D.R * GRID.depthM);
  const s0 = Math.max(0.5, D.sCap - over), s1 = Math.min(D.total - 0.5, D.sCap + D.cylL + over);
  for (let k = 0; k < NLONG; k++) {
    const th = 2 * Math.PI * k / NLONG;
    let prev = null;
    const NSEG = 40;
    for (let i = 0; i <= NSEG; i++) {
      const sm = s0 + (s1 - s0) * i / NSEG;
      const q = point(sm, innerOff, th);
      if (q[3] < RMIN) { prev = null; continue; }
      if (prev) longs.push({ a: [prev[0], prev[1], prev[2]], b: [q[0], q[1], q[2]], off: innerOff, s: sm, th });
      prev = q;
    }
  }
  // The meridional fan: per column, per bay, TWO diagonals — outer wall at the
  // bay's midpoint down to the two inner rings that bound it. The drawing IS
  // the drawn population the webs line bills.
  for (let bIdx = 0; bIdx < innerRings.length - 1; bIdx++) {
    const mid = snapOuter((innerRings[bIdx] + innerRings[bIdx + 1]) / 2);
    for (let k = 0; k < NLONG; k++) {
      const th = 2 * Math.PI * k / NLONG;
      const a = point(mid, wallOff, th);
      if (a[3] < RMIN) continue;
      for (const si of [innerRings[bIdx], innerRings[bIdx + 1]]) {
        const b = point(si, innerOff, th);
        if (b[3] >= RMIN)
          webs.push({ a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], off: wallOff, s: mid, th });
      }
    }
  }
  // The RING-PLANE X-webs: at every bay plane, per column, the crossed pair —
  // outer at column k to inner at k+1 and outer at k+1 to inner at k. These are
  // what let the two walls bend as ONE deep ring; the fan cannot do it.
  for (const sb of innerRings) {
    if (point(sb, wallOff, 0)[3] < RMIN) continue;
    const sbo = snapOuter(sb);
    for (let k = 0; k < NLONG; k++) {
      const th0 = 2 * Math.PI * k / NLONG;
      const th1 = 2 * Math.PI * (k + 1) / NLONG;
      const oa = point(sbo, wallOff, th0), ob = point(sbo, wallOff, th1);
      const ia = point(sb, innerOff, th0), ib = point(sb, innerOff, th1);
      if (Math.min(oa[3], ob[3], ia[3], ib[3]) < RMIN) continue;
      thetas.push({ a: [oa[0], oa[1], oa[2]], b: [ib[0], ib[1], ib[2]], off: wallOff, s: sb, th: th0 });
      thetas.push({ a: [ob[0], ob[1], ob[2]], b: [ia[0], ia[1], ia[2]], off: wallOff, s: sb, th: th1 });
    }
  }
  // Junction shear diagonals: both dome edges, 45-deg outer->inner across the
  // transition zone — the caps' 215 MN of thrust migrating to the longerons.
  for (const sj of [D.sCap, D.sCap + D.cylL]) {
    for (let k = 0; k < NLONG; k++) {
      const th = 2 * Math.PI * k / NLONG;
      const dir = sj < D.total / 2 ? 1 : -1;
      const a = point(snapOuter(sj - dir * over * 0.5), wallOff, th);
      const b = point(sj + dir * over * 0.5, innerOff, th);
      if (a[3] >= RMIN && b[3] >= RMIN)
        junctions.push({ a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], off: wallOff, s: sj, th });
    }
  }
  // The spokes: diametral cords at every bay plane, half the columns (each cord
  // serves both ends). Drawn as the layout concept; the model bills the smeared
  // area. Pretensioned, so both signs of the ovalization mode load them.
  for (const sb of innerRings) {
    const p0 = point(sb, innerOff, 0);
    if (p0[3] < RMIN + 4) continue;
    for (let k = 0; k < NLONG / 2; k++) {
      const th = 2 * Math.PI * k / NLONG;
      const a = point(sb, innerOff, th);
      const b = point(sb, innerOff, th + Math.PI);
      spokes.push({ a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], off: innerOff, s: sb, th });
    }
  }
  return { hoops, hoopsInner, longs, webs, thetas, junctions, spokes };
}

const segLines = (arr) => arr.map((g) => [g.a, g.b]);

/* L6 — THE GRID, up close: a lit patch of ship 0's own flank on the whole ship drawn
 * faint. One cell in the patch stands open — glass shell, real lattice — tying the top of
 * the ladder to its bottom. The warm ticks are the push path: each cell face-down onto
 * the outer chords, nothing crossing the wall. */
function buildGrid() {
  const root = node({ id: 'L_grid', category: 'vacuum', selectable: false });
  const D = shipDims();
  const bones = shipSkeletonSegs(D);
  const s0 = D.total / 2, TH0 = Math.PI / 2;

  // The whole ship stays present as its faint frame — the ghost DOMES died with
  // the panel pitch (69,000 instances of context is not context).
  lineNode(root, 'GridGhostFrame',
    segLines([...bones.hoops.filter((_, i) => i % 6 === 0),
              ...bones.longs.filter((_, i) => i % 2 === 0)]), XM.latticeFaint);

  /* THE WALL, as ruled: hoop chords at panel pitch with the film laid straight on them,
   * meridional cross-bars holding adjacent rings apart against the film's pull, and
   * nothing else. No posts and no rim grid — a pipe above a pipe was two members doing
   * one job with a spacer between them. */
  const ROW = D.rowY, CROSS = D.crossM;
  const NU = 8, NV = 6;
  const vHalf = NV * CROSS, ARCSEG = 26;
  const at = (u, v, off) => {
    const st = shipStation(D, s0 + u);
    const th = TH0 + v / D.R;
    const r = st.r - st.nr * off;
    return [st.x - st.nx * off, -r * Math.cos(th), r * Math.sin(th)];
  };
  const pipes = (id, segs, rOut, xmat) => {
    if (!segs.length) return;
    const pts = [], pairs = [];
    for (const [p1, p2] of segs) { pts.push(p1, p2); pairs.push([pts.length - 2, pts.length - 1]); }
    const gi = G.strutInstances(pts, pairs, 0, 1.0);
    const n2 = inst(root, { id }, gi.xf, gi.count, {});
    n2.geom = G.tubeArcGeom(rOut, rOut * 0.35, 1.0, 360, 10);
    n2.xmat = xmat;
  };
  const arc = (u, off, half = vHalf) => {
    const out = [];
    let prev = null;
    for (let i = 0; i <= ARCSEG; i++) {
      const q = at(u, -half + 2 * half * i / ARCSEG, off);
      if (prev) out.push([prev, q]);
      prev = q;
    }
    return out;
  };
  const rows = [];
  for (let k = -NU; k <= NU; k++) rows.push(k * ROW);

  // NOTHING IS CUT AND NOTHING IS DRILLED (operator, 08-13). The rings run continuous —
  // a hole in the primary compression member is a stress raiser, severs the wound fibre,
  // and invites local buckling in a 4 mm wall. The cross-bars also run continuous, one
  // diameter OUTBOARD, and a split-Ti clamp holds them where they cross. Not woven: a
  // weave's amplitude is one tube diameter over a half-metre span, an out-of-straightness
  // of ~1/21 against the L/500 a compression member wants, and the eccentricity moment
  // alone (P x 12 mm) exceeds the bar's section. Clamps do the interlock without kinking.
  const RING_R = WALL.ringOdMm / 2000, BAR_R = WALL.barOdMm / 2000;
  const BAR_OFF = -(RING_R + BAR_R);        // negative = outboard of the rings
  pipes('GridHoops', rows.flatMap(u => arc(u, 0)), RING_R, XM.pipeRim);
  // The cross-bars: struts between adjacent rings. The film's meridional pull draws the
  // rings together and these hold them apart — and they tie the rings into ONE flange,
  // so the webs can serve every ring between them instead of leaving most floating.
  const bars = [];
  // INTERIOR columns only (operator, 08-13): a bar on the patch's cut edge hung
  // half off the lit region with its clamps showing in full — an artefact of
  // where the patch ends, not a thing the wall has.
  for (let c = -NV + 1; c <= NV - 1; c++) {
    // Continuous, end to end of the patch — segmented only by the clamps it passes under.
    bars.push([at(-NU * ROW, c * CROSS, BAR_OFF), at(NU * ROW, c * CROSS, BAR_OFF)]);
  }
  pipes('GridCross', bars, BAR_R, XM.pipe);   // ~24 mm: the square halves the pull

  // THE CROSSING CLAMPS — SPARSE and STAGGERED (operator, 08-13): a clamp at every
  // intersection was ~4/m2 and 68,000 fittings on the ship, and the load case never asks
  // for them — inside is vacuum, so the push is always inward and every crossing sits
  // permanently in bearing. What the clamps are really for is the UNPRESSURISED states:
  // the operator's requirement that the wall be buildable and structured before the first
  // pump-down, plus ground handling and maintenance. So: one clamp every fourth bar along
  // every ring (~2 m), phase-shifted ONE bar on each successive ring — a brick pattern,
  // 1 in 4 crossings, ~1/m2, and EVERY bar clamped every fourth ring. The two-bar walk
  // this first drew left every odd bar with no clamp at all (operator catch, 08-13
  // morning) — and the erection-wind check prices each clamp at a barPitch x 4-ring
  // tributary, which only exists if every bar is actually clamped at that spacing. It
  // also leaves the outer wall a coarse shear net rather than none, which the torsion
  // check inherits.
  const CLAMP_EVERY = 4;
  {
    const cl = [];
    for (let k = -NU; k <= NU; k++) {
      for (let c = -NV + 1; c <= NV - 1; c++) {
        if ((((c + k) % CLAMP_EVERY) + CLAMP_EVERY) % CLAMP_EVERY !== 0) continue;
        const u = k * ROW, v = c * CROSS;
        const st = shipStation(D, s0 + u);
        const th = TH0 + v / D.R;
        const uu = [0, -Math.cos(th), Math.sin(th)];
        const n = [st.nx, st.nr * uu[1], st.nr * uu[2]];
        const tm = [st.tx, st.tr * uu[1], st.tr * uu[2]];
        const thop = [0, -Math.sin(th), -Math.cos(th)];
        const q = at(u, v, BAR_OFF / 2);
        cl.push([thop, tm, n, q]);
      }
    }
    const xf = new Float32Array(cl.length * 16);
    cl.forEach(([X, Y, Z, q], i) => xf.set([X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0,
      Z[0], Z[1], Z[2], 0, q[0], q[1], q[2], 1], i * 16));
    const cn = inst(root, { id: 'GridClamps' }, xf, cl.length, {});
    cn.geom = G.beadGeom(0.15, 0.11, 0.13, 10);
    cn.xmat = XM.printed;
  }

  // NO FILM AT THIS LEVEL (operator, 08-13 morning): the per-panel pillows read
  // as the old cells and hid the members. The grid level shows the BARE grid —
  // the film's story lives on the wall level below and the pressure wrap above.

  // The inner wall and the fan that reaches it — every web ends ON a ring.
  const innerRows = rows.filter((_, i) => i % 4 === 0);
  pipes('GridInner', innerRows.flatMap(u => arc(u, GRID.depthM)), 0.055, XM.pipeRim);
  const webs = [];
  for (let n = 0; n < innerRows.length - 1; n++) {
    const u0 = innerRows[n], u1 = innerRows[n + 1], mid = (u0 + u1) / 2;
    for (let c = -3; c <= 3; c++) {
      const v = c * vHalf / 3.5;
      webs.push([at(mid, v, 0), at(u0, v, GRID.depthM)]);
      webs.push([at(mid, v, 0), at(u1, v, GRID.depthM)]);
    }
  }
  pipes('GridWebs', webs, 0.038, XM.pipe);
  // The ring-plane X-webs — the member class the 08-13 checks found missing —
  // drawn at the patch's two bay planes; and two spoke cords crossing the void,
  // the licensed foundation, heading for the far wall.
  {
    // EVERY bay plane carries its X (operator, 08-13: two lit planes read as
    // "some hoops have them, some don't" — the model puts the crossed pair at
    // every inner ring, so the drawing does too), and EVERY landing wears a
    // connector: web ends on their rings, X ends on theirs, and the crossing
    // itself. Joints are PRICED SMEARED (the eta line, 15% of members plus joints),
    // so the beads are instanced truth about where fittings live, not a new
    // mass line — and minimizing that count is named daylight work.
    const tx = [];
    const joints = new Map();
    const joint = (q) => joints.set(
      `${q[0].toFixed(2)},${q[1].toFixed(2)},${q[2].toFixed(2)}`, q);
    // CONNECTORS AS COLLARS (operator round 5): a landing bead is centred ON
    // its pipe's centreline with a radius a little over the pipe's, so it
    // reads as a fitting wrapped around the member — visible on the big outer
    // hoops and the small inner ones alike. Three families, three sizes.
    const INNER_R = 0.055;
    const jOuter = new Map(), jInner = new Map(), jCross = new Map();
    const put = (m, q) => m.set(
      `${q[0].toFixed(2)},${q[1].toFixed(2)},${q[2].toFixed(2)}`, q);
    for (const u of innerRows) {
      for (let c = -3; c < 3; c++) {
        const v0 = c * vHalf / 3.5, v1 = (c + 1) * vHalf / 3.5;
        const A0 = at(u, v0, 0), A1 = at(u, v1, GRID.depthM);
        const B0 = at(u, v1, 0), B1 = at(u, v0, GRID.depthM);
        tx.push([A0, A1]);
        tx.push([B0, B1]);
        put(jOuter, A0); put(jOuter, B0);
        put(jInner, A1); put(jInner, B1);
        // THE TRUE CROSSING (operator round 5: "slightly above, in the well
        // of the top V"): the ring-plane panel is an isosceles trapezoid, and
        // trapezoid diagonals cross at the RADIUS-WEIGHTED point — a fraction
        // r_outer/(r_outer + r_inner) along each diagonal, nearer the short
        // inner chord — not at the corner centroid the last fix used.
        const rO = Math.hypot(A0[1], A0[2]);
        const rI = Math.hypot(A1[1], A1[2]);
        const tt = rO / (rO + rI);
        put(jCross, [A0[0] + (A1[0] - A0[0]) * tt,
                     A0[1] + (A1[1] - A0[1]) * tt,
                     A0[2] + (A1[2] - A0[2]) * tt]);
      }
    }
    pipes('GridTheta', tx, 0.02, XM.pipe);
    // The fan's own landings: outer end on its ring, inner ends on theirs —
    // including the four-legs-to-one point where two bays' webs share an
    // inner-hoop landing with the X ends.
    for (let n = 0; n < innerRows.length - 1; n++) {
      const u0 = innerRows[n], u1 = innerRows[n + 1], mid = (u0 + u1) / 2;
      for (let c = -3; c <= 3; c++) {
        const v = c * vHalf / 3.5;
        put(jOuter, at(mid, v, 0));
        put(jInner, at(u0, v, GRID.depthM));
        put(jInner, at(u1, v, GRID.depthM));
      }
    }
    const mount = (id, m, geom) => {
      const pts = [...m.values()];
      const xf = new Float32Array(pts.length * 16);
      pts.forEach((q, i) => xf.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
        q[0], q[1], q[2], 1], i * 16));
      const jn = inst(root, { id }, xf, pts.length, {});
      jn.geom = geom;
      jn.xmat = XM.printed;
    };
    mount('GridJointsOuter', jOuter, G.beadGeom(0.105, 0.075, 0.095, 8));
    mount('GridJointsInner', jInner, G.beadGeom(0.078, 0.056, 0.070, 8));
    mount('GridJointsX', jCross, G.beadGeom(0.062, 0.045, 0.055, 8));
    // Spokes leave from EVERY inner hoop — the model's own layout (one pair
    // drawn per bay here; the ship level draws the full diametral set).
    const sp = [];
    for (const u of innerRows) {
      for (const v of [-vHalf / 3, vHalf / 4]) {
        sp.push([at(u, v, GRID.depthM), at(u, v * 0.2, GRID.depthM + 18)]);
      }
    }
    lineNode(root, 'GridSpokes', sp,
      { kind: 'line', color: TOKENS.warm, weight: 1.1, opacity: 0.55 });
  }

  return {
    root,
    labels: [
      { p: at(0, 3.4 * CROSS, -1.6), t: 'the bare grid — the film goes on last', s: 'no posts and no rim grid: the hoop chords ARE the frame, and a ring loaded uniformly along its length is pure compression — the case it is funicular for. The film itself is drawn where it is the subject: the wall below, the wrap above' },
      { p: at(1.2 * ROW, -3.4 * CROSS, -1.4), t: 'square panels, and why', s: 'doubly curved carries pressure both ways at half the tension of a long trough — half the film, and half the pull the cross-bars resist' },
      { p: at(-1.4 * ROW, 3.4 * CROSS, -1.5), t: 'clamped sparsely, staggered ≈2 m', s: 'nothing drilled, cut or woven — and the crossings need no fastener under load, since the push is always inward. The clamps are for the unpressurised states: this has to stand up before it is ever pumped down' },
      { p: at(-3.2 * ROW, -2.8 * CROSS, -1.2), t: 'cross-bars, and what they are for', s: 'the film pulls adjacent rings together; these hold them apart — and tie the rings into one flange so the webs can serve them all' },
      { p: at(3.0 * ROW, 0, GRID.depthM + 1.3), t: 'every web lands on a ring', s: `the fan reaches the inner wall ≈${GRID.depthM} m in, where the bays and all the longerons live` },
      { p: at(0.5 * ROW, 2.0 * CROSS, GRID.depthM + 0.6), t: 'the X in the ring plane, at every bay', s: 'the member the checks found missing: without it the two walls cannot bend as one deep ring — the fan lives in meridional planes and cannot carry this shear' },
      { p: at(-2.2 * ROW, -1.2 * CROSS, GRID.depthM * 0.5), t: 'a connector at every landing', s: 'web ends, X ends, the crossing itself — the ledger prices joints smeared (the η line, 15% of members plus joints), and the render instances them for free. Getting that count DOWN is named daylight work; the count is why η matters' },
      { p: at(0, -1.5 * CROSS, GRID.depthM + 8), t: 'spokes, crossing the void', s: 'the licensed fallback: pretensioned cords against the EVEN out-of-round modes at fibre weight — a diametral cord cannot see the odd ones, and the record says so; the chordal net that could is SHIP-3' },
    ],
  };
}

/* The wrap: ONE mesh, the whole film, pressure-formed. Every panel gets its own
 * inward dimple — ring-line vertices ON the rings, a centre vertex dished by the
 * membrane law's own bulge (h = 0.25 a). Constant panel count around the girth
 * (the barrel's own); the caps narrow their panels toward the poles and the
 * panel already wears its "cap tiling schematic" tag. Drawn population is the
 * barrel's honest grid; the QUOTED population is the model's. */
function shipWrapGeom(D) {
  const nAround = Math.round(2 * Math.PI * D.R / D.crossM);
  const nRows = Math.round(D.total / D.rowY);
  const sag = 0.25 * (Math.max(D.rowY, D.crossM) / 2);
  const pos = [], idx = [];
  const ringVert = [];                        // [row][j] -> vertex index
  for (let i = 0; i <= nRows; i++) {
    const st = shipStation(D, D.total * i / nRows);
    const row = [];
    for (let j = 0; j < nAround; j++) {
      const th = 2 * Math.PI * j / nAround;
      row.push(pos.length / 3);
      pos.push(st.x, -st.r * Math.cos(th), st.r * Math.sin(th));
    }
    ringVert.push(row);
  }
  for (let i = 0; i < nRows; i++) {
    const sMid = D.total * (i + 0.5) / nRows;
    const st = shipStation(D, sMid);
    if (st.r < 1.5) {                         // polar caps: plain fan, no dimple room
      for (let j = 0; j < nAround; j++) {
        const a = ringVert[i][j], b = ringVert[i][(j + 1) % nAround];
        const c = ringVert[i + 1][j], d = ringVert[i + 1][(j + 1) % nAround];
        idx.push(a, c, d, a, d, b);
      }
      continue;
    }
    for (let j = 0; j < nAround; j++) {
      const thMid = 2 * Math.PI * (j + 0.5) / nAround;
      const r = st.r - st.nr * sag;
      const centre = pos.length / 3;
      pos.push(st.x - st.nx * sag, -r * Math.cos(thMid), r * Math.sin(thMid));
      const a = ringVert[i][j], b = ringVert[i][(j + 1) % nAround];
      const c = ringVert[i + 1][j], d = ringVert[i + 1][(j + 1) % nAround];
      idx.push(a, b, centre, b, d, centre, d, c, centre, c, a, centre);
    }
  }
  return G.solid(new Float32Array(pos), new Uint32Array(idx));
}

/* Instanced pipes from a segment list — the grid level's own idiom, shared. */
function pipesFromSegs(parent, id, segs, rOut, xmat, sides = 8) {
  if (!segs.length) return null;
  const pts = [], pairs = [];
  for (const g of segs) { pts.push(g.a, g.b); pairs.push([pts.length - 2, pts.length - 1]); }
  const gi = G.strutInstances(pts, pairs, 0, 1.0);
  const n2 = inst(parent, { id }, gi.xf, gi.count, {});
  n2.geom = G.tubeArcGeom(rOut, rOut * 0.35, 1.0, 360, sides);
  n2.xmat = xmat;
  return n2;
}

/* Level — SHIP 0: the whole vehicle, complete. Every member class the gated
 * model prices is on screen as pipe or cord: the film wrap pressure-formed over
 * the rings, the rings and cross-bars as real sections, the inner wall's
 * longerons and rings, the fan, the ring-plane X-webs, the junction diagonals,
 * and the spokes across the void. Fly through it — the fly view threads the
 * bow, the void and the wall gap. Figures come from the gated model through
 * catalog.js; nothing here is typed. */
let _wrapMemo = null;
const wrapGeomShared = (D) => _wrapMemo || (_wrapMemo = shipWrapGeom(D));

function buildShip() {
  const root = node({ id: 'L_ship', category: 'vacuum', selectable: false });
  const D = shipDims();
  // THE WRAP — the one loaded membrane, dished into every panel by the sky.
  // (Geometry shared with The Ship level above — one mesh, built once.)
  const wrap = solidNode(root, 'ShipFilm', wrapGeomShared(D), XM.sealedWall);
  wrap.shipWrap = true;
  const bones = shipSkeletonSegs(D);
  // The wall's members at their model sections (WALL carries mm; drawn in m).
  pipesFromSegs(root, 'ShipRings', bones.hoops, WALL.ringOdMm / 2000, XM.pipeRim, 6);
  // Cross-bars: continuous meridians one ring-diameter outboard would be sub-
  // pixel at this range; drawn on-surface at their true OD, one per column of
  // panels — the bar POPULATION is the girth count, drawn as full meridians.
  const barSegs = [];
  {
    const nB = Math.round(2 * Math.PI * D.R / D.crossM);
    for (let k = 0; k < nB; k += 1) {
      const th = 2 * Math.PI * k / nB;
      let prev = null;
      for (let i = 0; i <= 48; i++) {
        const sm = D.total * i / 48;
        const st = shipStation(D, sm);
        if (st.r < 1.2) { prev = null; continue; }
        const q = [st.x, -st.r * Math.cos(th), st.r * Math.sin(th)];
        if (prev) barSegs.push({ a: prev, b: q });
        prev = q;
      }
    }
  }
  pipesFromSegs(root, 'ShipBars', barSegs, WALL.barOdMm / 2000, XM.pipe, 6);
  pipesFromSegs(root, 'ShipInnerRings', bones.hoopsInner, 0.05, XM.pipeRim, 6);
  pipesFromSegs(root, 'ShipLongs', bones.longs, GRID.longOdMm / 2000, XM.pipeRim, 6);
  pipesFromSegs(root, 'ShipWebs', bones.webs, 0.03, XM.pipe, 6);
  pipesFromSegs(root, 'ShipTheta', bones.thetas, 0.02, XM.pipe, 6);
  pipesFromSegs(root, 'ShipJunction', bones.junctions, 0.04, XM.pipe, 6);
  // The spokes are CORDS, not pipes — drawn as the tension lines they are.
  lineNode(root, 'ShipSpokes', segLines(bones.spokes),
    { kind: 'line', color: TOKENS.warm, weight: 0.9, opacity: 0.4 });
  // (THE VOID SKIN IS RETIRED — operator, 08-14. It drew a glass lathe one sandwich
  // depth inside the wall, a "terminal skin" closing the vacuum off from the inside.
  // The two-wall design has no such surface: the inner wall IS the boundary, and a
  // second membrane behind it described a ship we no longer draw. Its layer switch
  // went with it.)
  const px = -SHIP.lenM / 2 - 2;
  lineNode(root, 'ShipPerson', [[[px, 0, -D.R * 0.1], [px, 0, -D.R * 0.1 + 1.8]]], XM.scaleTick);
  return {
    root,
    shipPanelCount: WALL.panels, shipPitchM: D.pitch,
    labels: [
      { p: [0, 0, D.R * 1.3], t: `the hull — ${SHIP.diaM} m × ${SHIP.lenM} m`, s: 'complete: one pressure-formed film over the ring grid, the two-walled skeleton, the ring-plane webs, and the spokes across the void. What it wears is the level above' },
      { p: [SHIP.lenM * 0.16, 0, -D.R * 1.3], t: `${WALL.rings.toLocaleString('en-US')} rings · ${WALL.bars.toLocaleString('en-US')} bars · ${WALL.panels.toLocaleString('en-US')} panels`, s: 'the gated model’s own populations — the cap tiling is drawn schematic' },
      { p: [-SHIP.lenM * 0.16, 0, -D.R * 1.3], t: 'the honest pair rides every number', s: 'it does not float on the house-harsh stability basis; the knockdown and coupon campaigns are the decision — the panel carries both worlds' },
    ],
  };
}

/* Level — THE SHIP: the hull plus everything it wears, under one rule —
 * NOTHING CUTS THE WALL (operator, 08-13). A vacuum wall has no spare local
 * capacity for a hole's stress raiser, and there is no interior to put gear
 * in: the inside IS the product. So every system is exterior. Thrust stands
 * off on pylons LONGER THAN THEIR OWN ROTOR RADIUS — the fleet dashboard
 * model's law, imported verbatim (its old hull-piercing mounts are exactly
 * what this level retires). Tanks, pumps and the winch ride a suspended
 * module under the keel on a wide bridle, so every pendant meets the hull as
 * a near-tangential pull on a circumferential strap — spread over many rings,
 * bearing and friction, never a bolt through film. The bucket lives on a line
 * below. Equipment is NAMED, NOT WEIGHED [SCOPING] — the ledger's declared
 * payload axis; Mission 0 (112 m) wears this same fit. */
function buildVessel(ctx) {
  const root = node({ id: 'L_vessel', category: 'vacuum', selectable: false });
  const D = shipDims();
  const wrap = solidNode(root, 'VesselWrap', wrapGeomShared(D), XM.sealedWall);
  wrap.shipWrap = true;
  const point = (s, off, th) => {
    const st = shipStation(D, s);
    const r = st.r - st.nr * off;
    return [st.x - st.nx * off, -r * Math.cos(th), r * Math.sin(th), r];
  };
  // SOLAR (operator, round 8): "as much power as we can get" — the ENTIRE top
  // half is the farm. Dense plate tiling with visible seams, so it reads as a
  // PV array rather than grey paint; sitting proud of the film on the same
  // frames everything else uses. Placement only; the energy budget lives in
  // the fleet model, not here.
  {
    const px2 = [];
    const sA = D.sCap, sB = D.sCap + D.cylL;
    // RECTANGULAR PANELS, GRID-ALIGNED (operator, round 11): the old plates
    // were 4-gon domes whose lathe put VERTICES on the hoop/axial axes — every
    // panel read as a diamond and its corners lapped the neighbouring rows.
    // Now each panel is a thin box with EDGES on the grid, sized just under
    // its pitch so seams show and nothing overlaps. The centre stands proud by
    // the hoop sagitta so a flat panel's corners never dip into the film.
    const HOOP_W = 4.2, THICK = 0.1;
    const plate = (s, th, axLen, capRow) => {
      const st = shipStation(D, s);
      const uu = [0, -Math.cos(th), Math.sin(th)];
      const n = [st.nx, st.nr * uu[1], st.nr * uu[2]];
      const tm = [st.tx, st.tr * uu[1], st.tr * uu[2]];
      const thop = [0, -Math.sin(th), -Math.cos(th)];
      const sag = st.r - Math.sqrt(Math.max(0, st.r * st.r - (HOOP_W / 2) ** 2));
      const off = 0.18 + sag + (capRow ? 0.08 : 0);
      const q = point(s, -off, th);
      px2.push([[thop[0] * HOOP_W, thop[1] * HOOP_W, thop[2] * HOOP_W],
                [tm[0] * axLen, tm[1] * axLen, tm[2] * axLen],
                [n[0] * THICK, n[1] * THICK, n[2] * THICK],
                [q[0], q[1], q[2]]]);
    };
    // CONTINUOUS DECKING (operator, round 10): plates abut — the pitch IS
    // the plate, so the top surface reads as one panelled skin with seam
    // lines, not a scatter of tiles.
    for (let i = 0; i < 24; i++) {
      const s = sA + (sB - sA) * (i + 0.5) / 24;
      for (let c = -8; c <= 8; c++) plate(s, Math.PI / 2 + c * 0.1673, 2.06, false);
    }
    // THE ENDS TOO (operator, round 9 addendum): the domes' top halves carry
    // the array as well — column count follows the shrinking circumference,
    // stopping short of the pole where a plate would out-size its ring.
    for (const [c0, c1] of [[0, D.sCap], [D.sCap + D.cylL, D.total]]) {
      const out = c0 === 0;             // orient rows outward from the barrel
      // Rows start almost at the barrel joint (operator, round 12: "fill the
      // curve/center transition") — f from 0.02, ten rows, plates sized under
      // the tighter pitch, so the decking runs continuously off the barrel
      // and over the shoulder.
      for (let i = 0; i < 10; i++) {
        const f = 0.9 * (i + 0.5) / 10;
        const s = out ? c1 - (c1 - c0) * f : c0 + (c1 - c0) * f;
        const st = shipStation(D, s);
        if (st.r < 9) continue;
        const dth = 4.35 / st.r;
        const m = Math.floor(1.35 / dth);
        for (let c = -m; c <= m; c++) plate(s, Math.PI / 2 + c * dth, 3.6, true);
      }
    }
    const xf = new Float32Array(px2.length * 16);
    px2.forEach(([X, Y, Z, q], i) => xf.set([X[0], X[1], X[2], 0,
      Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, q[0], q[1], q[2], 1], i * 16));
    const sol = inst(root, { id: 'VesselSolar' }, xf, px2.length, {});
    sol.geom = boxGeom(1, 1, 1);
    sol.xmat = XM.solar;
  }

  const normalAt = (s, th) => {
    const st = shipStation(D, s);
    return [st.nx, -st.nr * Math.cos(th), st.nr * Math.sin(th)];
  };
  const ringSeg = (s, off, out, th0 = 0, th1 = 2 * Math.PI, segN = 64) => {
    let prev = null;
    for (let j = 0; j <= segN; j++) {
      const th = th0 + (th1 - th0) * j / segN;
      const q = point(s, off, th);
      if (prev) out.push({ a: prev, b: [q[0], q[1], q[2]] });
      prev = [q[0], q[1], q[2]];
    }
  };

  // THE STRAPS: circumferential bands at the bridle stations and twin keel
  // rails — the only interface the equipment is allowed to have with the wall.
  const strapS = [0.32, 0.42, 0.58, 0.68].map(f => D.total * f);
  const straps = [];
  for (const s of strapS) ringSeg(s, -0.10, straps);
  for (const dth of [-0.10, 0.10]) {
    let prev = null;
    for (let i = 0; i <= 40; i++) {
      const s = D.total * (0.26 + 0.48 * i / 40);
      const q = point(s, -0.10, -Math.PI / 2 + dth);
      if (prev) straps.push({ a: prev, b: [q[0], q[1], q[2]] });
      prev = [q[0], q[1], q[2]];
    }
  }
  pipesFromSegs(root, 'VesselStraps', straps, 0.09, XM.printed, 6);

  // THRUST, GIMBALLED (operator ruling, 08-13 evening — REVERSING the same
  // day's low-mount call). Two duties, wildly unequal: cruise thrust is
  // CHEAP (a trimmed-neutral ship fights only drag) and HOLDDOWN is
  // EXPENSIVE (the scoop-and-drop transient is ~100 t of force with nowhere
  // to hide). The correction: holddown's WASH GOES UP — thrust down means
  // air thrown upward — so a pod below the beam fires its hardest wash
  // straight into the belly. The pods therefore ride THE HORIZONTAL PLANE,
  // the widest band's beam, where the wash column clears the hull's curve
  // in BOTH duties and the discs sit as far from wall, straps and working
  // lines as a pylon can hold them. Every pod vectors. Drawn MID-DUTY, not
  // animated: discs pointed to push the ship down and forward at once, the
  // posture the water cycle actually flies.
  const ROTOR_R = 5.5, PYLON = 7.5, NAC_L = 7.0;
  const thrustA = (() => {
    const v = [-0.45, 0, -1];
    const n2 = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n2, v[1] / n2, v[2] / n2];
  })();
  const tB = [thrustA[2], 0, -thrustA[0]];
  const tC = [thrustA[1] * tB[2] - thrustA[2] * tB[1],
              thrustA[2] * tB[0] - thrustA[0] * tB[2],
              thrustA[0] * tB[1] - thrustA[1] * tB[0]];
  const podS = [0.40, 0.52, 0.64].map(f => D.total * f);
  const pylons = [], rotors = [], podXf = [];
  for (const s of podS) {
    for (const side of [0, Math.PI]) {
      const th = side === 0 ? 0 : Math.PI;   // on the beam — the horizontal plane
      const base = point(s, 0, th);
      const n = normalAt(s, th);
      const hub = [base[0] + n[0] * PYLON, base[1] + n[1] * PYLON,
                   base[2] + n[2] * PYLON];
      pylons.push({ a: [base[0], base[1], base[2]], b: hub });
      podXf.push(hub);
      // The disc rides the THRUST axis: rim + three blades in the plane
      // perpendicular to down-and-forward.
      const hf = [hub[0] + thrustA[0] * NAC_L * 0.28,
                  hub[1] + thrustA[1] * NAC_L * 0.28,
                  hub[2] + thrustA[2] * NAC_L * 0.28];
      const rimAt = (a2) => [
        hf[0] + ROTOR_R * (Math.cos(a2) * tB[0] + Math.sin(a2) * tC[0]),
        hf[1] + ROTOR_R * (Math.cos(a2) * tB[1] + Math.sin(a2) * tC[1]),
        hf[2] + ROTOR_R * (Math.cos(a2) * tB[2] + Math.sin(a2) * tC[2])];
      let prev = null;
      for (let j = 0; j <= 36; j++) {
        const q = rimAt(2 * Math.PI * j / 36);
        if (prev) rotors.push({ a: prev, b: q });
        prev = q;
      }
      for (let b2 = 0; b2 < 3; b2++) {
        rotors.push({ a: hf.slice(), b: rimAt(2 * Math.PI * b2 / 3) });
      }
    }
  }
  pipesFromSegs(root, 'VesselPylons', pylons, 0.28, XM.pipeRim, 8);
  pipesFromSegs(root, 'VesselRotors', rotors, 0.10, XM.pipe, 6);
  {
    const xf = new Float32Array(podXf.length * 16);
    podXf.forEach((q, i) => xf.set([
      thrustA[0], thrustA[1], thrustA[2], 0,
      tB[0], tB[1], tB[2], 0,
      tC[0], tC[1], tC[2], 0,
      q[0], q[1], q[2], 1], i * 16));
    const nac = inst(root, { id: 'VesselPods' }, xf, podXf.length, {});
    nac.geom = latheWithScale([[-NAC_L / 2, 0.4], [-NAC_L * 0.2, 1.1],
      [NAC_L * 0.2, 1.1], [NAC_L / 2, 0.35]], 20, () => 1);
    nac.xmat = XM.printed;
  }

  // THE MODULE, suspended: a pipe-frame raft under the keel on a wide bridle.
  const xMid = point(D.total / 2, 0, 0)[0];
  const keelZ = -D.R;
  const DROP = D.R * 0.34;
  // Sized to what it carries (operator, round 7): the raft hugs the tank
  // cluster instead of rattling around a 22 m frame.
  const MW = 6.0, ML = 19.5, MH = 4.4;
  const mz0 = keelZ - DROP, mz1 = mz0 - MH;
  const corner = (sx, sy, z) => [xMid + sx * ML / 2, sy * MW / 2, z];
  const frame = [];
  for (const z of [mz0, mz1]) {
    frame.push({ a: corner(-1, -1, z), b: corner(1, -1, z) });
    frame.push({ a: corner(-1, 1, z), b: corner(1, 1, z) });
    frame.push({ a: corner(-1, -1, z), b: corner(-1, 1, z) });
    frame.push({ a: corner(1, -1, z), b: corner(1, 1, z) });
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1])
    frame.push({ a: corner(sx, sy, mz0), b: corner(sx, sy, mz1) });
  pipesFromSegs(root, 'VesselModule', frame, 0.16, XM.pipeRim, 6);
  {
    // ONE water tank, two N2 tanks fore and aft (operator, round 7): the
    // water is a single pi x 1.8^2 x 10.5 = 107 m3 vessel — the Mission-0
    // 100 t with trim margin — and the nitrogen pair is the air-admission
    // ballast the descent doctrine prices, riding the same raft. The pumps
    // and the winch are NOT here: they live in the box on the drop line.
    const zc = (mz0 + mz1) / 2;
    const wxf = new Float32Array(16);
    wxf.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, xMid, 0, zc, 1]);
    const wt = inst(root, { id: 'VesselTankWater' }, wxf, 1, {});
    wt.geom = latheWithScale([[-5.6, 0.3], [-5.25, 1.8],
      [5.25, 1.8], [5.6, 0.3]], 20, () => 1);
    wt.xmat = XM.membraneLoaded;
    const nx = [xMid - 7.8, xMid + 7.8];
    // On the upper deck's floor, bottoms on the WATER TANK'S DATUM (operator,
    // round 11): water r 1.8 centred at mz1+2.2, N2 r 1.0 — both underbellies
    // sit at mz1+0.4, one shared deck line.
    const nzFloor = mz1 + 1.4;
    const nxf = new Float32Array(nx.length * 16);
    nx.forEach((x2, i) => nxf.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
      x2, 0, nzFloor, 1], i * 16));
    const nt = inst(root, { id: 'VesselTanksN2' }, nxf, nx.length, {});
    nt.geom = latheWithScale([[-1.9, 0.25], [-1.7, 1.0],
      [1.7, 1.0], [1.9, 0.25]], 16, () => 1);
    nt.xmat = XM.cryo;
  }

  // THE BRIDLE: eight pendants from the strap bands to the raft's corners,
  // plus the drop line and the bucket. Lines, not pipes — they are tension.
  const lines = [];
  const bridleTh = [-Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55];
  const sPair = [[strapS[0], -1], [strapS[1], -1], [strapS[2], 1], [strapS[3], 1]];
  for (const [s, sx] of sPair) {
    for (let i = 0; i < 2; i++) {
      const q = point(s, -0.10, bridleTh[i]);
      lines.push([[q[0], q[1], q[2]], corner(sx, i === 0 ? -1 : 1, mz0)]);
    }
  }
  // THE TWO-DECK WORKING END (operator, rounds 9 + 11). Doctrine: TANK
  // STORAGE ON THE UPPER DECK (the raft — water amidships, the N2 pair ON ITS
  // FLOOR), ALL EQUIPMENT AND SENSORS ON THE LOWER DECK: a longer,
  // SEE-THROUGH equipment bay on the drop line holding the battery box up
  // top, the N2 cryo unit and THE SHIP MIND flanking it low, and THREE
  // PULLEYS on its keel — one per working line, and there are exactly three.
  // The sprayer hangs on its own cable to one side; the bucket hangs CENTRED;
  // the PUMP rides its RIGID PIPE from the winch — the pipe IS the 100 m reach
  // spec and the suspension, no separate cable — down past the bucket into the
  // water. THE ANCHOR LINE IS RETIRED (operator, 08-14): a fourth pendant off
  // the bay's stern, longer than everything else, drawn back when a hanging
  // weight was the holddown story. The wash ruling gave that duty to the
  // rotors, so the weight was a leftover reading as clutter — the gear now
  // ends at the water it works in.
  const bayZ = mz1 - 8.8;
  const bucketZ = bayZ - 9.6;
  // COLOUR CODE (operator, 08-13 late): PINK lines carry WEIGHT — bridle,
  // drop line, bucket. BLUE lines carry WATER — the sprayer's feed and the
  // pump's rigid pipe. One glance says which is which.
  lines.push([[xMid, 0, mz1], [xMid, 0, bayZ + 1.9]]);
  lines.push([[xMid, 0, bayZ - 1.95], [xMid, 0, bucketZ + 1.9]]);
  lineNode(root, 'VesselLines', lines,
    { kind: 'line', color: TOKENS.warm, weight: 1.1, opacity: 0.6 });
  lineNode(root, 'VesselLinesWater',
    [[[xMid - 3.3, 0, bayZ - 1.95], [xMid - 3.3, 0, bucketZ + 0.6]]],
    { kind: 'line', color: '#5b8fc4', weight: 1.1, opacity: 0.75 });
  {
    const one = (id, x2, z2, geom, xmat, vert2 = false) => {
      const xf = new Float32Array(16);
      if (vert2) xf.set([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, x2, 0, z2, 1]);
      else xf.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x2, 0, z2, 1]);
      const n2 = inst(root, { id }, xf, 1, {});
      n2.geom = geom; n2.xmat = xmat;
      return n2;
    };
    one('VesselRecvBay', xMid, bayZ, boxGeom(2.6, 8.2, 3.6),
      { kind: 'glass', color: '#9fb4cd', opacity: 0.22 });
    one('VesselBatteryBox', xMid, bayZ + 1.05, boxGeom(2.0, 6.4, 1.1),
      { kind: 'surface', color: '#2c2f38', spec: 0.35, opacity: 1 });
    // The cryo unit sits INBOARD of its keel pulley (operator, round 11 —
    // at x-2.6 the box overhung the winch sheave at x-3.3), and THE SHIP MIND
    // mirrors it on the other flank: the compute core in its own pink glass
    // box, clear of the pump pipe at x+3.2.
    one('VesselCryoBox', xMid - 2.0, bayZ - 0.95, boxGeom(1.7, 1.9, 1.5),
      XM.cryo);
    one('VesselShipMind', xMid + 2.0, bayZ - 0.95, boxGeom(1.5, 1.7, 1.4),
      { kind: 'glass', color: TOKENS.warm, opacity: 0.3 });
    {
      const off2 = [-3.3, 0, 3.3];
      const pxf2 = new Float32Array(off2.length * 16);
      off2.forEach((dx2, i) => pxf2.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
        xMid + dx2, 0, bayZ - 1.85, 1], i * 16));
      const pl = inst(root, { id: 'VesselPulleys' }, pxf2, off2.length, {});
      pl.geom = latheWithScale([[-0.16, 0.14], [-0.1, 0.38], [0.1, 0.38],
        [0.16, 0.14]], 10, () => 1);
      pl.xmat = XM.pipe;
    }
    one('VesselBucket', xMid, bucketZ, latheWithScale(
      [[-1.6, 0.4], [1.4, 2.3], [1.7, 2.35], [1.75, 2.1]], 18, () => 1),
      XM.membraneLoaded, true);
    // The working trio, re-read AGAIN (operator, 08-13 late): the grey
    // upright read as a second pump — gone. The SPRAYER is its blue water
    // line ending in a modest nozzle head; the PUMP is the blue horizontal
    // unit on its rigid pipe; the bucket rides pink, because pink carries
    // weight and blue carries water.
    one('VesselSprayer', xMid - 3.3, bucketZ + 0.1, latheWithScale(
      [[-0.5, 0.10], [-0.15, 0.24], [0.2, 0.3], [0.42, 0.06]], 12, () => 1),
      { kind: 'surface', color: '#5b8fc4', spec: 0.5, opacity: 1 }, true);
    one('VesselPump', xMid + 3.2, bucketZ - 5.4, latheWithScale(
      [[-0.6, 0.28], [-0.45, 0.5], [0.45, 0.5], [0.6, 0.28]], 12, () => 1),
      { kind: 'surface', color: '#5b8fc4', spec: 0.5, opacity: 1 });
    pipesFromSegs(root, 'VesselPumpPipe',
      [{ a: [xMid + 3.2, 0, bayZ - 1.85], b: [xMid + 3.2, 0, bucketZ - 4.95] }],
      0.09, { kind: 'surface', color: '#5b8fc4', spec: 0.5, opacity: 1 }, 6);
  }
  const px = -SHIP.lenM / 2 - 2;
  // The 1.8 m person at the bow is the viewer's scale reference. The hero ring
  // variant drops it (operator, #100): the watchers on the shore ARE the scale
  // there, and a lone tick floating off the bow of a turning ship reads as debris.
  if (!(ctx && ctx.envRing))
    lineNode(root, 'VesselPerson', [[[px, 0, -D.R * 0.1], [px, 0, -D.R * 0.1 + 1.8]]],
      XM.scaleTick);

  // THE ENVIRONMENT v2 (operator, round 9): the ship DIPPING INTO A LAKE —
  // the working end reaching down to the water, trees and people at the
  // shore. The hangar, vehicles and tethers are gone: this is the machine at
  // work, not parked. Opt-in 'env' layer; the fly camera makes it legible.
  {
    const zg = -(D.R + 34);                  // water level: a real dip reach
    const vert = (x2, y2, z2) => {
      const xf = new Float32Array(16);
      xf.set([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, x2, y2, z2, 1]);
      return xf;
    };
    // Land under everything; the lake floats just above it as glass.
    const gxf = new Float32Array(16);
    gxf.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 60, zg - 0.45, 1]);
    const gnd = inst(root, { id: 'VesselEnvGround' }, gxf, 1, {});
    gnd.geom = boxGeom(640, 640, 0.4);
    gnd.xmat = { kind: 'surface', color: '#15161b', spec: 0.05, opacity: 1 };
    const gridL = [];
    for (let k = -10; k <= 12; k++) {
      gridL.push([[-300, 60 + k * 24, zg - 0.2], [300, 60 + k * 24, zg - 0.2]]);
      gridL.push([[k * 26, -260, zg - 0.2], [k * 26, 360, zg - 0.2]]);
    }
    lineNode(root, 'VesselEnvGrid', gridL,
      { kind: 'line', color: '#26262e', weight: 1.0, opacity: 0.45 });
    // THE LAKE HAS A SHORE NOW (operator, round 12). The old 118 m disc put
    // the trees and half the crowd IN the water and ended in a hard glass
    // rim. Now: a 90 m core of water whose edge FADES over three stepped-
    // opacity washers (the solid shader discards per-instance alpha, so the
    // fade is stepped materials, not a gradient), lapping onto a beach
    // annulus — and everybody stands on the beach.
    const LC = [xMid, -6];                   // lake centre; the ship dips near it
    const vdisc = (z2) => {
      const xf = new Float32Array(16);
      xf.set([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, LC[0], LC[1], z2, 1]);
      return xf;
    };
    const lake = inst(root, { id: 'VesselEnvLake' }, vdisc(zg), 1, {});
    lake.geom = latheWithScale([[-0.18, 1.0], [-0.12, 90], [0.12, 90],
      [0.18, 1.0]], 40, () => 1);
    lake.xmat = { kind: 'glass', color: '#3d6f8f', opacity: 0.5 };
    // Washer = two profile rings at the water plane; the vertical basis lays
    // it flat. Opacity steps 0.30 / 0.16 / 0.07 walk the water out over the
    // sand until it is gone.
    const washer = (id2, r0, r1, op) => {
      const w2 = inst(root, { id: id2 }, vdisc(zg), 1, {});
      w2.geom = latheWithScale([[0.12, r0], [0.12, r1]], 40, () => 1);
      w2.xmat = { kind: 'glass', color: '#3d6f8f', opacity: op };
    };
    washer('VesselEnvLakeF1', 90, 98, 0.30);
    washer('VesselEnvLakeF2', 98, 106, 0.16);
    washer('VesselEnvLakeF3', 106, 114, 0.07);
    // The beach: a flat annulus just under the water plane, running from
    // inside the fade to well past the treeline.
    const shore = inst(root, { id: 'VesselEnvShore' }, vdisc(zg), 1, {});
    shore.geom = latheWithScale([[-0.06, 94], [-0.06, 132]], 40, () => 1);
    shore.xmat = { kind: 'surface', color: '#413d2e', spec: 0.06, opacity: 1 };
    // Trees rank along the OUTER shore (angle°, radius from the lake centre):
    // north arc facing the default camera, radii 112-127 — all on sand.
    const ringAt = (aDeg, r2) => [LC[0] + Math.cos(aDeg * Math.PI / 180) * r2,
                                  LC[1] + Math.sin(aDeg * Math.PI / 180) * r2];
    let TR = [[18, 118], [34, 124], [50, 114], [62, 126], [74, 116],
              [86, 122], [95, 113], [104, 125], [116, 115], [128, 121],
              [142, 113], [156, 124], [42, 119], [80, 127], [110, 120],
              [148, 118]];
    if (ctx && ctx.envRing) {
      // THE HERO RING (public arc, 08-13): the front page's ship turns with no controls,
      // so the treeline must close the full circle — in view from any azimuth. Same
      // shore band, same radii as the dip scene; positions are index-hashed (no
      // randomness — a hero that redraws differently on each visit reads as noise).
      TR = [];
      for (let i2 = 0; i2 < 30; i2++)
        TR.push([i2 * 12 + ((i2 * 47) % 11) - 5, 112 + ((i2 * 53) % 16)]);
    }
    {
      const xf = new Float32Array(TR.length * 16);
      TR.forEach(([a2, r2], i2) => {
        const [x2, y2] = ringAt(a2, r2);
        xf.set(vert(x2, y2, zg + 4.5 + (i2 % 3) * 0.4), i2 * 16);
      });
      const tn = inst(root, { id: 'VesselEnvTrees' }, xf, TR.length, {});
      tn.geom = latheWithScale([[-4.5, 0.4], [-3.2, 2.6], [4.5, 0.15]], 8, () => 1);
      tn.xmat = { kind: 'surface', color: '#2d4a35', spec: 0.1, opacity: 1 };
    }
    // People v2 (operator: "more detail to the human"): a shouldered body
    // and a separate head, 1.8 m all in — knots of watchers at the
    // waterline, feet on the beach (radius just past the fade's start).
    let PP = [[86, 98.5], [88.5, 100.1], [91, 98.9], [94, 100.7],
              [70, 99.3], [72.5, 100.5], [75, 99.1], [60, 100.9],
              [62.4, 99.5], [105, 100.3], [107.5, 99.7], [118, 100.5],
              [45, 100.1], [132, 99.9]];
    if (ctx && ctx.envRing) {
      // The watchers close the circle with the trees: knots of two and three at the
      // waterline every thirty degrees, feet on the beach, same 1.8 m people.
      PP = [];
      for (let k2 = 0; k2 < 12; k2++) {
        const a0 = k2 * 30 + ((k2 * 29) % 7);
        PP.push([a0, 98.6 + (k2 % 3) * 0.8],
                [a0 + 2.6, 100.2 - (k2 % 2) * 0.6],
                [a0 + 5.1, 99.4]);
      }
    }
    {
      const xf = new Float32Array(PP.length * 16);
      PP.forEach(([a2, r2], i2) => {
        const [x2, y2] = ringAt(a2, r2);
        xf.set(vert(x2, y2, zg + 0.84), i2 * 16);
      });
      const fn = inst(root, { id: 'VesselEnvPeople' }, xf, PP.length, {});
      fn.geom = latheWithScale([[-0.9, 0.11], [-0.5, 0.155], [-0.18, 0.20],
        [-0.05, 0.21], [0.28, 0.19], [0.5, 0.14], [0.55, 0.06]], 8, () => 1);
      fn.xmat = XM.printed;
      const hxf = new Float32Array(PP.length * 16);
      PP.forEach(([a2, r2], i2) => {
        const [x2, y2] = ringAt(a2, r2);
        hxf.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x2, y2, zg + 1.56, 1], i2 * 16);
      });
      const hd = inst(root, { id: 'VesselEnvHeads' }, hxf, PP.length, {});
      hd.geom = G.beadGeom(0.145, 0.125, 0.135, 8);
      hd.xmat = XM.printed;
    }
  }
  return {
    root,
    labels: [
      { p: [0, 0, D.R * 1.35], t: 'the ship — the hull plus everything it wears', s: 'one rule: NOTHING cuts the wall. There is no interior to put gear in — the inside is the product — so every system is exterior, on straps and pylons and lines. Equipment is named, not weighed [SCOPING]' },
      { p: point(podS[1], 0, -0.38).slice(0, 3).map((v, i) => i === 2 ? v + ROTOR_R + 9 : v), t: 'thrust stands off on pylons', s: 'the pylon is longer than the rotor radius so the disc clears the skin — the dashboard model’s own law. The load enters at a strap hardpoint and spreads over many rings; nothing is drilled' },
      { p: [xMid - ML * 2.6, 0, mz0 + 2.0], t: 'the works, suspended', s: 'one water tank with its N2 ballast pair on a raft under the keel, hung from a wide bridle: every pendant meets the hull as a near-tangential pull on a circumferential strap. A hard-mounted gondola would put its moments straight into a 4 mm wall; the pendulum is the price, and ops owns it [SCOPING]' },
      { p: [xMid + 16, 0, bucketZ + 2.5], t: 'the bucket rides a line', s: 'scoop, climb, drop — the water cycle never touches the hull. Drop the water and the ship is ~100 t light: the rotors are what hold it down while it refills, wash thrown upward' },
      { p: [-SHIP.lenM * 0.37, 0, -D.R * 0.62], t: 'Mission 0 wears this same fit', s: 'the spec ship is this architecture at 112 m — 100 t of water and 19 t of equipment, neutral at sea level in the certified world. This 52 m hull is the one drawn first; the spec ship is the design it scales up to.' },
    ],
  };
}

function boxGeom(w, l, h) {
  const x = l / 2, y = w / 2, z = h / 2;
  const P = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
             [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const F = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1],
             [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const pos = [], idx = [];
  for (const f of F) {
    const b0 = pos.length / 3;
    for (const vi of f) pos.push(...P[vi]);
    idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  }
  return G.solid(new Float32Array(pos), new Uint32Array(idx));
}

function latheWithScale(prof, seg, sScale) {
  const pos = [], idx = [];
  const rings = prof.length;
  for (let i = 0; i < rings; i++) {
    const [x, r] = prof[i];
    for (let j = 0; j < seg; j++) {
      const th = 2 * Math.PI * j / seg;
      const k = sScale(th);
      pos.push(x, -r * k * Math.cos(th), r * k * Math.sin(th));
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + (j + 1) % seg;
      const c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
      idx.push(a, c, d, a, d, b);
    }
  }
  return G.solid(new Float32Array(pos), new Uint32Array(idx));
}

/* ---------- level registry --------------------------------------------------------------------- */

// The cell group is shifted so the hero strut lands at the world origin; the orbit target
// has to undo that shift, or the article spins about a point off to one side of itself.
// DERIVED from the PINNED article pitch, not typed and not read off the live chain: the
// built article's size is a measurement (see model.js DEMO_PITCH_PINNED_M), and the
// chain's design point is free to move under corrected physics without dragging the
// drawn article with it.
const CELL_SHIFT = CELL.DEMO_PITCH_PINNED_M * Math.SQRT2 / 4;
const CELL_CENTRE = [-CELL_SHIFT, 0, 0];   // cg.p shifts NEGATIVE; follow it

// `stage: true` — this level does not build a scene, it displays built[3]'s. All four of
// the finest levels do, so a dive between any two of them is not a cross-fade at all: the
// article holds still at fade 1 and only the camera moves. ORDERED BY HOW TIGHTLY EACH ONE
// FRAMES IT — a joint, a member, a face, the whole cell — because with one shared scene
// graph a level that framed wider than the one below it would make a dive-in read as a
// zoom-out. On a level that declares a tour, `radius`, `target`, `az`, `el` and `dist` are
// only the fallback: the camera is framed by the stop it enters at.
// NAMED VIEWS — "proper movement around this": each level carries poses aimed at the
// things that matter on it, computed from the same generators that placed the geometry.
// A view is a camera move (and sometimes a reading), never a new scene — the same rule
// as the levels themselves. The grid's "see it from the ship" is the operator's own ask:
// pull all the way out and find the detailed patch sitting on the whole vehicle.
const SHIPVIEW = (() => {
  const D = shipDims();
  const s0 = D.total / 2;
  const at = (ds, off) => {
    const st = shipStation(D, s0 + ds);
    return [st.x - st.nx * off, 0, st.r - st.nr * off];
  };
  return {
    D,
    gridTg: [0, 0, D.R - GRID.depthM / 2],
    heroTg: at(0.5 * D.rowY, 0),
    openTg: at(-2.2 * D.rowY, 0),
    laidTg: at(2.0 * D.rowY, 0),
    depthTg: [0, 0, D.R - GRID.depthM / 2],
  };
})();

const LEVEL_VIEWS = {
  strut: [
    { k: 'centre', n: 'into the centre joint', az: -0.6, el: 0.15, d: 0.55 },
    { k: 'whole', n: 'the whole article', az: -0.9, el: 0.27, d: 1.64 },
    { k: 'above', n: 'from above', az: -0.9, el: 1.15, d: 1.2 },
  ],
  wall: [
    { k: 'whole', n: 'the whole article', az: -0.9, el: 0.27, d: 1.64 },
    { k: 'level', n: 'level with it', az: -0.9, el: 0.03, d: 1.45 },
    { k: 'above', n: 'from above', az: -0.9, el: 1.15, d: 1.7 },
  ],
  track: [
    { k: 'whole', n: 'the whole skin', az: -0.95, el: 0.30, d: 1.64 },
    { k: 'level', n: 'level with it', az: -0.95, el: 0.03, d: 1.45 },
    { k: 'above', n: 'from above', az: -0.95, el: 1.15, d: 1.7 },
  ],
  vessel: [
    { k: 'whole', n: 'the whole ship', tg: [0, 0, 0], az: -1.28, el: 0.12, d: 235 },
    { k: 'flank', n: 'the working flank', tg: [0, -SHIPVIEW.D.R * 0.9, -SHIPVIEW.D.R * 0.35], az: -0.55, el: 0.06, d: 60 },
    { k: 'keel', n: 'under the keel', tg: [0, 0, -SHIPVIEW.D.R - 8], az: -1.2, el: -0.30, d: 55 },
    { k: 'module', n: 'the suspended works', tg: [0, 0, -SHIPVIEW.D.R * 1.38], az: -0.8, el: 0.05, d: 34 },
    { k: 'drop', n: 'down the drop line', tg: [0, 0, -SHIPVIEW.D.R * 1.75], az: -1.0, el: 0.12, d: 40 },
    { k: 'gear', n: 'the water gear', tg: [0, 0, -SHIPVIEW.D.R * 2.3], az: -0.9, el: 0.05, d: 20 },
  ],
  ship: [
    // (No 'fly through it' here: the tour of that name sits in the row above, and one
    // control appearing twice under two headings is a control the reader cannot trust.)
    { k: 'whole', n: 'the whole ship', tg: [0, 0, 0], az: -1.15, el: 0.18, d: 211 },
    { k: 'bow', n: 'bow-on', tg: [0, 0, 0], az: -2.75, el: 0.10, d: 150 },
    { k: 'skim', n: 'skim the wall', tg: [0, 0, SHIPVIEW.D.R], az: -0.85, el: 0.10, d: 15 },
    { k: 'void', n: 'inside the void', tg: [0, 0, 0], az: -1.15, el: 0.05, d: 9 },
    { k: 'patch', n: 'where the grid lives', tg: SHIPVIEW.gridTg, az: -0.55, el: 0.62, d: 70 },
  ],
  bay: [
    { k: 'open', n: 'the open course', tg: SHIPVIEW.openTg, az: -0.55, el: 0.72, d: 15 },
    { k: 'laid', n: 'the laid wall', tg: SHIPVIEW.laidTg, az: -0.5, el: 0.62, d: 15 },
    { k: 'post', n: 'one crossing, clamped', tg: SHIPVIEW.heroTg, az: -0.7, el: 0.35, d: 3.2 },
    { k: 'depth', n: 'into the depth', tg: SHIPVIEW.depthTg, az: -0.4, el: 0.1, d: 8 },
    { k: 'fromship', n: 'see it from the ship', tg: SHIPVIEW.gridTg, az: -1.0, el: 0.5, d: 240 },
  ],
  cell: [
    { k: 'whole', n: 'the whole article', group: 'all', az: -0.9, el: 0.27, d: 1.64 },
    { k: 'centre', n: 'into the centre', group: 'centre', az: -0.6, el: 0.15, d: 1.15 },
    { k: 'primary', n: 'the primary path', group: 'primary', az: -1.3, el: 0.45, d: 1.5 },
    { k: 'above', n: 'from above', az: -0.9, el: 1.15, d: 1.7 },
    { k: 'level', n: 'level with it', az: -0.9, el: 0.03, d: 1.45 },
  ],
};

/* TOURS (operator, round 8): "at least one tour for every level that visits
 * all, other tours for specialty areas as well." Two kinds, both cancelled by
 * any input: a PATH tour is a chain of eased camera legs (the fly-through's
 * own machinery, generalized off the hull level); a WALK tour drives the
 * level's stop chips on a dwell timer, so the highlight, the caption and the
 * camera travel together through the existing stop machinery. The hull's
 * grand tour IS the fly-through — FLY_PATH is assigned in just after it is
 * built below. */
const LEVEL_TOURS = (() => {
  const D = shipDims();
  const R = D.R, L = SHIP.lenM;
  return {
    vessel: [
      { k: 'walkaround', n: 'the full walkaround', type: 'path', legs: [
        { tg: [-L * 0.62, 0, 0], az: -2.9, el: 0.06, d: 120, s: 2.4 },
        { tg: [0, -R * 0.9, -R * 0.35], az: -0.55, el: 0.06, d: 60, s: 2.6 },
        { tg: [0, 0, -R - 8], az: -1.2, el: -0.3, d: 55, s: 2.6 },
        { tg: [0, 0, -R * 1.38], az: -0.8, el: 0.05, d: 34, s: 2.4 },
        { tg: [0, 0, -R * 1.75], az: -1.0, el: 0.12, d: 40, s: 2.4 },
        { tg: [L * 0.6, 0, 0], az: -0.25, el: 0.12, d: 150, s: 2.8 },
      ] },
      { k: 'workingend', n: 'the working end', type: 'path', legs: [
        { tg: [0, 0, -R * 1.38], az: -0.8, el: 0.05, d: 34, s: 2.2 },
        { tg: [0, 0, -R * 1.62], az: -1.05, el: 0.02, d: 18, s: 2.2 },
        { tg: [0.9, 0, -R * 1.8], az: -0.7, el: 0.06, d: 14, s: 2.2 },
        { tg: [0, 0, -R * 1.98], az: -1.0, el: 0.15, d: 26, s: 2.4 },
      ] },
      { k: 'solarfield', n: 'over the solar field', type: 'path', legs: [
        { tg: [-L * 0.3, 0, R * 1.02], az: -1.5, el: 0.55, d: 42, s: 2.4 },
        { tg: [0, 0, R * 1.04], az: -1.1, el: 0.35, d: 26, s: 2.6 },
        { tg: [L * 0.3, 0, R * 1.02], az: -0.6, el: 0.5, d: 42, s: 2.6 },
      ] },
    ],
    ship: [
      { k: 'fly', n: 'the fly-through', type: 'path', legs: null },
      { k: 'stability', n: 'the stability circuit', type: 'path', legs: [
        { tg: [0, 0, R], az: -0.85, el: 0.10, d: 15, s: 2.2 },
        { tg: [0, 0, R - 1.5], az: -1.45, el: 0.06, d: 7, s: 2.6 },
        { tg: [0, 0, 0], az: -1.15, el: 0.05, d: 9, s: 2.6 },
        { tg: [L * 0.36, 0, R * 0.5], az: -0.5, el: 0.2, d: 22, s: 2.4 },
      ] },
    ],
    bay: [
      { k: 'wholewall', n: 'the whole wall', type: 'path', legs: [
        { tg: [0, 0, R - 1.5], az: -0.55, el: 0.72, d: 15, s: 2.2 },
        { tg: [0, 0, R - 1.5], az: -0.7, el: 0.35, d: 3.2, s: 2.4 },
        { tg: [0, 0, R - 1.5], az: -0.4, el: 0.1, d: 8, s: 2.4 },
        { tg: [0, 0, R - 3], az: -1.0, el: 0.5, d: 30, s: 2.4 },
      ] },
    ],
    cell: [
      { k: 'article', n: 'around the article', type: 'path', legs: [
        { az: -0.9, el: 0.27, d: 1.64, s: 2.2 },
        { az: -0.6, el: 0.15, d: 1.15, s: 2.4 },
        { az: -1.3, el: 0.45, d: 1.5, s: 2.4 },
        { az: -0.9, el: 1.15, d: 1.7, s: 2.4 },
        { az: -0.9, el: 0.03, d: 1.45, s: 2.4 },
      ] },
    ],
    strut: [{ k: 'families', n: 'walk all five families', type: 'walk' }],
    wall: [{ k: 'cuts', n: 'walk all nine cuts', type: 'walk' }],
    track: [
      { k: 'skin', n: 'around the skin', type: 'path', legs: [
        { az: -0.95, el: 0.30, d: 1.64, s: 2.2 },
        { az: -0.95, el: 0.03, d: 1.45, s: 2.4 },
        { az: -0.95, el: 1.15, d: 1.7, s: 2.4 },
      ] },
    ],
  };
})();

/* THE FLY-THROUGH — the operator's ask, verbatim: "the complete ship with all
 * struts and components as a view we can fly through." A chain of poses flown
 * as one continuous eased path: bow approach, skim the wall, thread the gap
 * between the walls, cross the void among the spokes, out over the stern.
 * Cancelled by any input; reduced motion steps it as cuts. */
const FLY_PATH = (() => {
  const D = shipDims();
  const R = D.R;
  return [
    { tg: [-SHIP.lenM * 0.62, 0, 0], az: -2.9, el: 0.06, d: 70, s: 2.4 },
    { tg: [-SHIP.lenM * 0.30, 0, R * 0.9], az: -2.2, el: 0.10, d: 26, s: 2.6 },
    { tg: [0, 0, R - GRID.depthM / 2], az: -1.45, el: 0.06, d: 7, s: 3.0 },
    { tg: [SHIP.lenM * 0.12, 0, R * 0.35], az: -0.9, el: 0.02, d: 12, s: 2.8 },
    { tg: [SHIP.lenM * 0.30, 0, 0], az: -0.5, el: -0.04, d: 18, s: 2.6 },
    { tg: [SHIP.lenM * 0.60, 0, 0], az: -0.25, el: 0.12, d: 90, s: 2.8 },
  ];
})();
LEVEL_TOURS.ship[0].legs = FLY_PATH;

export const LEVELS = [
  { id: 'strut', name: 'The connectors', scaleM: 0.05, radius: 0.030, az: -1.05, el: 0.24, dist: 2.6, target: CELL_CENTRE, stage: true, build: () => buildStageShell('strut'), instance: 'demonstrator' },
  { id: 'wall', name: 'The tubes', scaleM: 0.25, radius: 0.16, az: -0.9, el: 0.20, dist: 2.4, target: CELL_CENTRE, stage: true, build: () => buildStageShell('wall'), instance: 'demonstrator' },
  { id: 'track', name: 'The skin', scaleM: 0.50, radius: 0.30, az: -0.95, el: 0.30, dist: 2.1, target: CELL_CENTRE, stage: true, build: (c) => buildStageShell('track', c), instance: 'demonstrator' },
  // Target raised +z so the article sits BELOW the assembly guide's top-centre card
  // rather than behind it — a framing shift only, the geometry does not move.
  { id: 'cell', name: 'The cell', scaleM: 0.709, radius: 0.42, az: -0.9, el: 0.27, dist: 3.9, target: [CELL_CENTRE[0], CELL_CENTRE[1], CELL_CENTRE[2] + 0.075], stage: true, build: buildCell, instance: 'demonstrator' },
  // The array is framed on its HERO CELL — the one drawn with a skin at [0, -2, 1] — so
  // the descent to the level below goes into a cell already on screen instead of cutting
  // to a new model. openC in buildArray is the same point; one constant, both places.
  { id: 'bay', name: 'The grid', scaleM: 20, radius: 9, depthR: 130, az: -0.62, el: 0.85, dist: 3.0, target: [0, 0, SHIP.diaM / 2 - GRID.depthM / 2], build: buildGrid, instance: 'flight' },
  // THE COMPARTMENTS LEVEL IS RETIRED (operator + agreement, 08-13): the level
  // drew ONE membrane arrangement while SHIP-5 is an open policy, and the drawn
  // slabs escaped the hull. The doctrine paragraph lives on the hull panel; the
  // level returns when the policy is decided, drawn from a decided rule.
  // THE HULL — the blueprint's closure level: the 52 x 104 plan of record, bare —
  // every member class the gated model prices, and nothing else. (Renamed from
  // 'Ship 0', operator 08-13: the ship is the level above, wearing its gear.)
  { id: 'ship', name: 'The Hull', scaleM: 52, radius: 62, depthR: 130, az: -1.15, el: 0.18, dist: 3.4, build: buildShip, instance: 'flight' },
  // THE SHIP — the hull plus everything it wears, all of it EXTERIOR: pylon
  // thrust, strap rails, the suspended module, the bucket. Nothing cuts the wall.
  { id: 'vessel', name: 'The Ship', scaleM: 60, radius: 72, depthR: 150, az: -1.28, el: 0.12, dist: 3.4, build: buildVessel, instance: 'flight' },
];
export const STAGE_LEVEL = LEVELS.findIndex(l => l.id === 'cell');

/* ---------- tours: a level that walks a list of stops instead of holding one pose ------------- */

/* THE STOPS ARE GENERATED FROM THE ARTICLE, never listed.
 *
 * Three levels tour the one cell, and each groups the SAME drawn geometry a different way:
 * its joints by (role, arms), its members by what they are cut to, its surface by the kind
 * of face. Every grouping comes out of the build, and every figure the panel puts beside it
 * comes out of the manifest or the model — a typed stop list is a published figure with no
 * checker behind it, and it goes stale the first time a diameter, a face count or the tie
 * schedule moves without saying so.
 *
 * The joint families meet the manifest on the integer u, which is the one thing the render
 * and the generator agree on exactly (the render's half-pitch is 177.1 mm, the generator
 * cuts at 177.25 — 0.14% apart). The cut groups meet it on (SKU, length class, deduction).
 */

/** Look at something from OUTSIDE the article, a quarter-turn off its own outward
 * direction so it reads in depth rather than end-on. The cell is convex about CELL_CENTRE,
 * so that direction is simply where the subject sits; a subject AT the centre has no
 * outward direction at all and keeps the level's own pose. */
function poseFor(pos, lv) {
  const d = [pos[0] - CELL_CENTRE[0], pos[1] - CELL_CENTRE[1], pos[2] - CELL_CENTRE[2]];
  const dl = Math.hypot(d[0], d[1], d[2]);
  if (dl <= 1e-6) return { az: lv.az, el: lv.el };
  return {
    az: Math.atan2(d[1], d[0]) + 0.34,
    el: clamp(Math.asin(clamp(d[2] / dl, -1, 1)) * 0.62 + 0.15, -1.2, 1.2),
  };
}

const instKeys = (recs) => {
  const s = new Set();
  for (const rec of recs) for (const [id, i] of rec.inst) s.add(`${id}#${i}`);
  return s;
};

const union = (...sets) => {
  const s = new Set();
  for (const one of sets) for (const k of one) s.add(k);
  return s;
};

/* THE FIVE PRINTED FAMILIES, centre outward. */
function familyStops(cell, lv) {
  const byKey = new Map();
  for (const p of cell.parts) {
    const k = `${p.role}-${p.arms}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const stops = [];
  for (const key of FAMILY_ORDER) {
    const fam = NODE_FAMILIES[key];
    const group = byKey.get(key);
    if (!group || !group.length) continue;      // the gate fails loudly; the page still runs
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    // The manifest's own representative — the median-mass node of the family — so the
    // camera lands on the joint whose STL the panel names, matched on the integer u.
    const rep = group.find(p => same(p.u, fam.repU)) ||
      group.slice().sort((a, b) => `${a.u}`.localeCompare(`${b.u}`))[0];
    const r = cell.partRadius;
    // The whole FAMILY stays lit, not just the one joint the camera is at: the claim on
    // the card is "x24", and dimming the other twenty-three would hide it.
    //
    // AND SO DO THE PIPES THE FRAMED JOINT RECEIVES. The card's other claim is the
    // member-end count, and the pipes are the member-ends. Dim them with the rest and a
    // carbon tube at 0.28 of an already-dark tone is black inside a lit bone cup: every
    // socket on the representative read as an EMPTY, broken mouth — "interference in the
    // workhorse's receivers" — when the pipe was seated exactly where the schedule puts
    // it. The dim was hiding the very thing the stop exists to show.
    const inc = cell.members.filter((m) => m.keys.includes(rep.key));
    stops.push({
      key, name: fam.name, rep,
      // dist 4.4, not the 2.05 the levels use: `radius` is a bounding radius fitted to the
      // WIDTH of a 16:9 frame, and a joint whose arms reach 25 mm in every direction has
      // to clear the height too, in a portrait phone viewport as well as on a desktop.
      target: rep.pos.slice(), radius: r, dist: 4.4, ...poseFor(rep.pos, lv),
      subject: union(instKeys(group), instKeys(inc)),
      labels: [
        { p: [rep.pos[0], rep.pos[1], rep.pos[2] + r * 1.15],
          t: `${fam.name} — ${fam.arms} arms, ×${fam.count}`,
          s: `${fam.repFile} · ${fam.memberEnds} of ${NODE_TOTALS.memberEnds} member-ends` },
        { p: [rep.pos[0], rep.pos[1], rep.pos[2] - r * 1.05],
          t: `slot base ${fam.slotBaseMm.toFixed(2)} mm`,
          s: `tightest pair opens to ${fam.minArmAngleDeg.toFixed(0)}° — where the pipes stop` },
      ],
    });
  }
  return stops;
}

/* THE CUT SCHEDULE, walked on the article itself.
 *
 * A member's group is decided by its two ENDS: the SKU it is on, whether it is a <110>
 * member or a <100> tie, and the seat depth its two joints take out of it. The generated
 * module holds the same four groups keyed the same way, so this matches on (SKU, length
 * class, deduction) rather than on any name — a member the page draws that answers to no
 * generated group is a member the schedule does not price, and the gate says so.
 */
function cutStops(cell, lv, ctx) {
  // Membership comes off each member's own record, assigned once where the pipes were
  // drawn — NOT re-derived from a signature here. The signature stopped being unique the
  // day the sink sawed one rim deduction to two lengths, and a second derivation of the
  // same fact is how the two rim stops came to light all 36 edges each.
  const byGroup = new Map();
  for (const m of cell.members) {
    if (!m.group) continue;
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(m);
  }
  const stops = [];
  for (const key of ctx.cuts.order) {
    const g = ctx.cuts.groups[key];
    const group = byGroup.get(key);
    if (!group || !group.length) continue;
    // The member FARTHEST from the cell's own centre, so the camera lands on one the
    // article does not hide behind itself. Deterministic: ties break on draw order.
    const rep = group.reduce((best, m) => {
      const d = (q) => Math.hypot(q.pos[0] - CELL_CENTRE[0], q.pos[1] - CELL_CENTRE[1],
        q.pos[2] - CELL_CENTRE[2]);
      return d(m) > d(best) ? m : best;
    }, group[0]);
    const r = cell.memberRadius;
    stops.push({
      // Named by the CUT (operator, 08-13 round 5): nine chips that all said
      // 'octet' or 'tie' were labels in name only — the length is the identity
      // on a saw table, so the chip says the length.
      key, name: `${g.cutMm.toFixed(0)} mm ${g.name}`, rep,
      // WHOLE ARTICLE IN FRAME (operator, 08-13): the walk changes the
      // HIGHLIGHT, not the vantage. Every stop parks at the cell's own framing
      // — same pose for all of them, so between stops the camera does not move
      // and the lit group is what travels. The labels still ride the lit rep.
      target: LEVELS[STAGE_LEVEL].target.slice(),
      radius: LEVELS[STAGE_LEVEL].radius,
      dist: LEVELS[STAGE_LEVEL].dist, az: -0.9, el: 0.27,
      subject: instKeys(group),
      labels: [
        { p: [rep.pos[0], rep.pos[1], rep.pos[2] + r * 0.42],
          t: `${g.cutMm.toFixed(2)} mm × ${g.count}`,
          s: `${g.kindsText} · Ø${g.odMm.toFixed(0)} × ${g.idMm.toFixed(0)} · ` +
             `${g.cutM.toFixed(2)} m of tube` },
        { p: [rep.pos[0], rep.pos[1], rep.pos[2] - r * 0.34],
          t: `${g.memberMm.toFixed(2)} mm on the lattice`,
          s: `less ${g.deductMm.toFixed(2)} mm of seat and ${g.sinkShortMm.toFixed(2)} mm ` +
             'of sink — the seats are inside the joints, the sink is the boundary frame ' +
             'settling beneath the faces' },
      ],
    });
  }
  return stops;
}

/* THE SURFACE, walked by the kind of face rather than by parts.
 *
 * The stops are the four things a membrane meets on this cell — a hexagon, a square, the
 * dihedral edge between two hexagons, and the flat mating land a face closes on — and each
 * lights the FRAME that panel pulls on, because the film itself is one surface and cannot
 * be highlighted a face at a time. Which members those are is not asserted here: the
 * hexagons are carried by their spokes and hubs, the squares by the ties tagged in-plane
 * when they were drawn, the edges by the rim, and the lands by whichever joint families
 * the manifest says carry one.
 */
function faceStops(cell, lv) {
  const hex = cell.faces.filter(f => f.kind === 'hexagon');
  const sq = cell.faces.filter(f => f.kind === 'square');
  const byKind = (k) => cell.members.filter(m => m.kind === k);
  const hubs = cell.parts.filter(p => p.role === 'hexHub');
  const rimVerts = cell.parts.filter(p => p.role === 'rimVertex');
  const sqCentres = cell.parts.filter(p => p.role === 'lattice' &&
    p.u.some(x => Math.abs(x) === 2) && p.u.filter(x => x !== 0).length === 1);
  const landed = cell.parts.filter(p => {
    const fam = NODE_FAMILIES[`${p.role}-${p.arms}`];
    return fam && fam.lands > 0;
  });
  const plan = [
    { key: 'hexagon', name: 'the hexagon', at: hex[0],
      subject: union(instKeys(byKind('spoke')), instKeys(hubs)),
      t: `${hex.length} hexagons`,
      s: 'six radial spokes to a central hub — the largest panel, and the one the film '
         + 'pulls hardest on' },
    { key: 'square', name: 'the square', at: sq[0],
      subject: union(instKeys(byKind('tie').filter(m => m.inPlane)), instKeys(sqCentres)),
      t: `${sq.length} squares`, s: 'quartered in plane by the vertex ties, which lie in the face itself' +
         'plane — braced before anyone noticed' },
    { key: 'edge', name: 'the dihedral edge', at: null,
      subject: union(instKeys(byKind('rim')), instKeys(rimVerts)),
      t: `${byKind('rim').length} edges`, s: 'a dihedral: two panels pull the same edge, and their tensions add rather than cancel' +
         'tensions add instead of cancelling' },
    { key: 'land', name: 'the mating land', at: sq[1] || sq[0],
      subject: instKeys(landed),
      t: `${landed.length} joints carry a land`, s: 'flat mating faces, so cells seat against each other rather than on their pipes' +
         'has been chosen to go on them' },
  ];
  // The edge stop aims at a rim member rather than a face centre — it is the one stop
  // whose subject is not a panel.
  const rimRep = byKind('rim')[0];
  const stops = [];
  for (const s of plan) {
    const pos = (s.at ? s.at.pos : rimRep && rimRep.pos);
    if (!pos || !s.subject.size) continue;
    const r = cell.faceRadius;
    stops.push({
      key: s.key, name: s.name,
      // WHOLE ARTICLE IN FRAME (operator, 08-13), same rule as the cuts: the
      // walk moves the lit frame, never the camera.
      target: LEVELS[STAGE_LEVEL].target.slice(),
      radius: LEVELS[STAGE_LEVEL].radius,
      dist: LEVELS[STAGE_LEVEL].dist, az: -0.9, el: 0.27,
      subject: s.subject,
      labels: [{ p: [pos[0], pos[1], pos[2] + r * 0.5], t: s.t, s: s.s }],
    });
  }
  return stops;
}

/** The tour a level declares, or null. `noun` is what the button calls a stop — the page
 * reads it back out of here rather than deciding for itself what kind of thing it is
 * showing. `skinLit` is the skin level's one exemption: every other tour dims the film to
 * see through it, and the level ABOUT the film must not. */
function buildTour(levelId, cell, ctx) {
  if (!cell.parts) return null;
  const lv = LEVELS.find(l => l.id === levelId);
  let stops = null, noun = 'part', skinLit = false;
  if (levelId === 'strut') stops = familyStops(cell, lv);
  else if (levelId === 'wall') { stops = cutStops(cell, lv, ctx); noun = 'cut'; }
  // The SKIN's walk is retired (operator, 08-13 round 5): its stops stopped
  // moving the camera when the wide-framing rule landed, so the walk became a
  // list of highlights the panel already carries — the panel shows all four
  // face readings at once there now. faceStops stays for the day a walk earns
  // its place back.
  return stops && stops.length ? { levelId, noun, skinLit, stops } : null;
}


/* ---------- mount -------------------------------------------------------------------------------- */

export function mountExplorer(opts) {
  const { canvas, labelLayer, onLevelChange, reducedMotion, lite, envRing, layers } = opts;
  if (!isWebGL2Available()) return null;
  const renderer = createRenderer(canvas, { maxPixelRatio: 2 });
  if (!renderer) return null;

  const state = {
    levelIdx: opts.startLevel !== undefined ? opts.startLevel : 3,
    matKey: opts.matKey || 'PAHT_Z',
    altM: opts.altM !== undefined ? opts.altM : 2500,
    cut: 0,                      // 0 = off; -1..1 across the level radius
    breached: new Set(),
    // TRANSPARENT BY DEFAULT. A solid skin is an opaque box around the entire article,
    // and the article is the point — the structure inside was invisible until you found
    // the button. Glass first, solid on request.
    skinMode: 'transparent',     // 'solid' | 'transparent' | 'off'
    skinLoad: 0,                 // 0 = slack film, 1 = pumped onto the solved domes (#63)
    skinLoadTo: 0,               // what it is easing toward
    unfold: 0,                   // 0 = the cell, 1 = the flat net
    unfoldTo: 0,                 // what it is easing toward
    assemble: 1,                 // 0 = a pile of parts, 1 = the finished article (default)
    assembleTo: 1,               // what it is easing toward; scoped to the cell level
    assembleSpeed: 1,            // playback multiplier, guide and global alike
    assembleGuide: null,         // {idx, alpha, to}: one part at a time, prefix seated
    assembleLoop: null,          // null | 'loop' (restart at the end) | 'bounce' (unwind)
    assembleHold: 0,             // seconds left of the pause a loop takes at each end
    partsMode: 'all',            // 'all' | 'joinery' | 'pipes'
    // THE CELL OPENS ON ITS CENTRE JOINT. "Everything" is 216 identical-looking sticks and
    // says nothing about how the cell carries load; lighting the twelve members that reach
    // u = (0,0,0) shows the one interior node the whole octet hangs off, first frame, with
    // no click. Any group button (including "everything") replaces it.
    group: 'centre',             // which structural reading is lit; see applyGroup
    tourIdx: 0,                  // which stop of the current level's tour
    tourStop: null,              // its key, so a probe and a label can read it back
    // The ship level's own controls: every layer starts ON; the wall hides the skeleton
    // until the viewer opens it, which is what a sealed wall does.
    shipLayers: { wall: true, skeleton: true, webs: true, spokes: true,
                  pods: true, module: true, lines: true, env: false },
    flyQueue: null,              // a path tour's remaining legs (any level)
    tourKey: null,               // which tour the queue belongs to
    autoWalk: null,              // { key, dwell, acc, visited } for walk tours
    turntable: !reducedMotion,
    reduced: !!reducedMotion,
  };
  // Layer overrides land BEFORE anything builds or frames, so a hero boot can open with
  // the environment already on — no toggle, no eased zoom-out, no transition to wait on.
  if (layers) Object.assign(state.shipLayers, layers);
  let ctx = computeCtx(state.matKey, state.altM);
  ctx.envRing = !!envRing;

  // Build all levels once; they are small. A stage level's builder returns an empty shell:
  // built[STAGE_LEVEL] holds the one scene graph they all display.
  // LITE MOUNT (the front-page hero): only The Ship builds. Every other level gets the
  // same empty shell a stage level gets — enough shape for the loops below, no geometry,
  // no data, and the 6.5 MB of joint meshes never load. Nothing can navigate there: a
  // lite page wires no controls.
  const built = LEVELS.map((lv) => {
    const b = (lite && lv.id !== 'vessel')
      ? { root: node({ id: `LiteShell_${lv.id}`, selectable: false }), labels: [] }
      : lv.build(ctx);
    walk(b.root, (n) => { n._fadeRoot = b; });
    b.fade = 0;
    b.claim = 0;
    b.level = lv;
    return b;
  });
  built[state.levelIdx].fade = 1;
  built[state.levelIdx].claim = 1;
  const stageIdx = LEVELS.map((lv, i) => (lv.stage ? i : -1)).filter(i => i >= 0);
  const isStage = (i) => LEVELS[i] && !!LEVELS[i].stage;

  // Per-level tours, generated from the stage's own parts. Held here, not on LEVELS: they
  // depend on the built geometry, and LEVELS is exported and shared.
  const tours = new Map();
  if (!lite) for (const lv of LEVELS) {          // lite: the stage is a shell; no tours
    const t = buildTour(lv.id, built[STAGE_LEVEL], ctx);
    if (t) tours.set(lv.id, t);
  }
  const tourOf = (idx) => tours.get(LEVELS[idx].id) || null;
  const stopOf = (idx) => {
    const t = tourOf(idx);
    return t ? t.stops[clamp(state.tourIdx, 0, t.stops.length - 1)] : null;
  };

  const lv0 = LEVELS[state.levelIdx];
  const cam = createCamera({ radius: lv0.radius, azimuth: lv0.az, elevation: lv0.el });
  applyRadius(cam, lv0.radius);

  /** @param depthR the radius the near/far planes are sized from — the STAGE's, not the
   * stop's, when a tour has framed the camera on a 25 mm joint inside a 709 mm article.
   * Tie far to the framing radius there and far lands at 0.36 m, which cuts the far half
   * of the cell off mid-air. The clamps and the dive thresholds still ride the framing
   * radius, which is what they are for. */
  function applyRadius(c, r, depthR = r) {
    c.radius = depthR;
    // Generous room in both directions: a viewer wanted to inspect without being thrown
    // into the next level, so the auto-dive thresholds sit well inside these clamps.
    c.minDistance = r * 0.22;
    // Out, a stop is allowed to retreat to the whole stage before it hands over. Ten times
    // a 25 mm joint is 250 mm, so scrolling out twice from a part would leave the level
    // while the article was still half off the frame; 2.2 times the stage radius puts the
    // handover exactly where the cell fills the view, which is where the cell level starts.
    c.maxDistance = Math.max(r * 10, depthR * 2.2);
  }

  let transition = null;          // { kind: 'dive'|'tour', from, to, t, seconds, d0, d1, ... }
  // SHORTEST-PATH AZIMUTH for every eased move (operator, round 9): the idle
  // turntable winds cam.azimuth without bound, and a transition built on raw
  // values replays every accumulated turn — the 'furious spin' on a level
  // switch. Every builder routes its az1 through this.
  const nearAz = (to) => {
    let d = (to - cam.azimuth) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return cam.azimuth + d;
  };
  let dirty = true;
  let lastInteract = -1e9;
  let disposed = false;
  /** A DIVE may rewrite fades, suppress clipping, relax partAlpha and switch the label
   * source. A TOUR hop is the same eased camera interpolation with from === to, and must
   * do none of those — with from === to the second fade assignment wins and the whole
   * article would dissolve and reappear on every hop between parts. */
  const diving = () => !!transition && transition.kind === 'dive';

  /** Where the camera should sit for a level, or for the stop it enters that level at. */
  function framing(idx) {
    const lv = LEVELS[idx];
    const stop = tourOf(idx) ? tourOf(idx).stops[0] : null;
    // A level may pin its own depth range: the grid orbits a 12 m patch but keeps the
    // whole faint ship inside the clip planes — radius is the orbit, depthR the world.
    const depthR = lv.depthR || (isStage(idx) ? LEVELS[STAGE_LEVEL].radius : lv.radius);
    if (!stop) {
      return { r: lv.radius, depthR, d: lv.radius * (lv.dist || 2.05),
               tg: (lv.target || [0, 0, 0]).slice(), az: lv.az, el: lv.el };
    }
    // THE WHOLE ARTICLE STAYS IN FRAME while the subject is centred. A stop used to supply
    // its own small radius and the camera flew right down onto the part, which answers "what
    // does this look like" and destroys "where does it sit". The designer asked for both at
    // once — "keep the entire cell in screen but center the thing in focus and rotate around
    // it and fade out the other stuff" — so the orbit TARGET is the subject and the orbit
    // RADIUS is whatever it takes to still contain the cell from there: its own radius plus
    // however far off-centre the subject is. The focusing is then done entirely by the dim,
    // which is the one mechanism that can single a part out without hiding its context.
    const cellR = LEVELS[STAGE_LEVEL].radius;
    const c = LEVELS[STAGE_LEVEL].target || [0, 0, 0];
    const off = Math.hypot(stop.target[0] - c[0], stop.target[1] - c[1], stop.target[2] - c[2]);
    const r = cellR + off;
    // Never closer than the cell level frames the cell from. A stop's own dist is a hint;
    // r * 2.05 put the camera at roughly half the cell level's 0.42 x 3.9, which reads as a
    // zoom into the part and loses exactly the context this framing exists to keep.
    const cellLv = LEVELS[STAGE_LEVEL];
    const dFloor = cellLv.radius * (cellLv.dist || 2.05);
    return { r, depthR, d: Math.max(r * (stop.dist || 2.05), dFloor),
             tg: stop.target.slice(), az: stop.az, el: stop.el };
  }

  function setLevel(idx, immediate = false) {
    if (typeof exitFlight === 'function' && flight && flight.on) exitFlight();
    if (typeof cancelGuidance === 'function') cancelGuidance();
    idx = clamp(idx, 0, LEVELS.length - 1);
    if (idx === state.levelIdx && !immediate) return;
    const from = state.levelIdx;
    state.levelIdx = idx;
    const lv = LEVELS[idx];
    state.cut = lv.defaultCut || 0;
    if (lv.id !== 'track') { state.unfoldTo = 0; }
    // Every level with a tour is entered at stop 0, with THAT stop's framing — the level's
    // own radius and target are only the fallback for a level that has no stops.
    const tr = tourOf(idx);
    state.tourIdx = 0;
    state.tourStop = tr ? tr.stops[0].key : null;
    const f = framing(idx);
    if (immediate || state.reduced) {
      for (const b of built) { b.fade = 0; b.claim = 0; }
      built[idx].fade = 1;
      built[idx].claim = 1;
      applyRadius(cam, f.r, f.depthR);
      cam.distance = f.d;
      cam.target = f.tg;
      cam.azimuth = f.az; cam.elevation = f.el;
      transition = null;
    } else {
      transition = {
        kind: 'dive', from, to: idx, t: 0, seconds: 1.25,
        d0: cam.distance, d1: f.d,
        r0: cam.radius, r1: f.r, dr0: cam.radius, dr1: f.depthR,
        tg0: cam.target.slice(), tg1: f.tg,
        az0: cam.azimuth, az1: nearAz(f.az), el0: cam.elevation, el1: f.el,
      };
    }
    // The dim follows the level, not the hop: entering a tour level dims at once, leaving
    // one puts every tint back to 1 or the cell stays grey on the level that owns it.
    tourFrom = tourTo = tr ? tr.stops[0].subject : null;
    // A tour owns the dim on the levels that have one. On the levels that do not — the cell
    // itself, and the two outside the stage — the GROUP owns it, so re-apply it rather than
    // clearing: the reading you were looking at has to survive a walk up to the array and
    // back. Off the stage there is nothing of the cell on screen, so it costs a no-op walk.
    if (tr) applyTour(1);
    else if (isStage(idx) && state.group && state.group !== 'all') applyGroup(state.group);
    else clearTour();
    if (onLevelChange) onLevelChange(idx, LEVELS[idx]);
    if (opts.onPart) opts.onPart(lv.id, tr ? tr.stops[0] : null, 0);
    dirty = true;
  }

  /** Retarget the orbit onto another stop of the current level's tour. Mirrors setLevel:
   * per-stop target, radius and distance, snapping under reduced motion — `?still=1` sets
   * that, and a probe that clicks the button, reads "arrived" and screenshots a camera
   * still on its way is a gate asserting green over a broken page. */
  function setPart(i, immediate = false) {
    const tr = tourOf(state.levelIdx);
    if (!tr) return null;
    const n = tr.stops.length;
    const idx = ((i % n) + n) % n;
    tourFrom = tr.stops[clamp(state.tourIdx, 0, n - 1)].subject;
    state.tourIdx = idx;
    const stop = tr.stops[idx];
    state.tourStop = stop.key;
    tourTo = stop.subject;
    const depthR = isStage(state.levelIdx) ? LEVELS[STAGE_LEVEL].radius : stop.radius;
    const dTo = stop.radius * (stop.dist || 2.05);
    if (immediate || state.reduced) {
      applyRadius(cam, stop.radius, depthR);
      cam.distance = dTo;
      cam.target = stop.target.slice();
      cam.azimuth = stop.az; cam.elevation = stop.el;
      transition = null;
      tourFrom = tourTo;
      applyTour(1);
    } else {
      transition = {
        kind: 'tour', from: state.levelIdx, to: state.levelIdx, t: 0, seconds: 1.0,
        d0: cam.distance, d1: dTo,
        r0: cam.radius, r1: stop.radius, dr0: cam.radius, dr1: depthR,
        tg0: cam.target.slice(), tg1: stop.target.slice(),
        az0: cam.azimuth, az1: nearAz(stop.az), el0: cam.elevation, el1: stop.el,
      };
    }
    if (opts.onPart) opts.onPart(LEVELS[state.levelIdx].id, stop, idx);
    dirty = true;
    return stop;
  }

  /* -- the dim: per-instance tint RGB, enumerated by walking the stage -- */
  // RGB, never alpha. Every cell family is an opaque surface, so collect() files it under
  // `solids` with blending disabled and the shader discards `uOpacity * vTint.a` — a probe
  // reading the tint array back would report a perfectly dimmed scene that never dimmed.
  // (The array level gets away with alpha 5.0 only because its cells are glass at 0.035.)
  const TOUR_DIM = 0.28;          // how far a non-subject instance is pulled toward black
  const TOUR_SKIN_DIM = 0.42;     // lines and glass: those DO blend, so scale their opacity
  let tourFrom = null, tourTo = null;   // subject key sets, so the highlight can travel
  function applyTour(blend) {
    const cell = built[STAGE_LEVEL];
    walk(cell.root, (n) => {
      if (!n.inst) return true;
      const t = n.inst.tint;
      for (let i = 0; i < n.inst.count; i++) {
        const k = `${n.id}#${i}`;
        const w = lerp(tourFrom && tourFrom.has(k) ? 1 : 0,
          tourTo && tourTo.has(k) ? 1 : 0, blend);
        const v = lerp(TOUR_DIM, 1, w);
        t[i * 4] = v; t[i * 4 + 1] = v; t[i * 4 + 2] = v;   // alpha is left alone
      }
      n.inst.dirty = true;
      return true;
    });
    cell.tourDim = TOUR_SKIN_DIM;
    // The film is the one thing the skin level is about, so its own tour leaves it lit
    // while everything else dims. Every other tour dims it to see the structure through it.
    const tr = tourOf(state.levelIdx);
    cell.tourSkinDim = tr && tr.skinLit ? 1 : TOUR_SKIN_DIM;
    dirty = true;
  }
  function clearTour() {
    const cell = built[STAGE_LEVEL];
    walk(cell.root, (n) => {
      if (!n.inst) return true;
      n.inst.tint.fill(1);
      n.inst.dirty = true;
      return true;
    });
    cell.tourDim = 1;
    cell.tourSkinDim = 1;
    dirty = true;
  }

  /** Light one structural reading of the article and dim the rest.
   *
   * The same per-instance tint the tour uses, driven by a question instead of a stop.
   * Every one of these is a real partition of the 216 members, and two of them are the
   * project's own history: the SPOKES and the TIES were both added after a load path was
   * found missing, so "secondary" is not a grade, it is what the first cut forgot.
   *   internal / external  interior lattice + its binding, against everything lying in a face
   *   primary / secondary  sized against a real load, against added to brace what that missed
   *   long / short         the two cut lengths, 251 mm and 177 mm
   *   centre               the twelve that reach u = (0,0,0), the only 60-degree joint
   *
   * A local function rather than only an api method because setLevel re-applies it: the
   * group is a property of the article, not of the click, so walking up to the array and
   * back must not silently drop the reading you were looking at.
   */
  function applyGroup(name) {
    const KINDS = {
      internal: ['octet', 'tie'], external: ['rim', 'spoke'],
      primary: ['octet', 'rim'], secondary: ['spoke', 'tie'],
      long: ['octet', 'rim', 'spoke'], short: ['tie'],
    };
    state.group = name;
    if (name === 'all' || (!KINDS[name] && name !== 'centre')) {
      state.group = 'all';
      clearTour();
      return 'all';
    }
    const recs = built[STAGE_LEVEL].members || [];
    // The centre node's key is uKey([0,0,0]) — the same string the builder files members
    // under, so this asks the record rather than re-deriving a position.
    const CENTRE = '0,0,0';
    const keys = new Set();
    for (const m of recs) {
      const hit = name === 'centre'
        ? m.keys.includes(CENTRE)
        : KINDS[name].includes(m.kind);
      if (hit) for (const [id, i] of m.inst) keys.add(`${id}#${i}`);
    }
    // "Into the centre" is about a JOINT, so light the joint as well as the twelve members
    // that reach it — twelve lit tubes converging on a dimmed hub reads as a gap, which is
    // the opposite of the point. The kind-based readings have no joint of their own: every
    // node touches several kinds, so lighting their endpoints would light nearly all 51.
    if (name === 'centre') {
      for (const p of (built[STAGE_LEVEL].parts || [])) {
        if (p.key === CENTRE) for (const [id, i] of p.inst) keys.add(`${id}#${i}`);
      }
    }
    tourFrom = keys;
    tourTo = keys;
    applyTour(1);
    return name;
  }

  /* -- style resolution: fades, cuts, custom materials -- */
  const SKIN_SOLID = { kind: 'surface', color: '#5f6878', spec: 0.26, opacity: 1 };
  const SKIN_GLASS = { kind: 'glass', color: '#8fb6dc', opacity: 0.46 };
  // Lines and glass are what per-instance tint cannot reach, and they are exactly the
  // non-instanced nodes in the cell: the skin, its seams, the pipe ghosts. Opacity
  // genuinely blends there, so the tour dims those by scaling it instead — and the film
  // carries its own factor, because the level about the film must not dim it.
  const dimOf = (nn) => {
    if (nn.inst) return 1;
    const b = nn._fadeRoot;
    if (!b) return 1;
    const uf = b.unfoldDim === undefined ? 1 : b.unfoldDim;
    return ((nn.skinPart ? b.tourSkinDim : b.tourDim) || 1) * uf;
  };
  const SHIP_LAYER = { ShipFilm: 'wall',
                       ShipRings: 'skeleton', ShipBars: 'skeleton',
                       ShipLongs: 'skeleton', ShipInnerRings: 'skeleton',
                       ShipWebs: 'webs', ShipTheta: 'webs', ShipJunction: 'webs',
                       ShipSpokes: 'spokes' };
  const VESSEL_LAYER = { VesselWrap: 'wall', VesselSolar: 'wall',
                         VesselPylons: 'pods', VesselPods: 'pods',
                         VesselRotors: 'pods',
                         VesselModule: 'module', VesselTankWater: 'module',
                         VesselTanksN2: 'module', VesselBucket: 'module',
                         VesselPump: 'module', VesselSprayer: 'module',
                         VesselRecvBay: 'module', VesselBatteryBox: 'module',
                         VesselCryoBox: 'module', VesselShipMind: 'module',
                         VesselPulleys: 'module', VesselPumpPipe: 'module',
                         VesselStraps: 'lines', VesselLines: 'lines',
                         VesselLinesWater: 'lines',
                         VesselEnvGround: 'env', VesselEnvGrid: 'env',
                         VesselEnvLake: 'env', VesselEnvLakeF1: 'env',
                         VesselEnvLakeF2: 'env', VesselEnvLakeF3: 'env',
                         VesselEnvShore: 'env', VesselEnvTrees: 'env',
                         VesselEnvPeople: 'env', VesselEnvHeads: 'env' };
  const styleFor = (n) => {
    // THE CONNECTOR LEVEL HIDES THE SKIN (operator, 08-13): its tour parks the
    // camera at a joint INSIDE the article, and a solid shell around that is a
    // wall, not a reading. The skin button keeps its state for every other level.
    if (n.skinPart && LEVELS[state.levelIdx].id === 'strut') return { hidden: true };
    // Once the skin is unfolding, the cell it came off is not the subject any more.
    // Its own membrane is replaced by the net; the rest goes with it.
    const fr = n._fadeRoot;
    // SHIP LAYERS: scoped by the build that owns the node, like the unfold — a leaked
    // layer state must never blank another level's geometry.
    if (fr && fr.level && fr.level.id === 'ship') {
      const lay = SHIP_LAYER[n.id];
      if (lay && !state.shipLayers[lay]) return { hidden: true };
    }
    if (fr && fr.level && fr.level.id === 'vessel') {
      const lay = VESSEL_LAYER[n.id];
      if (lay && !state.shipLayers[lay]) return { hidden: true };
    }
    // ...but only on the level that owns the net. The stage cell is shared with the
    // connector and tube tours, and a leaked unfold state blanked both of them.
    const onTrack = LEVELS[state.levelIdx].id === 'track';
    if (onTrack && fr && fr.unfoldHideSkin
        && n.id !== 'FlatSkin' && n.id !== 'FlatSkinCuts') {
      if (n.skinPart) {
        // Glass genuinely blends, so the cell's own membrane can fade out properly instead of
        // disappearing the instant the net starts opening.
        if (fr.unfoldDim <= 0.004) return { hidden: true };
        return { material: { ...SKIN_GLASS, opacity: SKIN_GLASS.opacity * fr.unfoldDim } };
      }
      if (fr.unfoldGone) return { hidden: true };
    }
    // MID-ASSEMBLY THE SKIN HAS NOTHING TO DRAPE ON. While the cell is animating itself
    // together the membrane and its seams hide — a sealed film floating over a pile of
    // parts is a lie about the build order, the film goes on LAST — and come back the
    // frame the article is whole. Scoped to the cell level like every other mode.
    if (n.skinPart && state.assemble < 0.999
        && LEVELS[state.levelIdx].id === 'cell') return { hidden: true };
    // THE PRINT-RESOLUTION SWAP, scoped to the level that owns it (a leaked flag has
    // blanked two tours before). While the connector tour is framing a family, that
    // family's representative joint is drawn as the printed part — open sockets, bores,
    // ribs — and its display mesh steps aside. Everywhere else the five rep nodes are
    // hidden and the fifty-one display meshes carry the article. Never mid-dive: the
    // swap under a moving camera reads as the joint popping.
    const repShowing = LEVELS[state.levelIdx].id === 'strut' && !diving();
    if (n.repFam && !(repShowing && state.tourStop === n.repFam)) return { hidden: true };
    if (n.dispRepOf && repShowing && state.tourStop === n.dispRepOf) return { hidden: true };
    if (n.skinPart) {
      if (state.skinMode === 'off') return { hidden: true };
      // The slack film and the loaded film are two nodes over one article; the pump-down
      // state picks which one is on stage. Keyed by id: other levels have their own
      // skinPart surfaces (the flat net, the array cells) the pump must not touch.
      if (n.id === 'CellSkinLoaded' && state.skinLoad <= 0.004) return { hidden: true };
      if (n.id === 'CellSkin' && state.skinLoad > 0.004) return { hidden: true };
      if (n.skinPart === 'surface') {
        const b0 = n._fadeRoot;
        let f0 = b0 ? b0.fade : 1;
        if (f0 <= 0.004) return { hidden: true };
        // A tour looks INSIDE the article — at a joint, at a cut, at the frame under a
        // panel — and a solid skin is an opaque box around all of it. Demote the surface
        // to glass while a tour is running rather than mutating the viewer's skin setting
        // behind their back; the button still says what it does. The skin level keeps its
        // film at full opacity through dimOf, which is a different lever.
        const touring = !!tourOf(state.levelIdx);
        return { opacity: f0 * dimOf(n),
                 material: (state.skinMode === 'solid' && !touring) ? SKIN_SOLID : SKIN_GLASS };
      }
    }
    // PARTS view: the article's two build families, shown one at a time. Never mid-dive —
    // the cell<->strut handoff rides on the hero strut, which is a pipe, so hiding the
    // pipe family during a transition would delete the member the dive is following. Same
    // reason clips() refuses to cut mid-dive.
    let partAlpha = 1;
    if (n.partFamily) {
      const g = diving()
        ? smoothstep(clamp(transition.t * 3, 0, 1)) *
          smoothstep(clamp((1 - transition.t) * 3, 0, 1))
        : 0;
      partAlpha = n.partFamily === 'ghost'
        ? (state.partsMode === 'joinery' ? 1 - g : 0)
        : (((state.partsMode === 'joinery' && n.partFamily === 'pipe') ||
            (state.partsMode === 'pipes' && n.partFamily === 'printed')) ? g : 1);
      if (partAlpha <= 0.004) return { hidden: true };
    }
    const b = n._fadeRoot;
    const f = b ? b.fade : 1;
    if (f <= 0.004) return { hidden: true };
    const mat = n.xmat || null;
    const st = { opacity: f * partAlpha * dimOf(n) };
    if (mat) st.material = mat.kind === 'glass' ? mat : { ...mat };
    return st;
  };

  function clips() {
    // No cutting mid-DIVE: a cut plane sized for the incoming level slices the outgoing
    // one. A tour hop is not a dive — the article is not moving and the cutaway must not
    // blink off under the joint the viewer is inspecting.
    if (diving()) return null;
    if (!state.cut) return null;
    const lv = LEVELS[state.levelIdx];
    // The track level owns the unfold instead of a cut; every other level cuts — the
    // SHIP included, where the cutaway is how you see the skeleton through the wall.
    if (lv.id === 'track') return null;
    // A stage level frames a 25 mm joint but the thing being cut is the whole 709 mm
    // article, and it sits at CELL_CENTRE, not the origin. Cut about the stage's own
    // radius and centre or the plane lands inside a node and the level slices itself away.
    const st = isStage(state.levelIdx) ? LEVELS[STAGE_LEVEL] : lv;
    const cx = (st.target || [0, 0, 0])[0];
    return [[-1, 0, 0, cx + state.cut * st.radius * 0.9]];
  }

  /* -- breach handling (array level) -- */
  function applyBreach() {
    const arr = built[LEVELS.findIndex(l => l.id === 'array')];
    if (!arr.cellsNode) return;
    const tint = arr.cellsNode.inst.tint;
    const centres = arr.centres;
    const warm = [1.0, 0.42, 0.31, 1.9];          // hazard, brighter
    const near = [0.95, 0.72, 0.35, 1.5];         // neighbours carrying L=2
    for (let i = 0; i < centres.length; i++) {
      // The wrapped cell keeps its skin highlight through reseals.
      tint.set(i === arr.openIdx ? [1, 1, 1, 5.0] : [1, 1, 1, 1], i * 4);
    }
    for (const id of state.breached) {
      const i = +id.split('_')[1];
      tint.set(warm, i * 4);
      for (let j = 0; j < centres.length; j++) {
        if (j === i) continue;
        const a = centres[i].p, b = centres[j].p;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d < arr.span * 1.05 && !state.breached.has(`Cell_${j}`)) {
          const cur = tint.subarray(j * 4, j * 4 + 4);
          if (cur[3] <= 1.01) tint.set(near, j * 4);
        }
      }
    }
    arr.cellsNode.inst.dirty = true;
    dirty = true;
  }

  /* -- frame loop -- */
  const sceneBox = { w: 1, h: 1, dpr: 1 };
  /* FIT BY WIDTH ON A TALL SCREEN (operator, 08-14). Every framing in this file — the
   * levels' distances, the views, the tours, the hero's pose — was chosen against a
   * landscape window, and the projection's fov is VERTICAL. On a phone held upright
   * the aspect falls to about 0.46, so the horizontal field collapses with it and a
   * ship framed to fill a laptop overflows both edges: the reader's first sight of
   * the viewer is a wall of hull with no way to know what it is. Below a reference
   * aspect the vertical fov therefore widens to hold the HORIZONTAL field constant,
   * which is what "fit the subject" means on a portrait screen. REF sits just under
   * the front page's own hero aspect (860 x 713 = 1.206) so that framing — measured
   * and verified — is not touched, and every window wider than the reference keeps
   * the fov it always had. */
  const REF_ASPECT = 1.2;
  let baseFov = cam.fovDeg;
  function fitFov() {
    const aspect = sceneBox.w / sceneBox.h;
    const widen = Math.max(1, REF_ASPECT / Math.max(aspect, 0.05));
    cam.fovDeg = 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) * widen) * 180 / Math.PI;
  }
  function measure() {
    const r = canvas.getBoundingClientRect();
    sceneBox.w = Math.max(1, r.width);
    sceneBox.h = Math.max(1, r.height);
    sceneBox.dpr = window.devicePixelRatio || 1;
    fitFov();
  }
  measure();
  const ro = new ResizeObserver(() => { measure(); dirty = true; });
  ro.observe(canvas);

  let lastT = performance.now();

  /** Advance any running move; returns true if the camera or fades changed. */
  function advance(dt) {
    stepUnfold(dt);
    stepSkinLoad(dt);
    stepAssemble(dt);
    if (flightStep(dt)) dirty = true;
    // A WALK tour advances its level's stops on a dwell timer once each hop's
    // ease has landed; the stop machinery does everything else.
    if (state.autoWalk && !transition) {
      state.autoWalk.acc += dt;
      dirty = true;
      if (state.autoWalk.acc >= state.autoWalk.dwell) {
        state.autoWalk.acc = 0;
        state.autoWalk.visited += 1;
        const wt = tourOf(state.levelIdx);
        if (!wt || state.autoWalk.visited >= wt.stops.length) {
          const k = state.autoWalk.key;
          state.autoWalk = null;
          restoreLevelPose();
          spinHold = performance.now() + 6000;
          if (opts.onTourEnd) opts.onTourEnd(k);
        } else {
          setPart(state.tourIdx + 1);
        }
      }
    }
    if (!transition) return false;
    transition.t = Math.min(1, transition.t + dt / transition.seconds);
    const k = easeInOut(transition.t);
    cam.distance = transition.d0 * Math.pow(transition.d1 / transition.d0, k);
    applyRadius(cam, transition.r0 * Math.pow(transition.r1 / transition.r0, k),
      transition.dr0 * Math.pow(transition.dr1 / transition.dr0, k));
    cam.target = lerp3(transition.tg0, transition.tg1, k);
    cam.azimuth = lerp(transition.az0, transition.az1, k);
    cam.elevation = lerp(transition.el0, transition.el1, k);
    if (transition.kind === 'dive') {
      const fOut = 1 - smoothstep(Math.min(1, transition.t * 1.7));
      const fIn = smoothstep(clamp((transition.t - 0.22) / 0.78, 0, 1));
      for (const b of built) b.fade = 0;
      built[transition.from].fade = fOut;
      built[transition.to].fade = fIn;
      for (const b of built) b.claim = b.fade;
      // DIVING BETWEEN THE ARRAY AND THE CELL, the array clears down to its hero cell first.
      // The level below is a DIFFERENT article — a 0.709 m demonstrator against 2 m flight
      // cells — so this can never be a literal continuous zoom, and pretending otherwise would
      // be a lie about what the two levels are. What it can honestly do is single out the one
      // cell being flown into: every other cell fades ahead of the level cross-fade, so the
      // article arrives where a cell was rather than cutting to a fresh scene.
      const arrIdx = LEVELS.findIndex(l => l.id === 'array');
      const cellIdx = STAGE_LEVEL;
      const pair = (transition.from === arrIdx && transition.to === cellIdx)
        || (transition.from === cellIdx && transition.to === arrIdx);
      const arr = built[arrIdx];
      if (pair && arr.cellsNode && arr.cellsNode.inst) {
        // ahead of the cross-fade going down, behind it coming back up
        const clear = transition.from === arrIdx
          ? smoothstep(Math.min(1, transition.t * 2.2))
          : 1 - smoothstep(clamp((transition.t - 0.3) / 0.7, 0, 1));
        const tn = arr.cellsNode.inst.tint;
        for (let i = 0; i < arr.cellsNode.inst.count; i++) {
          const hero = i === arr.openIdx || i === arr.farIdx;
          const v = hero ? 1 : 1 - clear;
          tn[i * 4] = v; tn[i * 4 + 1] = v; tn[i * 4 + 2] = v;
          tn[i * 4 + 3] = hero ? 5.0 : (1 - clear) * 5.0;
        }
        arr.cellsNode.inst.dirty = true;
        arr.heroOnly = clear;
      }
    } else {
      // A hop between two parts of one level. NO fade rewrite: from === to, so the second
      // assignment would win and drive the whole article 0 -> 1 on every click. The
      // highlight travels with the camera instead.
      applyTour(k);
    }
    if (transition.t >= 1) {
      const wasTour = transition.kind === 'tour';
      const landed = transition.to;
      transition = null;
      if (wasTour) { tourFrom = tourTo; applyTour(1); }
      // The next queued leg of whatever path tour is running — generalized
      // off the hull level (round 8): every level may fly its own paths now.
      if (state.flyQueue && state.flyQueue.length) {
        const leg = state.flyQueue.shift();
        const lv = LEVELS[state.levelIdx];
        transition = {
          kind: 'view', from: state.levelIdx, to: state.levelIdx, t: 0,
          seconds: leg.s,
          d0: cam.distance, d1: leg.d,
          r0: cam.radius, r1: lv.radius,
          dr0: lv.depthR || lv.radius, dr1: lv.depthR || lv.radius,
          tg0: cam.target.slice(), tg1: (leg.tg || cam.target).slice(),
          az0: cam.azimuth, az1: nearAz(leg.az), el0: cam.elevation, el1: leg.el,
        };
      } else if (state.flyQueue && !state.flyQueue.length) {
        state.flyQueue = null;
        const k = state.tourKey;
        state.tourKey = null;
        // Ease back to the level's own framing, and give the viewer a beat
        // before the turntable starts again (operator, round 9).
        restoreLevelPose();
        spinHold = performance.now() + 6000;
        if (k && opts.onTourEnd) opts.onTourEnd(k);
      }
      // Put the array back if we came to rest on it by any route. The clear-down above only
      // reverses itself on the return dive from the cell; arriving from the rail or from the
      // bay above would otherwise show a field of cells that had been faded out and never
      // restored.
      if (landed === LEVELS.findIndex(l => l.id === 'array')) {
        const arr = built[landed];
        if (arr.cellsNode && arr.cellsNode.inst) {
          const tn = arr.cellsNode.inst.tint;
          for (let i = 0; i < arr.cellsNode.inst.count; i++) {
            tn[i * 4] = 1; tn[i * 4 + 1] = 1; tn[i * 4 + 2] = 1;
            tn[i * 4 + 3] = (i === arr.openIdx || i === arr.farIdx) ? 5.0 : 1;
          }
          arr.cellsNode.inst.dirty = true;
          arr.heroOnly = 0;
        }
      }
    }
    return true;
  }

  /* The stage's fade is the strongest claim any stage level makes — except between two
   * stage levels, where it holds at 1 and the dive stops being a cross-fade at all: the
   * article stands still and only the camera moves. Each level's own claim is kept beside
   * its fade so this can be recomputed from scratch every frame rather than read back out
   * of the value it is about to overwrite. */
  function syncStage() {
    const cell = built[STAGE_LEVEL];
    if (transition && transition.kind === 'dive' &&
        isStage(transition.from) && isStage(transition.to)) {
      cell.fade = 1;
      return;
    }
    let f = 0;
    for (const i of stageIdx) f = Math.max(f, built[i].claim);
    cell.fade = f;
  }

  /** Ease the assembly toward its target, scoped HARD to the cell level. The stage cell
   *  is one scene graph shared by the connector, tube and skin levels — a leaked mode has
   *  blanked two tours before — so leaving the cell level snaps every part back to seated
   *  before anything else can frame a half-built article. Seated restore is a byte copy
   *  of the matrices the cell was built with; at assemble = 1 the animation is
   *  indistinguishable from never having existed. */
  const ASSEMBLE_SECONDS = 24;
  const GUIDE_PART_SECONDS = 2.4;      // one part's whole motion at 1x; speeds scale it
  function stepAssemble(dt) {
    const cell = built[STAGE_LEVEL];
    if (!cell.assembly) return;
    if (LEVELS[state.levelIdx].id !== 'cell') {
      if (state.assemble !== 1 || state.assembleTo !== 1 || state.assembleGuide
          || state.assembleLoop) {
        state.assemble = 1; state.assembleTo = 1; state.assembleGuide = null;
        state.assembleLoop = null;
        cell.assembly.apply(1);
        applyGroup(state.group);           // the group owns the tints when whole
        dirty = true;
      }
      return;
    }
    // GUIDE MODE: ease exactly one part's alpha; everything else is pinned by apply().
    const g = state.assembleGuide;
    if (g) {
      if (Math.abs(g.to - g.alpha) < 1e-4) return;
      g.alpha += Math.sign(g.to - g.alpha) * Math.min(Math.abs(g.to - g.alpha),
        (dt / GUIDE_PART_SECONDS) * (state.assembleSpeed || 1));
      if (Math.abs(g.to - g.alpha) < 1e-4) {
        g.alpha = g.to;
        if (g.to === 0) {                  // flew a part back out: park on the previous
          g.idx -= 1; g.alpha = 1; g.to = 1;
        }
        const ws = cell.assembly.windows;
        state.assemble = state.assembleTo =
          g.idx >= 0 ? Math.min(1, ws[g.idx].t1) : 0;
      }
      cell.assembly.apply(0, g);
      dirty = true;
      return;
    }
    const d = state.assembleTo - state.assemble;
    if (Math.abs(d) < 1e-4) {
      // A loop takes a breath at each end — a hard cut from finished to pile reads as a
      // glitch, a beat of stillness reads as a cycle.
      if (!state.assembleLoop) return;
      if (state.assembleHold > 0) { state.assembleHold -= dt; return; }
      if (state.assembleLoop === 'loop' && state.assemble >= 1) {
        state.assemble = 0; state.assembleTo = 1;
        cell.assembly.apply(0);
        dirty = true;
      } else if (state.assembleLoop === 'bounce') {
        state.assembleTo = state.assemble >= 0.5 ? 0 : 1;
        dirty = true;
      }
      return;
    }
    state.assemble += Math.sign(d) * Math.min(
      Math.abs(d), (dt / ASSEMBLE_SECONDS) * (state.assembleSpeed || 1));
    state.assemble = clamp(state.assemble, 0, 1);
    cell.assembly.apply(state.assemble);
    if (state.assembleLoop && (state.assemble >= 1 || state.assemble <= 0)) {
      state.assembleHold = 0.8;          // arrival owns the end-of-cycle breath
    }
    if (state.assemble >= 1 && !state.assembleLoop) applyGroup(state.group);
    dirty = true;
  }

  /** Ease the film between slack and its solved loaded shape, rebuilding geometry only
   *  while the pump actually moves — the unfold's own pattern. */
  function stepSkinLoad(dt) {
    if (!LOADED_SKIN) return;
    const d = state.skinLoadTo - state.skinLoad;
    if (!d && LOADED_SKIN.at === state.skinLoad) return;
    if (d) {
      state.skinLoad += Math.sign(d) * Math.min(Math.abs(d), dt / 1.2);
      state.skinLoad = clamp(state.skinLoad, 0, 1);
    }
    if (LOADED_SKIN.at !== state.skinLoad) {
      const f = easeInOut(state.skinLoad);
      const { flat, full, index, nodeRef } = LOADED_SKIN;
      const cur = new Float32Array(flat.length);
      for (let i = 0; i < flat.length; i++) cur[i] = flat[i] + f * (full[i] - flat[i]);
      nodeRef.geom = G.solid(cur, index);
      LOADED_SKIN.at = state.skinLoad;
      dirty = true;
    }
  }

  /** Ease the net open or shut, rebuilding its geometry only while it actually moves.
   *  Fourteen faces is nothing to rebuild; doing it every frame regardless is still waste. */
  function stepUnfold(dt) {
    const lv = built[LEVELS.findIndex(l => l.id === 'track')];
    const g = lv && lv.root && lv.root.net;
    if (!g) return;
    const d = state.unfoldTo - state.unfold;
    if (Math.abs(d) < 1e-4) return;
    state.unfold += Math.sign(d) * Math.min(Math.abs(d), dt / 1.6);
    state.unfold = clamp(state.unfold, 0, 1);
    const u = easeInOut(state.unfold);
    // The net replaces the cell's own skin rather than sitting beside it, and the frame
    // inside fades over the first third so the film is alone before it opens.
    const cell = built[STAGE_LEVEL];
    // TURN THE SHEET TO FACE THE VIEWER as it opens. The net lands in the root face's plane,
    // which the cell group's rotation leaves nearly edge-on — a flat sheet seen edge-on is
    // invisible, so the animation ran correctly and looked like nothing was happening.
    // The sheet ends unrotated, so its plane is the root face's — normal along -X. Rather
    // than guess euler angles to point that at the camera, TURN THE CAMERA to look square down
    // it, and pull back far enough to hold the whole pattern. Eased on the same u, so folding
    // back returns the view to the cell.
    const R0 = [-Math.PI / 4, 0, -Math.PI / 2];
    g.sheet.r = R0.map(v => v * (1 - u));
    g.cuts.r = g.sheet.r.slice();
    if (u > 0.001) {
      const from = state.unfoldFrom || { d: cam.distance, az: cam.azimuth, el: cam.elevation };
      // The sheet's plane is the root face's — normal along -X — so the camera must sit ON the
      // X axis to see it square. With the camera at (cos e sin a, sin e, cos e cos a) that is
      // a = -PI/2, e = 0. PI put it back in the plane and the net rendered as slivers.
      cam.azimuth = lerp(from.az, -Math.PI / 2, u);
      cam.elevation = lerp(from.el, 0, u);
      // the net is about four hexagon-widths across against a cell radius of one
      // cam.RADIUS is the model's bounding radius and only sets the clamps; cam.DISTANCE is
      // what the camera actually sits at. Writing radius alone changed nothing on screen.
      // The net is about 2 m across against a 0.42 m cell, so it needs roughly 3x the reach.
      const lv0 = LEVELS[state.levelIdx];
      const dCell = lv0.radius * (lv0.dist || 2.05);
      // The clamp has to move FIRST or it silently caps the distance below the target and the
      // pull-back does nothing — which is what 3x looked like.
      cam.maxDistance = Math.max(cam.maxDistance, dCell * 12);
      cam.distance = lerp(from.d, dCell * 6.0, u);
    }
    // Fade the frame across the WHOLE motion rather than the first third — at 3x it was
    // gone before the panels had visibly moved, so the fold read as a cut to another scene.
    cell.unfoldDim = clamp(1 - u, 0, 1);
    cell.unfoldHideSkin = state.unfold > 0.005;
    cell.unfoldGone = u > 0.995;
    // THE FRAME HAS TO FADE THROUGH ITS TINT, not through dimOf. Every tube and joint is
    // INSTANCED, and dimOf returns 1 for instanced nodes because per-instance shading lives in
    // the tint buffer — so unfoldDim never reached them and they held full brightness until
    // the hide flicked them out at the end. Same RGB-not-alpha rule as the tour: these are
    // opaque surfaces, the shader discards vTint.a, so a fade written to alpha does nothing.
    walk(cell.root, (n) => {
      if (!n.inst) return true;
      const v = 1 - u;
      const tn = n.inst.tint;
      for (let i = 0; i < n.inst.count; i++) {
        tn[i * 4] = v; tn[i * 4 + 1] = v; tn[i * 4 + 2] = v;
      }
      n.inst.dirty = true;
      return true;
    });
    const ng = netGeom(g.net, u);
    g.sheet.geom = ng.solid;
    g.cuts.geom = G.lines(ng.cutSegs);
    dirty = true;
  }

  function renderBody() {
    syncStage();
    const roots = node({ id: 'World', category: 'vacuum', selectable: false });
    for (const b of built) {
      if (b.fade <= 0.004) continue;
      b.root.parent = null;
      roots.children.push(b.root);
    }
    renderer.render({
      root: roots,
      camera: cam,
      width: sceneBox.w, height: sceneBox.h, dpr: sceneBox.dpr,
      background: TOKENS.bg,
      // A hosting page may ask for a transparent sky (the front-page hero rides
      // over the ridge banner; anywhere no geometry draws, the page shows through).
      transparent: !!opts.transparentSky,
      styleFor,
      clips: clips(),
      lineWidth: 1,
      depthPrepass: null,
    });
    placeLabels();
  }

  function frame(now) {
    if (disposed) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (advance(dt)) dirty = true;
    else if (state.turntable && now - lastInteract > 6000
             && now > spinHold && !state.reduced) {
      cam.azimuth += dt * 0.05;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    renderBody();
  }
  requestAnimationFrame(frame);

  /* -- DOM labels -- */
  const labelEls = new Map();
  function placeLabels() {
    // FLOATING CARDS ARE RETIRED (operator, 08-13): every reading they
    // carried lives in the side panel now — one place to read, nothing
    // drifting over the model. The builders still declare label data; this
    // layer simply never mounts it, so bringing a card back is one revert.
    if (labelEls.size) {
      for (const el of labelEls.values()) el.remove();
      labelEls.clear();
    }
  }
  function projectPoint(view, proj, p) {
    const x = p[0], y = p[1], z = p[2];
    const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
    const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
    const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
    const cx = proj[0] * vx + proj[4] * vy + proj[8] * vz + proj[12];
    const cy = proj[1] * vx + proj[5] * vy + proj[9] * vz + proj[13];
    const cw = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15];
    if (cw <= 1e-6) return null;
    const sx = (cx / cw * 0.5 + 0.5) * sceneBox.w;
    const sy = (1 - (cy / cw * 0.5 + 0.5)) * sceneBox.h;
    if (sx < -80 || sy < -40 || sx > sceneBox.w + 80 || sy > sceneBox.h + 40) return null;
    return [sx, sy];
  }

  /* -- input -- */
  const panCentre = () => {
    const s = stopOf(state.levelIdx);
    if (s) return s.target;
    const lv = LEVELS[state.levelIdx];
    return (lv.target || [0, 0, 0]);
  };
  let drag = null;
  /* TOUCH (operator, 08-14: "I can't move around it at all" on a phone). One finger
   * always orbited — pointer events give a thumb the same path as a mouse — but the
   * DOLLY was wheel-only, and the dolly is also how the ladder dives. So a phone
   * could turn the model and nothing else. Two fingers now do what the wheel does:
   * the pinch RATIO drives the same zoom step, and the pair's midpoint pans. The map
   * is what makes the second finger visible; without it the browser hands a
   * two-finger gesture to whichever pointer moved last and it reads as a wild orbit. */
  const pointers = new Map();
  let pinch = null;
  const pinchOf = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  /* ONE zoom step, whatever drove it — a wheel notch or a pinch ratio. f > 1 pulls
   * out. Kept as one function so the powers-of-ten dive can never be a thing the
   * wheel does and the fingers do not. */
  function zoomBy(f) {
    cancelGuidance();
    lastInteract = performance.now();
    if (flight.on) {
      // In flight the wheel sets SPEED, not distance. Its exponents were -0.0009
      // against the dolly's 0.0011, so the same notch moves speed as f^-0.82.
      flight.speed = clamp(flight.speed * Math.pow(f, -0.82), 0.12, 12);
      if (opts.onFlight) opts.onFlight(true);
      dirty = true;
      return;
    }
    if (transition) return;
    dolly(cam, f);
    // Powers-of-ten: sail past the near threshold and dive a level; out, and rise. Both
    // thresholds ride the CAMERA's clamps, not the level's radius — once a tour frames a
    // 25 mm joint on a level whose own radius is 30 mm, the level's number is not the one
    // the dolly is working against and dive-out becomes unreachable.
    if (cam.distance <= cam.minDistance * 1.02 && f < 1 && state.levelIdx > 0) {
      setLevel(state.levelIdx - 1);
    } else if (cam.distance >= cam.maxDistance * 0.92 && f > 1 &&
               state.levelIdx < LEVELS.length - 1) {
      setLevel(state.levelIdx + 1);
    }
    dirty = true;
  }
  canvas.addEventListener('pointerdown', (e) => {
    cancelGuidance();                         // any hand on the stick ends the tour
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size >= 2) { pinch = pinchOf(); drag = null; }
    else drag = { x: e.clientX, y: e.clientY, moved: false, b: e.button };
    lastInteract = performance.now();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const p = pinchOf();
      // Clamped per move: a finger that jumps (or a second one that lands mid-drag)
      // must not teleport the camera through a level boundary.
      if (p.d > 8 && pinch.d > 8) zoomBy(clamp(pinch.d / p.d, 0.6, 1.7));
      if (!flight.on) pan(cam, p.cx - pinch.cx, p.cy - pinch.cy, sceneBox.h, panCentre());
      pinch = p;
      dirty = true;
      lastInteract = performance.now();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    // Pan clamps the target into a box about a CENTRE, and the centre is the subject, not
    // the world origin: at a stop 0.29 m out with a 25 mm radius the origin's box is 40 mm
    // wide and the first drag-pan throws the part out of frame.
    if (flight.on) {
      // DAMPED look (operator tune): the drag writes a TARGET at reduced
      // sensitivity and flightStep glides the nose onto it — twitch removed,
      // intent kept. flightApply happens in the step, not here.
      flight.yawT -= dx * 0.0016;
      flight.pitchT = clamp(flight.pitchT - dy * 0.0014, -1.5, 1.5);
    } else if (e.shiftKey || drag.b === 2) pan(cam, dx, dy, sceneBox.h, panCentre());
    else orbit(cam, -dx * 0.006, dy * 0.005);
    drag.x = e.clientX; drag.y = e.clientY;
    lastInteract = performance.now();
    dirty = true;
  });
  canvas.addEventListener('pointerup', (e) => {
    const arrIdxPick = LEVELS.findIndex(l => l.id === 'array');
    if (drag && !drag.moved && state.levelIdx === arrIdxPick && !diving()) {
      const r = canvas.getBoundingClientRect();
      const id = renderer.pick({
        root: built[arrIdxPick].root, camera: cam,
        width: sceneBox.w, height: sceneBox.h, dpr: sceneBox.dpr,
        styleFor, clips: clips(),
      }, e.clientX - r.left, e.clientY - r.top);
      if (id && id.startsWith('Cell_')) {
        if (state.breached.has(id)) state.breached.delete(id);
        else state.breached.add(id);
        applyBreach();
        if (opts.onBreach) opts.onBreach(state.breached.size);
      }
    }
    release(e);
  });
  /* A finger lifted out of a pinch leaves the other one down. Re-seed the drag where
   * that finger ACTUALLY is, or the next move jumps the camera by the whole gap
   * between the two. pointercancel matters as much as pointerup on a phone: the
   * browser takes a pointer away for its own gestures and never sends the up. */
  function release(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const p = pointers.values().next().value;
      drag = { x: p.x, y: p.y, moved: true, b: 0 };
    } else if (pointers.size === 0) drag = null;
    lastInteract = performance.now();
  }
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.0011));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* -- FLIGHT: the game-style free camera (operator, 08-13) --------------------
   * Arrow keys / WASD move, the mouse points the nose, and it works at every
   * scale because speed rides the level's own radius. The free camera is
   * REALIZED THROUGH THE ORBIT RIG rather than beside it — az = yaw + pi,
   * el = -pitch, target = pos + dir*L, distance = L — so every consumer of the
   * camera (projection, near/far, styles, screenshots) sees an ordinary orbit
   * pose and nothing needs a second code path. maxDistance is raised BEFORE
   * distance (the documented clamp trap). A dive or an eased view ends the
   * flight; entering the flight ends any tour or fly-path. */
  const flight = { on: false, pos: [0, 0, 0], yaw: 0, pitch: 0,
                   yawT: 0, pitchT: 0,
                   keys: new Set(), boost: false, speed: 1 };
  function flightApply() {
    const cp = Math.cos(flight.pitch);
    const d = [cp * Math.cos(flight.yaw), cp * Math.sin(flight.yaw),
               Math.sin(flight.pitch)];
    // THE NOSE POINT SITS CLOSE (operator, 08-14: "when flying, the point of rotation
    // can be very far away"). Looking around IS eye-centred — yaw and pitch turn about
    // flight.pos and the eye never moves — but the rig's TARGET is this far ahead, and
    // flight ends silently on any dive or named view. The next drag is then an orbit
    // about a point 0.6 radii out, which swings the whole world and is exactly the
    // complaint. At 0.35 radii the pivot is what you are looking at, and the near plane
    // (distance/100) halves with it, which is what flying close needs. It must stay
    // clear of minDistance (0.25 radii) or the first scroll after landing would read as
    // a dive rather than a zoom.
    const L = cam.radius * 0.35;
    cam.maxDistance = Math.max(cam.maxDistance, L);
    cam.distance = L;
    cam.azimuth = flight.yaw + Math.PI;
    cam.elevation = -flight.pitch;
    cam.target = [flight.pos[0] + d[0] * L, flight.pos[1] + d[1] * L,
                  flight.pos[2] + d[2] * L];
  }
  let spinHold = -1e9;            // the turntable waits after a tour ends
  function restoreLevelPose(seconds = 1.8) {
    const lv = LEVELS[state.levelIdx];
    transition = {
      kind: 'view', from: state.levelIdx, to: state.levelIdx, t: 0, seconds,
      d0: cam.distance, d1: lv.radius * (lv.dist || 2.05),
      r0: cam.radius, r1: lv.radius,
      dr0: lv.depthR || lv.radius, dr1: lv.depthR || lv.radius,
      tg0: cam.target.slice(), tg1: (lv.target || [0, 0, 0]).slice(),
      az0: cam.azimuth, az1: nearAz(lv.az), el0: cam.elevation, el1: lv.el,
    };
    dirty = true;
  }
  function cancelGuidance() {
    const k = state.tourKey || (state.autoWalk && state.autoWalk.key) || null;
    state.flyQueue = null;
    state.tourKey = null;
    state.autoWalk = null;
    if (k && opts.onTourEnd) opts.onTourEnd(k);
  }
  function enterFlight() {
    if (flight.on) return;
    cancelGuidance();
    const ce = Math.cos(cam.elevation), se = Math.sin(cam.elevation);
    const eye = [cam.target[0] + cam.distance * ce * Math.cos(cam.azimuth),
                 cam.target[1] + cam.distance * ce * Math.sin(cam.azimuth),
                 cam.target[2] + cam.distance * se];
    const d = [cam.target[0] - eye[0], cam.target[1] - eye[1],
               cam.target[2] - eye[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    flight.pos = eye;
    flight.yaw = Math.atan2(d[1] / dl, d[0] / dl);
    flight.pitch = Math.asin(clamp(d[2] / dl, -1, 1));
    flight.yawT = flight.yaw;
    flight.pitchT = flight.pitch;
    flight.keys.clear();
    flight.speed = 1;
    flight.on = true;
    flightApply();
    dirty = true;
    if (opts.onFlight) opts.onFlight(true);
  }
  function exitFlight() {
    if (!flight.on) return;
    flight.on = false;
    flight.keys.clear();
    // The pose stays where the flight left it — an ordinary orbit about the point just
    // ahead of the nose. "Just ahead" is enforced here as well as in flightApply,
    // because a flight can also end from a path leg or a view that left the distance
    // wherever it liked; the eye is held and only the pivot is pulled in.
    if (cam.distance > cam.radius * 0.35) {
      const ce = Math.cos(cam.elevation), se = Math.sin(cam.elevation);
      const eye = [cam.target[0] + cam.distance * ce * Math.cos(cam.azimuth),
                   cam.target[1] + cam.distance * ce * Math.sin(cam.azimuth),
                   cam.target[2] + cam.distance * se];
      cam.distance = cam.radius * 0.35;
      cam.target = [eye[0] - cam.distance * ce * Math.cos(cam.azimuth),
                    eye[1] - cam.distance * ce * Math.sin(cam.azimuth),
                    eye[2] - cam.distance * se];
    }
    dirty = true;
    if (opts.onFlight) opts.onFlight(false);
  }
  function flightStep(dt) {
    if (!flight.on || transition) return false;
    // Glide the nose onto the drag's target — a first-order lag, ~120 ms to
    // close. Returns "moving" while the glide is live so the frame keeps
    // rendering after the pointer stops.
    const g = 1 - Math.exp(-dt * 9);
    const dYaw = flight.yawT - flight.yaw;
    const dPitch = flight.pitchT - flight.pitch;
    flight.yaw += dYaw * g;
    flight.pitch += dPitch * g;
    const gliding = Math.abs(dYaw) + Math.abs(dPitch) > 1e-4;
    if (flight.keys.size) {
      // Normal is a walk, boost is the old cruise (operator tune, 08-13):
      // 0.55 radii/s read as fast everywhere, so it is now what SHIFT buys.
      const sp = cam.radius * 0.1375 * flight.speed * (flight.boost ? 4 : 1);
      const cp = Math.cos(flight.pitch);
      const f = [cp * Math.cos(flight.yaw), cp * Math.sin(flight.yaw),
                 Math.sin(flight.pitch)];
      const r = [Math.sin(flight.yaw), -Math.cos(flight.yaw), 0];
      const mv = [0, 0, 0];
      const acc = (v, s) => { mv[0] += v[0] * s; mv[1] += v[1] * s; mv[2] += v[2] * s; };
      if (flight.keys.has('fwd')) acc(f, 1);
      if (flight.keys.has('back')) acc(f, -1);
      if (flight.keys.has('right')) acc(r, 1);
      if (flight.keys.has('left')) acc(r, -1);
      if (flight.keys.has('up')) mv[2] += 1;
      if (flight.keys.has('down')) mv[2] -= 1;
      const n = Math.hypot(mv[0], mv[1], mv[2]);
      if (n > 0) {
        flight.pos[0] += mv[0] / n * sp * dt;
        flight.pos[1] += mv[1] / n * sp * dt;
        flight.pos[2] += mv[2] / n * sp * dt;
      }
    }
    flightApply();
    return flight.keys.size > 0 || gliding;
  }
  const FLY_KEYS = { ArrowUp: 'fwd', KeyW: 'fwd', ArrowDown: 'back', KeyS: 'back',
                     ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right',
                     KeyD: 'right', KeyE: 'up', PageUp: 'up', KeyQ: 'down',
                     PageDown: 'down' };
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
        || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') {
      if (flight.on) { exitFlight(); e.preventDefault(); }
      return;
    }
    let act = FLY_KEYS[e.code];
    if (!act) return;
    // SHIFT + up/down arrows fly ALTITUDE (operator ask); shift with anything
    // else stays the boost. Rise and sink also live on Q/E and PgUp/PgDn.
    const altArrow = e.code === 'ArrowUp' || e.code === 'ArrowDown';
    if (e.shiftKey && altArrow) act = e.code === 'ArrowUp' ? 'up' : 'down';
    if (!flight.on) {
      if (transition) return;         // never wrestle a dive for the camera
      enterFlight();
    }
    flight.keys.add(act);
    flight.boost = e.shiftKey && !(e.shiftKey && altArrow);
    lastInteract = performance.now();
    e.preventDefault();               // arrows must not scroll the page
  });
  window.addEventListener('keyup', (e) => {
    const act = FLY_KEYS[e.code];
    if (act) {
      flight.keys.delete(act);
      // A shift-mapped altitude arrow may be held under EITHER name — clear both.
      if (e.code === 'ArrowUp') flight.keys.delete('up');
      if (e.code === 'ArrowDown') flight.keys.delete('down');
      flight.boost = e.shiftKey;
    }
  });

  /* -- public api -- */
  const api = {
    state, cam, renderer, flight,
    /* The spoke net AS DRAWN, summed from the same segments the ship level renders.
     * The model computes the same length analytically (ship0Summary().spokeNet), and
     * check_explorer holds the two together — which is the only way a "layout concept"
     * and a purchased length can be claimed to be the same thing. */
    shipSpokeDrawn() {
      const segs = shipSkeletonSegs(shipDims()).spokes;
      let m = 0;
      for (const g of segs) m += Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
      return { cords: segs.length, lengthM: m };
    },
    flightToggle() {
      if (flight.on) exitFlight(); else if (!transition) enterFlight();
      return flight.on;
    },
    flightKey(act, down) {
      if (down) {
        if (!flight.on) { if (transition) return false; enterFlight(); }
        flight.keys.add(act);
      } else flight.keys.delete(act);
      return flight.on;
    },
    flightSpeed(f) {
      flight.speed = clamp(f, 0.12, 12);
      return flight.speed;
    },
    get ctx() { return ctx; },
    setLevel,
    setMaterial(k) {
      state.matKey = k;
      ctx = computeCtx(state.matKey, state.altM); ctx.envRing = !!envRing;
      if (opts.onCtx) opts.onCtx(ctx);
      dirty = true;
    },
    setAltitude(a) {
      state.altM = a;
      ctx = computeCtx(state.matKey, state.altM); ctx.envRing = !!envRing;
      if (opts.onCtx) opts.onCtx(ctx);
      dirty = true;
    },
    setCut(v) { state.cut = v; dirty = true; },
    /** Scrub the whole build: 0 = a pile of parts, 1 = the finished cell. Exits guide
     * mode; the stepper eases toward this. Cell level only, snaps home off it. */
    setAssemble(v) { state.assembleGuide = null; state.assembleLoop = null;
                     state.assembleTo = clamp(v, 0, 1); dirty = true; },
    /** Play the whole build: drop everything into the pile and let it assemble. */
    playAssembly() { state.assembleGuide = null; state.assembleLoop = null;
                     state.assemble = 0; state.assembleTo = 1; dirty = true; },
    /** Park the build at t without easing — deep links and the gate's pose checks. */
    jumpAssemble(v) {
      state.assembleGuide = null;
      state.assembleLoop = null;
      state.assemble = state.assembleTo = clamp(v, 0, 1);
      const a = built[STAGE_LEVEL].assembly;
      if (a) a.apply(state.assemble);
      dirty = true;
    },
    /** The transport: play in either direction, hold, and set the pace. */
    assemblePlay(dir) { state.assembleGuide = null; state.assembleLoop = null;
                        state.assembleTo = dir < 0 ? 0 : 1; dirty = true; },
    assemblePause() {
      const g = state.assembleGuide;
      state.assembleLoop = null;
      if (g) g.to = g.alpha;
      else state.assembleTo = state.assemble;
      dirty = true;
    },
    /** Loop the build ('loop': end -> pile -> again) or breathe it ('bounce': build,
     * unbuild, repeat). Toggles: the same mode again turns it off and the run plays out
     * to its current target. */
    assembleLoop(mode) {
      state.assembleGuide = null;
      state.assembleLoop = state.assembleLoop === mode ? null : mode;
      if (state.assembleLoop) {
        if (state.assemble >= 1) {
          state.assemble = 0;
          const a = built[STAGE_LEVEL].assembly;
          if (a) a.apply(0);
        }
        state.assembleTo = 1;
        state.assembleHold = 0;
      }
      dirty = true;
      return state.assembleLoop;
    },
    setAssembleSpeed(x) { state.assembleSpeed = clamp(x, 0.05, 8); return state.assembleSpeed; },
    /** GUIDE MODE: run the animation of exactly ONE part per press — everything placed
     * earlier seated, everything later still in the pile, the part flying its full proven
     * approach at watchable speed. Forward flies the next part in; back flies the newest
     * part out and parks on the one before. This is the assembly-guide mode, and it is
     * also the sweep's own model — a strict prefix seated, one body moving. */
    assembleStep(d) {
      const a = built[STAGE_LEVEL].assembly;
      if (!a) return null;
      const ws = a.windows;
      let g = state.assembleGuide;
      if (!g) {
        let i = -1;
        for (let k2 = 0; k2 < ws.length; k2++) {
          if (ws[k2].t1 <= state.assemble + 1e-6) i = k2;
        }
        g = state.assembleGuide = { idx: i, alpha: 1, to: 1 };
      }
      if (d > 0) {
        if (g.alpha < 1 && g.to !== 0) { g.to = 1; }           // finish the current flight
        else if (g.idx < ws.length - 1 || g.alpha < 1) {
          if (g.alpha >= 1) { g.idx = clamp(g.idx + 1, 0, ws.length - 1); g.alpha = 0; }
          g.to = 1;
        }
      } else {
        if (g.alpha > 0 && g.to !== 1) { g.to = 0; }           // finish flying it out
        else if (g.idx >= 0) { g.to = 0; }                     // fly the newest back out
      }
      const i2 = clamp(g.idx, 0, ws.length - 1);
      dirty = true;
      return { idx: g.idx, steps: ws.length, cap: g.idx >= 0 ? ws[i2].cap : '' };
    },
    /** Park the guide on a component (bar one): that part and everything before it
     * seated, everything after in the pile. */
    assembleGuidePark(i) {
      const a = built[STAGE_LEVEL].assembly;
      if (!a) return;
      const ws = a.windows;
      const g = { idx: clamp(Math.round(i), -1, ws.length - 1), alpha: 1, to: 1 };
      state.assembleGuide = g;
      state.assemble = state.assembleTo = g.idx >= 0 ? Math.min(1, ws[g.idx].t1) : 0;
      a.apply(0, g);
      dirty = true;
    },
    /** Scrub the current part's own motion (bar two): its alpha, parked exactly there —
     * the slow-motion control, at any pace the hand likes. */
    assemblePartAlpha(v) {
      const a = built[STAGE_LEVEL].assembly;
      if (!a) return;
      let g = state.assembleGuide;
      if (!g) {
        const ws = a.windows;
        let i = -1;
        for (let k2 = 0; k2 < ws.length; k2++) {
          if (ws[k2].t0 <= state.assemble) i = k2; else break;
        }
        g = state.assembleGuide = { idx: Math.max(i, 0), alpha: 1, to: 1 };
      }
      g.alpha = g.to = clamp(v, 0, 1);
      a.apply(0, g);
      dirty = true;
    },
    /** What the guide reads right now, in either mode: the component index and its own
     * motion alpha (the two bars), the caption, the pace, and whether anything runs. */
    assemblyGuide() {
      const a = built[STAGE_LEVEL].assembly;
      if (!a) return null;
      const ws = a.windows;
      const g = state.assembleGuide;
      if (g) {
        const i2 = clamp(g.idx, 0, ws.length - 1);
        const has = g.idx >= 0;
        return { mode: 'guide', t: state.assemble, steps: ws.length, idx: g.idx,
                 alpha: g.alpha,
                 cap: has ? ws[i2].cap : 'a pile of parts, and a proven order',
                 cap1: has ? ws[i2].cap1 : 'a pile of parts, and a proven order',
                 cap2: has ? ws[i2].cap2 : 'press assemble, or step the first part in',
                 playing: Math.abs(g.to - g.alpha) > 1e-4,
                 loop: state.assembleLoop, speed: state.assembleSpeed };
      }
      let i = -1;
      for (let k2 = 0; k2 < ws.length; k2++) {
        if (ws[k2].t0 <= state.assemble) i = k2; else break;
      }
      const alpha = i >= 0
        ? clamp((state.assemble - ws[i].t0) / (ws[i].t1 - ws[i].t0), 0, 1) : 0;
      return { mode: 'global', t: state.assemble, steps: ws.length, idx: i, alpha,
               cap: i >= 0 ? ws[i].cap : 'a pile of parts, and a proven order',
               cap1: i >= 0 ? ws[i].cap1 : 'a pile of parts, and a proven order',
               cap2: i >= 0 ? ws[i].cap2 : 'press assemble, or step the first part in',
               playing: Math.abs(state.assembleTo - state.assemble) > 1e-4
                        || !!state.assembleLoop,
               loop: state.assembleLoop, speed: state.assembleSpeed };
    },
    /** The gate's probe: parts displaced from their seated matrices, and by how far —
     * measured off the live instance buffers, never off the animation's own bookkeeping. */
    assemblyProbe() {
      const a = built[STAGE_LEVEL].assembly;
      return a ? { t: state.assemble, ...a.probe(), ...a.counts } : null;
    },
    /** Run (or fetch) the trajectory sweep and the planner: every flight tested against
     * everything seated at its moment, arcs replanned until clean, residue reported. */
    assemblySweep() {
      const a = built[STAGE_LEVEL].assembly;
      return a ? a.plan() : null;
    },
    /** The tour, exposed so the page's button and the gate drive the same thing. */
    tourFor(idx) { return tourOf(idx === undefined ? state.levelIdx : idx); },
    setPart,
    /** Advance one stop and hand back the stop's display name, the way cycleParts hands
     * back the mode: the button's label is READ BACK from the state, never assembled at
     * the call site out of what the click was assumed to do. */
    nextPart() {
      const s = setPart(state.tourIdx + 1);
      return s ? s.name : '';
    },
    /** Jump straight to a stop. The step-through remains, but a tour of five joint families
     *  is a set of choices, not a queue, and making someone click past four to reach one is
     *  a worse control than the buttons it replaced. */
    goPart(i) {
      const s = setPart(i);
      return s ? s.name : '';
    },
    prevPart() {
      const s = setPart(state.tourIdx - 1);
      return s ? s.name : '';
    },
    /** The name of the stop the state says we are at — what the button must be showing. */
    partName() {
      const s = stopOf(state.levelIdx);
      return s ? s.name : '';
    },
    /** The whole button label, noun included. The noun belongs to the tour — a stop on the
     * tube level is a cut and a stop on the skin level is a face — so the page reads it
     * back from here instead of deciding for itself what it is looking at. */
    partLabel() {
      const t = tourOf(state.levelIdx), s = stopOf(state.levelIdx);
      return t && s ? `${t.noun}: ${s.name}` : '';
    },
    stageLevel: STAGE_LEVEL,
    /** The fade the shared cell is actually drawn at. Between two stage levels it must sit
     * at 1 the whole way: they show the SAME scene graph, so a cross-fade there is a dip
     * in brightness over an article that never moved. */
    get stageFade() { return built[STAGE_LEVEL].fade; },
    /** The article's own 51 printed joints, as the page drew them: role, integer u, arm
     * count, and the instances each one owns. The gate builds the page's arm histogram
     * from this and holds it to the manifest of the STLs on disk. */
    get parts() { return built[STAGE_LEVEL].parts || []; },
    /** The article's 216 members as the page drew them: kind, the two joints each one runs
     * between, and the instance it is. The gate counts these against the generated graph,
     * so the cut schedule cannot price members the article does not have. */
    get members() { return built[STAGE_LEVEL].members || []; },
    /** The cell group's own matrix. Member ends and seats are recorded in the group's
     * local frame while part positions are world; the vision harness projects seat
     * markers through THIS, so a marker lands where the renderer put the geometry. */
    get cellFrame() { return built[STAGE_LEVEL].cgM; },
    /** Every instanced thing in the cell, as `id#i`. The gate needs one that is NOT in the
     * current stop's subject to check the dim, and on a level that lights whole runs of
     * tube it cannot assume which one that is. */
    instanceKeys() {
      const out = [];
      walk(built[STAGE_LEVEL].root, (n) => {
        if (n.inst) for (let i = 0; i < n.inst.count; i++) out.push(`${n.id}#${i}`);
        return true;
      });
      return out;
    },
    /** Read one instance's tint back out of the scene. The gate asserts the dim landed in
     * RGB and not in alpha, where the opaque pass discards it while a probe reading the
     * array reports a perfectly dimmed scene. */
    tintAt(id, i) {
      let out = null;
      walk(built[STAGE_LEVEL].root, (n) => {
        if (n.id === id && n.inst) out = Array.from(n.inst.tint.slice(i * 4, i * 4 + 4));
        return true;
      });
      return out;
    },
    /** The current level's named views — what the deck's view buttons are built from. */
    viewsFor() { return LEVEL_VIEWS[LEVELS[state.levelIdx].id] || []; },
    /** The level's tours, and the door into one. A path tour rides the fly
     * queue; a walk tour rides the stop machinery on a dwell. */
    toursFor() { return LEVEL_TOURS[LEVELS[state.levelIdx].id] || []; },
    startTour(key) {
      const tr = (LEVEL_TOURS[LEVELS[state.levelIdx].id] || [])
        .find(x => x.k === key);
      if (!tr) return null;
      exitFlight();
      cancelGuidance();
      if (tr.type === 'walk') {
        setPart(0);
        state.autoWalk = { key, dwell: 2.6, acc: 0, visited: 0 };
        dirty = true;
        return tr.n;
      }
      const legs = tr.legs || [];
      if (!legs.length) return null;
      if (state.reduced) {
        const mid = legs[Math.floor(legs.length / 2)];
        const lv = LEVELS[state.levelIdx];
        applyRadius(cam, lv.radius, lv.depthR || lv.radius);
        if (mid.tg) cam.target = mid.tg.slice();
        cam.azimuth = mid.az; cam.elevation = mid.el; cam.distance = mid.d;
        dirty = true;
        if (opts.onTourEnd) opts.onTourEnd(key);
        return tr.n;
      }
      state.tourKey = key;
      state.flyQueue = legs.slice(1).map(l => ({ ...l }));
      const leg = legs[0];
      const lv = LEVELS[state.levelIdx];
      transition = {
        kind: 'view', from: state.levelIdx, to: state.levelIdx, t: 0,
        seconds: leg.s || 1.6,
        d0: cam.distance, d1: leg.d,
        r0: cam.radius, r1: lv.radius,
        dr0: lv.depthR || lv.radius, dr1: lv.depthR || lv.radius,
        tg0: cam.target.slice(), tg1: (leg.tg || cam.target).slice(),
        az0: cam.azimuth, az1: nearAz(leg.az), el0: cam.elevation, el1: leg.el,
      };
      dirty = true;
      return tr.n;
    },
    /** Fly to a named view of the current level. A camera move (plus a reading, where the
     * view carries one) through the SAME transition the dives use — eased from the live
     * camera, never snapped, and instant under reduced motion. */
    applyView(key) {
      const v = (LEVEL_VIEWS[LEVELS[state.levelIdx].id] || []).find(x => x.k === key);
      if (!v) return null;
      exitFlight();
      cancelGuidance();
      // THE FLY-THROUGH: a queue of poses flown as one continuous path, each leg
      // the same eased move a view uses. Any input cancels it (the handlers
      // clear the queue); reduced motion parks at the path's heart instead —
      // the gap between the walls — because a slideshow of six cuts is worse
      // than one good vantage.
      if (v.fly) {
        if (state.reduced) {
          const mid = FLY_PATH[2];
          const lv = LEVELS[state.levelIdx];
          applyRadius(cam, lv.radius, lv.depthR || lv.radius);
          cam.target = mid.tg.slice();
          cam.azimuth = mid.az; cam.elevation = mid.el; cam.distance = mid.d;
          state.flyQueue = null;
          dirty = true;
          return v.n;
        }
        state.flyQueue = FLY_PATH.slice(1);
        const first = FLY_PATH[0];
        const lv = LEVELS[state.levelIdx];
        transition = {
          kind: 'view', from: state.levelIdx, to: state.levelIdx, t: 0,
          seconds: first.s,
          d0: cam.distance, d1: first.d,
          r0: cam.radius, r1: lv.radius,
          dr0: lv.depthR || lv.radius, dr1: lv.depthR || lv.radius,
          tg0: cam.target.slice(), tg1: first.tg.slice(),
          az0: cam.azimuth, az1: nearAz(first.az), el0: cam.elevation, el1: first.el,
        };
        dirty = true;
        return v.n;
      }
      if (v.group !== undefined) applyGroup(v.group);
      const lv = LEVELS[state.levelIdx];
      const depthR = lv.depthR || (isStage(state.levelIdx) ? LEVELS[STAGE_LEVEL].radius : lv.radius);
      const tg = (v.tg || lv.target || [0, 0, 0]).slice();
      const az = v.az !== undefined ? v.az : cam.azimuth;
      const el = v.el !== undefined ? v.el : cam.elevation;
      const d = v.d !== undefined ? v.d : cam.distance;
      if (state.reduced) {
        applyRadius(cam, lv.radius, depthR);
        cam.target = tg; cam.azimuth = az; cam.elevation = el; cam.distance = d;
        dirty = true;
        return v.n;
      }
      transition = {
        kind: 'view', from: state.levelIdx, to: state.levelIdx, t: 0, seconds: 1.1,
        d0: cam.distance, d1: d,
        r0: cam.radius, r1: lv.radius, dr0: depthR, dr1: depthR,
        tg0: cam.target.slice(), tg1: tg,
        az0: cam.azimuth, az1: nearAz(az), el0: cam.elevation, el1: el,
      };
      dirty = true;
      return v.n;
    },
    /** Toggle one ship layer; returns its new state for the button to read back. */
    shipLayer(name) {
      if (!(name in state.shipLayers)) return null;
      state.shipLayers[name] = !state.shipLayers[name];
      // Switching the WORLD on pulls the camera back (operator, round 12):
      // the lake is ~230 m across — at ship-framing distance it reads as a
      // wall of water. Ease out only, never in, and only on the vessel.
      if (name === 'env' && state.shipLayers.env
          && LEVELS[state.levelIdx].id === 'vessel' && !transition) {
        const lv = LEVELS[state.levelIdx];
        const depthR = lv.depthR || lv.radius;
        const d1 = Math.max(cam.distance * 1.4, 330);
        if (d1 > cam.distance + 1) {
          if (state.reduced) {
            cam.distance = d1;
          } else {
            transition = {
              kind: 'view', from: state.levelIdx, to: state.levelIdx, t: 0,
              seconds: 1.1,
              d0: cam.distance, d1,
              r0: cam.radius, r1: lv.radius, dr0: depthR, dr1: depthR,
              tg0: cam.target.slice(), tg1: cam.target.slice(),
              az0: cam.azimuth, az1: cam.azimuth,
              el0: cam.elevation, el1: cam.elevation,
            };
          }
        }
      }
      dirty = true;
      return state.shipLayers[name];
    },
    get shipLayers() { return { ...state.shipLayers }; },
    cycleSkin() {
      const order = ['solid', 'transparent', 'off'];
      state.skinMode = order[(order.indexOf(state.skinMode) + 1) % order.length];
      dirty = true;
      return state.skinMode;
    },
    /** Segmented deck (operator, round 6): SET a mode, don't cycle to it. */
    setSkinMode(mode) {
      if (['solid', 'transparent', 'off'].includes(mode)) {
        state.skinMode = mode;
        dirty = true;
      }
      return state.skinMode;
    },
    setPartsMode(mode) {
      if (['all', 'joinery', 'pipes'].includes(mode)) {
        state.partsMode = mode;
        // Same demotion the cycler applies: a joinery view behind an opaque
        // skin is a blank box.
        if (mode !== 'all' && state.skinMode === 'solid') {
          state.skinMode = 'transparent';
        }
        dirty = true;
      }
      return state.partsMode;
    },
    /** Pump the article down (1) or vent it (0): the film eases between slack and the
     *  membrane shape gen_skin solved. Returns what the button should now claim. */
    setSkinLoad(v) { state.skinLoadTo = v ? 1 : 0; dirty = true; return state.skinLoadTo; },
    toggleSkinLoad() { return api.setSkinLoad(state.skinLoadTo ? 0 : 1); },
    /** The loaded-skin numbers the page draws plus the live morph state — one readback
     *  for check_explorer, which holds them to research/geometry/skin/loaded-skin.json. */
    skinStats() {
      const n = SKIN.numbers;
      let sumW = 0;
      for (const c of Object.values(SKIN.classes)) for (const w of c.w) sumW += w;
      return { load: state.skinLoad, to: state.skinLoadTo,
               sagHexMm: n.sagHexMm, sagSqMm: n.sagSqMm,
               dishM3: n.dishM3, dishPct: n.dishPct, dispLoadedM3: n.dispLoadedM3,
               tHexSLNpm: n.tHexSLNpm, tSqSLNpm: n.tSqSLNpm,
               clearanceMm: n.clearanceMm, goredPiecesAtK12: n.goredPiecesAtK12,
               sumWMm: Math.round(sumW * 1e7) / 1e4 };
    },
    /** Light one structural reading of the article and dim the rest — see applyGroup. */
    setGroup(name) { return applyGroup(name); },
    get group() { return state.group || 'all'; },
    /** Open the net, or fold it back. Returns the label the button must now show. */
    toggleUnfold() {
      // Capture the camera as it stands. Easing from the LEVEL'S default distance meant that
      // if you had zoomed in or out yourself, the first frame snapped to that default and the
      // pull-back started from somewhere you were never looking.
      state.unfoldFrom = { d: cam.distance, az: cam.azimuth, el: cam.elevation };
      state.unfoldTo = state.unfoldTo > 0.5 ? 0 : 1;
      dirty = true;
      return state.unfoldTo > 0.5 ? 'fold up' : 'unfold flat';
    },
    get unfoldLabel() { return state.unfoldTo > 0.5 ? 'fold up' : 'unfold flat'; },
    /** Everything the gate needs to decide whether the net could actually be cut, measured
     *  on the geometry that is on screen rather than recomputed beside it. */
    netStats() {
      const lv = built[LEVELS.findIndex(l => l.id === 'track')];
      const g = lv && lv.root && lv.root.net;
      if (!g) return null;
      const M = netPose(g.net, easeInOut(state.unfold));
      const { verts, faces } = g.net;
      const n0 = faces[g.net.root].normal;
      const polys = [], e1 = norm(sub(verts[faces[g.net.root].loop[0]],
        verts[faces[g.net.root].loop[1]]));
      const e2 = cross(n0, e1);
      let lo = 1e9, hi = -1e9, area = 0;
      faces.forEach((f, fi) => {
        const [R, T] = M[fi];
        const P = f.loop.map(i => add(mat3(R, verts[i]), T));
        for (const p of P) { const d = dot(p, n0); if (d < lo) lo = d; if (d > hi) hi = d; }
        const q = P.map(p => [dot(p, e1), dot(p, e2)]);
        let a2 = 0;
        for (let i = 0; i < q.length; i++) {
          const r = q[(i + 1) % q.length];
          a2 += q[i][0] * r[1] - r[0] * q[i][1];
        }
        area += Math.abs(a2) / 2;
        polys.push(q);
      });
      // Separating-axis overlap on the shrunk polygons, so shared fold edges do not count.
      const shrink = (q) => {
        const c = q.reduce((s2, p) => [s2[0] + p[0] / q.length, s2[1] + p[1] / q.length],
          [0, 0]);
        return q.map(p => [c[0] + (p[0] - c[0]) * 0.94, c[1] + (p[1] - c[1]) * 0.94]);
      };
      const S = polys.map(shrink);
      let overlaps = 0;
      for (let i = 0; i < S.length; i++) for (let k = i + 1; k < S.length; k++) {
        let sep = false;
        for (const P of [S[i], S[k]]) {
          for (let e = 0; e < P.length && !sep; e++) {
            const a2 = P[e], b2 = P[(e + 1) % P.length];
            const nx = -(b2[1] - a2[1]), ny = b2[0] - a2[0];
            const pa = S[i].map(p => nx * p[0] + ny * p[1]);
            const pb = S[k].map(p => nx * p[0] + ny * p[1]);
            if (Math.max(...pa) <= Math.min(...pb) + 1e-12 ||
                Math.max(...pb) <= Math.min(...pa) + 1e-12) sep = true;
          }
          if (sep) break;
        }
        if (!sep) overlaps++;
      }
      // The flat pattern's own bounding box, in the plane it lies in. Area alone does not
      // say whether the net can be CUT: film comes on a roll of finite width and a laser
      // has a finite bed, and both are answered by the extent, not the square metres.
      let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
      for (const q of polys) for (const p of q) {
        if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0];
        if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1];
      }
      return { u: state.unfold, thicknessMm: (hi - lo) * 1000, areaM2: area,
               widthM: bx1 - bx0, heightM: by1 - by0,
               overlaps, folds: g.net.folds, cuts: g.net.cuts };
    },
    cycleParts() {
      const order = ['all', 'joinery', 'pipes'];
      state.partsMode = order[(order.indexOf(state.partsMode) + 1) % order.length];
      // A joinery view behind a solid skin is a blank box — the skin is opaque and
      // encloses everything. Demote it once, in the open, rather than let the button
      // appear to do nothing.
      if (state.partsMode !== 'all' && state.skinMode === 'solid') {
        state.skinMode = 'transparent';
      }
      dirty = true;
      return state.partsMode;
    },
    clearBreach() { state.breached.clear(); applyBreach(); },
    invalidate() { dirty = true; },
    /** Advance and draw exactly one frame, synchronously — for tests and stills. */
    tick(dt = 1 / 60) {
      advance(dt);
      renderBody();
    },
    levels: LEVELS,
    dispose() {
      disposed = true;
      ro.disconnect();
      for (const el of labelEls.values()) el.remove();
      labelEls.clear();
      renderer.dispose();
    },
  };

  setLevel(state.levelIdx, true);
  // A hosting page may pin the opening pose AFTER the boot setLevel has framed the
  // level's default (the front-page hero letterboxes ship + shore ring; the viewer's
  // default suits its side-panel stage). maxDistance first, or the distance is capped.
  if (opts.pose) {
    const po = opts.pose;
    if (po.tg) cam.target = po.tg.slice();
    if (po.az !== undefined) cam.azimuth = po.az;
    if (po.el !== undefined) cam.elevation = po.el;
    if (po.d) { cam.maxDistance = Math.max(cam.maxDistance, po.d * 1.05); cam.distance = po.d; }
    // A wider fov on a proportionally taller canvas is not a zoom: pixels per metre
    // are tan(fov/2) / height, so scaling both leaves the subject exactly the size and
    // place it was and spends the difference on frame. That is how the hero buys
    // headroom for the bow-on crown without moving the ship (operator, 08-14).
    // It sets the BASE fov, not the live one: fitFov() widens it again on a portrait
    // canvas, and it must widen from the pose's number rather than from the default.
    if (po.fov) { baseFov = po.fov; fitFov(); }
    dirty = true;
  }
  return api;
}

void mix; void addChild; void updateWorld; void boxSegs;
