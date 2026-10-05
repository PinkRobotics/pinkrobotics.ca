# airship3d

A reusable, state-driven, parametric 3D visualisation system for the Pink Robotics conceptual
vacuum airships (P-100, P-1000, P-10000).

**Zero dependencies. No build step. No external asset.** It is a set of ES modules the browser
imports directly, and the same modules run unchanged in node for the figure export and the tests.

---

## Why not Three.js

Every page in this repository is self-contained: no bundler, no npm, no linked assets. Vendoring
~600 kB of library to draw flat-shaded solids and technical linework would cost more than it
saves, and the one thing this content genuinely needs — readable engineering linework with
hidden-line removal — is a depth prepass, not a scene graph library.

So `render/gl.js` is a small raw-WebGL2 renderer with four paths: lit solids (instanced),
translucent solids, screen-space-width lines (instanced quads, because `gl.LINES` cannot exceed 1 px
on most platforms), and an on-demand id buffer for picking. Instances of a node that declared
itself unselectable are never drawn into that buffer, so a click passes through spray, wash
streaks and tank fill levels to the component behind them rather than selecting a puff of air.
`render/svg.js` projects the *same*
geometry through the *same* camera maths to produce vector figures, so a figure cannot drift from
the viewer without the drift being detectable — `scripts/figures.mjs --check` is what detects it.
(It is failing today; see *Assets and reproducibility*.)

One parametric model is the single source of truth, and every representation — interactive
viewer, SVG figure, map marker, cockpit panel — is generated from it.

---

## Pages

| Page | What it is |
|---|---|
| `model-lab/index.html` | The development and review surface. Every class, mode, camera preset, animation clip, wrench demand, failure toggle, mass/power control, plus live performance instrumentation and static-export buttons. `noindex`. |
| `3d/tests/browser.html` | Browser integration suite. `noindex`. |

The lab takes URL parameters so a review screenshot is reproducible:

```
model-lab/?class=P1000&mode=cutaway-longitudinal&clip=water_fill&t=0.4
          &camera=cutaway-long&forces=1&paused=1&wrench=yaw&wmag=0.8
```

---

## Quick start

```html
<script type="module">
  import { mount, defaultState } from '../3d/index.js';

  const viewer = mount(document.querySelector('#viewer'), {
    classId: 'P100',
    viewMode: 'cutaway-longitudinal',
    visualState: defaultState({ phase: 'WATER_FILL', waterFraction: 0.4, hoseProgress: 1 }),
    showForces: true,
    onComponentSelect: (id) => console.log(id),
  });

  viewer.setProps({ visualState: nextState });   // drive it
  viewer.dispose();                              // and clean up on unmount
</script>
```

The container needs a height. Styles are injected automatically (`injectStyles()`), keyed by id, so
ten viewers on a page share one `<style>`.

---

## The props

```ts
type AirshipClassId = 'P100' | 'P1000' | 'P10000';

type AirshipViewMode =
  | 'exterior' | 'ghost' | 'cutaway-longitudinal' | 'cutaway-transverse' | 'vacuum'
  | 'lattice' | 'wire' | 'systems' | 'load-paths' | 'energy' | 'mass' | 'failure';

interface Airship3DProps {
  classId: AirshipClassId;
  visualState: AirshipVisualState;
  viewMode?: AirshipViewMode;
  quality?: 'auto' | 'low' | 'medium' | 'high';   // -> detail tier 1..3
  interactive?: boolean;
  showLabels?: boolean;
  showForces?: boolean;       // force arrows + centre of mass + centre of buoyancy
  showScale?: boolean;        // graduated bar in real configured metres
  showCells?: boolean;        // representative sealed vacuum cells
  selectedComponentId?: string | null;
  isolate?: string | null;    // show one component, ghost everything else
  cutFrac?: number;           // 0..1 cut-plane position
  systems?: string[] | null;  // categories to isolate in 'systems' mode
  wrench?: number[] | null;   // [Fx,Fy,Fz,Tx,Ty,Tz] to allocate and display
  env?: { windMps?: number[]; waterSurfaceZ?: number; shipVel?: number[]; lowDetail?: boolean };
  reducedMotion?: boolean;    // defaults to the prefers-reduced-motion media query
  onComponentSelect?: (id: string | null) => void;
  onReady?: () => void;
}
```

### The viewer handle

