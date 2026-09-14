# Larger benchmark and recognition audit

**Complete September 13, 2026, at 7:30 p.m. PDT (September 14, 02:30 UTC).** All seven saved checkpoints finished both benchmarks and recognition replay. All seven receipts and 56 output-file hashes were rechecked. No new training, weight averaging, label changes or model promotion occurred.

The three latest saved checkpoints and four historical parent checkpoints were evaluated through the same CPU path, using two workers and two CPU threads per worker. [Complete metric tables](RESULTS.md), [distributions and contrasts](RESULTS.json), and [verification receipts](VERIFICATION.json) are saved with this report.

## What the results change

The larger benchmarks do not establish that cyclic loss caused the phone-session regression. On the September 10 split, fixed order found 676/700 real cards versus cyclic's 677/700, with 544 versus 550 tight outlines and mean assigned IoU 0.8976 versus 0.8981. On synthetic data, fixed order also trailed cyclic: 3,339 versus 3,358 found and 2,699 versus 2,713 tight. The old-split comparison is mixed: fixed order finds six more real cards but has 32 fewer tight outlines. These are one-seed contrasts, and the adapter implementation also differs between objectives.

The observed final-epoch seed difference is smaller on the larger benchmarks after normalizing denominators: found rate changes by **+1.43 percentage points on real** and **−0.05 points on synthetic**, compared with **+8.49 points on the phone session**. Mean IoU changes by +0.00985, −0.00318 and +0.02776 respectively. This reduces concern that a few phone images alone should decide the next objective, but one seed pair still does not estimate seed variance. Tight-rate differences remain material on real: −2.43 points, versus −2.83 on the phone session.

Checkpoint selection remains a concrete issue. The new seed's final checkpoint beats its framework-selected checkpoint on real photos: **680 versus 661 found, 513 versus 479 tight, and 40 versus 99 extras**. On synthetic it finds six fewer but has 78 more tight outlines and 217 fewer extras. For the original seed, the selected checkpoint finds more cards but has fewer tight outlines on both larger benchmarks. Selecting only for the framework's score does not consistently select the best card borders.

Reference quality changes the ranking. The current baseline has the highest mean assigned IoU on the **139 human-corner cards (0.7793)**, versus 0.7338 for new fixed order and 0.7252 for new cyclic. On the **561 imported references**, new cyclic has the highest mean (0.9409). These slices also differ in scene difficulty and source; this is not a controlled test of annotation quality. The 700-card pooled score must not replace the human-corner slice.

Recognition replay is complete, but does not separate the candidates: each has four verified correct and one verified wrong outcome across 57 replay frames. Six checkpoints have seven abstentions and 45 unknown outcomes; old cyclic has eight and 44. With so few adjudicated identities, this is insufficient evidence for a product-level improvement.

Keep the current baseline as the continuity default. Defer YOLO11m and predeclare the next evaluation and checkpoint-selection rule before further training. Fixed order with checked geometric augmentation remains a reasonable next experiment, with two seeds per arm, because it tests coverage directly; the present results do not establish fixed order as the superior objective. A weight-average pilot and text-orientation validation remain separate, unstarted work. No repeat full label review is needed.

## Scope fixed before inference

- Real: 600 photos / 700 cards, corpus `631cc7f9ac24b19d5e7587f5c5aefa401f911cfcf4ed52ab6858ea29d3740dd7`.
- Synthetic: 1,000 photos / 3,651 cards, corpus `fb3eca1aa55d99cbff03c1f0eb58600884be879af2d75b8b4becc3d94932ba05`.
- Checkpoints: new fixed-order final/validation-selected, new-seed final and framework best, old fixed-order final and framework best, old-split cyclic final, new-split cyclic final/validation-selected. Seven distinct checkpoint files.
- Recognition: the same pinned three-game models and four-way family-margin replay for all checkpoints. There are 57 replay frames with sparse verified outcomes, so this does not estimate recognition accuracy across all 700 cards.
- Evaluation: existing BGR decoder contract, confidence/NMS thresholds, 640-pixel model input and context padding. Source code, checkpoints, manifests, recognition assets and replay input are pinned in [PROTOCOL.json](PROTOCOL.json).

The existing benchmark matching and counts are preserved. A separate maximum-total-IoU assignment retains every scorable target, including zero-overlap misses. Its distributions are reported for saved human corners and other references separately, alongside photo-balanced means. The real benchmark contains 139 cards with human corner labels and 561 with imported geometry; 49 of those imported references use visible masks rather than full quads. Matching occurs across the whole photo before slicing, so one prediction cannot be reused in different annotation-quality slices.

## Questions this pass can and cannot answer

The predeclared contrasts are seed change at the final epoch, seed change under framework checkpoint selection, fixed versus cyclic on each split, and original selected versus final checkpoint. Changes in counts must be normalized by each dataset's denominator when compared with the 106-card phone session. Real and synthetic results remain separate.

One additional seed supplies one observed paired difference, not a variance distribution. Larger sample size may reduce sensitivity to a few photos, but repeated cards, familiar archive images and annotation quality limit independence. A weight average beating its parents would not prove that all parental differences were noise. Low training loss and these seed differences alone do not establish memorization or predict what a bigger model will do.

Before subsequent training, define the decision protocol, at least two seeds per arm, primary endpoints and minimum meaningful effects. The single seed pair here can inform pilot thresholds but cannot provide a robust variability bound. The existing 40-tight phone score is not a promotion gate. Shipping decisions still need recognition and independent capture evidence; the phone gallery remains useful for qualitative review.

## Execution and outputs

Runner: [`evaluate_checkpoint_suite.py`](../../../../tools/card-geometry/evaluate_checkpoint_suite.py). It verifies model/source hashes, retains resumable prediction prefixes, runs full release preflights when scoring, writes original metrics and separate overlap distributions, and completes four-way recognition replay before writing a checksum receipt. Two focused tests check that annotation-quality slicing cannot reuse predictions and that misses remain in the denominator.

The local batch root is `.artifacts/card-geometry/large-benchmark-audit-20260913/`. Its `run.py` launched the finite queue and assembled `RESULTS.json` and `RESULTS.md` after all seven verified evaluations completed. `status.json` now reports `complete`. Per-checkpoint logs, predictions, overlap rows and recognition outcomes are retained; the batch lock prevents duplicate coordinators. It cannot submit paid jobs or promote a model.

The batch took approximately 86 minutes, with most time spent in the first pair while the Mac was under heavy load. The next steps—weight averaging, promotion-policy implementation, two-seed geometric augmentation, and text-orientation validation on training labels—remain separate decisions. The earlier [loss/split/seed report](../2026-09-13-loss-split-ablation/README.md) records the completed phone results and their interpretation.
