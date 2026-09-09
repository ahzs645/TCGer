# Corner-order investigation

The investigation confirms a training-target mismatch: automatically fitted real outlines use an image-relative starting corner, while synthetic targets retain their printed-card corner identities through rotation. The YOLO adapter discards the orientation uncertainty flag. Its fixed-order coordinate loss can therefore penalize a geometrically perfect prediction that uses the printed-card order.

This establishes conflicting supervision semantics. It does not measure how much of the model's sideways-card failure rate comes from that conflict, or demonstrate that a retrained model will improve.

## Verified inputs and population

Audited all 13,465 training record files against their frozen manifest hashes, and verified the manifest corpus hash `41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf`. Validation and evaluation records were excluded. The current `train_yolo_pose.py` and `training_geometry.py` have no differences from frozen training-tooling commit `9a96e11fb09aa82693eff9b0301e24b1dda9a734`.

| Training targets | Cards |
|---|---:|
| Real mask fits, unknown printed top | 2,829 |
| Real detector corners, unknown printed top | 13 |
| Real human corners, unknown printed top | 1 |
| Real detector corners, known printed top | 855 |
| Real human corners, known printed top | 509 |
| Real box-only targets | 2,038 |
| Synthetic corners, known printed top | 32,904 |

All 2,829 mask-fit quads start at the minimum source-pixel `x + y` corner. This is an image-relative convention, independent of the printed top. There are 2,843 real corner-supervised targets with unknown orientation in total; that does not mean all 2,843 have the wrong starting corner. Upright examples can agree by coincidence.

The source of the mismatch is traceable:

- `polygon_quad_fit._order_quad` and `build_real_smoke_release._order_quad` choose minimum `x + y`, with clockwise winding. The importer marks these fits `orientationKnown: false`.
- `compositor._camera_quad` begins with printed-card TL/TR/BR/BL, then rotates/projects those points without re-sorting them. Synthetic instances declare known orientation.
- `training_geometry.has_corner_supervision` requires four known coordinates, but does not distinguish orientation certainty.
- `train_yolo_pose.yolo_line` exports coordinates in stored order. Flipping only `orientationKnown` produces an identical training label.

## Real examples

The [numbered training examples](../../../../.artifacts/card-geometry/corner-order-audit-20260909/verified/training-examples.png) show original image pixels with the stored target indices 0–3. All nine selected image files also passed their manifest hash checks. Selection was deterministic: the first six wide and first three other eligible single-card training photos in manifest order. These are examples, not a representative error-rate sample.

Examples 3, 5, 7 and 8 visibly have upside-down printing, but point 0 remains at the image's upper-left. For example 7, Julius Erving's printed upper-left is at stored point 2. Examples 1, 2, 6 and 9 illustrate that wide or upright cards need not have a starting-corner conflict. Example 4 has horizontally mirrored source printing, a separate property of the input image; corner reordering cannot undo that reflection.

## Loss experiment and tested correction

The local runtime is the run's pinned Ultralytics 8.4.138. The saved YOLO11s checkpoint has four 3-component keypoints and no custom OKS sigmas, giving the default sigma 0.25 per corner. The probe calls its actual `KeypointLoss` on source-derived targets using the declared padding and isotropic image scaling.

For example 7, a perfect outline with its starting corner shifted by two positions has **IoU 1.0**, yet the current coordinate loss is **0.977593** and its gradient is nonzero. The same outline in the stored order has loss zero. These are isolated coordinate-loss values, not a total training loss or a measured model accuracy change.

An isolated prototype minimizes that existing coordinate loss across the four clockwise cyclic shifts **only when orientation is unknown**. It preserves fixed identity when orientation is known, rotates masks with coordinates, and never offers reversed winding as an allowed alternative. The perfect shifted outline then has zero geometry loss while checked printed-top errors still incur the original penalty.

Six focused tests pass: current export/loss reproduction, cyclic loss and gradient invariance, unchanged known-orientation behavior, rejection of reversed winding, visibility alignment without input mutation, and mixed batches retaining box-only masks and known-orientation gradients.

## Implementation recommendation and limits

Carry `orientationKnown` through materialization and batching into the pose loss, aligned with the assigned ground-truth instance. Use the selected cyclic phase consistently for coordinate and keypoint-presence supervision. Test that mapping through shuffled batches, target assignment and any augmentation before a full run. Preserve the four-corner inference/export contract and all saved labels. This avoids asking the user to re-check thousands of borders.

The prototype is intentionally diagnostic: it uses per-instance calls for clarity and is not an efficient, integrated training implementation. Trainer behavior, model weights, annotations, evaluation scores and paid jobs are unchanged. The effect on perspective, detection and recognition still requires a controlled comparison after integration.

## Reproduction

Tool: `tools/card-geometry/audit_corner_ordering.py`; tests: `tools/card-geometry/test_corner_ordering.py`. Final machine-readable evidence and source bindings: `.artifacts/card-geometry/corner-order-audit-20260909/verified/audit.json`.

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python \
  tools/card-geometry/audit_corner_ordering.py \
  --release .artifacts/card-geometry/releases/card-geometry-training-reviewed-corners-v1 \
  --config .artifacts/card-geometry/reviewed-yolo11s-20260908/yolo11s-pose.json \
  --output /tmp/tcger-corner-order-audit-new

.artifacts/card-geometry/trainer-validation-venv/bin/python \
  -m unittest discover -s tools/card-geometry -p test_corner_ordering.py -v
```

The output directory must not already exist. The final audit JSON records its producing tool's SHA-256, which was checked against the current source after the run.