| Member | Purpose |
|---|---|
| `setProps(partial)` | Push new props. Only `classId` and `quality` rebuild the model. |
| `select(id)` / `isolate(id)` | Selection and isolation. |
| `goToPreset(id)` / `frameAll()` | Camera. Any user input cancels a running move. |
| `tick(dt)` | Advance and draw exactly **one** frame, synchronously. Use this whenever you need a deterministic frame — the loop is lazy and a backgrounded tab throttles rAF to ~1 Hz. |
| `invalidate()` | Request a frame. |
| `clearFailures()` | Clear the visual failure marks (state still governs — see below). |
| `snapshot()` | PNG data URL of the current frame. |
| `describe()` | `{ cls, mass, energy, selected, stats, text, angularAccel }` for DOM panels. |
| `dispose()` | Remove listeners, observers, GPU resources and DOM. |
| `model` / `camera` / `driver` / `actuators` / `stats` / `available` | Read-only handles. |

**Failures are recomputed from state every frame**, never accumulated. Remove an id from
`visualState.failedComponents` and the component comes back. `clearFailures()` only resets the
visual marks; if the state still lists the failure, the next frame reinstates it.

---

## Integration with the wildfire monitor

The monitor owns the mission. This system never re-plans, re-times or re-derives anything the
monitor has decided.

```js
import { mountForMission } from '../3d/index.js';

const panel = mountForMission(document.querySelector('#selected-aircraft'), {
  mission,                       // the monitor's mission object (has .cls)
  stateAt: () => stateAt(mission, t),
  cfg: CFG,                      // adopts eLN2, rtLN2, hoseHead, pumpEta, Cd, rho — one source of truth
  props: { viewMode: 'exterior', quality: 'low' },
});

// then, whenever the monitor's clock advances:
panel.sync(mission);             // cheap; safe per tick; switches class automatically
```

`adapter/fable.js` is the only file that has to change if the monitor's state shape changes.
`describeMapping()` prints the correspondence as data, and `checkHostState(s)` returns a list of
problems. Both are asserted by the test suite.

### The two unit traps this adapter exists to handle

| Monitor field | Model field | Conversion |
|---|---|---|
| `stateAt().water` | `waterFraction` | **tonnes** → fraction of class payload |
| `stateAt().ln2` | `ln2Fraction` | **tonnes** → fraction of configured tank capacity |
| `stateAt().draw.{prop,fans,rotors}` | `propulsionPowerMW` | megawatts, summed |
| `stateAt().phase === 'NO_SUITABLE_SOURCE'` | `phase = 'WEATHER_HOLD'` | idle is a real state, not a gap |

Everything the monitor has no reason to carry — hose payout, pod depth, release progress, attitude,
airspeed, vertical speed — comes from `anim/mission.js` `phaseShape()`, the same function the
standalone lab uses, so a scene looks identical either way.

The hose is the one place the adapter has to do more than translate. The monitor's cycle is six
phases with no stopped hose time: the pod pays out during the flown approach and winds up during
the climb-out. The lab's eleven-phase cycle has separate deploy and retract phases, so replaying
`phaseShape()` unmodified against a monitor phase deployed the hose twice — once on the approach
and again at the fill. The overlap is applied in `adapter/fable.js`, not in `anim/mission.js`.

### The cockpit HUD — drop-in for a canvas

The monitor's cockpit draws a 2D schematic of the selected ship on a canvas, in
`app/cockpit/shipviz.js`. `AirshipHUD` is a drop-in replacement for that canvas: it keeps the
element's id, class and CSS box, and exposes the same call the frame loop already makes.

```js
import { AirshipHUD } from '../3d/index.js';

// was: const shipViz = (() => { …schematic… })();
const shipViz = AirshipHUD(document.getElementById('shipviz'), { cfg: CFG });

// unchanged, in the frame loop:
shipViz.draw(st, m);
```

That is the whole integration. `draw(state, mission)` accepts the arguments in either order,
converts the tonnes/megawatt units, follows the mission's class automatically, and no-ops on an
idle mission.

