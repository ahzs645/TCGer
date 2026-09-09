# Reviewed-corner YOLO11s results

The single 50-epoch YOLO11s run completed training and both frozen geometry evaluations. Its checkpoint and report hashes passed verification.

## Real images: 600 images / 700 cards

| Metric | Previous YOLO11s | Reviewed-data YOLO11s |
|---|---:|---:|
| Recall at IoU .50 | 92.3% | 96.7% |
| Recall at IoU .75 | 76.9% | 90.4% |
| Recall at IoU .90 | 55.4% | 74.4% |
| Extra detections | 177 | 47 |
| Duplicate detections | 16 | 2 |
| Median normalized corner error | 0.1415 | 0.0686 |

## Real scene slices

| Scene | Cards | Recall .50, previous → reviewed | Recall .75, previous → reviewed | Extras, previous → reviewed |
|---|---:|---:|---:|---:|
| binder_page | 27 | 55.6% → 100.0% | 3.7% → 100.0% | 51 → 0 |
| duel_field | 33 | 60.6% → 81.8% | 21.2% → 60.6% | 21 → 9 |
| single_card_archive | 561 | 96.6% → 97.9% | 88.1% → 94.8% | 84 → 29 |
| single_handheld | 57 | 93.0% → 96.5% | 54.4% → 80.7% | 13 → 7 |
| steep_playmat | 22 | 72.7% → 86.4% | 22.7% → 36.4% | 8 → 2 |

## Synthetic images and recognition

Synthetic recall at IoU .50: 90.2% → 92.4%; at IoU .90: 49.3% → 69.0% (1,000 images / 3,651 cards).

Synthetic extra detections increased from 729 to 843, while duplicates fell from 53 to 22.

Recognition replay, baseline: 4 correct / 8 abstentions / 1 wrong.
Recognition replay, reviewed: 4 correct / 7 abstentions / 1 wrong.

Real training context padding increased from 15% to 16% to preserve one reviewed outside-frame corner. Other training settings and all evaluation settings are unchanged.

One seed. The frozen binder slice has only three images and 27 cards. This compares the complete reviewed-data preparation, including the small padding adjustment, rather than isolating label changes alone.

Experiment: `0c78006b4b116bcdc7ebf3fb29c99de48780f6c43441d85d80b2eac67c3960ba`. Checkpoint SHA-256: `0f5bc3e2509c98837b4c57745af55b75f5acac5739a76d68122c46f0b9995327`.

[Verified training artifacts](https://huggingface.co/ahzs645/tcger-universal-arcface/tree/6254006b866a24c16b9df9c1a95e43ddb2595a34/geometry/yolo11s-pose/41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf/0c78006b4b116bcdc7ebf3fb29c99de48780f6c43441d85d80b2eac67c3960ba)
