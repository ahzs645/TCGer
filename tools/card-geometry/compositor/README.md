# Deterministic card-geometry compositor

This directory implements workstream 3 of the shared card-geometry plan. It
generates ordinary `smoke`-purpose corpus releases: the same record schema,
manifest, readiness policy, preflight, Hub smoke, and benchmark used for real
data. Generated images are not a parallel training format.

## Contracts

- Every random draw comes from NumPy PCG64 seeded by the tuple
  `(compositorRevision, sceneSeed, transformationSeed)`.
- `compositorRevision` is the SHA-256 of a pinned 40-hex compositor Git SHA
  and the resolved config SHA-256. The resolved config includes both asset
  manifest hashes.
- Card and background asset manifests assign bytes to `train` or
  `validation` before generation. Identical asset bytes under different ids
  may not cross splits. Synthetic records are never emitted into `test`.
- Each full amodal quad is printed-card TL, TR, BR, BL with
  `cornerSource: synthetic`, known coordinates, and `orientationKnown: true`.
  `outsideFrame` is relative to the cropped capture, not the padded canvas.
- Visible masks are exact uncompressed COCO RLE masks after later cards, the
  optional hand occluder, and the capture frame are applied.
- The release records the background asset and any card-derived art-panel
  distractor. It also records `distractorCount`, including procedural objects,
  so prevalence can be reported without confusing asset-backed provenance
  with scene difficulty. Shared leakage-key derivation includes asset ids as
  well as the instance card assets.
- No wall-clock value enters an image, record, manifest, config, or summary.

The pinned stack is in `requirements.txt`. A five-record test generates two
releases and compares every byte, then runs the normal preflight.

## Asset policy

Card faces come from a locally materialized, pinned private scanner image
library. `build_card_asset_manifest.py` extracts a bounded pack from already
downloaded tar shards, verifies every blob hash, preserves the library repo,
revision, manifest hash, member, and sample id, and marks the result
`private-training-only`. It never fetches mutable artwork URLs.

Backgrounds must be self-captured or explicitly CC0. The checked-in smoke
manifest uses two project-authored CC0 procedural textures with different
bytes and ids for train and validation. Replace or extend it with reviewed
photo assets for a later training release; do not scrape backgrounds.

Card backs are private training assets. The first smoke uses the checked-in
Pokémon back only in `train`; validation disables face-down cards so the same
back bytes never cross the split boundary.

The checked-in assets are intentionally a smoke pool, not a training pool. A
training-purpose synthetic release must first contain several thousand renders
across Pokémon, Magic, and Yu-Gi-Oh (including the 59:86 Yu-Gi-Oh aspect), all
three game backs, and 50–100 self-captured photos of representative desks,
playmats, binder pages, carpet, hands, and sleeves. Background provenance stays
self-captured or explicitly CC0; scraped backgrounds are forbidden.

## Build the bounded card pack

The local image-library root must contain `manifest.jsonl`, `library.json`,
and the selected tar shards from one immutable Hub revision:

```bash
uv run --with-requirements tools/card-geometry/compositor/requirements.txt \
  python tools/card-geometry/compositor/build_card_asset_manifest.py \
  --library-root /path/to/pinned/pokemon/physical-v2 \
  --library-repo ahzs645/tcger-scanner-images \
  --library-revision <40-hex-hub-revision> \
  --game pokemon \
  --train-count 64 \
  --validation-count 7 \
  --card-back frontend/public/card-backs/pokemon.png \
  --output .artifacts/card-geometry/compositor-assets/pokemon-smoke-v1
```

## Build the 2,000-frame smoke

Commit the compositor first and pass that exact Git SHA:

```bash
uv run --with-requirements tools/card-geometry/requirements.txt \
  --with-requirements tools/card-geometry/compositor/requirements.txt \
  python tools/card-geometry/compositor/compositor.py \
  --config tools/card-geometry/compositor/config.smoke-v1.json \
  --card-assets .artifacts/card-geometry/compositor-assets/pokemon-smoke-v1/card-assets.json \
  --background-assets tools/card-geometry/compositor/background-assets.smoke-v1.json \
  --compositor-git-sha <40-hex-git-sha> \
  --release-id synthetic-geometry-smoke-v1 \
  --output .artifacts/card-geometry/releases/synthetic-geometry-smoke-v1
```

The full config emits 1,800 train and 200 synthetic-validation frames across
`single_handheld`, `binder_page`, `duel_field`, and `steep_playmat`, targeting
about 6,000 card instances. Images are 896 × 1280 JPEG quality 90. The camera
bank supplies contrast 0.71/0.97/1.28, sharpness 0.06/0.64/1.67, saturation
0.56/0.90/1.24, mean brightness near 0.89, and noise sigma up to 7.6. Other
sampled effects are warm/cool gains up to 1.25, gamma, recompression,
vignette, glare, sleeve tint, non-card rectangles, phones, paper, and cropped
art panels.

`config.smoke-v2.json` preserves the same 2,000-frame size while splitting 75
single-handheld frames into `single_handheld_distractor_free`. That subset has
the same geometry and photometric distributions as `single_handheld`, but an
exact distractor count of zero. The build summary reports record prevalence and
mean distractor count for every scene slice. Compare the two single-handheld
slices before changing either distractor density or transformation ranges.

This is a smoke release. Its generated minimums are tooling-only and cannot
authorize training. A future `training` release must bind the separately
approved `training-minimums-v1` policy by hash.

The first published run is pinned at dataset revision
`b4ef746b06c725cbe196e709d518dc53eea0ad13`, release path
`geometry/releases/synthetic-geometry-smoke-v1`, and corpus hash
`544ec80646b61e8b3c5343b93ce9580061d164ad03cd1e25ed28c08d2eec9393`.
Its counts, Hub smoke, and baseline results are recorded in the
[dated benchmark](../../../docs/scanner-system/benchmarks/2026-09-02-synthetic-card-geometry-smoke/README.md).
