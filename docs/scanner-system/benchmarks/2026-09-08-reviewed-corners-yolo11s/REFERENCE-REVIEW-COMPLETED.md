# Completed reference corner review

The user completed all 502 imported photos / 561 reference cards, including all 22 multi-card photos. The server contains no remaining drafts or skips. A snapshot was exported and verified against the live journal and export at 2026-09-09 05:32 UTC.

Snapshot directory: `.artifacts/card-geometry/reference-corner-review/completed-20260909T053239.496979Z/`.

- `reviewed-reference-corners.json`: portable sidecar, SHA-256 `1c4b12c9808b44f874442ac4f3d62ba51fe4677eb57cc183b9ed5c1e4d257399`.
- `queue-v1.json` and `journal-v1.jsonl`: exact source backups.
- `comparison.json`: per-card comparison of both frozen models against these reviewed corners.
- `RESULTS.md`: concise comparison findings.
- `snapshot.json`: checksums for all six snapshot files.
- `complete_review.py`: reporting script; original script remains one directory above the snapshot.

All saved quads pass geometry, visibility and seed-binding validation; the exported sidecar passes its JSON schema and all saved layer relations pass graph validation. The review contains 10 physically adjusted outlines and 551 accepted starting outlines, plus three layer relationships. Human confirmation can accept a starting outline without moving its corners; it is not independent blind re-annotation.

Printed-top orientation is explicitly known for nine cards and remains unknown for 552. Confirmation did not silently mark their printed top as checked. Border comparison uses the best cyclic corner alignment; unknown orientation stays excluded from printed-top disagreement checks.

## Comparison using the newly reviewed references

Both model columns use these same 561 reviewed reference cards.

| Metric | Previous model | Retrained YOLO11s |
|---|---:|---:|
| Matches at IoU ≥ 0.50 | 542 | 549 |
| Matches at IoU ≥ 0.75 | 494 | 532 |
| Matches at IoU ≥ 0.90 | 368 | 475 |
| Missed reference cards | 19 | 12 |
| Extra detections | 84 | 29 |
| Duplicate detections | 12 | 1 |

The current model has 419 photos with close agreement, 47 with smaller differences, and 36 flagged photos. These are diagnostic model-comparison categories, not unfinished label work. The flagged set remains 36 photos. Original source polygons and reviewed full-card quads have different semantics in some cases; their metrics are not interchangeable.

The previous reference labels, prediction files, published frozen benchmark scores, earlier training-label journal and model weights are unchanged. The newly checked references are exported as a separate version; the model comparison studio still loads its previous pinned reference report. No new training, publication, split reassignment or deployment ran as part of completion. Further work should focus on the identified model weaknesses rather than asking for another pass through these borders.
