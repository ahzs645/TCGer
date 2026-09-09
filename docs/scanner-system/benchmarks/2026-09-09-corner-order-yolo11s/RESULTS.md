# Corner-order experiment: retain the previous model

All 50 epochs, the 600-photo real benchmark, the 1,000-photo synthetic benchmark and recognition replay completed. The final report failed because aggregation dropped the candidate's zero-duplicate count. The report was repaired locally from saved, hash-verified predictions and checkpoint; no additional training run was submitted. The Hugging Face job retains its historical Error status.

Later follow-up found **508 tight reviewed outlines in the saved final checkpoint**, versus 475 previously. It still loses more real capture targets and has more wrong identifications with four-orientation recognition. [The diagnosis compares both checkpoints](DIAGNOSIS.md). The original tables below refer to the automatically selected epoch-20 checkpoint.

## Completed reference review: 502 photos, 561 cards

| Metric | Previous YOLO11s | Corner-order candidate |
|---|---:|---:|
| Matched cards, IoU >= 0.50 | 549 | 554 |
| Matches, IoU >= 0.75 | 532 | 535 |
| Tight outline matches, IoU >= 0.90 | 475 | 454 |
| Missed cards | 12 | 7 |
| Extra detections | 29 | 27 |
| Duplicate detections | 1 | 0 |
| Median mean corner error / card side length | 2.23% | 2.61% |

The candidate detects five more reference cards, but outlines are less precise. These are the user's completed reference checks, applied in memory to the frozen records; neither the original benchmark nor the saved labels was overwritten. Most checks accepted existing outlines, so this is not an independent reannotation study.

## Full frozen benchmarks

| Metric | Previous YOLO11s | Corner-order candidate |
|---|---:|---:|
| Real recall, IoU >= 0.50 | 96.7% | 95.9% |
| Real tight outline recall, IoU >= 0.90 | 74.4% | 71.3% |
| Real misses / extras / duplicates | 23 / 47 / 2 | 29 / 65 / 2 |
| Synthetic recall, IoU >= 0.50 | 92.4% | 92.9% |
| Synthetic tight outline recall, IoU >= 0.90 | 69.0% | 67.2% |
| Synthetic misses / extras / duplicates | 279 / 843 / 22 | 261 / 1,049 / 48 |
| Recognition correct / wrong / abstained | 4 / 1 / 7 | 0 / 0 / 14 |

The full real benchmark includes 98 additional photos and uses its original reference geometry; its results are separate from the reviewed sidecar comparison. Recognition replay covers 57 frames, but many have unknown outcomes (45 baseline, 43 candidate); these small counts do not support a broad accuracy estimate. Extra predictions may include unannotated real cards, so they are not all established false positives.

## Decision and next diagnosis

Keep the previous reviewed-data model, checkpoint `0f5bc3e2509c98837b4c57745af55b75f5acac5739a76d68122c46f0b9995327`. No production model was replaced. The supervision mismatch was real and the runtime correction worked, but this one-seed experiment did not improve the outcomes needed for replacement. It also changed internal checkpoint selection through cyclic validation OKS, so it does not isolate coordinate loss alone.

Before considering another run, inspect saved predictions on the photos that regressed, distinguish outline errors from printed-top errors, and check why the recognition replay abstained. These can be investigated using the saved outputs. Fresh rotated-card capture sessions would strengthen later evaluation, but the user does not need to repeat the completed 561-card review. No sideways-card improvement is established by this aggregate comparison.

## Evidence

- [Job and immutable input/output pins](RUN.md).
- Local run evidence: `.artifacts/card-geometry/cyclic-yolo11s-20260909/`.
- `results-download.json`: immutable output revision and downloaded-file SHA-256 hashes.
- `comparison/comparison.json`: complete benchmark and reviewed-reference aggregate results.
- `comparison/reviewed-reference-comparison.json`: all 502 per-photo comparisons.
- `comparison/verification.json`: verified frozen input and comparison output hashes.
- `comparison/recovery.json`: report failure, correction, regression check and local recovery provenance.

Candidate checkpoint SHA-256: `7e66c9e6734c86fea217831217785fd78cad1eaaea7434f29546d20f123f112e`. Candidate and baseline use the same frozen evaluation contract and decoder. All 50 training CSV rows are present and finite. The report regression test and the full recovered comparison pass.