| | |
|---|---|
| Cost | 50 draw calls, 86,584 triangles per frame in a 300 × 150 panel (measured, P-100, `quality: 'low'`) |
| Loop | none of its own — renders synchronously from your `draw()` |
| Detail | exterior view only. The model is still *built* at detail tier 1 — 96,140 triangles including interior structure — and the interior is simply not drawn. Nothing here skips geometry construction. |
| Motion | slow turntable, paused by any interaction, resumes after 4 s idle, off under `prefers-reduced-motion` |
| Overlay | buoyancy, weight, net and aerodynamic force, from the monitor's own `buoyN`/`weightN` |
| Fallback | static SVG silhouette if no WebGL context is available |
| Extras | `.setClass(id)`, `.spin = false`, `.describe()` for a live region, `.dispose()` |

Preview at the real panel size: `3d/tests/hud-demo.html`.

### Three ways to embed

1. **Selected-aircraft panel** — `mountForMission()` + `sync()`, exterior/cutaway toggle.
2. **Mission-phase explanation** — a focused scene per phase:
   `AirshipMissionCycle`, or a viewer pinned with `visualState` and `viewMode`.
3. **Explanatory sections** — `AirshipScaleComparison`, `AirshipCutaway`,
   `AirshipControlAuthority`, `AirshipFailureExplorer`, `AirshipTrajectoryExplorer`.

For a map marker use `AirshipMapModel(classId)` — an SVG string of 2.8 kB, no GPU. Pair it with
the caption *"Map symbols are enlarged for visibility. The scale viewer shows physical dimensions."*

---

## Scene components

All take `(container, props)` and return `{ viewer?, element, dispose() }`.

| Component | What it adds over the bare viewer |
|---|---|
| `AirshipModelViewer` | the viewer itself (`createViewer` / `mount`) |
| `AirshipCutaway` | cut-axis buttons, draggable cut plane, system chips, component panel |
| `AirshipMissionCycle` | scrubbable loopable master cycle, rapid/balanced/endurance, phase readout |
| `AirshipControlAuthority` | wrench buttons, magnitude, failure toggles, requested-vs-achieved table |
| `AirshipScaleComparison` | SVG — all three classes and four references at one real scale, plus a dimensions table |
| `AirshipFailureExplorer` | the failure and fail-safe clip set with explanatory notes |
| `AirshipTrajectoryExplorer` | SVG — altitude bands, wind field, candidate routes, selected route |
| `AirshipHUD` | drop-in for the monitor's `#shipviz` cockpit panel — see above |
| `AirshipMapModel` | tiny per-class SVG outline for map markers |
| `AirshipStaticFigure` | deterministic SVG figure at any camera angle |

`componentPanel(viewer)` is the DOM component list + info panel used by several of them; it is the
accessible spine and can be dropped beside any viewer.

---

## The model

```
core/      math, deterministic prng, scene-graph nodes
model/     config (ALL speculative numbers), layout, density field, structure, geometry,
           metadata, build
render/    gl (WebGL2), svg, views (modes + analytic cutaway caps), camera, palette, styles
control/   actuators, allocator
physics/   state contract, mass/buoyancy/inertia, energy graph
anim/      mission (demo only), clips, hose, driver
adapter/   fable (the monitor bridge)
scenes/    viewer + the named scenes
scripts/   figures.mjs, render-figures.sh, browser-tests.sh, audit.mjs, probe-ports.mjs,
           stamp-version.mjs
tests/     node suite + browser suite
```

### How the three classes differ

They are one parametric family, not one mesh at three sizes. Two arguments drive it:

- **Total disc area is fixed by the simulation, not chosen here.** `sim/config.js` publishes
  2 500 / 12 000 / 160 000 m² as `diskM2`, and that number drives the monitor's descent-power
  arithmetic. Rotor sizing is solved to match it, and lands within 1.8%: 2 513 / 12 215 /
  158 886 m² across 4 / 6 / 14 stations of two rotors each, at rotor diameters of 20 / 36 / 85 m.
  Disc area per station therefore grows 628 → 2 036 → 11 349 m², a factor of 18, against a factor
  of 100 in displacement — which is why the P-10000's thrust is a *network* of fourteen stations
  and not a scaled-up quad. Note what this does *not* say: the rotors do not grow much more slowly
  than the hull (85/20 = 4.3× against 820/177 = 4.6× of length). It is the count that absorbs the
  difference, and an 85 m rotor is a speculative object in its own right.
- **Structural cell pitch is a manufacturing constant**, not a scaled dimension — 9 m → 12 m → 16 m.
  The big ships therefore read as *finer*-grained, not coarser: more cells, not bigger ones.

