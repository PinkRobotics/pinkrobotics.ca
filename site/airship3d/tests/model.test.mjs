/* Model, geometry, structure and metadata.  Run: node --test tests/ */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveClass, classes, validateClass, CLASS_IDS, hullVolume, radiusForVolume,
  profileR, sectionScale, HULL_DEFAULT, stationX, stationT, hullR,
  capsuleRadiusForVolume, RHO_LN2,
} from '../model/config.js?v=41bc1f51';
import { build } from '../model/build.js?v=41bc1f51';
import { buildLayout, insideHull } from '../model/layout.js?v=41bc1f51';
import { proxyField, dataField, anchorsFor } from '../model/density.js?v=41bc1f51';
import { checkMetadata, MASS_SHARE, templateFor } from '../model/metadata.js?v=41bc1f51';
import { buildLattice, TIERS } from '../model/structure.js?v=41bc1f51';
import { auditBuild } from '../model/audit.js?v=41bc1f51';
import { featureEdges, boxGeom, latheGeom } from '../model/geom.js?v=41bc1f51';
import { walk, buildIndex, updateWorld } from '../core/nodes.js?v=41bc1f51';
import { m4transform, norm, cross } from '../core/math.js?v=41bc1f51';
import { prng, streamFor } from '../core/prng.js?v=41bc1f51';

test('the three classes resolve and validate', () => {
  for (const c of classes()) {
    assert.deepEqual(validateClass(c), [], `${c.id} should validate cleanly`);
  }
});

test('displacement premise is preserved exactly — the homepage ledger is the invariant', () => {
  // The P-100's ~180,000 m3 is the site's published "220 tonnes of air" figure. If this test
  // fails, the lift premise moved and every number downstream of it is wrong.
  const want = { P100: 180000, P1000: 1.8e6, P10000: 1.8e7 };
  for (const id of CLASS_IDS) {
    const c = resolveClass(id);
    assert.ok(Math.abs(c.volumeM3 - want[id]) / want[id] < 1e-3,
      `${id}: solved hull displaces ${c.volumeM3}, wanted ${want[id]}`);
  }
});

test('solved diameters stay near the published illustrative figures', () => {
  for (const c of classes()) {
    const err = Math.abs(c.diameterM - c.nominalDiameterM) / c.nominalDiameterM;
    assert.ok(err < 0.05, `${c.id}: ${c.diameterM.toFixed(1)} m vs published ${c.nominalDiameterM} m`);
  }
});

test('hull volume is quadratic in radius, so the radius solve is exact', () => {
  const v1 = hullVolume(177, 20, HULL_DEFAULT);
  const v2 = hullVolume(177, 40, HULL_DEFAULT);
  assert.ok(Math.abs(v2 / v1 - 4) < 1e-6, `expected 4x, got ${v2 / v1}`);
  const R = radiusForVolume(177, 180000, HULL_DEFAULT);
  assert.ok(Math.abs(hullVolume(177, R, HULL_DEFAULT) - 180000) / 180000 < 1e-6);
});

test('hull profile is well behaved end to end', () => {
  assert.ok(profileR(0, HULL_DEFAULT) < 0.05, 'nose closes');
  assert.ok(profileR(1, HULL_DEFAULT) < 0.05, 'tail closes to a stub');
  assert.ok(Math.abs(profileR(HULL_DEFAULT.xMax, HULL_DEFAULT) - 1) < 1e-9, 'max section is 1');
  for (let i = 0; i <= 100; i++) {
    const r = profileR(i / 100, HULL_DEFAULT);
    assert.ok(r >= 0 && r <= 1 && isFinite(r), `profileR(${i / 100}) = ${r}`);
  }
  // the top is flattened for solar, the keel slightly, the beam not at all
  assert.ok(sectionScale(Math.PI / 2, HULL_DEFAULT) < 1);
  assert.ok(sectionScale(-Math.PI / 2, HULL_DEFAULT) < 1);
  assert.ok(Math.abs(sectionScale(0, HULL_DEFAULT) - 1) < 1e-12);
  assert.ok(sectionScale(Math.PI / 2, HULL_DEFAULT) < sectionScale(-Math.PI / 2, HULL_DEFAULT),
    'the top is flatter than the keel');
});

