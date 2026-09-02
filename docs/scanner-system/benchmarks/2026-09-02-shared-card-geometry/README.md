# Shared card-geometry baselines — 2026-09-02

These are the first model-independent geometry baselines on the Dev Mode smoke
release. Every localizer emitted the same `card-geometry-predictions.v1` JSONL
contract and was scored by `tools/card-geometry/benchmark_geometry.py` at
tooling revision `c1e16d45acf05cdf1563b8bc16beea079014e5e7`.

## Frozen inputs

- dataset repo: `ahzs645/tcger-scanner-images`;
- dataset revision: `445437c5e7d92ee92de0dd7ab8c2f30bbbee87b1`;
- release path: `geometry/releases/real-geometry-devmode-smoke-v2`;
- corpus hash: `d14c97a428e7295e10e75644189528dce297d5990d9c76435eeb9e1cf64dc242`;
- 61 real records: 57 single-handheld Dev Mode frames and four TCGX polygon
  records;
- 228 metric-eligible human corners, including 40 `outsideFrame` corners;
- 12 `maskFit` corners participate in matching but are metric-excluded, and
  four unknown corners are skipped.

The DRAW2 weight is `HichTala/draw2` `ygo_yolo.pt` at revision
`ff62fec32e0c1c2104d548b6f8dfcc0b3c46d26f` (weight SHA-256
`037e71a818fc76c65b63d9d81addb28dae306e1b2754151385b18d3555de9cb7`).
The Pokémon DETR is `Matthieu68857/pokemon-cards-detection` at revision
`54330f9a0a671167dcf133e36304dcb58a5d9d76`. Vision stages used the checked-in
`vision-quads.swift` and the compiled app `CardDetector.mlmodelc`; device quads
were reconstructed from the archived session results and matched to release
images by content hash.

## Results

Corner errors are conditional on IoU ≥ 0.5 matches, so they must be read with
recall. Pixel conversion is provisionally `x * width`, `y * height` until the
crop-parity experiment freezes the convention. R@0.75 and R@0.9 re-threshold
the same R@0.5 greedy matches; they do not rematch.

| Localizer | Predictions | R@0.5 | R@0.75 | R@0.9 | Duplicate | Extra | Miss | Scored corners | Pixel p50 | Pixel p90 | Outside scored | Outside p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vision document | 61 | 1.000 | 0.705 | 0.230 | 0 | 0 | 0 | 228 | 33.7 | 159.3 | 40 | 76.3 |
| `vision-app` | 61 | 0.951 | 0.639 | 0.230 | 0 | 3 | 3 | 216 | 37.3 | 206.9 | 35 | 76.8 |
| App YOLO11s box | 61 | 0.885 | 0.475 | 0.262 | 0 | 7 | 7 | 200 | 64.7 | 306.0 | 33 | 191.7 |
| Device quad | 57 | 0.803 | 0.443 | 0.082 | 0 | 8 | 12 | 196 | 52.5 | 301.2 | 36 | 131.9 |
| Pokémon DETR | 71 | 0.820 | 0.344 | 0.082 | 3 | 18 | 11 | 184 | 88.7 | 308.9 | 28 | 216.1 |
| DRAW2 YGO OBB | 80 | 0.787 | 0.344 | 0.098 | 0 | 32 | 13 | 184 | 81.1 | 257.9 | 30 | 152.9 |
| Vision rectangles | 93 | 0.525 | 0.361 | 0.180 | 14 | 47 | 29 | 112 | 29.4 | 245.3 | 11 | 58.7 |

Vision document segmentation is the strongest baseline on this single-card
release. Its perfect R@0.5 and complete 40-corner amodal slice make it the
number to beat, although its 33.7 px median and 159.3 px p90 leave substantial
room for a true corner model. The low Vision-rectangles median is selection
bias from scoring only 32 matches; its recall and duplicate/extra counts make
it unsuitable as the winner.

All current truth instances have `orientationKnown: false`. The scorer used
the minimum-error cyclic roll and excluded every match from orientation
accuracy, as required. This release contains no multi-card frames, so these
reports do not claim duel-field or binder performance.

## Artifacts

- `predictions/` contains the exact schema-validated JSONL inputs. Their hashes
  are recorded in the corresponding reports.
- `reports/` contains deterministic benchmark JSON. Each report repeats the
  corpus hash, predictions hash, tooling revision, preflight corner counts,
  coordinate convention, matching rule, all detection counts, and all corner
  error/orientation breakdowns. No timestamp is part of the report.

The committed reports are baselines, not a training authorization and not a
licensing decision. A candidate must improve downstream recognition as well as
these geometry numbers before it can win the shared detector bake-off.
