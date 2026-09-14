# Larger benchmark and recognition audit

**Started September 13, 2026. Local evaluation is running; no results are claimed yet.**

The three latest saved checkpoints are being evaluated on the frozen real and synthetic benchmarks. Four historical parent checkpoints are included so seed, loss/split and checkpoint-selection contrasts use the same CPU evaluation path. This is a finite local batch, with two workers and two CPU threads per worker. No training or weight averaging is part of this pass.

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

The local batch root is `.artifacts/card-geometry/large-benchmark-audit-20260913/`. Its `run.py` launches the finite queue, writes `status.json`, and will assemble `RESULTS.json` and `RESULTS.md` after all seven verified evaluations complete. Per-checkpoint logs and partial predictions are retained; the batch lock prevents duplicate coordinators. It cannot submit paid jobs or promote a model.

This Mac needs to remain available while the local batch runs. At startup the machine was under heavy load, so a few-minute completion estimate was not supported. The next steps—weight averaging, promotion-policy implementation, two-seed geometric augmentation, and text-orientation validation on training labels—remain separate decisions. The earlier [loss/split/seed report](../2026-09-13-loss-split-ablation/README.md) records the completed phone results and their interpretation.
