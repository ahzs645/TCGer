# Shared card-geometry orientation baselines — 2026-09-02

This rerun measures card-relative corner ordering. It changes only the 57
manual Dev Mode truth records from `orientationKnown: false` to `true`; record
ids, images, quads, prediction files, matching, and the four TCGX records are
unchanged from the [v2 baseline](../2026-09-02-shared-card-geometry/README.md).

## Frozen inputs

- dataset repo: `ahzs645/tcger-scanner-images`;
- immutable dataset revision:
  `65017ce8da9137fea491739bd06388ab513831a2`;
- release path:
  `geometry/releases/real-geometry-devmode-orientation-smoke-v3`;
- corpus hash:
  `97780e7e96cbd98da91173a00b37e6304514f758a9046f5bd98adf30c418820e`;
- tooling revision: `e037926e06c570ad054f2b18fec15fcebac14616`;
- predictions: the exact JSONL files committed with the v2 baseline; report
  `predictionsSha256` fields prove the reuse;
- manual orientation evidence: ten of ten zero-roll crops upright across all
  seven sessions, including four outside-frame examples.

The pinned Hub smoke passed. Job `6a98695b21c5aa7c8364e811` changed one image
byte and failed with exactly `IMAGE_HASH`; job
`6a98697b0718b0f6d8911b8e` passed every check and reported
`readyFor: tooling`. The positive report is pinned at model-repo commit
`84ce65e08a1c405a04b454d3fd01b523ead47426`.

## Results

Because orientation is now known, corner error uses the fixed stored
TL,TR,BR,BL correspondence. Orientation accuracy is the share of IoU 0.5
matches whose zero cyclic roll is the minimum-error roll. Detection metrics
are unchanged from v2.

| Localizer | R@0.5 | R@0.75 | Normalized p50 | p90 | p95 | Orientation pairs | Correct order | Orientation accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Vision document | 1.000 | 0.705 | 0.058 | 0.483 | 0.875 | 57 | 53 | 93.0% |
| `vision-app` | 0.951 | 0.639 | 0.064 | 0.513 | 0.632 | 54 | 52 | 96.3% |
| App YOLO11s box | 0.885 | 0.475 | 0.122 | 0.552 | 0.618 | 50 | 49 | 98.0% |
| Device quad | 0.803 | 0.443 | 0.098 | 0.558 | 0.674 | 49 | 47 | 95.9% |
| Pokémon DETR | 0.820 | 0.344 | 0.158 | 0.556 | 0.631 | 46 | 45 | 97.8% |
| DRAW2 YGO OBB | 0.787 | 0.344 | 0.135 | 0.552 | 0.853 | 46 | 42 | 91.3% |
| Vision rectangles | 0.525 | 0.361 | 0.045 | 0.391 | 0.529 | 28 | 28 | 100.0% |

The orientation tail is now visible. Vision document is still the strongest
detector but assigns the wrong corner roll on four of 57 matched cards; the
device quad does so on two of 49. Those few errors inflate fixed-order p90 and
p95 sharply compared with the v2 minimum-roll report. This validates the
plan's decision to keep 0/180 recognition and orientation-contradiction
rejection until a calibrated `cornerOrderConfidence` exists. High aggregate
orientation accuracy alone is not enough to remove that safety net.

In particular, Vision document's normalized p95 moves from 0.426 to 0.875
without any change to its quads: the change is the four fixed-order roll
errors, not worse localization precision. Across the plausible 93–98%
baselines, removing double inference would expose roughly 2–7% of matched
cards to a silent wrong orientation. Confidence must be calibrated per
candidate against these tail errors, not inferred from aggregate accuracy.

Vision rectangles' perfect orientation number is conditional on only 28
matched pairs and must not be read without its 0.525 recall. As before, this
release is single-card and smoke-purpose; it is not training authorization and
does not establish multi-card performance.

## Artifacts

The `reports/` directory contains all seven deterministic reports. The
crop-parity experiment subsequently froze their existing `x * width`,
`y * height` image-edge mapping, so no numerical rerun was required. Proposed
candidate budgets remain pending human approval and are not modified by this
rerun.
