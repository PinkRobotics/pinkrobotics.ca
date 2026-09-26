/* Rendering modes.
 *
 * A view mode is a pure function from a node to a style: hidden or not, which material, what
 * opacity. It never mutates the tree — `node.visible` belongs to the animation drivers (a
 * retracted hose is not "hidden by the cutaway view"), and keeping the two separate is what stops
 * a mode change from silently deploying the hose.
 *
 * The one exception is clipping, which cannot be a per-node decision: it is a pair of world-space
 * planes handed to the renderer, plus an analytic CAP so the cut face reads as solid material
 * rather than as a hole. Because the hull is a body of revolution the cap is exactly computable,
 * which is why this cutaway has no stencil pass and no z-fighting along the cut.
 */

import { hullR, stationX, stationT, sectionScale, profileR } from '../model/config.js?v=6e20b6c4';
import { resolveMaterial, MATERIALS, CATEGORY_TONE, STATE_TONE, TOKENS, mix } from './palette.js?v=6e20b6c4';
import { solid } from '../model/geom.js?v=6e20b6c4';
import { node } from '../core/nodes.js?v=6e20b6c4';
import { clamp01 } from '../core/math.js?v=6e20b6c4';

export const VIEW_MODES = [
  'exterior', 'ghost', 'cutaway-longitudinal', 'cutaway-transverse', 'vacuum', 'lattice',
  'wire', 'systems', 'load-paths', 'energy', 'mass', 'failure',
];

export const VIEW_LABELS = {
  exterior: 'Exterior',
  ghost: 'Ghosted exterior',
  'cutaway-longitudinal': 'Longitudinal cutaway',
  'cutaway-transverse': 'Transverse cutaway',
  vacuum: 'Vacuum volume',
  lattice: 'Structural lattice',
  wire: 'Wire',
  systems: 'Systems',
  'load-paths': 'Load paths',
  energy: 'Energy',
  mass: 'Mass state',
  failure: 'Failure and fail-safe',
};

/** Nodes a viewer can see without cutting the ship open. */
const EXTERNAL = new Set([
  'OuterFairing', 'SolarSkin', 'HullUnderside', 'MediumThrusters', 'LocalTrimFans', 'SensorClusters',
  'DropOutlets', 'DropSpray', 'AirStreaks', 'MotionLines', 'WindLines', 'GustPuffs',
  'HoseFlow', 'HoseReels', 'TankerDock', 'HullWire',
  // The descent anchor and the lake it works against. All four are outside the hull and all four
  // are the point of the source phases, so leaving them off this list built them, positioned them
  // every frame, and drew none of them — which is what an allow-list does when you forget it.
  'AnchorWinch', 'AnchorCable', 'AnchorBag', 'WaterSurface', 'WaterSurfaceRings',
  'AnchorContact',
  // The rotating halves of the ducted units, and the panels that cover the ragged edge of each
  // aperture. All are part of the exterior; omitting them left the blowers with no blades and the
  // hole edges uncovered.
  'MediumThrusterFans', 'LocalTrimFanBlades',
  'PortSurrounds', 'SolarPortSurrounds', 'UndersidePortSurrounds',
]);
// THE UNDERCARRIAGE (operator, 08-13): the raft and everything it carries is
// EXTERIOR now — the allow-list must say so or the exterior view shows a bare
// hull with two lines and nothing they hang from (exactly the bug report).
const EXTERNAL_PREFIX = ['PrimaryRotor', 'TailSurface', 'Hose_', 'PumpPod_',
  'RaftFrame', 'BridleLines', 'WaterTank', 'LN2Tank', 'Generator', 'BatteryModule',
  'CryoCompressor', 'CryoColdBox', 'CryoExpander', 'VehicleMindCompute', 'SafetyKernel'];

export function isExternal(n) {
  if (EXTERNAL.has(n.id)) return true;
  return EXTERNAL_PREFIX.some((p) => n.id.startsWith(p));
}

const STRUCTURE_NODES = new Set([
  'VacuumLattice', 'MacroFrames', 'SectionJoints', 'VacuumCellModules', 'VacuumCellFocus',
]);

/**
 * Build the render style for a mode.
 *
 * @param {object} b        the build() result
 * @param {string} mode
 * @param {object} p        { cutFrac, cutAxis, systems:Set, selectedId, isolate, failed:Set,
 *                            showCells, exploded }
 * @returns {{ styleFor, clips, depthPrepass, extraNodes, caption, legend }}
 */
