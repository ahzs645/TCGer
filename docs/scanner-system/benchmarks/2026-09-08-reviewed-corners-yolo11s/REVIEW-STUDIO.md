# Reviewing the trained YOLO11s model

Open <http://localhost:8768/model-review.html>. The existing corner-labeling queue remains at <http://localhost:8768/>.

Update: the default view now opens 12 inspected model failures from the [completed reference comparison](REFERENCE-COMPARISON.md). All 600 photos have been compared; the three binder pages agree closely with the saved human borders and do not need repeat labeling. The original starter set below remains available in the selector. Benchmark approval is no longer requested; feedback is optional.

The starter set contains 24 real benchmark photos: all three binder pages, six duel-field scenes, six handheld photos, six steep-angle photos and three archive photos. Within each scene it includes remaining failures and improvements over the prior model. The full 600-photo benchmark is available from **Review set**. This intentionally selected starter set is diagnostic; its error rate is not an unbiased estimate of accuracy.

1. Inspect all outlines and the rectified thumbnails. Toggle **Previous model** or **Reference labels** for context. Benchmark reference masks can describe only the visible portion of a card.
2. Drag a corner to correct it. **Draw missed card** takes four clockwise clicks beginning at the printed top-left. Rotate the printed top until the crop is upright. Mark covered cards, and optionally enter their known name/set/number.
3. **Not a card** excludes an extra detection; **Restore card** and **Undo edit** recover it. Original card IDs stay stable.
4. **Approve & next** approves every retained outline on the photo and advances. Use **Needs work** or **Unsure** with **Save review** when unresolved. Ordinary Next/Previous save changed photos as drafts and keep the set in a fixed order. Previous restores the last selected card and zoom for that photo within the open page. Refresh restores the current photo/card and saved feedback.
5. **Copy photo/card ref** copies a reference such as `R519 / C3`, the record ID and a direct link.

Rectification uses photographed pixels. Areas outside the photo are transparent; there is no mirrored padding. A covering card remains visible in the crop. This new model-review view does not infer occlusion ordering; the original labeling studio retains its ordering and masking tools.

## What the first inspection found

- **R509, binder page:** new model produces nine detections for nine reference cards, with no unmatched extras or misses. The previous model produced 20 detections. The selected Absol crop looked clean in the browser.
- **R519, duel field:** remaining failure involving stacked cards. The new model still produces multiple overlapping outlines on the blue foreground card and misses the rear Rivers Charm reference. The separate partly covered card underneath is real but is not annotated as another reference target here. Frozen matching reports one miss and two unmatched detections. This is a useful type of scene to collect independently for training.
- The main benchmark and recognition findings remain in [RESULTS.md](RESULTS.md). Geometry improved considerably; this does not establish that recognition or the shipping device pipeline is ready.

## Adding photos

**Add photos** accepts multiple JPEG, PNG or WebP files, at most 18 MB and 60 megapixels each. Images are EXIF-oriented, converted to RGB and resized to fit 2048×2048 before local CPU inference. This normalized raster is the image reviewed and exported. Name each capture session so related shots can later be grouped into the same dataset split.

Use different lighting, cameras, backgrounds, card games and print styles, sleeves/glare, steep angles, overlaps, partial cards at the image edge, and a few scenes with no cards. Include the actual card name/number where known. New, varied, accurately reviewed examples are useful; repeated captures or color/grayscale variants of the same photo add less independent evidence. Keep some entirely new capture sessions reserved for future evaluation.

The model runs locally with the frozen evaluator's 640-pixel input, BGR handling, 192-pixel black context and decoder thresholds. The checkpoint is SHA-256 verified. Benchmark proposals use the existing frozen prediction files. No model is retrained or deployed by this workflow.

Exact duplicate uploads resolve to the existing photo. A conservative grayscale dHash check also flags likely re-encoded or color/grayscale copies of photos in the review library. Raw image hashes from the training release and both benchmark releases are protected. These are preliminary checks: transformed copies of training/synthetic images, session leakage, physical-card grouping and licensing still require validation before future dataset ingestion.

**Export reviewed new photos** exports metadata, local normalized-image paths and human-reviewed decisions for approved, eligible new photos only. Negative photos with zero retained cards are valid candidates. It does not include image bytes and is not a portable dataset archive. Frozen benchmark feedback and flagged possible duplicates are excluded. Candidate exports still require canonical corpus conversion and a grouped split before training; unknown printed orientation and occlusion must be respected during that conversion.

## Local storage and startup

- Configuration: `.artifacts/card-geometry/model-review/reviewed-yolo11s-20260908/config.json`
- Pinned comparison catalog: the adjacent `catalog.json` (600 photos).
- Append-only feedback: `feedback/reviews.jsonl`.
- New photos and cached predictions: `feedback/uploads/<stable-id>/`.
- UI test data is isolated in `ui-smoke-test-feedback/` and is not part of the user library.

The existing `archive-corner-labeler` configuration in `.claude/launch.json` now passes `--model-review-config`. The server binds only to localhost on port 8768. Start that configuration, or run its Python command. To build another catalog, use `tools/card-geometry/prepare_model_review.py --help`; choose a new output/storage directory for another model. Do not repoint an existing feedback directory to a different checkpoint.

Model SHA-256: `0f5bc3e2509c98837b4c57745af55b75f5acac5739a76d68122c46f0b9995327`.

The completed annotation journal and frozen evaluation labels remain unchanged. Feedback is bound to image and model hashes, and stale concurrent saves are rejected.

## Validation

- Seven focused model-review tests: persistence, stale saves, image binding, invalid geometry, duplicate isolation, training export boundaries, and HTTP route/origin behavior.
- All ten existing archive-labeler server tests passed.
- Local checkpoint inference: nine detections on R509, matching the frozen detection count; zero detections on an empty test photo. This is a runtime smoke check, not numeric CPU/GPU parity certification.
- Browser checks in a separate test journal: rendered photo/crops; exclusion/undo; draft saving through Next/Previous; approval persistence after refresh; fresh image upload and local inference.
