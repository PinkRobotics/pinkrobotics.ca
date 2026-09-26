# Blower ports: why the artifact is still there

**Status:** root-caused, not fixed. Every number below is measured from the built geometry by
`scripts/probe-ports.mjs`, which prints PASS/FAIL per defect and exits non-zero. Run it before and
after any change.

```
node scripts/probe-ports.mjs
```

All three classes fail every check today (36 failures).

Two independent problems live here:

- **D1–D4, the large ports.** The panel that covers the cut aperture is collapsed onto the nose
  tip, so the ragged hole edge has never been covered.
- **D5, the small blowers.** No aperture is cut for these; they are mounted proud instead, but not
  proud enough to get the duct's own back cup clear of the skin — so you see hull colour in the
  bore.

---

## The short version

The panel that is supposed to cover the ragged aperture edge around each large blower —
`PortSurrounds` / `SolarPortSurrounds` / `UndersidePortSurrounds` — **is not near any blower.**
Every one of its vertices collapses onto a single point at the nose tip.

On the P-100 the panels measure `x = [84.6..84.6]`, `radius = [1.5..1.7] m`. The ports they are
meant to cover are at `x = [-33.9..26.3]`, `radius = [17.0..19.6] m`, on a hull of radius 22.3 m.

So the hole in the skin has been sitting there uncovered the whole time. That is the artifact: not
a shading problem, not the solar layer, not inverted hull normals — the stair-stepped edge of a
real hole, with nothing over it.

This is also why every previous attempt failed. The fixes were aimed at how the panel *shades*.
The panel was never in the picture.

---

## D1 — the station clamp is inverted (root cause)

`model/build.js:244` and `:252`, in `portSurroundGeom`:

```js
const xLo = stationX(cls, 0.001), xHi = stationX(cls, 0.999);
...
const x = Math.max(xLo, Math.min(xHi, port.c[0] - rho * Math.cos(phi)));
```

`stationX` is `model/config.js:430`:

```js
export const stationX = (c, t) => c.xNose - t * c.lengthM;
```

It **decreases** with `t`. So `stationX(0.001)` is the *nose* — the largest x — and
`stationX(0.999)` is the *tail*, the smallest. The names are backwards, and therefore so is the
clamp: `Math.max(xLo, Math.min(xHi, x))` with `xLo > xHi` is the constant function `xLo`.

Measured, for every input:

| class | stationX(0.001) | stationX(0.999) | clamp(x) for all x | hull radius there |
|---|---:|---:|---:|---:|
| P-100 | 84.6 | −92.1 | **84.6** | 1.7 m |
| P-1000 | 181.5 | −197.7 | **181.5** | 3.7 m |
| P-10000 | 391.7 | −426.7 | **391.7** | 8.0 m |

Every vertex of every surround patch is forced to the nose station, where the hull has almost no
radius, so the whole patch crumples into a sliver a metre or two across at the tip of the ship.

**Fix:** order the bounds before clamping.

```js
const xa = stationX(cls, 0.001), xb = stationX(cls, 0.999);
const xLo = Math.min(xa, xb), xHi = Math.max(xa, xb);
```

Verified in isolation: with that change the P-100 patch lands at `x = [18.7..34.0]`,
`radius = [19.7..21.5] m`, centred on its port at `x = 26.3`, `radius = 18.6 m`. Correct place.

Worth a grep for the same pattern elsewhere — `stationX` returning a descending x is exactly the
kind of thing that gets assumed the other way twice.

---

## D2 — the patch winds inward

Fixing D1 alone is not enough. With the patch in the right place, **132 of 132 faces point inward.**

`model/build.js:261` uses

```js
idx.push(a, c, d, a, d, b);
```

`hullGridGeom` — which measures 100 % outward — uses the opposite at `:183`:

```js
idx.push(a, d, c, a, b, d);
```

There is already a comment at `:178` explaining that the hull profile runs with x *decreasing* and
that this is what inverts the winding. The surround was written with the other convention.

**Fix:** match the hull grid's winding, and delete the runtime flip test at `:269–278` — a
correct constant winding makes it unnecessary, and it is currently dead anyway (see D3).

---