export function viewStyle(b, mode, p = {}) {
  const cls = b.cls;
  const sel = p.selectedId || null;
  const failed = p.failed instanceof Set ? p.failed : new Set(p.failed || []);
  const systems = p.systems instanceof Set ? p.systems : (p.systems ? new Set(p.systems) : null);
  const isolate = p.isolate || null;
  const clips = [];
  const extraNodes = [];
  let depthPrepass = [];

  const cutFrac = p.cutFrac === undefined ? 0.5 : clamp01(p.cutFrac);

  // THE CUT FOLLOWS THE CAMERA. The half removed is the half NEAREST the viewer, always. Cutting
  // a fixed half means that half the time the user is looking at the intact outside of the kept
  // half and wondering why the cutaway does nothing — which is the single most common way an
  // interactive cutaway is broken.
  const az = p.cameraAzimuth === undefined ? -0.95 : p.cameraAzimuth;
  // 'vacuum' is a longitudinal cutaway whose story is the packed cell field, so it shares the
  // camera-following cut and the analytic cap.
  if (mode === 'cutaway-longitudinal' || mode === 'vacuum') {
    const off = (cutFrac - 0.5) * 2 * cls.maxRadiusM;
    const eyeY = Math.sin(az);
    if (eyeY >= 0) clips.push([0, -1, 0, off]);      // eye to port: keep starboard
    else clips.push([0, 1, 0, -off]);                // eye to starboard: keep port
    extraNodes.push(capNode(cls, 'y', off, 'CutCapLongitudinal'));
  } else if (mode === 'cutaway-transverse') {
    const x = stationX(cls, cutFrac);
    const eyeX = Math.cos(az);
    if (eyeX >= 0) clips.push([-1, 0, 0, x]);        // eye forward: keep the aft body
    else clips.push([1, 0, 0, -x]);                  // eye aft: keep the forward body
    extraNodes.push(capNode(cls, 'x', x, 'CutCapTransverse'));
  }

  if (mode === 'wire' || mode === 'lattice') {
    // The fairing writes depth but no colour: that is the hidden-line removal.
    depthPrepass = ['OuterFairing'];
  }

  const dimTone = (m) => ({ ...m, color: mix(m.color, TOKENS.bg, 0.68), opacity: (m.opacity || 1) * 0.5 });

  /**
   * The three VIEW LAYERS — hull wire, component edges, load paths — are decided here and only
   * here. They used to be switched off at build time with `node.visible`, which the renderer
   * honours before it asks the view mode anything, so they could never be shown at all.
   */
  function layerStyle(n) {
    // The full vacuum fill exists ONLY for the 'vacuum' view. It is built lazily on first entry
    // and stays in the tree afterwards, so every other mode must explicitly not draw it.
    // The void replaced the ball field (operator, 08-13): one black space.
    if (n.id === 'VacuumVoid') return mode === 'vacuum' ? null : { hidden: true };
    if (n.id === 'VacuumFillBalls') return { hidden: true };
    if (n.id === 'HullWire') {
      if (mode === 'wire') return null;
      return (mode === 'exterior' || mode === 'ghost') && p.shellWire
        ? { material: MATERIALS.shellWire } : { hidden: true };
    }
    if (n.id === 'ComponentEdges') {
      if (mode === 'wire') return null;
      if (mode === 'lattice') return { material: dimTone(MATERIALS.lattice), opacity: 0.5 };
      return { hidden: true };
    }
    if (n.id === 'LoadPaths') {
      return mode === 'load-paths' ? null : { hidden: true };
    }
    return undefined;
  }

  function styleFor(n) {
    if (!n.material && !n.geom) return null;
    const layer = layerStyle(n);
    if (layer !== undefined) return layer;
    // Overlays (force arrows, the centre-of-mass and centre-of-buoyancy markers, the scale bar)
    // are ANNOTATION, not vehicle. A view mode decides what part of the machine to show; it has no
    // business hiding the arrows drawn on top of it, and "showForces did nothing in the exterior
    // view" is exactly the bug that produces.
    if (n.overlay) return null;
    const isFailed = failed.has(n.id);
    const base = MATERIALS[n.material] || MATERIALS.machine;

    // Isolation wins over everything: one component lit, the rest a faint context.
    if (isolate) {
      const keep = n.id === isolate || (n.inst && n.inst.byId.has(isolate));
      if (!keep) {
        if (n.id === 'OuterFairing') return { material: { ...base, kind: 'glass', opacity: 0.05 } };
        if (n.geom && n.geom.kind === 'lines') return { material: dimTone(base), opacity: 0.35 };
        return { hidden: true };
      }
      return { material: { ...base, color: STATE_TONE.selected } };
    }

    switch (mode) {
      case 'exterior':
        if (!isExternal(n)) return { hidden: true };
        // The shell wire: hull meridians and station rings over the solid skin. It was built from
        // the start and never shown by any mode — at panel size a bare solid reads as a dark blob,
        // and the linework is what makes it read as a machine.
        break;

      case 'ghost':
        if (n.id === 'OuterFairing') return { material: { ...base, kind: 'glass', opacity: base.ghost } };
        if (n.id === 'SolarSkin' || n.id === 'HullUnderside' ||
            n.id === 'PortSurrounds' || n.id === 'SolarPortSurrounds' || n.id === 'UndersidePortSurrounds') {
          return { material: { ...base, kind: 'glass', opacity: base.ghost } };
        }
        if (n.id === 'VacuumCellModules') return { hidden: !p.showCells };
        break;

      case 'cutaway-longitudinal':
      case 'cutaway-transverse':
        if (n.id === 'VacuumCellModules') return { hidden: !p.showCells };
        break;

      case 'vacuum': {
        // The pink fill is the story; everything else is context. The sparse representative
        // cells are hidden here (the full fill replaces them — they stay on for other views),
        // the functional skins go glassy, and every machine dims to a silhouette.
        if (n.id === 'CutCapLongitudinal' || n.id === 'CutCapTransverse') return null;
        if (n.id === 'OuterFairing' || n.id === 'SolarSkin' || n.id === 'HullUnderside' ||
            n.id === 'PortSurrounds' || n.id === 'SolarPortSurrounds' ||
            n.id === 'UndersidePortSurrounds') {
          return { material: { ...base, kind: 'glass', opacity: 0.05 } };
        }
        if (n.id === 'VacuumCellModules' || n.id === 'VacuumCellFocus') return { hidden: true };
        if (n.geom && n.geom.kind === 'lines') return { material: dimTone(base), opacity: 0.15 };
        return { material: dimTone(base), opacity: 0.18 };
      }

      case 'lattice':
        if (n.id === 'OuterFairing') return { prepassOnly: true };
        if (n.id === 'SolarSkin' || n.id === 'HullUnderside') return { hidden: true };
        if (STRUCTURE_NODES.has(n.id)) {
          if (n.id === 'VacuumCellModules') return { hidden: !(p.showCells !== false) };
          return null;
        }
        // machinery stays, dimmed, so the structure reads as surrounding something
        return { material: dimTone(base), opacity: 0.4 };

      case 'wire':
        if (n.id === 'OuterFairing') return { prepassOnly: true };   // depth write, no colour
        if (n.id === 'SolarSkin' || n.id === 'HullUnderside') return { hidden: true };
        if (n.geom && n.geom.kind === 'lines') {
          if (n.id === 'VacuumCellModules') return { hidden: !p.showCells };
          return null;
        }
        return { hidden: true };                                 // solids become their edges

      case 'systems': {
        const isolate = !!(systems && systems.size);
        const member = n.category && (!isolate || systems.has(n.category));
        const tone = CATEGORY_TONE[n.category];
        // The fairing always ghosts; the functional skins may be members of their own
        // category (solar IS the power system's collector) and tint when isolated.
        if (n.id === 'OuterFairing') return { material: { ...base, kind: 'glass', opacity: 0.05 } };
        if (n.id === 'SolarSkin' || n.id === 'HullUnderside') {
          if (isolate && member) return { material: { ...base, color: tone ? tone.color : base.color, opacity: 0.85 } };
          return { material: { ...base, kind: 'glass', opacity: 0.05 } };
        }
        if (!member) {
          // ghosted, never vanished: the isolated system needs the ship for context
          if (n.geom && n.geom.kind === 'lines') return { material: dimTone(base), opacity: 0.14 };
          return { material: dimTone(base), opacity: 0.10 };
        }
        return { material: { ...base, color: tone ? tone.color : base.color } };
      }

      case 'load-paths': {
        if (n.id === 'OuterFairing' || n.id === 'SolarSkin' || n.id === 'HullUnderside') {
          return { hidden: true };
        }
        if (n.id === 'VacuumLattice' || n.id === 'MacroFrames') return null;
        if (n.geom && n.geom.kind === 'lines') return { material: dimTone(base), opacity: 0.3 };
        return { material: dimTone(base), opacity: 0.28 };
      }

      case 'energy': {
        if (n.id === 'OuterFairing' || n.id === 'SolarSkin' || n.id === 'HullUnderside') {
          return { material: { ...base, kind: 'glass', opacity: 0.05 } };
        }
        const powerish = n.category === 'power' || n.category === 'propulsion' ||
          n.category === 'cryogenic' || n.id.startsWith('HVDC');
        if (!powerish) {
          if (n.geom && n.geom.kind === 'lines') return { material: dimTone(base), opacity: 0.14 };
          return { hidden: true };
        }
        break;
      }

      case 'mass': {
        if (n.id === 'OuterFairing' || n.id === 'SolarSkin' || n.id === 'HullUnderside') {
          return { material: { ...base, kind: 'glass', opacity: 0.06 } };
        }
        const massy = n.category === 'water' || n.category === 'cryogenic' ||
          n.id === 'Generators' || n.id === 'BatteryModules';
        if (!massy) {
          if (n.geom && n.geom.kind === 'lines') return { material: dimTone(base), opacity: 0.14 };
          return { hidden: true };
        }
        break;
      }

      case 'failure': {
        if (n.id === 'OuterFairing' || n.id === 'SolarSkin' || n.id === 'HullUnderside') {
          return { material: { ...base, kind: 'glass', opacity: 0.07 } };
        }
        break;
      }

      default:
        break;
    }

    if (isFailed) {
      return { material: { ...base, color: STATE_TONE.failed, kind: base.kind === 'line' ? 'line' : base.kind } };
    }
    if (sel && (n.id === sel)) {
      return { material: { ...base, color: STATE_TONE.selected } };
    }
    return null;
  }

  return {
    styleFor,
    clips,
    depthPrepass,
    extraNodes,
    caption: captionFor(mode, cls, p),
    legend: legendFor(mode, systems),
  };
}

