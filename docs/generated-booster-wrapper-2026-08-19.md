# Can we draw our own booster wrapper in code?

**Date:** 2026-08-19
**Branch:** `claude/desktop-mobile-interface-review-c59mkx`
**Question:** for the Pokémon packs, can a wrapper be generated in code, and how does it compare with the one the opener shows today?

Short answer: yes, and the comparison also turned up a rendering bug in the
wrapper the opener currently paints.

---

## What the opener shows today

Every pack in `/packs` is a *generated* wrapper already — there is no real
artwork in the tree. `packages/pack-core` ships one mesh
(`assets/pack/models/pack.obj`) and an empty cover manifest:

```json
{ "mesh": "/pack/models/pack.obj", "rim": [0.23, 0.29, 0.42],
  "covers": {}, "bases": {}, "decals": {} }
```

`NEXT_PUBLIC_PACK_ASSET_BASE_URL` is unset, so no remote covers load either.
What you see comes from `paintVariantSheet` in
`src/experience/pack-sheet.ts`: a vertical gradient, one of four abstract
motifs (`aurora`, `flame`, `wave`, `leaf`), a blurred circle, and three lines of
type. Eight skins exist — two sets (Base Set, Pitch Black) × four motifs.

It reads as a placeholder because it is one. Nothing on it says *booster*: no
brand band, no set lockup, no card count, no foot strip, no foil.

## The sheet it has to fill

The mesh samples a single 1024×512 sheet laid out `[back | FRONT | back]`, and
`readSheetLayout` reads the regions off the geometry rather than hardcoding
bands. Measured on the shipped mesh:

| Region | Rect |
|---|---|
| front (display face) | x 328.1, y 21.3, **366.6 × 468.1** |
| back block 1 (wrap order) | x 243.0, w 80.8 |
| back block 2 | x 698.9, w 284.3 |
| seams | 2 vertical strips |
| crimps | 2 horizontal strips |
| `stretch` | **1.4166** |
| `displayFaceZ` | +1 |

Two things fall out of that and drive the whole design:

- **The back panel is cut in two, and the two halves sit at opposite ends of the
  sheet.** `layout.back` is ordered by position *around the pack*, not by
  position on the sheet, so anything meant to read as one back has to be drawn
  once and then sliced.
- **The UVs are not area-preserving.** A texture pixel lands 1.42× wider than
  tall on the display face, so anything that should read as a circle, or as
  upright text, has to be pre-stretched by `sqrt(stretch)` to cancel it.

## What was built

`frontend/src/lib/packs/booster-sheet.ts` — `paintBoosterSheet(canvas, layout,
spec)`. Everything is drawn; nothing is loaded. The spec is small:

```ts
{ game: "pokemon", setName: "Evolving Skies",
  variationName: "Booster pack", cardCount: 10, brand: "TCGer" }
```

`game` resolves through `src/lib/games.ts`, so the wrapper's colour is the same
`brandColor` iOS uses — Pokémon blue `#3d7dca`, Magic `#a5732c`, and so on.

What it draws:

| Layer | What it is |
|---|---|
| Foil field | 9 broad specular ribbons plus 6 tighter ones in the accent hue, drawn in sheet space at a lean, composited with `screen` |
| Diffraction hatch | two mirrored sets of hairlines at 3.5% under `overlay` — invisible alone, shimmer together |
| Sheen / vignette | a lit hot-spot behind the lockup; darkened panel edges so each face reads as a face |
| Brand band | slanted parallelogram, accent gradient, letter-spaced publisher name |
| Set lockup | heavy face with a dark outer stroke, an accent inner stroke and a metallic vertical fill; **condensed to fit rather than shrunk**, the way a set logo is |
| Rule | double rule with diamond finials, then the variation name in spaced caps |
| Crest | hexagon with six alternating facets, an inner ring, a specular arc and a core glow |
| Card count | 16-point starburst carrying the number |
| Foot strip | dark band with a seeded barcode, microtype rules, the set name and a "SIMULATED · NOT FOR RESALE" line |
| Back face | the same field, plus a wordmark and a microtype block drawn **once across the joined panel** and sliced into the two blocks |
| Seams, crimps | the same treatment `paintVariantSheet` uses, so the fold furniture matches |

