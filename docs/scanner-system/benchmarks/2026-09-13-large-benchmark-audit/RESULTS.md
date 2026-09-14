# Saved-checkpoint benchmark results

2026-09-14T02:30:39.351289+00:00

All seven checkpoints completed; no training, averaging, label changes or promotion.

## real

| Checkpoint | Found | Tight | Mean assigned IoU | Extras |
|---|---:|---:|---:|---:|
| newFixedFinal | 676 / 700 | 544 | 0.8976 | 26 |
| newSeedFinal | 680 / 700 | 513 | 0.8983 | 40 |
| oldFixedFinal | 670 / 700 | 530 | 0.8885 | 39 |
| newSeedBest | 661 / 700 | 479 | 0.8694 | 99 |
| oldCyclicFinal | 664 / 700 | 562 | 0.8923 | 53 |
| newCyclicFinal | 677 / 700 | 550 | 0.8981 | 36 |
| oldFixedBest | 677 / 700 | 520 | 0.8922 | 47 |

## synthetic

| Checkpoint | Found | Tight | Mean assigned IoU | Extras |
|---|---:|---:|---:|---:|
| newFixedFinal | 3339 / 3651 | 2699 | 0.8652 | 520 |
| newSeedFinal | 3347 / 3651 | 2658 | 0.8653 | 502 |
| oldFixedFinal | 3349 / 3651 | 2692 | 0.8685 | 543 |
| newSeedBest | 3353 / 3651 | 2580 | 0.8640 | 719 |
| oldCyclicFinal | 3338 / 3651 | 2678 | 0.8616 | 497 |
| newCyclicFinal | 3358 / 3651 | 2713 | 0.8710 | 495 |
| oldFixedBest | 3371 / 3651 | 2519 | 0.8624 | 845 |

Recognition counts and human-corner slices are in RESULTS.json. One seed pair does not estimate a variance distribution.