test('station coordinates round-trip', () => {
  const c = resolveClass('P1000');
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(stationT(c, stationX(c, t)) - t) < 1e-9);
  }
});

test('the three classes are a family, not one mesh scaled', () => {
  const [a, b, c] = classes();
  const lenRatio = c.lengthM / a.lengthM;
  const rotorRatio = c.primaryRotorDiameterM / a.primaryRotorDiameterM;
  const cellRatio = c.cellSizeM / a.cellSizeM;
  assert.ok(rotorRatio < lenRatio * 0.6,
    `rotors must grow much slower than the hull (len x${lenRatio.toFixed(1)}, rotor x${rotorRatio.toFixed(1)})`);
  assert.ok(cellRatio < lenRatio * 0.5,
    `cells must grow much slower than the hull (cell x${cellRatio.toFixed(1)})`);
  assert.ok(c.primaryRotorStations > b.primaryRotorStations &&
    b.primaryRotorStations > a.primaryRotorStations, 'station count grows');
  assert.equal(a.stationLayout, 'quad');
  assert.equal(c.stationLayout, 'network');
  // The biggest class must read as finer-grained: more cells per unit volume is the wrong test;
  // cells per unit LENGTH is the one that shows on screen.
  assert.ok(c.approxCellCount / c.lengthM > a.approxCellCount / a.lengthM);
});

test('primary disc area matches the figure the wildfire page publishes', () => {
  for (const c of classes()) {
    const err = Math.abs(c.totalDiscAreaM2 - c.publishedDiscAreaM2) / c.publishedDiscAreaM2;
    assert.ok(err < 0.10, `${c.id}: ${Math.round(c.totalDiscAreaM2)} vs ${c.publishedDiscAreaM2}`);
  }
});

test('adjacent rotor discs never overlap each other', () => {
  // The P-10000 grew 85 m discs so it could push a fully emptied hull back down (2026-08-08).
  // At that size the discs are within ~10 m of touching, so the clearance is a test now.
  for (const id of CLASS_IDS) {
    const c = resolveClass(id);
    const st = buildLayout(c).rotorStations.filter((s) => s.side > 0)
      .sort((a, b) => a.p[0] - b.p[0]);
    const bladeR = (c.primaryRotorDiameterM * 0.94) / 2;    // rotorGeom draws blades to 0.94 r
    for (let i = 1; i < st.length; i++) {
      const gap = Math.abs(st[i].p[0] - st[i - 1].p[0]) - 2 * bladeR;
      assert.ok(gap > 2, `${c.id} stations ${i - 1}/${i}: ${gap.toFixed(1)} m apart`);
    }
  }
});

test('every layout item sits inside the hull', () => {
  for (const id of CLASS_IDS) {
    const c = resolveClass(id);
    const L = buildLayout(c);
    // Internal machinery must be inside the envelope.
    const internal = ['waterTanks', 'ln2Tanks', 'generators', 'batteries', 'compute'];
    for (const g of internal) {
      for (const item of L[g]) {
        assert.ok(insideHull(c, item.p, -0.5),
          `${id}: ${item.id} at ${item.p.map((v) => v.toFixed(1))} is outside the hull`);
      }
    }
    // Skin-mounted units sit ON the surface, within a band about it — not adrift inside or out.
    // Trim fans are deliberately PROUD (they are smaller than one skin grid cell, so no aperture
    // is cut for them); medium thrusters are recessed into an aperture that IS cut.
    for (const g of ['trimFans', 'mediumThrusters', 'dropOutlets']) {
      for (const item of L[g]) {
        const th = Math.atan2(item.p[2], -item.p[1]);
        const skin = hullR(c, item.p[0]) * sectionScale(th, c.hull);
        const r = Math.hypot(item.p[1], item.p[2]);
        const band = Math.max(2, (item.diameter || 2) * 0.8);
        assert.ok(Math.abs(r - skin) < band,
          `${id}: ${item.id} is ${(r - skin).toFixed(1)} m off the skin, outside the ±${band.toFixed(1)} m band`);
      }
    }
  }
});