Two details worth keeping:

- **Deterministic.** The ribbon angles, speckle and barcode come from a seeded
  mulberry32 keyed off `game:setName`. `Math.random()` would re-roll them on
  every repaint and the same set would not look like itself twice.
- **Microtype is rules, not words.** At this scale real small print is a
  texture; drawing hairlines gets the texture without inventing legal copy.

## The comparison

Both sheets painted against the same mesh-derived layout, both worn by the same
geometry, same lights, same `MeshPhysicalMaterial` settings as the live scene.

Left: the current painted variant. Middle: the generated booster, front.
Right: the same wrapper, turned around. The renders are in the interface
artifact for this branch rather than in the repo.

Flat, the difference is in how much of the sheet does any work: the current
sheet leaves the whole lower half of the display face empty and puts nothing on
the reverse but a line of type.

The generator was then run against five specs — two Pokémon sets, plus Magic,
Yu-Gi-Oh! and One Piece — with nothing changing but the spec. Each takes its
game's brand colour from `lib/games`.

## What the comparison found: a bug in the current painter

`paintVariantSheet` draws the reverse-face wordmark centred on **each** back
block, with no clip and no fit:

```ts
for (const block of layout.back) {
  ctx.font = `600 ${Math.round(block.h * 0.055)}px system-ui, sans-serif`;
  ctx.fillText(`TCGer · ${setName.toUpperCase()}`,
               block.x + block.w / 2, block.y + block.h * 0.5);
}
```

The narrow back block is **80.8px wide**. `"TCGer · EVOLVING SKIES"` at that
size measures about **270px**. Centred at x≈283, it runs from x≈148 to x≈418 —
and the display face starts at **x=328**.

So roughly 90px of back-of-wrapper text is painted across the front of the
pack. It is visible on every generated skin in the live opener as ghost letters
floating over the display face — "NG SKIES" to the left of the emblem and "TC"
to the right. The same call on the wide block runs off the right edge of the
sheet and is clipped mid-word.

Three things are wrong and each is independently sufficient: the text is not
clipped to its block, it is not fitted to the block width, and it is centred per
block rather than once across the joined panel.

This lives in `packages/pack-core`, which is a git submodule pointing at
`ahzs645/booster-pack-core` — a different repository from this one.

## Where this leaves things

The generator is committed here and is standalone: it depends only on
pack-core's public `SheetLayout` type and on `lib/games`. It is **not wired into
the opener yet**, and cannot be from this repository alone:

- The skin picker is built in pack-core from `VARIANT_SKINS` and `coverSkins`,
  and `PackOpeningProps` has no hook for a host-supplied skin.
- The one host→scene channel that carries artwork, the `uploadArtwork` command,
  routes through `composeSkinFromImage`, which hardcodes `placement: "panel"` —
  so it refits an image into the display face rather than accepting a
  pre-laid-out sheet. `composeCover` *does* support `placement: "sheet"`; it is
  simply not reachable from the host.

Wiring it up is a small change on the pack-core side — either a new
`kind: "generated"` skin whose painter the host supplies, or exposing
`placement: "sheet"` through the upload command. Both need a commit in
`ahzs645/booster-pack-core`, which this session is not scoped to push to.

## Verification

- `tsc --noEmit` clean; `npm test` 101/101; eslint reports nothing on the new
  module.
- Renders produced headlessly in Chromium (swiftshader) against the real
  `pack.obj`, using `readSheetLayout` on the prepared geometry — the same
  layout the app computes, not a transcription. The layout table above is the
  harness's own read-back.
- Every element of the generated sheet was checked to sit inside its rect: the
  first draft overflowed the lockup into the seam (the aspect pre-stretch was
  not counted in the fit) and pushed the foot strip's second line under the
  crimp band. Both fixed and re-rendered.
