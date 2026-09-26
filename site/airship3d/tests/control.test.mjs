/* Actuators, allocation, mass, energy. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveClass, CLASS_IDS } from '../model/config.js?v=41bc1f51';
import { buildLayout } from '../model/layout.js?v=41bc1f51';
import { proxyField } from '../model/density.js?v=41bc1f51';
import { buildActuators, totalThrustN, idealDiscThrust, idealDiscPower } from '../control/actuators.js?v=41bc1f51';
import { allocate, clampToEnvelope, demoWrench, solve6 } from '../control/allocator.js?v=41bc1f51';
import { massState, forceSet, inertia, angularAccelDegS2, RHO_LN2, ln2VolumeM3 } from '../physics/mass.js?v=41bc1f51';
import { energyFlows, derivePower, ln2Ledger, pumpPowerMW } from '../physics/energy.js?v=41bc1f51';
import { defaultState } from '../physics/state.js?v=41bc1f51';
import { dot, len, norm, cross } from '../core/math.js?v=41bc1f51';

const rig = (id = 'P100') => {
  const cls = resolveClass(id);
  const layout = buildLayout(cls);
  const field = proxyField(cls, layout);
  const acts = buildActuators(cls, layout);
  const m = massState(cls, defaultState({ waterFraction: 1 }), layout);
  return { cls, layout, field, acts, m,
    ref: { weightN: m.weightN, armM: cls.lengthM / 2 },
    opts: { densityAt: (p) => field.sample(p).density } };
};

test('solve6 solves a known system', () => {
  const A = new Float64Array([
    4, 1, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0,
    0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7,
  ]);
  const b = [9, 10, 4, 15, 2, 21];
  const x = solve6(A, b);
  const want = [17 / 11, 31 / 11, 2, 3, 2, 3];
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(x[i] - want[i]) < 1e-9, `x${i}=${x[i]}`);
});

test('ideal disc thrust and power are inverses', () => {
  const T = idealDiscThrust(600, 5e6);
  assert.ok(Math.abs(idealDiscPower(600, T) - 5e6) / 5e6 < 1e-9);
});

test('actuator sets are built for every class with sane geometry', () => {
  for (const id of CLASS_IDS) {
    const { cls, acts } = rig(id);
    const prim = acts.filter((a) => a.kind === 'primary');
    assert.equal(prim.length, cls.primaryRotorStations);
    assert.equal(acts.filter((a) => a.kind === 'fan').length, cls.localTrimFans);
    for (const a of acts) {
      assert.ok(a.fMaxN > 0 && isFinite(a.fMaxN), `${a.id} fMax`);
      assert.ok(Math.abs(len(a.axis) - 1) < 1e-6, `${a.id} axis not unit`);
      assert.ok(len(a.r) < cls.lengthM, `${a.id} moment arm outside the vehicle`);
    }
    // Primary stations carry most of the thrust, as they should.
    const pT = prim.reduce((s, a) => s + a.fMaxN, 0);
    assert.ok(pT / totalThrustN(acts) > 0.6, `${id}: primaries only ${(pT / totalThrustN(acts) * 100).toFixed(0)}%`);
  }
});

test('a modest vertical demand is met almost exactly', () => {
  const { cls, acts, m, ref, opts } = rig();
  const w = [0, 0, 0.05 * m.weightN, 0, 0, 0];
  const r = allocate(acts, w, opts, ref);
  assert.ok(r.shortfall.force < 0.05, `shortfall ${(r.shortfall.force * 100).toFixed(1)}%`);
  assert.ok(r.powerMW > 0 && r.powerMW < cls.batteryPeakPowerMW + cls.generatorContinuousPowerMW,
    `power ${r.powerMW} MW exceeds the electrical system`);
});

test('allocation respects every actuator limit', () => {
  for (const id of CLASS_IDS) {
    const { acts, m, ref, opts } = rig(id);
    for (const kind of ['up', 'down', 'forward', 'lateral', 'yaw', 'pitch', 'roll', 'emergency']) {
      const r = allocate(acts, demoWrench(kind, resolveClass(id), m.totalTonnes * 1000), opts, ref);
      for (let i = 0; i < acts.length; i++) {
        const a = acts[i], s = r.solution[i];
        assert.ok(s.magnitude <= a.fMaxN * 1.0001,
          `${id}/${kind}: ${a.id} commanded ${s.magnitude} > fMax ${a.fMaxN}`);
        if (s.magnitude > 1e-6) {
          const c = clampToEnvelope(a, s.force);
          assert.ok(len(c.f) >= s.magnitude - 1e-3 * a.fMaxN,
            `${id}/${kind}: ${a.id} direction is outside its envelope`);
        }
      }
    }
  }
});

test('a fixed-axis fan can only ever push along its axis', () => {
  const { acts } = rig();
  const fan = acts.find((a) => a.kind === 'fan');
  const c = clampToEnvelope(fan, [fan.fMaxN, fan.fMaxN, fan.fMaxN]);
  const d = norm(c.f);
  assert.ok(Math.abs(Math.abs(dot(d, fan.axis)) - 1) < 1e-6, 'fan thrust left its axis');
});

test('a reversible station reaches any direction in its swing plane without a big slew', () => {
  // The rotors are reversible, so a station never has to swing a motor all the way round: with
  // +/-95 degrees of gimbal it can point at a direction or point away from it and reverse. Down
  // thrust in particular must cost ZERO gimbal travel.
  const { acts } = rig();
  const st = acts.find((a) => a.kind === 'primary');
  assert.equal(st.reversible, true, 'primary stations must be reversible');
  assert.ok(st.pitchMax <= (100 * Math.PI) / 180,
    'a reversible rotor does not need more than about 90 degrees of swing');

  for (let deg = 0; deg < 360; deg += 15) {
    const a = (deg * Math.PI) / 180;
    const wanted = [Math.sin(a), 0, Math.cos(a)];            // any direction in the swing plane
    const c = clampToEnvelope(st, wanted.map((v) => v * st.fMaxN));
    const got = norm(c.f);
    assert.ok(dot(got, wanted) > 0.999,
      `direction ${deg} deg unreachable: got [${got.map((v) => v.toFixed(2))}]`);
    // and the gimbal itself never travels more than 90 degrees from vertical to get there
    const travel = Math.acos(Math.abs(dot(c.axis, st.axis))) * 180 / Math.PI;
    assert.ok(travel <= 90.001, `gimbal travelled ${travel.toFixed(1)} deg for ${deg} deg of thrust`);
  }
  // Straight down: no slew at all, just a reversal.
  const down = clampToEnvelope(st, [0, 0, -st.fMaxN]);
  assert.ok(Math.abs(dot(down.axis, st.axis) - 1) < 1e-9, 'down thrust should not move the gimbal');
  assert.ok(dot(norm(down.f), [0, 0, -1]) > 0.999, 'down thrust should point down');

  // Out of the swing plane it is still limited — that constraint has NOT gone away.
  const side = clampToEnvelope(st, [0, st.fMaxN, 0]);
  assert.ok(dot(norm(side.f), [0, 1, 0]) < 0.6, 'a station must not reach straight abeam');
});

test('a descent commands reversal, not a 180-degree slew', () => {
  const { acts, m, ref, opts, cls } = rig();
  const r = allocate(acts, demoWrench('down', cls, m.totalTonnes * 1000), opts, ref);
  const prim = r.solution.filter((s) => s.kind === 'primary' && s.magnitude > 1);
  assert.ok(prim.length > 0, 'nothing was commanded');
  assert.ok(prim.every((s) => s.reversed), 'down thrust should reverse the rotors');
  assert.ok(prim.every((s) => s.gimbalRad < 0.02),
    `gimbals moved for a descent: ${prim.map((s) => (s.gimbalRad * 180 / Math.PI).toFixed(0))}`);
  assert.ok(r.shortfall.force < 0.05, `descent shortfall ${(r.shortfall.force * 100).toFixed(1)}%`);
});

test('rotor direction matches the allocated force', () => {
  const { acts, m, ref, opts, cls } = rig();
  const r = allocate(acts, demoWrench('forward', cls, m.totalTonnes * 1000), opts, ref);
  for (const s of r.solution) {
    if (s.magnitude < 1e-6) continue;
    const d = norm(s.force);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(d[k] - s.direction[k]) < 1e-6,
        `${s.id}: reported direction does not match the force vector`);
    }
  }
});

test('a failed actuator contributes nothing and the rest reallocate', () => {
  const { acts, m, ref, opts, cls } = rig();
  const w = demoWrench('up', cls, m.totalTonnes * 1000);
  const before = allocate(acts, w, opts, ref);
  const victim = acts.find((a) => a.kind === 'primary');
  victim.enabled = false;
  const after = allocate(acts, w, opts, ref);
  victim.enabled = true;

  const s = after.solution.find((x) => x.id === victim.id);
  assert.equal(s.magnitude, 0, 'a failed station must produce no force');
  assert.equal(s.enabled, false);
  // The others take up the slack: total commanded force rises on the survivors.
  const sumOthers = (r) => r.solution.filter((x) => x.id !== victim.id)
    .reduce((a, x) => a + x.magnitude, 0);
  assert.ok(sumOthers(after) > sumOthers(before),
    'the surviving actuators should be working harder after a failure');
});

test('saturation is reported and bounded', () => {
  const { acts, m, ref, opts, cls } = rig();
  // Demand far beyond capability: everything saturates, nothing exceeds its limit, and the
  // shortfall is reported rather than hidden.
  const w = demoWrench('up', cls, m.totalTonnes * 1000).map((v) => v * 40);
  const r = allocate(acts, w, opts, ref);
  assert.ok(r.saturated.length > 0, 'nothing saturated on an impossible demand');
  assert.ok(r.shortfall.force > 0.3, `shortfall only ${(r.shortfall.force * 100).toFixed(0)}%`);
  for (let i = 0; i < acts.length; i++) {
    assert.ok(r.solution[i].fraction <= 1.0001, `${acts[i].id} over 100%`);
  }
});

test('a symmetric demand produces a symmetric solution', () => {
  const { acts, m, ref, opts, cls } = rig();
  const r = allocate(acts, [0, 0, 0.05 * m.weightN, 0, 0, 0], opts, ref);
  const prim = acts.map((a, i) => [a, r.solution[i]]).filter(([a]) => a.kind === 'primary');
  const port = prim.filter(([a]) => a.r[1] > 0).reduce((s, [, x]) => s + x.magnitude, 0);
  const stbd = prim.filter(([a]) => a.r[1] < 0).reduce((s, [, x]) => s + x.magnitude, 0);
  assert.ok(Math.abs(port - stbd) / Math.max(1, port) < 0.02,
    `port ${port.toFixed(0)} vs starboard ${stbd.toFixed(0)} N`);
  void cls;
});

test('allocation is deterministic', () => {
  const { acts, m, ref, opts, cls } = rig();
  const w = demoWrench('emergency', cls, m.totalTonnes * 1000);
  const a = allocate(acts, w, opts, ref);
  const b = allocate(acts, w, opts, ref);
  for (let i = 0; i < a.solution.length; i++) {
    assert.equal(a.solution[i].magnitude, b.solution[i].magnitude);
  }
});

/* ---------- mass and buoyancy ------------------------------------------------------------------ */