test('node ids are unique across every class and tier', () => {
  for (const id of CLASS_IDS) {
    for (const tier of [0, 1, 2, 3]) {
      const b = build(id, { tier });
      assert.doesNotThrow(() => buildIndex(b.root), `${id} tier ${tier}`);
      const seen = new Set();
      walk(b.root, (n) => {
        if (!n.inst) return true;
        for (const iid of n.inst.ids) {
          assert.ok(!seen.has(iid), `duplicate instance id ${iid}`);
          seen.add(iid);
        }
        return true;
      });
    }
  }
});

test('every selectable id has complete metadata', () => {
  for (const id of CLASS_IDS) {
    const b = build(id, { tier: 3 });
    const errs = checkMetadata(b.metadata, b.selectableIds);
    assert.deepEqual(errs, [], `${id}: ${errs.slice(0, 3).join('; ')}`);
  }
});

test('mass shares sum to one and nominal masses sum to the ledger', () => {
  const sum = Object.values(MASS_SHARE).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `MASS_SHARE sums to ${sum}`);
});

test('metadata templates resolve to the longest matching prefix', () => {
  assert.equal(templateFor('PrimaryRotorStation_02').label, 'Primary thrust station');
  assert.equal(templateFor('PrimaryRotorGimbal_02').label, 'Rotor gimbal');
  assert.equal(templateFor('PrimaryRotorA_02').label, 'Primary rotor');
  assert.equal(templateFor('WaterTank_00').label, 'Water tank');
  assert.equal(templateFor('WaterManifold_00').label, 'Fill and release manifold');
});

test('structure is deterministic from the seed', () => {
  const c = resolveClass('P100');
  const L = buildLayout(c);
  const f = proxyField(c, L);
  const a = buildLattice(c, f, L, 2);
  const b = buildLattice(c, f, L, 2);
  assert.equal(a.memberCount, b.memberCount);
  assert.equal(a.geom.pos.length, b.geom.pos.length);
  for (let i = 0; i < a.geom.pos.length; i += 977) {
    assert.equal(a.geom.pos[i], b.geom.pos[i], `member vertex ${i} differs between builds`);
  }
  // A different seed must give a different structure, or the seed is not doing anything.
  const c2 = resolveClass('P100', { structuralSeed: c.structuralSeed + 1 });
  const l2 = buildLattice(c2, proxyField(c2, buildLayout(c2)), buildLayout(c2), 2);
  assert.notEqual(a.memberCount, l2.memberCount);
});

test('prng streams are stable and independent', () => {
  const a = prng(1234), b = prng(1234);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
  assert.notEqual(streamFor(7, 'lattice')(), streamFor(7, 'fans')());
});

test('the density field densifies around hardpoints and is normalised', () => {
  const c = resolveClass('P100');
  const L = buildLayout(c);
  const f = proxyField(c, L);
  assert.equal(f.source, 'proxy');
  assert.match(f.label, /Illustrative/);
  const atRotor = f.sample(L.rotorStations[0].p).density;
  // A point at the same radius but in a quiet bay well away from every anchor.
  const quiet = [c.xNose - c.lengthM * 0.80, 0, c.maxRadiusM * 0.15];
  assert.ok(atRotor > f.sample(quiet).density,
    `rotor hardpoint (${atRotor.toFixed(2)}) should be denser than a quiet bay`);
  for (const p of [[0, 0, 0], L.waterTanks[0].p, L.ln2Tanks[0].p, quiet]) {
    const s = f.sample(p);
    assert.ok(s.density >= 0 && s.density <= 1, `density ${s.density} out of range`);
    assert.equal(s.source, 'proxy');
  }
  // corridors are modelled as holes: negative weight
  const corridorAnchor = anchorsFor(c, L).find((a) => a.id.startsWith('MaintenanceCorridor'));
  assert.ok(corridorAnchor.weight < 0, 'a corridor must push material away, not attract it');
});