## D3 — the double-sided winding destroys the vertex normals

`model/build.js:261–262`:

```js
idx.push(a, c, d, a, d, b);
idx.push(d, c, a, b, d, a);      // double-sided: no port ring can dim as a backface
```

`solid()` (`model/geom.js:22`) derives vertex normals by summing face normals. `(d,c,a)` is the
exact reverse of `(a,c,d)`, so each face contributes `+n` and `−n` and they cancel — completely.

Measured on P-100 `PortSurrounds`: **all 736 raw normal accumulations fall below 1e-9.** What
survives is the floating-point residue, which `solid()` then normalises into a unit vector pointing
in a meaningless direction. The result:

| layer | mean dot(normal, outward) | zero-length normals |
|---|---:|---:|
| `OuterFairing` (control) | **0.9433** | 26 / 5486 |
| `SolarSkin` (control) | **0.9799** | 14 |
| `PortSurrounds` | **0.0000** | 16 / 736 |
| `SolarPortSurrounds` | **0.0000** | 8 / 368 |

Not a spread around zero — *every single vertex* lands in the |dot| < 0.2 bucket. In the shader
`normalize(vNor)` on a zero vector is a division by zero; on the residue it is a unit vector in a
random direction. Either way the diffuse term is garbage.

It also makes the flip test at `:269–278` a no-op (flipping a double-sided patch changes nothing)
and doubles the triangle count of every panel.

**Fix:** push one winding, the outward one from D2. The comment's worry — "no port ring can dim as
a backface" — is solved by winding it correctly, not by winding it both ways.

---

## D4 — the aperture is cut far larger than the duct

Not the cause of the artifact, but it is why the surround has to be so big, and it will still look
wrong after D1–D3 are fixed.

`blocked()` at `:153` drops a quad if **any** of its four corners falls inside the port circle. That
is deliberate and it is the right call for keeping skin out of the opening — but it means the hole
extends up to one full grid-cell diagonal past the port. `holeR`, which is the code's own
measurement of what it removed:

| class | duct radius | grid cell diagonal | widest hole cut | ratio | duct flange reaches |
|---|---:|---:|---:|---:|---:|
| P-100 | 3.50 m | 4.24 m | **7.05 m** | 2.01× | 1.18× |
| P-1000 | 5.50 m | 9.13 m | **13.62 m** | 2.48× | 1.18× |
| P-10000 | 7.50 m | 19.68 m | **25.35 m** | 3.38× | 1.18× |

So each 7 m blower sits in a 14 m hole, and on the P-10000 a 15 m blower sits in a hole 51 m
across. Everything between the duct flange and the hole edge is substitute hull painted on by the
surround panel — a large flat disc standing in for real curved skin, which will read as a plate
around each port even once it is lit correctly.

**Options, in the order I'd try them:**

1. Subdivide the hull grid locally near each aperture so a cell is small relative to the port. Most
   faithful, most work.
2. Keep the corner test but shrink the test radius to `r − cellDiagonal/2`, so the *resulting* hole
   is close to `r`. Cheap, and `holeR` already measures whether it worked.
3. Drop by quad centre and widen the duct flange to cover one cell diagonal. Simplest; makes the
   flange visibly large on the P-10000.

---

## D5 — the small blowers show hull colour inside the bore

A separate defect with a separate cause, affecting the trim fans rather than the big ports.

No aperture is cut for a trim fan — it is smaller than one skin grid cell, so `layout.js:195`
mounts it **proud** of the skin instead. That is the right call. But it means the only thing
standing between the viewer and the hull, when you look into the bore, is the duct's own back cup.
And the fan does not stand proud by enough to get that cup clear of the skin.

`ductHousingGeom` (`build.js:371`) seals the bore with its cup at `h = R * depthRatio` behind the
duct centre — for a trim fan, `depthRatio` is 0.45, so `h = dia * 0.225`.
`layout.js:198` mounts it at:

```js
const p = inside(cls, tc, theta, (localRf + dia * 0.16) / localRf);
```

`dia * 0.16` < `dia * 0.225`. The skin plane therefore sits **in front of** the cup — inside the
open bore — and it is the skin you see, not the cup.

