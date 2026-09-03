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
recall. These reports used `x * width`, `y * height`; the crop-parity
experiment subsequently froze that same image-edge mapping, so no numerical
rerun was required. R@0.75 and R@0.9 re-threshold the same R@0.5 greedy
matches; they do not rematch.

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

Normalized by mean truth-card side, Vision document reports p50 0.051, p90
0.256, p95 0.426, and mean matched IoU 0.816. Its visible-corner p50 is 0.042
and its `outsideFrame` p50 is 0.138. The device quad is behind the same offline
Vision request on every comparable axis: R@0.5 0.803, normalized p50 0.088,
p90 0.522, and mean matched IoU 0.745. This is consistent with the earlier
device-versus-offline replay gap. Guide-crop handling and platform Vision
behavior are plausible contributors, but this benchmark does not isolate
their individual effects.

All current truth instances have `orientationKnown: false`. The scorer used
the minimum-error cyclic roll and excluded every match from orientation
accuracy, as required. This release contains no multi-card frames, so these
reports do not claim duel-field or binder performance.

### Manual orientation audit

The manual labeler records the first click as the printed card's top-left and
then TL, TR, BR, BL. A zero-roll audit warped ten stored manual quads directly
in that order without geometric reordering. All ten crops were upright. The
sample spans all seven contributing sessions and includes four frames with
outside-frame corners. The [audit report](reports/manual-orientation-audit.json)
records the stable frame keys; its contact sheet remains local because it
contains card imagery.

The pinned v2 release and its reports remain unchanged. The ingestion adapter
now marks manual quads orientation-known; detector-derived quads remain
orientation-unknown. The resulting pinned v3 corpus and its
[orientation-aware baseline rerun](../2026-09-02-shared-card-geometry-orientation-v3/README.md)
measure the previously excluded orientation accuracy.

### Geometry error versus device outcome

The [device outcome report](reports/device-geometry-outcomes.json) joins each
manual frame's device geometry to the archived `identified` decision and human
identity verdict. The primary bucket value is the mean of the four normalized
corner errors after the same minimum cyclic roll as the frozen benchmark.

| Mean normalized error | Frames | Known outcomes | Correct | Wrong | Abstain | Unknown | Abstention rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| [0.00, 0.05) | 5 | 5 | 1 | 1 | 3 | 0 | 60.0% |
| [0.05, 0.10) | 16 | 15 | 7 | 0 | 8 | 1 | 53.3% |
| [0.10, 0.20) | 12 | 12 | 3 | 1 | 8 | 0 | 66.7% |
| [0.20, infinity) | 16 | 16 | 0 | 1 | 15 | 0 | 93.8% |
| unmatched at IoU 0.5 | 8 | 8 | 0 | 1 | 7 | 0 | 87.5% |

Abstention concentrates above 0.20: 15 of 16 known outcomes, versus 19 of 32
below it. That is a useful breakpoint for calibrating a crop-quality proxy,
not a runtime gate by itself: true corner error requires ground truth and is
not observable on-device. The four wrong accepts are also too few and not
monotonic in geometry error, so geometry quality cannot replace the existing
recognition safety checks.

Geometry is therefore necessary but not sufficient. A corner model can attack
the high-error bucket and the eight unmatched frames, but abstention remains
53–60% below 0.10 where geometry is already good. The 2026-08-30 bake-off
isolated that residual as the encoder's camera-domain gap; reducing it requires
the separate camera fine-tune rather than more detector tuning.

### Proposed candidate budgets

These values are proposed pending human approval. If approved, they are frozen
before any candidate is evaluated and must not be tuned after candidate
results are visible:

- R@0.5 at least 0.98 and R@0.75 at least 0.85;
- normalized corner-error p50 at most 0.03, p90 at most 0.10, and p95 at most
  0.15;
- `outsideFrame` normalized p50 at most 0.08;
- zero duplicates and at most three extras on these 61 frames; and
- no increase in wrong accepts through the full recognition replay.

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