test('water and LN2 raise mass; releasing water raises net buoyancy', () => {
  const cls = resolveClass('P100');
  const layout = buildLayout(cls);
  const empty = massState(cls, defaultState({ waterFraction: 0, ln2Fraction: 0 }), layout);
  const full = massState(cls, defaultState({ waterFraction: 1, ln2Fraction: 0 }), layout);
  const cold = massState(cls, defaultState({ waterFraction: 0, ln2Fraction: 1 }), layout);

  assert.ok(full.totalTonnes > empty.totalTonnes, 'water must add mass');
  assert.ok(Math.abs(full.totalTonnes - empty.totalTonnes - cls.payloadTonnes) < 1e-6);
  assert.ok(cold.totalTonnes > empty.totalTonnes, 'LN2 must add mass');
  assert.ok(Math.abs(cold.totalTonnes - empty.totalTonnes - cls.ln2TankCapacityTonnes) < 1e-6);
  assert.ok(full.netTonnes < empty.netTonnes, 'a full ship must be less positively buoyant');
  assert.ok(empty.netN > full.netN, 'releasing water must raise net upward force');
});

test('mass state moves the centre of mass', () => {
  const cls = resolveClass('P100');
  const layout = buildLayout(cls);
  const dry = massState(cls, defaultState(), layout).centreOfMass;
  const wet = massState(cls, defaultState({ waterFraction: 1 }), layout).centreOfMass;
  const moved = Math.hypot(wet[0] - dry[0], wet[1] - dry[1], wet[2] - dry[2]);
  assert.ok(moved > 0.5, `centre of mass barely moved (${moved.toFixed(2)} m) — tanks are not weighing`);
  assert.ok(wet[2] < dry[2], 'water is carried low, so the centre of mass must drop');
});

