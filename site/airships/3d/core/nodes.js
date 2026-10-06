/* The scene graph.
 *
 * A node is a named, categorised transform with optional geometry. The whole airship is one tree
 * of these, built by model/build.js. The renderer walks it; selection, isolation, clipping, the
 * DOM component list and the exports all address nodes by `id`.
 *
 * IDs are the contract. They are stable semantic names (`PrimaryRotorStation_02`), not display
 * labels and not array indices, because everything outside this module — Fable's page, the
 * metadata registry, saved lab states, the failure list in AirshipVisualState — refers to parts
 * by id. `buildIndex()` enforces uniqueness; a duplicate is a build error, not a warning.
 */

import { m4compose, m4identity, m4mul } from './math.js?v=91301eab';

/** The ten semantic categories. Systems view, palette and the metadata schema all key off these. */
export const CATEGORIES = [
  'structure', 'vacuum', 'water', 'cryogenic', 'power',
  'propulsion', 'control', 'sensors', 'compute', 'maintenance',
];

/**
 * @param {object} spec
 * @param {string} spec.id           unique semantic id
 * @param {string} [spec.category]   one of CATEGORIES; inherited from the parent when omitted
 * @param {number[]} [spec.p]        local translation
 * @param {number[]} [spec.r]        local euler XYZ (applied Z*Y*X)
 * @param {number|number[]} [spec.s] local scale
 * @param {object} [spec.geom]       geometry record (see model/geom.js)
 * @param {string} [spec.draw]       'solid' | 'lines' | 'instanced' | 'instancedLines' | null
 * @param {string} [spec.material]   material key in render/palette.js
 * @param {boolean} [spec.selectable] whether a click can pick it (default: has metadata)
 * @param {number} [spec.lod]        minimum detail tier that shows it (0 map … 3 close cutaway)
 */
export function node(spec) {
  return {
    id: spec.id,
    category: spec.category || null,
    p: spec.p ? spec.p.slice() : [0, 0, 0],
    r: spec.r ? spec.r.slice() : [0, 0, 0],
    s: spec.s === undefined ? 1 : spec.s,
    geom: spec.geom || null,
    draw: spec.draw || (spec.geom ? spec.geom.kind : null),
    material: spec.material || null,
    selectable: spec.selectable !== undefined ? spec.selectable : true,
    lod: spec.lod === undefined ? 0 : spec.lod,
    // Runtime state, mutated per frame by the animation drivers. Kept on the node (not in a
    // parallel map) so a driver only has to hold the node reference it already resolved.
    visible: true,
    opacity: 1,
    failed: false,
    tint: null,
    fill: spec.fill === undefined ? 0 : spec.fill,   // 0..1 for tanks: how full it reads
    children: [],
    parent: null,
    world: m4identity(),
    _localDirty: true,
    _local: m4identity(),
  };
}

export function addChild(parent, child) {
  child.parent = parent;
  if (child.category === null) child.category = parent.category;
  parent.children.push(child);
  return child;
}

/** Convenience: create and attach in one call. */
export const child = (parent, spec) => addChild(parent, node(spec));

/** Mark a node's local transform stale — call after mutating p/r/s. */
export function touch(n) {
  n._localDirty = true;
}

export function setPos(n, p) { n.p[0] = p[0]; n.p[1] = p[1]; n.p[2] = p[2]; n._localDirty = true; }
export function setRot(n, r) { n.r[0] = r[0]; n.r[1] = r[1]; n.r[2] = r[2]; n._localDirty = true; }
export function setScale(n, s) { n.s = s; n._localDirty = true; }

/** Recompute world matrices for the whole tree. Called once per frame before drawing. */
export function updateWorld(root, parentWorld = null) {
  if (root._localDirty) {
    m4compose(root.p, root.r, root.s, root._local);
    root._localDirty = false;
  }
  if (parentWorld) m4mul(parentWorld, root._local, root.world);
  else root.world.set(root._local);
  for (const c of root.children) updateWorld(c, root.world);
}

/** Depth-first walk. Return `false` from `fn` to skip a subtree. */
export function walk(root, fn) {
  if (fn(root) === false) return;
  for (const c of root.children) walk(c, fn);
}

/**
 * Build the id → node index and verify uniqueness.
 * @throws if two nodes share an id, or a node carries an unknown category.
 */
export function buildIndex(root) {
  const index = new Map();
  walk(root, (n) => {
    if (index.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    if (n.category && !CATEGORIES.includes(n.category)) {
      throw new Error(`node ${n.id}: unknown category "${n.category}"`);
    }
    index.set(n.id, n);
  });
  return index;
}

/** Every id in the tree, in tree order. */
export function ids(root) {
  const out = [];
  walk(root, (n) => { out.push(n.id); });
  return out;
}

/** Nodes whose id starts with `prefix` — the way the drivers grab "all rotor stations". */
export function byPrefix(index, prefix) {
  const out = [];
  for (const [id, n] of index) if (id.startsWith(prefix)) out.push(n);
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Reset the per-frame runtime state so a driver never inherits the previous frame's overrides. */
export function resetRuntime(root) {
  walk(root, (n) => {
    n.visible = true;
    n.opacity = 1;
    n.tint = null;
  });
}