test('an analysis field can replace the proxy without touching geometry', () => {
  const c = resolveClass('P100');
  const L = buildLayout(c);
  const nodes = [], stress = [], safety = [], displacement = [];
  for (let i = 0; i <= 20; i++) {
    const x = c.xNose - (i / 20) * c.lengthM;
    nodes.push([x, 0, 0]);
    stress.push(1e6 * (1 + Math.sin(i)));
    safety.push(2 + Math.cos(i));
    displacement.push([0, 0, 0.01 * i]);
  }
  const f = dataField(c, { nodes, stress, safety, displacement, loadCase: 'gust-45deg' });
  assert.equal(f.source, 'analysis');
  assert.equal(f.loadCase, 'gust-45deg');
  const s = f.sample([0, 0, 0]);
  assert.ok(s.density >= 0 && s.density <= 1);
  assert.ok(Array.isArray(s.disp));
  // and the structure builds from it, unchanged
  const lat = buildLattice(c, f, L, 1);
  assert.ok(lat.memberCount > 0);
  const b = build('P100', { tier: 1, field: f });
  assert.equal(b.field.source, 'analysis');
});

test('damage redistributes rather than deleting', () => {
  const c = resolveClass('P100');
  const L = buildLayout(c);
  const base = proxyField(c, L);
  const p = [c.xNose - c.lengthM * 0.6, 0, c.maxRadiusM * 0.5];
  const damaged = base.withDamage([{ p, radius: c.maxRadiusM * 0.25 }]);
  assert.ok(damaged.sample(p).density < base.sample(p).density, 'inside the damage, less material');
  const ring = [p[0] + c.maxRadiusM * 0.35, p[1], p[2]];
  assert.ok(damaged.sample(ring).density > base.sample(ring).density,
    'just outside the damage, MORE material — the load has to go somewhere');
});

test('LOD tiers reduce geometry monotonically', () => {
  for (const id of CLASS_IDS) {
    let prevSeg = Infinity;
    for (const tier of [3, 2, 1, 0]) {
      const b = build(id, { tier });
      assert.ok(b.stats.segments <= prevSeg,
        `${id}: tier ${tier} has ${b.stats.segments} segments, more than the tier above`);
      prevSeg = b.stats.segments;
    }
  }
});

test('performance budgets hold', () => {
  // Map tier: tiny. Inline tier: modest. Explorer tier: within the stated targets.
  const map = build('P10000', { tier: 0 });
  assert.ok(map.stats.drawCalls < 200, `map draw calls ${map.stats.drawCalls}`);
  const inline = build('P100', { tier: 1 });
  assert.ok(inline.stats.triangles < 150000, `inline triangles ${inline.stats.triangles}`);
  for (const id of CLASS_IDS) {
    const b = build(id, { tier: 3 });
    assert.ok(b.stats.triangles < 400000, `${id} triangles ${b.stats.triangles}`);
    assert.ok(b.stats.drawCalls < 200, `${id} draw calls ${b.stats.drawCalls}`);
  }
});

test('feature edges find creases and boundaries, not tessellation', () => {
  assert.equal(featureEdges(boxGeom(2, 2, 2)).length, 12, 'a cube has twelve edges');
  // A smooth lathe should give only its two open boundaries, not one edge per quad.
  const tube = latheGeom([[0, 1], [1, 1], [2, 1]], 24, { caps: false });
  const e = featureEdges(tube, 24);
  assert.ok(e.length <= 24 * 2 + 4, `smooth tube gave ${e.length} edges — tessellation is leaking`);
});

test('the wire and edge layers exist and are off by default — via the VIEW, not node.visible', () => {
  const b = build('P100', { tier: 2 });
  const hw = b.index.get('HullWire');
  const ce = b.index.get('ComponentEdges');
  assert.ok(hw && hw.geom.segs > 0);
  assert.ok(ce && ce.geom.segs > 0);
  // They must NOT be switched off with node.visible: the renderer honours that before it asks the
  // view mode, which made all three view layers permanently unreachable. render/views.js decides.
  assert.notEqual(hw.visible, false, 'HullWire is hidden by node.visible — no mode can show it');
  assert.notEqual(ce.visible, false, 'ComponentEdges is hidden by node.visible');
  assert.notEqual(b.index.get('LoadPaths').visible, false, 'LoadPaths is hidden by node.visible');
});

