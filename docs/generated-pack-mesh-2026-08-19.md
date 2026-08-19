# Can we build the pack model in code?

**Date:** 2026-08-19
**Branch:** `claude/desktop-mobile-interface-review-c59mkx`
**Question:** not the wrapper art — the 3D model the opener uses. Can it be generated?

Yes. `frontend/src/lib/packs/pack-geometry.ts` builds it from twelve numbers,
lands within **0.037 units of the shipped mesh at the worst point** (0.8% of the
pack's width, 0.006 mean), and reproduces its surface area to **0.014%** — while
also *stating* the sheet layout instead of leaving it to be re-derived at
runtime.

---

## What ships today

`packages/pack-core/assets/pack/models/pack.obj` — 29KB, hand-modelled and
hand-unwrapped:

| | shipped |
|---|---|
| triangles | 282 |
| vertex records | 192 (143 unique positions) |
| bounding box | 4.5544 × 8.1447 × 0.5747 |
| surface area | 80.222 |
| groups | `BoosterPack`, `BoosterPack_0` |

It works. Three things about it are awkward:

- **The proportions are locked.** A slimmer 5-card pack or a fat 36-card one
  means opening a modeller.
- **Nothing records what the unwrap was meant to be.** `readSheetLayout` has to
  recover the sheet's regions at runtime by classifying triangles — any face
  within about 25° of an axis counts and the rest is discarded — so the layout
  the app uses is an inference, not a fact.
- **It has to be copied around.** `sync-assets` exists to put it where each
  consumer can reach it.

## Reading it back

Everything the generator needs is measurable. The pack turns out to be a plain
swept pillow pouch with **nine rings**, symmetric about the mid-plane:

| y | half-width | thickness | v |
|---|---|---|---|
| ±4.0723 | 2.2772 | 0.0747 | 0.9585 / 0.0410 |
| ±3.4872 | 2.2772 | 0.0724 | 0.8928 / 0.1102 |
| ±3.2053 | 2.2495 | 0.4690 | 0.8611 / 0.1420 |
| ±3.0169 | 2.2308 | 0.5742 | 0.8403 / 0.1629 |
| 0 | 2.2309 | 0.5747 | 0.5017 |

A crimped end is *wider* than the body it came from — flattening a tube spreads
it — which is why half-width grows 2% as thickness collapses to 13%.

**`v` is linear in `y`** (0.1123 per unit, checked across all four spans), so
the art is unskewed down the pack. `u` is a budget walked around the wrap from
the fin seal:

| segment | u | width |
|---|---|---|
| reverse face, near half | 0.2373 → 0.3038 | 68px |
| gusset | 0.3038 → 0.3329 | 30px |
| **display face** | **0.3329 → 0.6659** | **341px** |
| gusset | 0.6659 → 0.6950 | 30px |
| reverse face, far half | 0.6950 → 0.9624 | 274px |

The reverse face gets the same 342px the display face does, split at the fin
seal — which is exactly why `layout.back` arrives as two blocks at opposite ends
of the sheet.

## The generator

```ts
buildPackGeometry({ width: 4.5544, height: 8.1447, depth: 0.5496,
                    bodyWidth: 4.4618, panelWidth: 4.1888,
                    crimpHeight: 0.5851, crimpDepth: 0.0747, foldHeight: 0.4703,
                    lapAt: 1.2613, lapWidth: 0.0226, lapDepth: 0.025,
                    panelSegments: 4, shoulderSegments: 2, shoulderFullness: 2.8 })
```

It sweeps a cross-section through the ring profile. Three things were worth
getting right:

**The gusset is a superellipse, not an ellipse.** A plain elliptical corner is
visibly too pinched — a folded film corner holds its depth further out. The
shipped corner's interior point sits at (0.688·a, 0.854·c), which solves to an
exponent of **2.8**. That also matters for a reason beyond looks: it keeps the
first band out of each face shallow enough to still classify as that face, which
is what decides how wide `readSheetLayout` reports the display region.

**The fin seal is a strip, not a ramp.** The shipped mesh rises gently to the
seal across most of the reverse face and drops away after it, so its back panel
is subtly wedge-shaped — almost certainly a vertex that got pulled and took its
neighbour with it. The generator keeps the reverse face flat and puts the seal
in its own 0.023-wide strip, which is what the film actually does. **That ramp
is the entire 0.037 maximum deviation between the two meshes.**

**Normals come from the sweep, not from the faces.** They are central
differences across the grid, so the gussets shade round rather than faceted —
the gussets are the whole reason a pack reads as a pouch instead of a slab. The
first version had the cross product the wrong way round and put every body
normal *inside* the pack; the reversed pack rendered flat and dim. A check that
dots each body normal against the outward direction now runs in the comparison
and reports 0 of 102 inward. The three that do flag sit at exactly
`x=1.261 z=0.300` — the seal's riser, where the surface genuinely doubles back.

## The comparison

| | shipped | generated |
|---|---|---|
| triangles | 282 | 306 |
| unique positions | 143 | 146 |
| bounding box | 4.5544 × 8.1447 × 0.5747 | 4.5544 × 8.1447 × 0.5746 |
| surface area | 80.222 | **80.233** (+0.014%) |
| inward body normals | 0 / 102 | 0 / 102 |

Surface distance, sampling triangle corners, edge midpoints and centroids on
each mesh against the other's triangles:

| direction | max | mean |
|---|---|---|
| generated → shipped | 0.0300 | 0.0061 |
| shipped → generated | 0.0369 | 0.0062 |

The pack is 4.55 wide, so the worst disagreement is **0.8% of its width** and
the average is **0.13%** — and it is all the fin-seal ramp described above.

## The layout, stated instead of inferred

`buildPackGeometry` also returns a `SheetLayout` built from the budget the
vertices were written from. Compared with what `readSheetLayout` recovers:

| | front rect | stretch |
|---|---|---|
| shipped, read back | 328.1, 21.3, **366.6** × 468.1 | **1.4166** |
| generated, read back | 333.4, 21.2, **355.9** × 468.1 | 1.4025 |
| generated, **declared** | 340.9, 21.2, **341.0** × 468.1 | **1.4164** |

Two things fall out of that table.

The declared `stretch` — computed from `front.w / front.h ÷ (panelWidth /
height)` — comes out at **1.4164** against the shipped mesh's measured
**1.4166**. Two independent routes to the same number to four decimals is a good
sign the model is right.

And the read-back front rect is **7.5% wider than the display face actually
is**, on both meshes, because the classifier absorbs whatever slice of the
gusset passes its 0.9 dot threshold. Anything painted against the read-back
number is therefore drawn slightly too wide and pre-stretched slightly wrong.
With a built mesh nobody has to guess: the budget is the answer.

## Where this leaves things

The generator is standalone — three.js plus pack-core's public `SheetLayout`
type — and is committed here. As with the wrapper generator, it is **not wired
in**: `packGeometry()` in pack-core loads the manifest's `mesh` path and hands
it to `parseObj`, and there is no seam for a host-supplied geometry. Switching
the app over is a small change in `ahzs645/booster-pack-core`, which this
session is not scoped to push to.

If it were wired in, the asset, `sync-assets`' job of copying it, and the
runtime layout inference all go away, and the pack becomes something you can
resize by changing a number.

## Verification

- `tsc --noEmit` clean; `npm test` 101/101; eslint reports nothing on the module.
- Every number above is produced by a harness that loads the real `pack.obj`
  through pack-core's own `parseObj` and runs pack-core's own `readSheetLayout`
  on both meshes — no transcriptions.
- Renders are headless Chromium (swiftshader) with the same
  `MeshPhysicalMaterial` settings, environment and lights the live pack scene
  uses, both meshes wearing the same generated sheet.
