/* Materials and the semantic colour system.
 *
 * The colours are the pinkrobotics.ca design tokens, not a new palette: --bg, --panel, --line,
 * --warm (pink), --cool, --green, --bone, --faint, --muted. The site's own encoding — warm means
 * built and running, cool means studied but not built — is why the vacuum structure is PALE and
 * unsaturated rather than glowing: none of it exists.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. Every material also carries `weight` (line thickness) and
 * `dash` (stroke pattern), and every category has a text label in the DOM legend. A viewer who
 * cannot distinguish the water blue from the cryogenic violet can still read the dash pattern and
 * the legend.
 */

/** The site tokens, resolved at import so node (figure export) has them too. */
export const TOKENS = {
  bg: '#0a0a0c',
  panel: '#111114',
  line: '#232329',
  lineStrong: '#33333c',
  text: '#e8e8ea',
  bone: '#c9c3b6',
  muted: '#9a9aa5',
  faint: '#74747f',
  warm: '#ff4fa3',
  warmDim: '#8c2a58',
  cool: '#7aa2c8',
  coolDim: '#47637d',
  green: '#46d06e',
  red: '#d98b80',
  amber: '#e3a94e',
  gold: '#f0c05a',
  violet: '#8f8fd8',
  hazard: '#e0674f',
};

/** Category → tone. This is the legend, in code. */
export const CATEGORY_TONE = {
  structure: { color: TOKENS.bone, label: 'Structure', dash: null },
  vacuum: { color: TOKENS.muted, label: 'Vacuum structure and cells', dash: null },
  water: { color: TOKENS.cool, label: 'Water', dash: null },
  cryogenic: { color: TOKENS.violet, label: 'Liquid nitrogen and cold', dash: [7, 3] },
  power: { color: TOKENS.amber, label: 'Electrical power', dash: [11, 3, 2, 3] },
  propulsion: { color: TOKENS.green, label: 'Propulsion', dash: null },
  control: { color: '#3fb8c4', label: 'Control surfaces', dash: [4, 3] },
  sensors: { color: '#e39ec6', label: 'Sensing', dash: [2, 3] },
  compute: { color: TOKENS.warm, label: 'Mind and safety', dash: null },
  maintenance: { color: TOKENS.faint, label: 'Maintenance and logistics', dash: [3, 4] },
};

export const STATE_TONE = {
  failed: TOKENS.hazard,
  warning: TOKENS.red,
  inactive: TOKENS.faint,
  selected: TOKENS.warm,
  solar: TOKENS.gold,
  net: TOKENS.warm,
  mass: TOKENS.bone,
  aero: TOKENS.muted,
};

/**
 * Materials. `kind` picks the shader path:
 *   surface   flat-shaded solid, lit
 *   glass     translucent solid (fairing in ghost mode, tank shells)
 *   line      screen-space-width line, unlit
 *   flat      unlit solid (thrust discs, fill bodies)
 */
