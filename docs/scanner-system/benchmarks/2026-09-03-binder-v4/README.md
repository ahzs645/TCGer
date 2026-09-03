# Human-reviewed binder labels and local v4 baselines — 2026-09-03

The user finalized three nine-card binder pages and then corrected the three
card-back side labels. A fresh FiftyOne export includes those saved payloads.
This is a **local, content-addressed smoke release**, not a published Hub
revision or training authorization. No GPU job or asset-store export ran.

## Inputs and preservation

- Export: `labels-20260903-093857.json`, exported at
  `2026-09-03T09:38:57-07:00`, 163 labeled samples; SHA-256
  `43719d17a8bceac44f356385bc10cbe96c6d917785d6c88d456675de199418ed`.
- Supersedes backup `labels-20260902-194920.json`; the backups and private
  images remain in the existing local Reference library.
- Baseline release: v3 at dataset revision
  `65017ce8da9137fea491739bd06388ab513831a2`, corpus
  `97780e7e96cbd98da91173a00b37e6304514f758a9046f5bd98adf30c418820e`.
- New local release:
  `.artifacts/card-geometry/releases/real-geometry-binder-smoke-v4`, corpus
  `764491d11ea134686687c462fa7bef19cf70ca817ab1d124d3f27b5c6d400a0d`.
- Bound smoke policy: `real-ingestion-smoke-v1`, SHA-256
  `3f8d4c29da90e2d38558a58c755705ba1f2b2d545d83c74a72f3814349d27aee`.
- Scorer/preflight tooling revision:
  `d9dad6b1db9bd918e4c28bd8b36e0bde39552d9a`.

All 61 existing record documents (including all 57 manual quads) are unchanged
from v3. The four original TCGX smoke records remain the same deliberate
sample; this does not expand the external archive. Three new test records add
27 instances, bringing the release to 64 images and 88 card instances across
eight real sessions. The binder session is added to the evaluation denylist;
none of these labels enter train or validation. v3 and its committed reports
remain untouched, and its full local copy still passes preflight.

The additions are `frame-0000.jpg`, `frame-0010.jpg`, and `frame-0018.jpg` in
`scan-session-20260809-223944`. Saved card backs are page 2 cards 5 and 7, and
page 3 card 5. There are 336 metric-eligible human corners (108 new), including
46 `outsideFrame` corners (six new). Twelve mask-fit corners remain
metric-excluded and four unknown corners remain skipped.

## Label diff and readiness

The multi-card-aware diff reports three gaining frames / 27 gaining instances,
zero changed or lost original quads, and 57 unchanged original manual frames.
Across all 604 image-backed FiftyOne samples, 544 still have no finalized
human geometry: 126 binder frames and 418 singles. These are existing test
sessions, not a potential training split.

Coverage is projected against the unchanged approved `training-minimums-v2`,
SHA-256 `b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d`.
This projection is distinct from the passing smoke-purpose preflight.

| Test requirement | Actual | Minimum | Remaining |
|---|---:|---:|---:|
| Images / records | 64 | 100 | 36 |
| Card instances | 88 | 150 | 62 |
| Metric-eligible instances | 84 | 100 | 16 |
| Real sessions | 8 | 3 | 0 |
| Single-handheld eligible instances | 57 | 50 | 0 |
| Binder-page eligible instances | 27 | 20 | 0 |
| Steep-playmat eligible instances | 0 | 20 | 20 |
| Duel-field eligible instances | 0 | 30 | 30 |

A concrete next evaluation-capture batch that clears these numerical gaps is
20 steep-playmat frames with one fully labelable card each, plus 16 duel-field
frames with at least three fully labelable cards each. That adds 36 records
and at least 68 eligible instances, reaching 100 records and 156 instances.
Vary poses/layouts rather than duplicating adjacent frames, include Yu-Gi-Oh
and the other games, and designate this batch as evaluation at capture time.
A Yu-Gi-Oh binder page is still useful game coverage, though the aggregate
binder minimum is already satisfied. Unknown hidden-corner coordinates must
remain unknown; they cannot be invented just to satisfy a minimum.

