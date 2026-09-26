# Blower ports — RESOLVED. A record of a geometry defect and the probe that keeps it fixed

**Status: fixed. `scripts/probe-ports.mjs` measures all 45 checks clean across the three
classes** (verified 2026-08-09). This file is history plus a warning, not an open bug. It is
kept because the root cause was a naming trap that will catch the next person, and because
the fix is only permanent while the probe keeps running.

```
node scripts/probe-ports.mjs                          # exits non-zero on any defect
```

No node? `scripts/probe-ports.html` runs the same module in a browser and puts the verdict in
the page title.

The symptom was a ragged, stair-stepped hole around every large blower, on every class. Two
independent defects produced it, and four more were found while measuring:

| | Defect | Cause | Fixed in |
|---|---|---|---|
| D1 | Every port surround panel collapsed onto the nose tip | inverted clamp bounds | `model/build.js` |
| D2 | The surround wound inward | wrong index order for a nose-to-tail profile | `model/build.js` |
| D3 | Its vertex normals summed to zero | double-sided winding | `model/build.js` |
| D4 | The aperture was cut up to 3.4× wider than the duct | corner test at full grid pitch | `model/build.js` |
| D5 | Trim fans showed hull colour inside the bore | two magic numbers, unlinked | `model/config.js`, `model/layout.js` |
| D6 | (new guard) a proud-mounted fan could overlap other skin equipment | never checked | `scripts/probe-ports.mjs` |

Every number below was measured from the built geometry by the probe, not asserted from the
source.

---

## What it looked like, and why it took so long to find

The panel that covers the ragged aperture edge around each large blower —
`PortSurrounds` / `SolarPortSurrounds` / `UndersidePortSurrounds` — **was not near any
blower.** Every one of its vertices collapsed onto a single point at the nose tip. On the
P-100 the panels measured `x = [84.6..84.6]`, `radius = [1.5..1.7] m`; the ports they cover
are at `x = [-33.9..26.3]`, `radius = [17.0..19.6] m`, on a hull of radius 22.3 m.

So the hole in the skin sat uncovered. That was the artifact: not a shading problem, not the
solar layer, not inverted hull normals — the stair-stepped edge of a real hole with nothing
over it.

That is also why several earlier attempts failed. They were aimed at how the panel *shades*.
The panel was never in the picture.

**The general lesson.** A guard on how a thing is *lit* can pass while the thing is at the
other end of the ship. A guard on where it *is* cannot. The probe checks position first.

---

## D1 — the station clamp was inverted (the root cause)

`stationX` (`model/config.js`) is

```js
export const stationX = (c, t) => c.xNose - t * c.lengthM;
```

It **decreases** with `t`. `stationX(0.001)` is the *nose* — the largest x — and
`stationX(0.999)` is the *tail*, the smallest. `portSurroundGeom` clamped with the raw pair:

```js
const xLo = stationX(cls, 0.001), xHi = stationX(cls, 0.999);
const x = Math.max(xLo, Math.min(xHi, port.c[0] - rho * Math.cos(phi)));   // WRONG
```

`Math.max(xLo, Math.min(xHi, x))` with `xLo > xHi` is the constant function `xLo`:

| class | stationX(0.001) | stationX(0.999) | clamp(x) for all x | hull radius there |
|---|---:|---:|---:|---:|
| P-100 | 84.6 | −92.1 | **84.6** | 1.7 m |
| P-1000 | 181.5 | −197.7 | **181.5** | 3.7 m |
| P-10000 | 391.7 | −426.7 | **391.7** | 8.0 m |

Every vertex of every surround was forced to the nose station, where the hull has almost no
radius, so the patch crumpled into a sliver at the tip of the ship.

The fix is to order the bounds before clamping:

```js
const xa = stationX(cls, 0.001), xb = stationX(cls, 0.999);
const xLo = Math.min(xa, xb), xHi = Math.max(xa, xb);
```

Measured after the fix, the P-100 panels span `x = [-38.8..31.2]`, `radius = [18.3..21.9] m`,
against ports at `x = [-33.9..26.3]` — covered, with margin, at every class.

**`stationX` returning a descending x is worth remembering.** It is exactly the kind of thing
that gets assumed the other way round, and it reads as correct in isolation both times.

## D2 and D3 — winding and normals

With the patch in the right place, all 132 of its faces pointed inward, because it used the
opposite index order from `hullGridGeom` — which is itself unusual, since the hull profile
runs with x *decreasing* and that inverts the conventional winding.

Worse, the patch was pushed **double-sided**:

```js
idx.push(a, c, d, a, d, b);
idx.push(d, c, a, b, d, a);      // "so no port ring can dim as a backface"
```

`solid()` derives vertex normals by summing face normals. `(d,c,a)` is the exact reverse of
`(a,c,d)`, so each face contributed `+n` and `−n` and they cancelled — all 736 raw normal
accumulations on the P-100 fell below 1e-9. What survived was floating-point residue, which
`solid()` normalised into a unit vector pointing nowhere in particular. Every vertex landed
in the |dot| < 0.2 bucket; in the shader that is a division by zero or a random direction,
and either way the diffuse term is garbage.

Both are fixed by pushing **one** winding, the hull grid's own. Backface dimming is solved by
winding a patch correctly, not by winding it both ways. Measured now:

