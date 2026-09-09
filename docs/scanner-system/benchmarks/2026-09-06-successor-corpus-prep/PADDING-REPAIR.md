# Reflected padding correction

The local `real-geometry-successor-padding-fixed-v1` release corrects all 48 training images from `pk-detect.v3i.coco`. Each has two reflected letterbox strips. The correction replaces those strips with RGB `(114,114,114)` padding, stored as PNG, and removes 32 whole-card annotations lying entirely in those strips. The release retains 5,744 records and 7,635 targets. The labeling queue retains its 259 frames with 2,038 targets.

This is a derived local smoke candidate, with full preflight passing for tooling. It does not alter the original archive, original release, or evaluation records. Release hash: `d3e761313361542990c402a7706490cebcdeec9578bc0471635b8a80d416a20c`.

## Verification and provenance

The archive-specific audit tests each edge independently near the observed 1/8-image letterbox seam (±2 pixels). A seam needs normalized RGB error ≤0.006 after Gaussian smoothing with sigma 2, luminance correlation ≥0.99, and spatial texture standard deviation ≥0.01. Smoothing handles resampling/JPEG phase differences; flat backgrounds alone cannot pass. All 96 seams passed. Eight difficult images were also visually inspected against their border reflections.

Every correction is bound to the source corpus and original image hashes. The derived record stores `source.paddingCorrection`, including original image hash, content bounds, fill, and removed original annotation indices. Original annotation category counts remain intact; preflight accounts for explicit removals while validating original index bounds and preventing a removed target from remaining in the record.

All 48 corrected images were checked for identical dimensions and byte-identical decoded interior pixels. All retained target objects were unchanged. The other 5,696 records and their manifest entries are unchanged. No target crossed a verified seam. The repair tool would clip a crossing box and make its corners pending for review.

The migration replayed all 33 historical revisions across 29 reviewed frames into a new journal, retaining reviewers, directions, interior labels and human/bot provenance. The original journal retains original timestamps and all removed target history. The new journal records migration times; its `.migration.json` sidecar pins the original journal. Twenty-two historical target entries (including repeated revisions and previous skips) were removed from the migrated history because they reference false targets. Frame numbers and original displayed card numbers remain stable.

## Reproduce

Run from the repository root, using new output directories for a new run:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/audit_reflected_archive_padding.py \
  --release .artifacts/card-geometry/releases/real-geometry-successor-candidate-v1 \
  --output .artifacts/card-geometry/archive-corner-labels/pk-padding-corrections.json

.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/repair_archive_padding.py \
  --release .artifacts/card-geometry/releases/real-geometry-successor-candidate-v1 \
  --corrections .artifacts/card-geometry/archive-corner-labels/pk-padding-corrections.json \
  --output .artifacts/card-geometry/releases/real-geometry-successor-padding-fixed-v1 \
  --release-id real-geometry-successor-padding-fixed-v1

.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/migrate_archive_label_journal.py \
  --source-queue .artifacts/card-geometry/successor-prep/archive-corner-label-queue.json \
  --source-release .artifacts/card-geometry/releases/real-geometry-successor-candidate-v1 \
  --source-journal .artifacts/card-geometry/archive-corner-labels/journal.jsonl \
  --release .artifacts/card-geometry/releases/real-geometry-successor-padding-fixed-v1 \
  --output-queue .artifacts/card-geometry/successor-prep/archive-corner-label-queue-padding-fixed.json \
  --output-journal .artifacts/card-geometry/archive-corner-labels/journal-padding-fixed.jsonl
```

Stop the label server before journal migration to prevent saves during the snapshot. The scripts refuse to replace a non-empty release or existing destination journal. Start the corrected labeler using [LABELING.md](LABELING.md). Portable label exports still bind to original canonical images; rerun the audit/repair after importing labels into a freshly rebuilt candidate. The correction file must be regenerated for that candidate's corpus hash.