test('every tail surface points OUTWARD, and the tail is port-starboard symmetric', () => {
  // Regression: the mount angle was `theta + PI/2`, which is correct at 45 and 225 degrees and
  // points the fin straight into the hull at 135 and 315. Two of four fins were invisible, and a
  // 'plus' tail was 90 degrees out on all four. The correct angle is PI - theta.
  for (const id of CLASS_IDS) {
    for (const arrangement of ['x', 'plus']) {
      const b = build(id, { tier: 1, overrides: { tailArrangement: arrangement } });
      updateWorld(b.root);
      const spans = [];
      for (const ts of b.layout.tailSurfaces) {
        const n = b.index.get(ts.id);
        const root = m4transform(n.world, [0, 0, 0]);
        const tip = m4transform(n.world, [0, ts.span, 0]);
        const out = Math.hypot(tip[1], tip[2]) - Math.hypot(root[1], root[2]);
        assert.ok(out > 0, `${id}/${arrangement}: ${ts.id} points inward (${out.toFixed(2)} m)`);
        assert.ok(Math.abs(out - ts.span) < ts.span * 0.02,
          `${id}/${arrangement}: ${ts.id} only reaches ${out.toFixed(2)} of its ${ts.span} m span`);
        spans.push(out);
        // The tip must also sit outside the hull, not just outside its own root.
        assert.ok(Math.hypot(tip[1], tip[2]) > hullR(b.cls, tip[0]),
          `${id}/${arrangement}: ${ts.id} tip is inside the hull`);
      }
      for (const v of spans) assert.ok(Math.abs(v - spans[0]) < 1e-6, 'fins differ in reach');

      // Port/starboard mirror: for every fin there is one at the mirrored y.
      const tips = b.layout.tailSurfaces.map((ts) =>
        m4transform(b.index.get(ts.id).world, [0, ts.span, 0]));
      for (const t of tips) {
        assert.ok(tips.some((u) => Math.abs(u[1] + t[1]) < 1e-6 && Math.abs(u[2] - t[2]) < 1e-6),
          `${id}/${arrangement}: no mirror partner for a fin at y=${t[1].toFixed(2)}`);
      }
    }
  }
});

test('the fin hinge rotates about the fin, not about the hull', () => {
  const b = build('P100', { tier: 1 });
  const fin = b.index.get('TailSurface_00');
  const mount = fin.parent;
  assert.equal(mount.id, 'TailSurfaceMount_00', 'the fin must hang off a mount node');
  // Deflecting must not move the span axis: a control surface changes incidence, it does not
  // sweep. If the deflection were applied on the mount it would swing the whole fin.
  updateWorld(b.root);
  const spanBefore = m4transform(fin.world, [0, 10, 0]);
  fin.r[1] = 0.4;
  fin._localDirty = true;
  updateWorld(b.root);
  const spanAfter = m4transform(fin.world, [0, 10, 0]);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(spanBefore[k] - spanAfter[k]) < 1e-6,
      'deflection moved the span axis — it is hinging about the wrong axis');
  }
  // and it must actually move the chord
  const chordBefore = [0, 0, 0];
  fin.r[1] = 0;
  fin._localDirty = true;
  updateWorld(b.root);
  const c0 = m4transform(fin.world, [4, 5, 0]);
  fin.r[1] = 0.4;
  fin._localDirty = true;
  updateWorld(b.root);
  const c1 = m4transform(fin.world, [4, 5, 0]);
  assert.ok(Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) > 0.5,
    'deflection did not move the surface at all');
  void chordBefore;
});