| layer (P-100) | faces outward | mean dot(normal, outward) | zero-length normals |
|---|---:|---:|---:|
| `OuterFairing` (control) | 5484 / 5484 | 0.9433 | 26 / 5486 |
| `PortSurrounds` | 1056 / 1056 | **0.9932** | 0 |
| `SolarPortSurrounds` | 528 / 528 | **0.9894** | 0 |
| `UndersidePortSurrounds` | 528 / 528 | **0.9969** | 0 |

## D4 — the aperture was cut far wider than the duct

`blocked()` drops a skin quad if **any** of its four corners falls inside the port circle.
That is the right rule — it guarantees no skin intrudes into the opening — but at the full
grid pitch it removed up to one whole cell diagonal past the port:

| class | duct radius | grid cell diagonal | hole cut, before | after | duct flange reaches |
|---|---:|---:|---:|---:|---:|
| P-100 | 3.50 m | 4.24 m | 7.05 m (2.01×) | **4.33 m (1.24×)** | 1.18× |
| P-1000 | 5.50 m | 9.13 m | 13.62 m (2.48×) | **6.75 m (1.23×)** | 1.18× |
| P-10000 | 7.50 m | 19.68 m | 25.35 m (3.38×) | **9.34 m (1.24×)** | 1.18× |

On the P-10000 that meant a 15 m blower sitting in a hole 51 m across, with everything
between the flange and the hole edge being substitute hull painted on by the surround panel.

The fix subdivides the hull grid locally near each aperture before the corner test, so the
stair step is a fraction of the duct radius instead of a whole cell. The subdivision is
bilinear in position space, so sub-quads tile the original flat quad exactly and the borders
stay straight — no T-junction cracks against untouched neighbours.

The residual 1.24× is still slightly outside the flange's 1.18×, which is what the surround
panel is for. The probe holds the ratio under 1.4×.

## D5 — the small blowers showed hull colour inside the bore

A separate defect with a separate cause, affecting the trim fans.

No aperture is cut for a trim fan — it is smaller than one skin grid cell, so cutting for it
would remove several times more skin than the unit occupies, and it is mounted **proud**
instead. That means the only thing between the viewer and the hull, looking into the bore, is
the duct's own back cup. The fan did not stand proud by enough to clear that cup:

| class | fans | duct dia | cup seals at | was mounted proud by | skin was inside the bore by |
|---|---:|---:|---:|---:|---:|
| P-100 | 48 | 1.60 m | 0.36 m | 0.256 m | 0.104 m |
| P-1000 | 96 | 2.65 m | 0.60 m | 0.423 m | 0.172 m |
| P-10000 | 220 | 5.70 m | 1.28 m | 0.911 m | 0.370 m |

It read as pink underneath and solar on top because it was the *band* layers you were seeing:
they are drawn at `lift = 1.004`, deeper into the bore than the fairing.

**The underlying defect was not the number.** It was that the seal depth (`depthRatio`, in the
duct geometry) and the mount offset (in the layout) were two independent magic numbers in two
files that had to satisfy an inequality, with nothing tying them together and nothing checking
it. Tuning either one would have silently broken it again.

The fix gives the seal depth one home — `DUCT_SEAL_OF_DIAMETER` in `model/config.js` — and
derives the mount offset from it, plus the band lift, plus a margin:

```js
const proud = dia * DUCT_SEAL_OF_DIAMETER + localRf * (HULL_BAND_LIFT - 1) + dia * 0.03;
```

Measured now: 0 of 48 / 96 / 220 fans have skin in the bore, worst-case clearance +0.048 m
(P-100), +0.079 m (P-1000), +0.171 m (P-10000). The probe reads the same two constants from
`config.js` rather than mirroring them, so it cannot drift from what the model uses.

This does not make the fans float. At `proud = h` the duct's back rim lands on the skin and
the cup is buried beneath it — a duct sitting on the hull, which is what it should look like.
Before, it was partially *sunk*.

The medium thrusters use the same seal geometry at `depthRatio = 0.62`, but they are recessed
behind a real cut aperture (P-100: 1.95 m below the skin), so the cup is behind the hull line
and they were never affected.

---

## What this was *not* — ruled out by measurement, do not re-chase

- **The solar layer filling the port.** `SolarSkin` and `HullUnderside` cut their own
  apertures; `holeR` confirms 4 of 8 holes in each on the P-100, matching the ports on their
  own half.
- **Inverted hull normals.** A real defect, fixed earlier and separately; `OuterFairing`
  measures 5484 / 5484 faces outward, mean dot 0.9433.
- **Band / surround mismatch at the beam line.** The solar–underside seam does not cut
  through the side ports: they sit at 50.4°/129.6°/230.4°/309.6°, ±4.6–9.0°, well clear of
  the 0°/180° seam, and the `c[2] >= 0` assignment matches which band actually cut a hole.
- **The surround being too small to cover the hole.** It is sized from `holeR` plus a margin
  and the arithmetic was right. It was big enough. It was in the wrong place.
- **The duct's back cup being inside-out.** All 80 cup faces point toward a viewer looking
  into the bore, mean `n·axis` = 0.885. The cup was correct; it was simply behind the skin.
  (A signed-volume test said otherwise. That test is invalid on an open surface — use a
  facing test.)

## Keeping it fixed

`scripts/probe-ports.mjs` is the regression test: 15 checks per class, exiting non-zero on
any failure. The one worth lifting into `tests/model.test.mjs`, because it would have caught
D1 on day one and no amount of shading work could have satisfied it:

> every port surround vertex lies within one duct diameter of the port it belongs to.
