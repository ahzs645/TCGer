# Reviewed-corner YOLO11s follow-up — 2026-09-08

The user requested completing the reviewed-data preparation and retraining only the most promising model. This run selects **YOLO11s-pose**. The September 7 successor benchmark gave it the strongest overall real-image coverage and substantially tighter localization than YOLO11n; YOLOX still missed all binder cards and FastViT overfit. See the [baseline results](../2026-09-07-successor-bakeoff/RESULTS.md).

## Dataset

The completed review contains 259 frames and 2,038 decisions: 1,378 corner labels and 660 skips. The labels comprise 510 human-source and 868 detector-source instances; provenance and orientation uncertainty are retained. The immutable journal snapshot is bound by SHA-256 `565ed494998606b8ee5a487869e4acaeeaa51e60218e1102e1d82cfe97f2581e`.

- Imported all 1,378 labels and seven saved layer relationships.
- Derived five `visible` → `occluded` corner flags from the reviewed layer order. The original review export and all corner coordinates remain intact.
- Removed 32 targets in reflected archive borders and replaced those reflected pixels with neutral padding.
- Removed the four saved `not-a-card` targets with journal provenance. The 656 cut-off or occluded skips retain box supervision.
- Preserved all 1,279 real validation records exactly. Synthetic training and validation images are unchanged.

Final combined release: `card-geometry-training-reviewed-corners-v1`, corpus SHA-256 `41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf`. It contains 13,465 training images / 39,149 targets and 2,279 validation images / 5,003 targets. Full policy-v4 preflight and cross-release separation checks passed. The perceptual audit found no flagged matches between the real component and either frozen evaluation release. Every final YOLO pose target passed materialization validation.

## Single-model training recipe

YOLO11s-pose starts from the same hash-pinned official base checkpoint as the baseline: 50 epochs, batch 16, seed 20260905, 640-pixel input, one L4, Ultralytics 8.4.138, and no runtime augmentation. The job has a four-hour timeout and includes both geometry evaluations, recognition replay, and a verified baseline comparison. Checkpoints and reports are saved to the existing private model repository.

One training setting changes: real-image context padding increases from 15% to 16% of the long side. A reviewed outside-frame corner at x=1.158788 on a 512-pixel image extends about 4.3 pixels beyond the old 77-pixel margin; the new 82-pixel margin preserves it. Synthetic padding and all evaluation settings remain unchanged. This measures the complete reviewed-data preparation, including that padding adjustment, rather than isolating label changes alone.

The frozen evaluation sets remain 600 real images / 700 cards and 1,000 synthetic multigame images / 3,651 cards. The decoder and BGR evaluation contract remain unchanged. The comparison reports loose and tight recall, extra/duplicate detections, corner error, scene slices, and recognition outcomes. The binder slice contains only three images / 27 cards, and this is one seed.

## Reproducibility and status

Prepared tooling is frozen in isolated local commit `9a96e11fb09aa82693eff9b0301e24b1dda9a734` and uploaded as a hash-pinned archive. Preparation artifacts live in `.artifacts/card-geometry/reviewed-yolo11s-20260908/`; `freeze.json`, `input-publication.json`, `job-spec.json`, and the job receipt identify the exact private Hub inputs and run once submitted. `collect_results.py` verifies the checkpoint, report hashes, frozen evaluation identities, and experiment identity before writing the comparison.

Status: **completed and verified** on September 8 at 23:33 UTC (16:33 Pacific). [Completed Hugging Face job](https://huggingface.co/jobs/ahzs645/6aa0721b32d5d0c22c5ae7fd). The replacement ran all 50 epochs, both frozen geometry evaluations, recognition replay, and the verified baseline comparison in about 2 hours 44 minutes. [Results](RESULTS.md).

On the 600-image real evaluation, recall at IoU .50 improved from 92.3% to 96.7%, recall at IoU .90 from 55.4% to 74.4%, extras fell from 177 to 47, duplicates from 16 to 2, and median normalized corner error from .1415 to .0686. All 27 binder cards matched at IoU .75 with no extras across the three binder images. Synthetic tight-match recall improved from 49.3% to 69.0%, while synthetic extras increased from 729 to 843. Recognition remains four correct and one wrong, with seven abstentions versus eight previously. These results support improved geometry; recognition accuracy has not yet improved.

The original job `6aa0489c32d5d0c22c5adf86` queued for 71 minutes, then failed after 32 seconds because the connector-injected credential could not write the resolved config to the model repository (403). No training epochs ran. The unchanged experiment was resubmitted through the Python Jobs API with the saved local credential, after an actual write to the private model repository verified access. Credentials remain in encrypted job secrets.

Dataset revision: `3759819e007e6ee755b530652c3d72abbd96963f`. Model input revision: `3016a7f6edfdcdb3e9abd6ec1fecc7125b22b7a8`. Experiment: `0c78006b4b116bcdc7ebf3fb29c99de48780f6c43441d85d80b2eac67c3960ba`.

[Private checkpoint and results location](https://huggingface.co/ahzs645/tcger-universal-arcface/tree/main/geometry/yolo11s-pose/41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf/0c78006b4b116bcdc7ebf3fb29c99de48780f6c43441d85d80b2eac67c3960ba) (files appear as the job saves them).