test('LN2 volume uses its own density, not water', () => {
  const cls = resolveClass('P100');
  const vol = ln2VolumeM3(cls, 1);
  const asWater = cls.ln2TankCapacityTonnes;
  assert.ok(vol > asWater, 'LN2 is less dense than water, so a tonne takes MORE room');
  assert.ok(Math.abs(vol - (cls.ln2TankCapacityTonnes * 1000) / RHO_LN2) < 1e-6);
});

test('inertia is enormous and the classes differ by orders of magnitude', () => {
  const a = inertia(resolveClass('P100'), 200);
  const c = inertia(resolveClass('P10000'), 20000);
  assert.ok(c.pitch / a.pitch > 500, `pitch inertia only grew ${(c.pitch / a.pitch).toFixed(0)}x`);
  // A large torque still produces a small angular acceleration. This is the whole point.
  const acc = angularAccelDegS2(resolveClass('P10000'), 20000, [0, 5e8, 0]);
  assert.ok(Math.abs(acc.pitch) < 1, `${acc.pitch.toFixed(3)} deg/s2 is not "enormous inertia"`);
});

test('the force set is internally consistent', () => {
  const cls = resolveClass('P1000');
  const layout = buildLayout(cls);
  const s = defaultState({ waterFraction: 0.5, airspeedMps: 30 });
  const f = forceSet(cls, s, layout, null);
  assert.ok(f.buoyancy.vec[2] > 0 && f.weight.vec[2] < 0);
  assert.ok(Math.abs(f.net.vec[2] - (f.buoyancy.vec[2] + f.weight.vec[2])) < 1);
  assert.ok(f.aero.vec[0] < 0, 'drag must oppose forward motion');
  assert.deepEqual(f.buoyancy.at, [0, 0, 0], 'buoyancy acts at the centre of buoyancy = the origin');
});

