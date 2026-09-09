# Next model experiment after reference review

The border review is complete: 502 photos / 561 cards, with no drafts or skips. The [completion report](REFERENCE-REVIEW-COMPLETED.md) identifies the verified snapshot and comparison. Keep these photos as evaluation data. The next work is model diagnosis and preparation, followed by one YOLO11s-pose candidate if the diagnosis supports a change.

## First investigation: corner identity on rotated cards

Update: the [corner-order audit](CORNER-ORDER-AUDIT.md) now confirms the supervision mismatch, shows real upside-down examples and reproduces the penalty for an identical outline with a different starting corner. A diagnostic cyclic-loss prototype passes six tests. Integration into training and a measured model improvement remain outstanding.

Implementation and result update: the [single-model run](../2026-09-09-corner-order-yolo11s/RUN.md) integrated the correction through materialization, target assignment, coordinate/presence loss and internal validation. Twenty-four focused tests and a two-epoch local training/checkpoint round trip passed. Training, frozen evaluations and the recovered reviewed-reference comparison are complete. The candidate reduced reviewed-reference misses but worsened tight outlines and full real-photo results; [retain the previous model](../2026-09-09-corner-order-yolo11s/RESULTS.md). The sections below preserve the original experiment plan, not outstanding authorization for another run.

A read-only audit of the frozen training release `card-geometry-training-reviewed-corners-v1` (`41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf`) counted:

| Training targets | Cards |
|---|---:|
| Real, four known corners and known printed top | 1,364 |
| Real, four known corners but unknown printed top | 2,843 |
| Real, box supervision only | 2,038 |
| Synthetic, four known corners and known printed top | 32,904 |

The current adapter's `training_geometry.has_corner_supervision` checks coordinate availability, without checking `orientationKnown`. `train_yolo_pose.yolo_line` emits those corners in their stored order. Thus unknown printed-top labels still provide fixed-order keypoint targets. This is a possible supervision conflict, not a demonstrated cause of the model failures.

Before another full run, check representative training records and their stored corner identities against the photographed cards. Test a geometry loss that accepts cyclic shifts for orientation-unknown quads while retaining fixed corner identities for orientation-known quads. Preserve clockwise winding; accepting reversed order would hide mirrored crops. Verify equivalent cyclic labels produce equivalent geometry supervision, known orientation remains meaningful, and box-only targets stay usable. Export and inference should keep the same four-corner output contract.

## Rotation, perspective and false detections

The completed run disabled runtime augmentation, but its synthetic corpus already includes rotation and perspective variation. Do not assume augmentation was absent. Measure rotation sensitivity and inspect coverage of real sideways, upside-down and slanted cards before selecting additional training transforms. The previous visual audit found rotated cards in 30 of the 36 flagged imported photos; that association alone does not establish causation.

Audit training examples of inner artwork, slab grading labels and rectangular background objects. Additional negative examples must preserve all actual visible cards, including partial cards. Some unmatched predictions in the current benchmark correspond to real cards missing from its reference targets.

## One candidate and evaluation

Keep the retrained YOLO11s as the baseline. Select one justified change after the local checks, record a new immutable experiment configuration, and train one YOLO11s candidate. Compare it against the baseline on the same newly reviewed references and the full real and synthetic evaluations. Report tight border matches, misses, extras, duplicates and recognition outcomes together. Current reviewed-reference results are 532 matches at IoU >= 0.75, 475 at IoU >= 0.90, 12 misses and 29 extras; these counts are not independent error totals.

Fresh captures would help cover real tilted, rotated, sleeved and overlapping cards, plus confusing backgrounds. Use distinct capture sessions and reserve separate sessions for evaluation. Because the existing benchmark has guided development, new held-out sessions are needed for a stronger generalization claim. More labeling is not a prerequisite for the first investigation.

This document is a proposed sequence. The audit and plan are complete; no training changes, new paid run or deployment were performed for this plan.