Measured, every fan on every class:

| class | fans | duct dia | cup seals at | mounted proud by | skin sits inside the bore by |
|---|---:|---:|---:|---:|---:|
| P-100 | 48 / 48 | 1.60 m | 0.36 m | 0.256 m | 0.104 m |
| P-1000 | 96 / 96 | 2.65 m | 0.60 m | 0.423 m | 0.172 m |
| P-10000 | 220 / 220 | 5.70 m | 1.28 m | 0.911 m | 0.370 m |

It is the *band* colour you see rather than the fairing, which is why it reads as pink on the
underside and solar on top: `hullBandGeom` draws the solar and underside layers at `lift = 1.004`,
another 0.09 m (P-100) to 0.41 m (P-10000) further out, so they are deeper into the bore than the
fairing is.

**The underlying defect** is that `0.16` in `layout.js` and `0.45` in `build.js` are two
independent magic numbers in two files that have to satisfy an inequality, and nothing ties them
together or checks it. Fixing the number without fixing that will drift again the first time
someone tunes the duct depth.

**Fix, in the order I'd do it:**

1. Give the seal depth one home. Export it from the duct geometry — something like
   `export const DUCT_SEAL_OF_DIAMETER = depthRatio / 2` — and have `layout.js` derive the mount
   offset from it, plus the band lift, plus a margin:
   ```js
   const proud = dia * DUCT_SEAL_OF_DIAMETER + localRf * 0.004 + dia * 0.03;
   const p = inside(cls, tc, theta, (localRf + proud) / localRf);
   ```
2. Stopgap if you want one line now: `dia * 0.16` → `dia * 0.32`. Verified against all three
   classes — 0 of 48 / 96 / 220 fans left with the skin in the bore, worst-case clearance +0.063 m
   (P-100), +0.059 m (P-1000), +0.127 m (P-10000).
3. `scripts/probe-ports.mjs` now checks this as D5, so either fix is verifiable by running it.

Note this does **not** make the fans float. At `proud = h` the duct's back rim lands exactly on the
skin and the cup is buried beneath it — the unit reads as a duct sitting on the hull, which is what
it should look like. Today it is partially *sunk*, which is why the skin cuts across the opening.

The same seal geometry is used by the medium thrusters at `depthRatio = 0.62`, but they are
genuinely recessed behind a cut aperture (P-100: 1.95 m below the skin), so the cup is behind the
hull line and they are not affected by this.

---

## What this is *not* — already ruled out, please don't re-chase

Each of these was tested directly and came back clean:

- **The solar layer filling the port.** `SolarSkin` and `HullUnderside` cut their own apertures;
  `holeR` confirms 4 of 8 holes in each on the P-100, matching the ports on their own half.
- **Inverted hull normals.** Fixed earlier; `OuterFairing` now measures 5484 / 5484 faces outward
  and mean dot 0.9433.
- **Band / surround mismatch at the beam line.** I thought the solar–underside seam might cut
  through the side ports. It does not: the ports sit at 50.4°/129.6°/230.4°/309.6°, ±4.6–9.0°, well
  clear of the 0°/180° seam, and the `c[2] >= 0` assignment matches which band actually cut a hole.
- **The surround being too small to cover the hole.** `measured` at `:439` sizes it from `holeR`
  plus a margin, and the arithmetic is right. The panel is big enough. It is in the wrong place.
- **The duct's back cup being inside-out.** I suspected this for D5 and it is wrong: all 80 cup
  faces point toward a viewer looking into the bore, mean `n·axis` = 0.885. The cup is correct;
  it is simply behind the skin. (A signed-volume test said otherwise — that test is invalid on an
  open surface. Use the facing test in `probe11` terms, not signed volume.)

---

## Suggested regression test

`scripts/probe-ports.mjs` is written to be the test — it exits non-zero on any defect. The check
worth lifting into `tests/model.test.mjs` is the one that would have caught D1 on day one, and that
no amount of shading work could have satisfied:

> every port surround vertex lies within one duct diameter of the port it belongs to.

A guard on how the panel is *lit* can pass while the panel is at the other end of the ship. A guard
on where it *is* cannot.