Pylon length is **computed, not chosen**: the hub sits far enough outboard that the rotor disc
clears the hull at every reachable gimbal angle, allowing for the hull growing across the x-range a
horizontal disc spans. It therefore varies along the ship rather than being one number per class —
11.4–11.7 m, 20.0–21.4 m and 46.8–54.6 m, against rotor radii of 10 / 18 / 42.5 m. A test sweeps
the whole gimbal range sampling the disc rim to prove the clearance holds.

Counts, spacing, plant capacities and layout families all live in `model/config.js` and are exposed
in the lab. Nothing is hard-coded in a component.

### Skin, solar and the high-visibility underside

The fairing carries two full-half bands drawn just proud of it: **solar over the entire upper
half**, and a **high-visibility pink finish over the entire lower half**. The pink is a conspicuity
choice rather than styling — an aircraft working low over terrain is seen from below by other
aircraft and from the ground, and a dark underside against dark ground is the hard case. It is the
one place on the vehicle where the brand colour is doing a job.

Ports large enough to matter have **real apertures cut through all three layers**. This is not
cosmetic: recessing a ducted unit into a closed skin puts it *behind* the surface, so what fills
the port is the hull — or, on the upper half, the solar band drawn outside it. A back cup on the
duct does not help, because the duct was never visible. The hole has to be real. Units smaller than
one skin grid cell (the trim fans) are mounted **proud** instead, since cutting for them would
remove several times more skin than the unit occupies.

### The hull

An axisymmetric body with a flattened upper surface for solar. One function pair — `profileR(t)`
and `sectionScale(theta)` — is used by the skin, the frames, the lattice, the cell packing, the
cutaway caps and the SVG silhouettes, so all six agree by construction.

The maximum radius is **solved** so the shaped hull displaces exactly the published displacement.
The lift premise is the invariant; the diameter is whatever that costs. The solved diameters land
within 1.4% of the published illustrative figures, and a test asserts both.

### The structure — sponge, not egg

Not a hollow shell. Nested shells following the body, transverse rings at roughly the class's cell
pitch, azimuths spaced by **arc length** so cells stay the same physical size everywhere, plus
hoop, longitudinal, radial and diagonal members, with representative sealed cell modules through
the volume. Alternate rings are offset half a bay, which is what turns a grid into a lattice.

### The density field

`model/density.js` is a deterministic proxy: Gaussians about hand-placed load anchors (which *are*
the machinery positions), a beam-bending term, a shell band, and end transitions. Corridors enter
with a **negative** weight, so material routes around them.

> **It is not FEA.** Nothing here is FEA-optimized, ML-optimized, structurally validated,
> stress-proven or flightworthy. Views that show it are labelled *"Illustrative stress-informed
> topology"*.

The upgrade path is the point: consumers only call `field.sample(p)` and `field.member(a, b)`.
`dataField(cls, data)` satisfies the same interface and already accepts per-node stress, per-element
density, displacement vectors, safety factors, a load-case id and damage states. Swap it in and the
structure re-grades itself with no other change — there is a test that builds the whole model from
an analysis field.

---

## The control allocator

`control/allocator.js` answers one question: *given a wanted force and torque, what would each
actuator do, and could it?* It is a weighted minimum-norm solve with redistributed clamping.

Two things make it behave like a vehicle:

1. **It allocates in normalised control space** (`u ∈ [-1,1]`, not newtons), so the solution
   equalises how hard each unit works rather than how much force it contributes. Without this a
   2.6 kN trim fan is asked for the same force as a 423 kN rotor station, saturates instantly, and
   the set jams. (P-100 figures, from `buildActuators`: 4 stations at 423 kN, 8 medium propulsors
   at 33 kN, 48 trim fans at 2.6 kN.)
2. **Direction and magnitude are solved in two phases** — free vectoring then clamp, then fixed
   directions and redistributed magnitudes. One pass would report a wrench the vehicle cannot
   actually produce.

Envelopes are per-kind: a primary station's gimbal swings about its **athwartships pylon**, so its
reachable set is a *wedge* through the fore-and-aft plane (±95° pitch, ±17.5° yaw), not a cone about
vertical. Ducted units get a cone; fixed fans get an axis. Weights consider electrical cost,
off-nominal vectoring, and local structural density. Failed units are dropped from the matrix, so
reallocation is not a special case — it is the same solve with fewer columns. Symmetry comes out
rather than being asked for.

