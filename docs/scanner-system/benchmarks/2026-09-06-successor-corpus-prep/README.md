# Successor corpus preparation — 2026-09-06

Purpose: answer the open real-supervision question left by the [category repair](../2026-09-06-category-repair/README.md) and assemble a local successor training corpus under `training-minimums-v4`. Everything here is local and unpublished. No corpus was uploaded, no experiment configuration was frozen and no training was launched. The frozen round-two corpus, its benchmarks and both evaluation releases are untouched.

## Where real corner supervision can and cannot come from

The canonical archives were inventoried per source and per fit outcome (`real-build-summary.json`, `../2026-09-06-category-repair/coverage.json`). Every multi-card train archive (carddetection-hegxe, pk-detect, pokefolio, pokemon-card-outliner, mtg-scanner-bughx) is **box-only**: no polygon exists, so no adapter can recover binder or tabletop corners from existing labels. Those targets need human labels; see the queue below.

Two groups of whole-card polygons were being rejected by the lossless v1 fit for reasons that are not label defects:

- **Square-stretched exports.** 550 four-vertex card polygons in card-scanner-seg have an opposite-edge aspect of 1.0 to 1.1 because the Roboflow export stretched portrait photographs to squares. The cards are real and the model sees the same stretched pixels (`v1-rejected-aspect-examples.jpg`). The v1 band of 1.10 to 2.20 measured the export, not the card.
- **Many-vertex outlines.** 704 card polygons in the card-seg-j74w1 parent and fork trace the card inside a slab with 8 to 40 edge clicks (`v1-rejected-residual-examples.jpg`). They are straight-edged cards with extra vertices, not occluded shapes.

## Fit adapter `polygon-quad-fit-v2`

`tools/card-geometry/polygon_quad_fit.py` is a separately versioned adapter that runs only on polygons v1 rejected for `residual` or `aspect`. It seeds a quad from the convex hull, assigns every vertex to a side, fits a line per side twice (the second pass excludes vertices within 4% of the settled corners), intersects the lines and applies declared gates: residual at most 1% of quad scale, polygon-to-quad area ratio in [0.93, 1.02], solidity at least 0.97, aspect in [1.0, 3.0], convexity. Gates were measured on the canonical corpus before the adapter was enabled: on the 822 v1-rejected polygons the residual distribution has p50 0.0055 and p95 0.011; on 600 v1-accepted quads densified and jittered by 0.3% of scale it recovered every corner within 0.9% of scale. Exact four-vertex quads keep the v1 adapter. Each instance now records `cornerFit` (`conservative-mask-quad-v1` or `polygon-quad-fit-v2`); corners stay `maskFit` and never become metric ground truth.

On the successor real candidate the adapter accepted 1,252 instances and rejected 123 (108 residual, 15 area ratio). `polygon-fit-v2-spot-check.jpg` shows 16 accepted fits drawn from the release at random (seed 20260906): quads sit on the card edge inside slabs, on stretched exports and on cards cut by the frame; corners are ordered from the top-left.

| Real split | Card targets | Trusted corners before | Trusted corners after | Of which v2 |
|---|---:|---:|---:|---:|
| Train | 6,281 | 2,176 | 2,829 | 653 |
| Validation | 1,386 | 194 | 793 | 599 |

## Real scene slices for multi-card frames

`classify_canonical_scenes.py` (heuristic `grid-size-overlap-rotation-v1`, `scene-assignments.json`) labels the 304 multi-card canonical frames as regular grid (99), overlap or rotation spread (125) or other (80). The spot-check sheet (`scene-spot-check.jpg`) shows that "grid" includes cards laid out in rows on tables and floors as well as binder pages, so the importer maps the assignments to layout names rather than scene claims: `multi_card_grid_archive`, `multi_card_scatter_archive`, `multi_card_other_archive`. Single-card frames stay `single_card_archive`. The importer binds the assignment file to the canonical corpus hash and refuses a multi-card record without an assignment. These names never collide with synthetic or Dev Mode slices, so per-slice minimums stay separately enforceable.

Train instances after slicing: single 4,204, grid 778, scatter 1,065, other 234. Validation: single 1,258, grid 29, scatter 80, other 19. Every multi-card train target is box-only except 7.

## Policy v4 (amended before any use)

`training-minimums-v4` keeps the v3 split totals and metric-eligible minimums, adds `requireTargetSemantics`, and re-partitions the real archive slice minimums to the new slices: `single_card_archive` train 4,000 and validation 1,000, `multi_card_grid_archive` train 700, `multi_card_scatter_archive` train 1,000, all with zero metric-eligible requirement because real polygon fits are not ground truth. The synthetic slice minimums are unchanged. SHA-256 `d1f38ac331ef3eef1e632f6f3874cd1f33967c073ca33dbbec26c8547a9080f6`, pinned in `combine_geometry_releases.py`. v4 had not been referenced by any receipt when it was amended.