/* ---------- analytic cutaway caps --------------------------------------------------------------- */

/**
 * Geometry for the face exposed by an axis-aligned cut.
 *
 * Because the hull is r(x) revolved through s(theta), "is this point inside" is a closed-form
 * test, so the cut face can be generated exactly instead of recovered with a stencil buffer. A
 * transverse cut caps with the section outline; a longitudinal cut caps with the band of the
 * profile that the plane actually passes through — which is NOT the full silhouette unless the
 * cut is on the centreline, and getting that wrong is what makes off-centre cutaways look wrong.
 */
export function capGeom(cls, axis, offset, samples = 96) {
  // The cut face is a BAND along the section boundary, not a filled disc.
  //
  // A filled disc is what you get if you believe the vehicle is solid. This one is not: it is a
  // lattice full of sealed voids with machinery in it, and a disc across the cut plane is a lid
  // that hides the entire interior — which is the opposite of what a cutaway is for. What the
  // plane actually passes through is the fairing and the outer structure, so that is what gets
  // capped: a ribbon of skin thickness following the exact section outline.
  const th = Math.max(0.6, cls.maxRadiusM * 0.045);
  const pos = [], idx = [];
  // Every quad is emitted with BOTH windings: the cut keeps whichever hull half faces away
  // from the eye, so a single-winding cap is guaranteed to show its dimmed back face to the
  // camera about half the time — which is exactly the "hole instead of material" bug.
  const quad = (a, b, c, d) => {
    const k = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    idx.push(k + 2, k + 1, k, k + 3, k + 2, k);
  };

  if (axis === 'x') {
    const R = hullR(cls, offset);
    if (!(R > 0)) return null;
    for (let j = 0; j < samples; j++) {
      const t0 = (2 * Math.PI * j) / samples, t1 = (2 * Math.PI * (j + 1)) / samples;
      const r0 = R * sectionScale(t0, cls.hull), r1 = R * sectionScale(t1, cls.hull);
      const o0 = Math.max(0, r0 - th), o1 = Math.max(0, r1 - th);
      quad(
        [offset, -r0 * Math.cos(t0), r0 * Math.sin(t0)],
        [offset, -r1 * Math.cos(t1), r1 * Math.sin(t1)],
        [offset, -o1 * Math.cos(t1), o1 * Math.sin(t1)],
        [offset, -o0 * Math.cos(t0), o0 * Math.sin(t0)],
      );
    }
    return solid(new Float32Array(pos), new Uint32Array(idx));
  }

  // y = offset: walk the closed outline (upper run forward, lower run back) and inset it.
  const outline = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = stationX(cls, t);
    const R = hullR(cls, x);
    if (R <= 1e-6) continue;
    const z = halfHeightAt(cls, R, offset);
    if (z > 1e-6) outline.push([x, z]);
  }
  if (outline.length < 3) return null;
  const loop = [
    ...outline.map(([x, z]) => [x, z]),
    ...outline.slice().reverse().map(([x, z]) => [x, -z]),
  ];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    // inward normal of the 2-D outline segment
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    let nx = dz / l, nz = -dx / l;
    // point it toward the interior (the outline is traversed clockwise in x-z)
    if (a[1] > 0 ? nz > 0 : nz < 0) { nx = -nx; nz = -nz; }
    quad(
      [a[0], offset, a[1]],
      [b[0], offset, b[1]],
      [b[0] + nx * th, offset, b[1] + nz * th],
      [a[0] + nx * th, offset, a[1] + nz * th],
    );
  }
  return solid(new Float32Array(pos), new Uint32Array(idx));
}

