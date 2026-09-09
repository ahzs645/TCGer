# Model output versus the saved borders

All 600 frozen real benchmark photos were compared with their existing reference geometry. Codex then visually inspected source-photo overlays for all 75 flagged photos and all three binder pages. The existing annotations, prediction files, review journal and published benchmark scores were not edited.

Open [the 12 inspected failure examples](http://localhost:8768/model-review.html?set=examples). Each example has a written finding. Green outlines are model predictions (`C#`); gold outlines are saved reference geometry (`T#`). Cards are matched by geometry, not by list index. For matched human-labelled cards, the studio shows the model crop beside the crop from the saved corners. The full flagged set and all saved human-corner photos remain available in the selector.

The selector also includes [all 502 imported photos](http://localhost:8768/model-review.html?set=imported) and [the 36 flagged imported photos](http://localhost:8768/model-review.html?set=imported-flagged). These are available for optional inspection; the comparison does not require another labeling pass. Both counts, the example findings, and the binder agreement view were verified in the running studio.

## Results

| Reference source | Photos | Cards | Close agreement | Smaller differences | Flagged photos |
|---|---:|---:|---:|---:|---:|
| Saved human corners | 98 | 139 | 13 | 46 | 39 |
| Imported polygons / fitted geometry | 502 | 561 | 423 | 43 | 36 |
| Total | 600 | 700 | 436 | 89 | 75 |

The last three columns count photos. These are diagnostic categories, not human approvals or new benchmark accuracy measures. In particular, a smaller-difference photo can still have a visibly imperfect crop.

**The binder work is complete and carried forward correctly.** All 27 cards across R509–R511 have close agreement, with no missing or extra detections. The worst matched outline overlap is 93.0%; median per-card mean corner displacement is 6.5 source-image pixels. All mean corner displacements are below 3.7% of the card's mean side length. The user does not need to redraw these pages.

Across the 139 human-labelled cards, the new model matches 128 at IoU ≥ 0.50, compared with 104 previously. Reference misses fall from 35 to 11. Benchmark extras fall from 93 to 18 and duplicates from 4 to 1. Matches at IoU ≥ 0.75 improve from 44 to 101. This harder, human-labelled subset is separate from the 96.7% detection recall over the complete 700-card benchmark.

## What the visual comparison shows

1. **Perspective remains the main physical-border problem.** On many slanted cards, the prediction remains too rectangular or has the wrong slant. It cuts card corners and includes table pixels. R504 is a clear example; R512 also merges stacked cards into one outline.
2. **Sideways/upside-down cards are a concentrated weakness.** Thirty of the 36 flagged imported-geometry photos contain a sideways or upside-down card. Examples R019 and R161 produce inner regions instead of consistently finding the full card. This is an observed association in this selected failure set, not a controlled augmentation experiment.
3. **Interior artwork and non-card rectangles produce extra regions.** R564 gives multiple nested regions on Darkrai. R308 mistakes a slab grading label for a card. R490 detects the rectangular object beside the real card. R581 combines a nested detection with a printed-top mismatch.
4. **Partial and covered cards are sometimes missed.** R526 misses the card behind Palafin; R535 misses the cropped rear card.
5. **Unmatched does not always mean a false card.** R515, R520, R531 and R532 contain real rear/partial cards absent from the reference targets. These frames still have model problems, but their raw extra counts should not all be described as hallucinations. Some historical reference corners also extrapolate past the photographed card, so large numerical offsets need the source-photo context.

The actionable next model work is rotation/perspective robustness and suppression of interior/non-card regions, using new reviewed training captures and suitable training augmentation. These findings do not justify asking the user to recreate the existing binder labels. Recognition remains a separate evaluation; no additional model training or deployment ran during this comparison.

## Method and limitations

The comparison reuses the benchmark's deterministic one-to-one matching at IoU 0.50. A photo is flagged when it has an unmatched reference/prediction, a matched outline below IoU 0.75, or a printed-top order disagreement against an orientation-known human quad. Otherwise, overlap below 0.90 or human mean corner displacement above 5% of mean card side length creates a smaller-difference category.

Human corner displacement is measured in source-image pixels after the best cyclic alignment; printed-top disagreement is reported separately so a rotation cannot hide behind a good polygon overlap. Imported fitted quads and segmentation polygons do not receive human-corner precision or printed-top claims. A miss and an unmatched prediction may describe one badly localized card; these counts must not be added as independent failed cards.

Visual review used four-photo overlay sheets; it was not an exhaustive pixel-level re-annotation. Seventy-five flagged photos have visually identifiable model issues, but their reference labels and individual numerical error claims retain the caveats above. The 12 examples are illustrative, not an unbiased evaluation subset. All inputs stay frozen. Future changes guided by this benchmark should also be tested on new held-out capture sessions.

## Artifacts and reproduction

- Tool: `tools/card-geometry/compare_reviewed_model.py`.
- Input-bound visual notes: [comparison-inspections.json](comparison-inspections.json), explicitly authored by Codex rather than recorded as user approvals.
- Full per-card comparison: `.artifacts/card-geometry/model-review/reviewed-yolo11s-20260908/reference-comparison.json`.
- Photo overlays and sheet index: adjacent `comparison-sheets/` directory.
- Review server loads the comparison through SHA-256-pinned fields in its existing `config.json`. The original catalog and image/model pins are unchanged.

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python \
  tools/card-geometry/compare_reviewed_model.py \
  --config .artifacts/card-geometry/model-review/reviewed-yolo11s-20260908/config.json \
  --release .artifacts/card-geometry/releases/real-geometry-evaluation-v6-full-aliases-v2 \
  --output .artifacts/card-geometry/model-review/reviewed-yolo11s-20260908/reference-comparison.json \
  --inspection docs/scanner-system/benchmarks/2026-09-08-reviewed-corners-yolo11s/comparison-inspections.json
```

Four focused comparison tests cover geometric matching despite shuffled detection order, printed-top rotation, non-human reference handling, and separate miss/duplicate counts with unchanged source records. All seven model-review and ten existing archive-labeler server tests also pass.