export const MATERIALS = {
  fairing: { kind: 'surface', color: '#54555f', spec: 0.30, opacity: 1, ghost: 0.10, edge: TOKENS.lineStrong },
  solar: { kind: 'surface', color: '#39435c', spec: 0.42, opacity: 1, ghost: 0.14, edge: TOKENS.gold, tone: 'power' },

  /** High-visibility underside. A painted surface, not an emissive one — it must read as pink
   *  under the scene light without glowing like a sign. */
  underside: { kind: 'surface', color: '#d4497f', spec: 0.20, opacity: 1, ghost: 0.12, tone: 'sensors' },

  lattice: { kind: 'line', color: TOKENS.muted, weight: 1.0, opacity: 0.85 },
  frame: { kind: 'line', color: TOKENS.bone, weight: 1.7, opacity: 1 },
  /** Hull meridians and station rings drawn over the solid skin — the "light shell". */
  shellWire: { kind: 'line', color: TOKENS.bone, weight: 0.75, opacity: 0.30 },
  joint: { kind: 'line', color: TOKENS.faint, weight: 1.2, opacity: 0.9, dash: [3, 4] },
  cell: { kind: 'line', color: TOKENS.muted, weight: 0.8, opacity: 0.5 },
  cellFocus: { kind: 'glass', color: TOKENS.muted, opacity: 0.16 },
  loadpath: { kind: 'line', color: TOKENS.warm, weight: 2.4, opacity: 0.95 },
  corridor: { kind: 'glass', color: TOKENS.faint, opacity: 0.20 },

  tankShell: { kind: 'glass', color: TOKENS.coolDim, opacity: 0.30, edge: TOKENS.cool },
  water: { kind: 'flat', color: TOKENS.cool, opacity: 0.92 },
  spray: { kind: 'flat', color: TOKENS.cool, opacity: 0.55 },      // falling release droplets
  airflow: { kind: 'flat', color: '#cfe0ee', opacity: 0.16 },      // rotor / blower wash streaks
  motionline: { kind: 'flat', color: '#aebccb', opacity: 0.12 },   // relative-wind speed lines
  windline: { kind: 'flat', color: '#8fb8a8', opacity: 0.13 },     // ambient wind streaks
  pipe: { kind: 'surface', color: TOKENS.coolDim, spec: 0.2, opacity: 1 },
  outlet: { kind: 'surface', color: TOKENS.cool, spec: 0.2, opacity: 1 },
  hose: { kind: 'surface', color: TOKENS.coolDim, spec: 0.15, opacity: 1 },

  cryoShell: { kind: 'glass', color: '#4a4a78', opacity: 0.32, edge: TOKENS.violet },
  cryo: { kind: 'flat', color: TOKENS.violet, opacity: 0.92 },

  /** The full vacuum-fill spheres of the 'vacuum' view. Estate pink, lit, fully opaque: in that
   *  view the evacuated volume IS the subject and everything else is ghosted around it. */
  vacuumFill: { kind: 'surface', color: TOKENS.warm, spec: 0.18, opacity: 1 },

  machine: { kind: 'surface', color: '#6a6b76', spec: 0.35, opacity: 1 },
  battery: { kind: 'surface', color: '#7d6841', spec: 0.25, opacity: 1, tone: 'power' },
  bus: { kind: 'line', color: TOKENS.amber, weight: 1.8, opacity: 0.9, dash: [11, 3, 2, 3] },

  rotor: { kind: 'surface', color: '#5c6b60', spec: 0.45, opacity: 1, tone: 'propulsion' },
  thrustDisc: { kind: 'flat', color: TOKENS.green, opacity: 0 },
  fan: { kind: 'surface', color: '#5c6b60', spec: 0.3, opacity: 1, tone: 'propulsion' },
  surface: { kind: 'surface', color: '#64736a', spec: 0.3, opacity: 1, tone: 'control' },

  sensor: { kind: 'surface', color: '#7b4763', spec: 0.4, opacity: 1, tone: 'sensors' },
  compute: { kind: 'surface', color: '#784465', spec: 0.35, opacity: 1, tone: 'compute' },
  safety: { kind: 'surface', color: TOKENS.warmDim, spec: 0.4, opacity: 1, tone: 'compute' },

  // The face exposed by a cutaway. Analytic, so it never z-fights the surface it caps.
  capFace: { kind: 'surface', color: '#6b6b78', spec: 0.08, opacity: 1, edge: '#8a8a98' },

  // overlays
  arrow: { kind: 'flat', color: TOKENS.warm, opacity: 0.95 },
  ghostEdge: { kind: 'line', color: TOKENS.lineStrong, weight: 1, opacity: 0.6 },
  water3d: { kind: 'flat', color: TOKENS.cool, opacity: 0.55 },
  terrain: { kind: 'surface', color: '#1a1c1a', spec: 0.05, opacity: 1 },
  lake: { kind: 'flat', color: '#16283a', opacity: 1 },
  smoke: { kind: 'flat', color: '#6a5a52', opacity: 0.22 },
};

/** #rrggbb → [r,g,b] in 0..1. */
export function rgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? [h[0] + h[0], h[1] + h[1], h[2] + h[2]]
    : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return v.map((s) => parseInt(s, 16) / 255);
}

export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  const c = A.map((v, i) => v + (B[i] - v) * t);
  return `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The material a node should draw with, after the view mode and its runtime state have their say. */
export function resolveMaterial(nodeMaterial, opts = {}) {
  const base = MATERIALS[nodeMaterial] || MATERIALS.machine;
  if (opts.failed) return { ...base, color: STATE_TONE.failed, opacity: Math.max(0.5, base.opacity) };
  if (opts.selected) return { ...base, color: STATE_TONE.selected };
  if (opts.dimmed) {
    return { ...base, color: mix(base.color, TOKENS.bg, 0.62), opacity: base.opacity * 0.55 };
  }
  if (opts.ghosted) {
    return { ...base, kind: base.kind === 'surface' ? 'glass' : base.kind,
      opacity: base.ghost !== undefined ? base.ghost : base.opacity * 0.16 };
  }
  return base;
}

/** The DOM legend rows for a systems view — colour, dash and words together. */
export function legendRows(categories) {
  return categories.map((c) => ({ id: c, ...CATEGORY_TONE[c] }));
}

/** The claim-level badge styling. Words first; colour second. */
export const CLAIM_TONE = {
  'known-physics': { color: TOKENS.bone, label: 'Known physics' },
  'reference-assumption': { color: TOKENS.cool, label: 'Reference assumption' },
  'conceptual-layout': { color: TOKENS.faint, label: 'Conceptual layout' },
  'future-research': { color: TOKENS.warm, label: 'Future research' },
};