**The rotors are reversible**, which is why the gimbal range is ±95° rather than ±180°: within 90°
of travel, every direction in the swing plane is reachable either by pointing at it or by pointing
the opposite way and reversing thrust. A motor never has to be swung all the way round. The
measured consequence is that a powered descent costs **zero gimbal travel** — all four stations
simply reverse — and pitch and roll are produced by differential reversal:

Measured on a fully loaded P-100 (four stations), from `allocate()` on `demoWrench()`:

| Demand | Max gimbal travel | Stations reversed | Force shortfall |
|---|---:|---:|---:|
| up | 0.0° | 0 / 4 | 0.0% |
| down | 0.0° | 4 / 4 | 0.0% |
| pitch | 0.1° | 2 / 4 | 0.0% |
| roll | 0.0° | 2 / 4 | 0.0% |
| forward | 92.6° | 0 / 4 | 0.0% |
| yaw | 90.0° | 0 / 4 | 0.0% |

The allocator tracks where a unit *points* (`solution[i].axis`) separately from where its thrust
*acts* (`.direction`), because those differ whenever thrust is reversed. The gimbal animation
follows the axis; the wrench follows the direction. Following the thrust vector instead would swing
every station through 180° on screen to achieve what a pitch reversal already did.

> Simulated force allocation — **not** a certified flight-control system.

---

## Animation and state

`anim/clips.js` holds 55 named clips in eight groups, plus the master `mission_cycle`. A clip is a
function from normalised time to a patch (state fields, view mode, camera preset, wrench, failures)
— not a baked cinematic. That is what lets the same clip be scrubbed, paused, stepped, driven by
scroll, or rendered to a still.

`anim/driver.js` is the only thing that writes to the tree per frame. Whole-body attitude is
rate-limited by the class envelope (`maxYawRateDegS`: 2.2 °/s for a P-100, 1.4 for a P-1000,
0.8 for a P-10000; pitch and roll are lower still) **and** accelerated toward that limit, while
gimbals slew at 18 °/s. The contrast is the point: the actuators are quick and the vehicle is not.

`anim/mission.js` is a demonstration state machine **for the standalone lab only**. It computes
durations from the class configuration — the same fill rate and cruise speed the monitor reads —
so those cannot drift even here. The altitude bands have drifted: `anim/mission.js` uses
`{ cruise: 1500, source: 300, drop: 250 }` while `sim/config.js` uses `drop: 450`, and the
comment above it claims they are the same three bands. The lab therefore flies its drop run
200 m lower than the model prices. Nothing in the monitor reads this file, so the published
numbers are unaffected; the lab's altitude readout is wrong by 200 m. When the monitor drives
the model, none of it runs.

---

## Assets and reproducibility

```bash
node scripts/figures.mjs            # regenerate every SVG figure + manifest.json
node scripts/figures.mjs --check    # compare the committed assets with the model
scripts/render-figures.sh --width 1760            # rasterise to PNG (+ WebP where available)
scripts/render-figures.sh --transparent           # transparent-background variants
```

The vector set and its per-figure character counts are recorded in
`assets/static/manifest.json`. UTF-8 byte sizes can differ from those character counts.
Rasterisation is a separate step because it needs a browser; `figures.mjs` runs in Node.

> **The committed figures differ from the model.** The asset comparison on 2 October
> 2026 reported mismatches for every SVG and the manifest. The earlier note named only
> a subset affected by the port-aperture correction; it no longer described the check's
> result. Run `node scripts/figures.mjs --check` to inspect the mismatches. Regeneration
> requires a separate review of the figures; this documentation change leaves them intact.

---

## Tests

```bash
node --test "tests/*.test.mjs"           # 103 unit/model/physics/adapter/geometry tests
node scripts/audit.mjs                   # containment + interference across all three classes
node scripts/probe-ports.mjs             # 45 blower-port geometry checks
node scripts/stamp-version.mjs --check   # every module URL carries the content version
scripts/browser-tests.sh                 # 28 DOM + WebGL integration tests, headless
node scripts/figures.mjs --check         # committed figures match the model
```

Counts are the tests that exist, not a claim that they all pass. **Verified on 2026-08-09:**
`probe-ports` clean (45/45, via `scripts/probe-ports.html`, the browser runner for machines
without node), `browser-tests.sh` `pass=28 fail=0 skip=0`, `stamp-version.py --check` clean
(the Python port; `stamp-version.mjs` is the same check and needs node).
**`figures.mjs --check` is expected to fail** — see the note under *Assets* above; the committed
SVGs predate a geometry fix. Three things were **not** run on that pass because the machine had
no node: the 103-test node suite, `audit.mjs`, and `figures.mjs --check` itself. CI is the
authority on all three; the 103 is a count of `test(` calls in the three files, not a pass count.