/**
 * Half-height of the hull section of radius R in the plane y = c. Solves
 * hypot(c, z) = R * s(atan2(z, -c)) by bisection — the section is star-shaped about its centre,
 * so there is exactly one crossing on each side.
 */
function halfHeightAt(cls, R, c) {
  const inside = (z) => {
    const th = Math.atan2(z, -c);
    return Math.hypot(c, z) <= R * sectionScale(th, cls.hull);
  };
  if (!inside(0)) return 0;
  let lo = 0, hi = R * 1.2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function capNode(cls, axis, offset, id) {
  const g = capGeom(cls, axis, offset);
  if (!g) return null;
  const n = node({ id, category: 'structure', geom: g, material: 'capFace', selectable: false });
  return n;
}

/* ---------- captions and legend ------------------------------------------------------------------ */

const EPISTEMIC = {
  'load-paths': 'Illustrative load paths — not an FEA result.',
  vacuum: 'The free interior volume, drawn as what it is: one evacuated space behind the wall.',
  lattice: 'Illustrative stress-informed topology. Cell modules are representative, not the real count.',
  wire: 'Representative internal arrangement. Conceptual reference vehicle.',
  failure: 'Graceful containment is a design objective, not demonstrated performance.',
  energy: 'Demonstration assumptions, not an airborne plant specification.',
};

function captionFor(mode, cls, p) {
  const bits = [`${cls.name} — conceptual reference vehicle`];
  if (mode === 'vacuum') {
    bits.push('Longitudinal cutaway — the free interior volume is evacuated cell space');
  }
  if (mode === 'cutaway-longitudinal') {
    const off = ((p.cutFrac === undefined ? 0.5 : p.cutFrac) - 0.5) * 2 * cls.maxRadiusM;
    bits.push(`Longitudinal cut ${off === 0 ? 'on the centreline' : `${Math.abs(off).toFixed(1)} m ${off > 0 ? 'to port' : 'to starboard'} of the centreline`}`);
  }
  if (mode === 'cutaway-transverse') {
    const t = p.cutFrac === undefined ? 0.5 : p.cutFrac;
    bits.push(`Transverse cut at station ${(t * 100).toFixed(0)}% (${(t * cls.lengthM).toFixed(0)} m from the nose)`);
  }
  if (EPISTEMIC[mode]) bits.push(EPISTEMIC[mode]);
  return bits.join(' · ');
}

function legendFor(mode, systems) {
  const cats = systems && systems.size ? [...systems] : Object.keys(CATEGORY_TONE);
  if (mode === 'systems') return cats.map((c) => ({ id: c, ...CATEGORY_TONE[c] }));
  if (mode === 'vacuum') {
    return [
      { id: 'vac', color: '#9a9aa5', label: 'The evacuated volume — the void is the product', dash: null },
      { id: 'mach', color: TOKENS.faint, label: 'Structure and machinery, ghosted', dash: null },
    ];
  }
  if (mode === 'load-paths') {
    return [
      { id: 'high', color: TOKENS.warm, label: 'Higher illustrative load-path density', dash: null },
      { id: 'low', color: TOKENS.faint, label: 'Lower', dash: null },
    ];
  }
  return null;
}

void resolveMaterial; void stationT; void profileR;