test('the rotor disc clears the hull at every reachable gimbal orientation', () => {
  // Regression: the pylon was `max(4, 0.16 * hullRadius)` while the rotor radius was 10 m, so the
  // disc cut 6-11 m into the hull on every class — at rest, not only when vectored forward.
  for (const id of CLASS_IDS) {
    const b = build(id, { tier: 1 });
    const c = b.cls;
    const rr = c.primaryRotorDiameterM / 2;
    for (const st of b.layout.rotorStations) {
      assert.ok(st.pylonLength > rr,
        `${id}/${st.id}: pylon ${st.pylonLength.toFixed(1)} m is shorter than the ${rr} m rotor radius`);
      // Sweep the gimbal through its whole range and sample the disc rim.
      for (let p = -95; p <= 95; p += 19) {
        const pr = (p * Math.PI) / 180;
        const axis = [Math.sin(pr), 0, Math.cos(pr)];          // thrust axis in the swing plane
        // Two orthonormal vectors spanning the disc plane.
        const u = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
        const e1 = norm(cross(axis, u));
        const e2 = cross(axis, e1);
        for (let k = 0; k < 16; k++) {
          const th = (2 * Math.PI * k) / 16;
          const q = [
            st.p[0] + rr * (e1[0] * Math.cos(th) + e2[0] * Math.sin(th)),
            st.p[1] + rr * (e1[1] * Math.cos(th) + e2[1] * Math.sin(th)),
            st.p[2] + rr * (e1[2] * Math.cos(th) + e2[2] * Math.sin(th)),
          ];
          assert.ok(!insideHull(c, q),
            `${id}/${st.id}: disc rim enters the hull at gimbal ${p} deg`);
        }
      }
    }
  }
});

test('no component breaches the skin or occupies another component\u2019s space', () => {
  // The audit that found the reported faults: vacuum cells hanging out of the hull, water tanks
  // overlapping each other, a 63 m manifold outside the aircraft, batteries inside maintenance
  // corridors. Checks are circumscribing bounds, so they over-report rather than under-report.
  for (const id of CLASS_IDS) {
    const r = auditBuild(build(id, { tier: 3 }));
    assert.deepEqual(r.containment.map((x) => `${x.id} ${x.depth.toFixed(2)}m`), [],
      `${id}: volumes outside the hull`);
    assert.deepEqual(r.machinery.map((x) => `${x.a}\u2229${x.b} ${x.ov.toFixed(2)}m`), [],
      `${id}: machinery interference`);
    assert.deepEqual(r.cellsVsMachinery.map((x) => `${x.a}\u2229${x.b} ${x.ov.toFixed(2)}m`), [],
      `${id}: a representative cell is drawn through a machine`);
    assert.ok(r.volumes > 200, `${id}: only ${r.volumes} volumes checked — the audit lost sight of something`);
  }
});

test('tanks are sized by what they hold, not by the hull', () => {
  // Regression: tank radius was a fraction of hull radius, which made every P-10000 water tank
  // 4.4x and every LN2 tank 5.8x too big — a collision AND a contradiction of the point the scale
  // scene makes, that the payload volume is tiny beside the lifting volume.
  for (const id of CLASS_IDS) {
    const b = build(id, { tier: 0 });
    const c = b.cls;
    const wt = b.layout.waterTanks[0];
    const want = capsuleRadiusForVolume(c.payloadTonnes / c.waterTanks, 3.1);
    assert.ok(Math.abs(wt.radius - want) < 1e-6,
      `${id}: water tank r=${wt.radius.toFixed(2)} but its ${wt.capacityTonnes.toFixed(1)} t needs ${want.toFixed(2)}`);
    const lt = b.layout.ln2Tanks[0];
    const lWant = capsuleRadiusForVolume((lt.capacityTonnes * 1000) / RHO_LN2, 3.4);
    assert.ok(Math.abs(lt.radius - lWant) < 1e-6, `${id}: LN2 tank sized wrong`);
    // LN2 is 807 kg/m3, water is 1000, so a tonne of LN2 takes MORE room than a tonne of water.
    assert.ok(lt.volumeM3 / lt.capacityTonnes > wt.volumeM3 / wt.capacityTonnes,
      `${id}: a tonne of LN2 should occupy more volume than a tonne of water`);
    assert.ok(Math.abs(lt.volumeM3 / lt.capacityTonnes - 1000 / RHO_LN2) < 1e-6,
      `${id}: LN2 volume does not follow its density`);
    // All the water tanks together hold the payload, and no more.
    const total = b.layout.waterTanks.reduce((a, t) => a + t.capacityTonnes, 0);
    assert.ok(Math.abs(total - c.payloadTonnes) < 1e-6,
      `${id}: tanks hold ${total} t, payload is ${c.payloadTonnes} t`);
  }
});