Train and validation are intentionally empty in this real evaluation release;
the separately split shippable sources must supply their coverage in the
later combined release. These numbers do not authorize training.

## Seven rerun baselines

Every localizer was rerun over all 64 images and exported 64 prediction rows;
the existing scorer produced a fresh report per localizer. The following table
isolates the three new binder frames / 27 human instances.

| Localizer | Predictions | Matched @0.5 | R@0.75 | Misses | Extras | Normalized corner p50 |
|---|---:|---:|---:|---:|---:|---:|
| Pokémon DETR | 27 | 27/27 | 1.000 | 0 | 0 | 0.0564 |
| DRAW2 YGO OBB | 21 | 21/27 | 0.778 | 6 | 0 | 0.0389 |
| Vision rectangles | 15 | 11/27 | 0.407 | 16 | 4 | 0.0227 |
| App YOLO11s single box | 3 | 3/27 | 0.111 | 24 | 0 | 0.0257 |
| `vision-app` single-card path | 3 | 3/27 | 0.111 | 24 | 0 | 0.0257 |
| Archived device single quad | 3 | 3/27 | 0.111 | 24 | 0 | 0.0197 |
| Vision document | 3 | 0/27 | 0.000 | 27 | 3 | — |

Duplicates are zero for all seven binder rows. Errors are conditional on
matches and use fixed manual corner order, normalized by mean truth-card side
length; a low error on three matched cards does not outweigh 24 misses.

DETR's complete coverage on these three Pokémon pages is a useful real
multi-card baseline, not evidence that it solves perspective or other games.
These are only three pages from one session. Conversely, the app-box and
`vision-app` adapters intentionally expose one best card, and the device
adapter reads the one archived frame quad rather than all binder detections.
Their rows measure the existing single-card exports, not the complete native
binder scanner or the underlying detector's unrestricted multi-card recall.
Vision rectangles is capped at five observations per frame in the existing
harness. None of these limits were changed to improve this result.

Vision export used the checked-in `tools/camera-corpus/vision-quads.swift` and
the existing compiled app `CardDetector.mlmodelc`. Model artifact hashes are
carried in the predictions. DETR and DRAW2 use the same locally cached pinned
weights as v3 (DETR revision `54330f9a0a671167dcf133e36304dcb58a5d9d76`;
DRAW2 revision `ff62fec32e0c1c2104d548b6f8dfcc0b3c46d26f`). Challenger inference
used the existing labeling environment: Torch 2.13.0, TorchVision 0.28.0,
Transformers 5.16.1, Ultralytics 8.4.135, OpenCV 5.0.0.93, NumPy 2.5.2,
Pillow 12.3.0. Vision/device exports used the pinned crop-parity stack.

## Artifacts and checks

- `fiftyone-v3-diff.json`: per-session/frame changes, instance counts, export
  provenance, and approved-policy coverage gaps.
- `preflight.json`: all checks pass for the local release; `readyFor: tooling`.
- `predictions/` and `reports/`: seven fresh contract inputs and deterministic
  score reports, each bound to the new corpus and prediction hashes.

Validation: 89 Python tests using the pinned fixture/compositor/crop stack,
seven JavaScript geometry/editor tests, Ruff 0.15.8 over all of
`tools/card-geometry`, and diff whitespace checks. Regression tests now cover
nine-card coverage without double counting, a changed ninth card, newly
gained multi-card pages, invalid finalized payloads, and ignored drafts.
The builder's summary also now includes multi-card instances (88, not 61).

Hub publication and its fail-first CPU smoke have not run for v4. Publication
must capture the immutable dataset revision before this becomes a pinned
shared evaluation input. The existing published v3 remains the frozen gate
until any replacement is explicitly adopted; proposed budgets are unchanged.