/* ---------- energy ------------------------------------------------------------------------------ */

test('the energy graph balances in every phase', () => {
  for (const id of CLASS_IDS) {
    const cls = resolveClass(id);
    for (const phase of ['WATER_FILL', 'OUTBOUND_TRANSIT', 'RETURN_TRANSIT', 'CONTROLLED_DESCENT',
      'BUOYANCY_ESCAPE', 'SAFE_DRIFT', 'TOTAL_POWER_LOSS']) {
      const e = energyFlows(cls, defaultState({ phase }));
      assert.ok(Math.abs(e.balanceMW) < 1e-6,
        `${id}/${phase}: bus is ${e.balanceMW.toFixed(3)} MW out of balance`);
    }
  }
});

test('total power loss really is off', () => {
  const cls = resolveClass('P100');
  const p = derivePower(cls, defaultState({ phase: 'TOTAL_POWER_LOSS' }));
  assert.equal(p.generatorPowerMW, 0);
  assert.equal(p.propulsionPowerMW, 0);
  assert.equal(p.cryogenicPowerMW, 0);
  assert.equal(p.hotelPowerMW, 0);
});

test('the nitrogen store is lossy and says so', () => {
  const cls = resolveClass('P1000');
  const l = ln2Ledger(cls);
  assert.ok(l.returnMWh < l.chargeMWh, 'the store must not return more than it took');
  assert.ok(Math.abs(l.returnMWh / l.chargeMWh - 0.5) < 1e-9, 'default round trip is 50%');
  assert.ok(l.lostMWh > 0);
  assert.match(l.note, /not an airborne plant specification/);
});

test('pump power matches the published arithmetic', () => {
  // rho g Q H / eta: the /airships page quotes ~1.6 MW for the P-100.
  const cls = resolveClass('P100');
  const mw = pumpPowerMW(cls);
  assert.ok(Math.abs(mw - 1.635) < 0.01, `pump power ${mw.toFixed(3)} MW`);
});

void cross;