## Successor real candidate

`real-geometry-successor-candidate-v1` was built with `plan_real_archive_release.py`: whole-archive components recomputed from the canonical inventory, the round-two alias table and the recorded reviewed links, excluded against both pinned evaluation releases, then assigned largest-first toward 80/20 (`real-archive-assignment.json`). The assignment equals the round-two one. Corpus hash `8c709255183d446e6e5740bc4754767b80e01281e810904e1e8578ede667a855`, 5,744 records, 7,667 card targets, smoke purpose, local only. It declares `targetSemantics`, uses `polygon-quad-fit-v2` and the scene assignments above.

The near-duplicate audit against both evaluation releases and across train/validation flagged **zero** pairs at Hamming distance 4 with eight rotations/reflections (`near-duplicate-audit.json`). As before, pHash is a screen, not proof.

## Human corner-label queue

`build_archive_corner_label_queue.py` lists the train multi-card targets without corners: 259 records and 2,070 targets (grid 778 in 90 records, scatter 1,061 in 108, other 231 in 61; `archive-corner-label-queue-summary.json`). Each frame carries the canonical record id, image hash, annotation index and seed box that the new `card-geometry-archive-corner-labels` v1 sidecar needs. The importer's `--archive-corner-labels` option attaches human corners to exactly the named target, requires the label quad to cover the annotation box, binds labels to corpus and image bytes, and records `cornerSource: human` with the labeler's orientation flag. Labels do not exist yet; the queue is the input for a labeling session, not evidence. Neither Dev Mode nor evaluation images appear in it.

## Combined successor training candidate

`card-geometry-training-successor-candidate-v1` combines the successor real candidate with the unchanged `synthetic-geometry-round-two-v1` under `training-minimums-v4`, with both frozen evaluation releases pinned. Corpus hash `74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf`, 15,744 records, 39,185 train and 5,003 validation instances, 32,904 and 3,617 metric-eligible (all synthetic). Preflight passed all 20 checks including `TARGET_SEMANTICS` on 5,744 archive records, with `readyFor: training` (`combined-preflight.json`). The cross-release gate found no archive, session, asset, physical-card or image overlap against either evaluation (`combined-cross-release-leakage.json`). The corpus is local only; it becomes a frozen input only after publication with a receipt and a declared experiment configuration.

## Not done here

- No successor corpus was published to the dataset Hub, no experiment configuration or fairness policy was frozen, and no training was launched. Publication should follow the recorded round-two commands with a receipt.
- Human corner labels for the 2,070 queued train targets were not collected; the existing corner editor is bound to Dev Mode sessions and needs an adapter for archive frames.
- The scene heuristic remains provisional. Its slice names deliberately describe layout, not verified binder or duel scenes.
- Synthetic training data is the unchanged `synthetic-geometry-round-two-v1`; no new backgrounds or scenes were added.

## Reproduce

```sh
PY=.artifacts/card-geometry/trainer-validation-venv/bin/python
$PY -m unittest discover -s tools/card-geometry -p "test_*.py"
$PY tools/card-geometry/classify_canonical_scenes.py --corpus <canonical corpus.jsonl> --output <scene-assignments.json> --raw-dir <raw> --spot-check-output <sheet.jpg>
cd tools/card-geometry && $PY plan_real_archive_release.py --canonical-corpus <canonical corpus.jsonl> --raw-dir <raw> \
  --aliases ../../docs/scanner-system/benchmarks/2026-09-04-round-two-assembly/source-archive-aliases.json \
  --reviewed-links ../../docs/scanner-system/benchmarks/2026-09-04-round-two-assembly/reviewed-archive-links-v2.json \
  --evaluation <real-geometry-evaluation-v6-full-aliases-v2> --evaluation <synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2> \
  --output <release> --release-id real-geometry-successor-candidate-v1 --polygon-fit polygon-quad-fit-v2 --scene-assignments <scene-assignments.json>
$PY tools/card-geometry/audit_near_duplicates.py --training <release> --evaluation <real eval> --evaluation <synthetic eval> --output <dir>
$PY tools/card-geometry/build_archive_corner_label_queue.py --release <release> --output <queue.json>
$PY tools/card-geometry/combine_geometry_releases.py --input-release <release> --input-release <synthetic-geometry-round-two-v1> --output <combined> \
  --release-id card-geometry-training-successor-candidate-v1 --policy tools/card-geometry/policies/training-minimums-v4.json \
  --evaluation-release frozenReal=<real eval> --evaluation-release syntheticMultigame=<synthetic eval>
```