The browser suite runs against software WebGL (`--use-angle=swiftshader`) rather than a real GPU,
because it asserts geometry and DOM behaviour rather than pixels and has to give the same answer
on a headless runner with no display.

Two environment facts the suite had to be built around, both of which are *correct* behaviour being
observed rather than bugs:

- Headless Chromium reports `prefers-reduced-motion: reduce`, so the viewer legitimately stops
  animating. Animation tests pass `reducedMotion: false` explicitly.
- A backgrounded page throttles `requestAnimationFrame` to about 1 Hz, so wall-clock animation
  cannot be asserted there. Tests that need deterministic frames call `viewer.tick(dt)`.

---

## Performance

Draw calls, not triangles, are the budget. Repeated machinery — on a P-10000, 220 trim fans, 40
water tanks and 32 medium propulsors — is instanced: one geometry, one call, a transform and a
tint per instance, with a
parallel id list so selection, failure state and the allocator still address an individual unit.

What one `build(classId, { tier })` produces, measured from `b.stats`. These are the counts the
model constructs, not the counts a single frame draws: a view mode that hides the interior still
builds it.

| Class · tier | Triangles | Segments | Draw calls | Instances | Lattice members |
|---|---:|---:|---:|---:|---:|
| P-100 · 0 (map) | 57 612 | 34 165 | 72 | 489 | 42 |
| P-100 · 2 | 88 956 | 41 268 | 77 | 505 | 1 205 |
| P-1000 · 2 | 184 816 | 77 091 | 96 | 954 | 2 574 |
| P-10000 · 3 (max) | 466 612 | 168 905 | 145 | 1 933 | 13 965 |

Tier does not monotonically reduce triangles: tier 1 builds *more* of them than tier 2 on every
class (P-100: 96 140 against 88 956; P-10000: 605 452 against 466 612), because the tiers trade
hull-grid resolution against lattice detail rather than scaling one dial — and because the
subdivision that cuts the blower ports targets an absolute edge length, so the coarser tier-1
grid subdivides further around every aperture. The inline tier is therefore the heaviest build
of the three, which is worth knowing before choosing one. The lattice column is where the tiers
actually diverge — 42 members at tier 0 against 2 606 at tier 3 on a P-100.

Loop behaviour: paused offscreen (IntersectionObserver), paused on hidden tab, and idle whenever
nothing is animating and no camera move is running. Pixel ratio is capped. Quality auto-selects
from `hardwareConcurrency`, `deviceMemory` and viewport size.

---

## Accessibility

The canvas is supplementary. Everything it shows is also text:

- `aria-label` on the canvas carrying class, view mode, full state summary and the selected
  component's description
- an `aria-live="polite"` state summary
- a DOM component list with metadata, claim level and category — keyboard operable
- keyboard camera: arrows orbit, `+`/`-` zoom, `0` resets, `1`–`9` are camera presets, `Escape`
  clears selection and isolation
- `prefers-reduced-motion`: rotors freeze, camera moves cut instead of sweeping, attitude snaps,
  turntables stop — and every datum stays available
- a static SVG figure fallback when WebGL is unavailable, which says in words where the data is
- colour is never the only channel: every category carries a dash pattern and a label, and load-path
  density modulates line *weight and brightness* as well as hue

---

## Epistemic rules

Reusable labels are built into the captions and the metadata, not bolted on:

> Conceptual reference vehicle · Illustrative same-proportion scale · Representative internal
> arrangement · Illustrative load paths — not an FEA result · Simulated force allocation — not a
> certified flight-control system · Deformation exaggerated for visibility · No flightworthy vacuum
> airship currently exists · The first physical gate remains a complete positively buoyant
> evacuated cell

Every component carries a `claimLevel` of `known-physics`, `reference-assumption`,
`conceptual-layout` or `future-research`. A component that needs a working vacuum cell to exist at
all is `future-research`, however ordinary its own engineering.

The model does not show: a cockpit, pilots, fleet markings, certification, test results, safety
factors, current deployments, or any weather-control capability. It does not imply that delivering
water predicts fire suppression.
