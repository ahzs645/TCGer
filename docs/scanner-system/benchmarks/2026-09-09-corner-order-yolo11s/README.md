# YOLO11s corner-order correction

Latest outcome: [guarded checkpoint selection and rotation handling](SELECTION-ROTATION.md) are implemented and tested against all three saved models. The final checkpoint keeps its four recovered correct identifications while the cross-orientation family margin reduces its naive four-way wrong identifications from two to one. Its real-capture detection regressions still prevent replacement. The previous model remains the baseline; epoch 50 is retained as the best border candidate, and no second training job was submitted.

The user authorized integrating the tested corner-order correction, validating it locally, retraining one YOLO11s model and comparing it with the existing reviewed-data model.

The new `cyclic-unknown-v1` policy preserves the existing four-corner model and all stored labels. Materialization writes a hash-bound orientation sidecar. The data loader joins metadata against actual cached label rows, carries target identity through filtering, and restores class zero before collation. The assigned ground-truth index selects coordinates and orientation together.

Unknown-orientation targets use the best of four clockwise cyclic shifts under the pinned coordinate-loss formula. Known-orientation targets retain fixed identities. Visibility follows the selected shift; reversed winding is never accepted as an equivalent order. Box-only targets retain detection supervision and masked corner coordinates.

Internal validation now uses cyclic OKS for unknown-orientation targets too. This affects checkpoint selection; its fitness formula is unchanged. Internal pose mAP is therefore not directly comparable with the previous run. The external frozen geometry and recognition evaluations remain unchanged and determine the model comparison.

## Validation

Five integration tests cover vectorized-loss/gradient agreement with the diagnostic prototype, target filtering and shuffled batches, metadata binding and unsupported augmentation rejection, assigned-target alignment, and validation rotation/mirror semantics. Existing geometry/materialization tests also pass. A two-epoch CPU smoke run on seven existing training/validation examples exercised known and unknown corners, synthetic cards and box-only targets. Its training criterion recorded 440 unshifted and 20 two-position-shifted positive anchors. Training and validation losses were finite. The checkpoint reloaded as the standard Ultralytics `PoseModel` and produced the standard four-by-three keypoint output.

The smoke is a runtime check, not an accuracy estimate; its weights are not the new candidate. Its evidence is `.artifacts/card-geometry/cyclic-yolo11s-20260909/local-smoke-v2/validation.json`.

The post-run comparison was checked by comparing the frozen baseline with itself against the reviewed sidecar. It reproduced 549/532/475 matches at IoU 0.50/0.75/0.90, 12 misses, 29 extras and one duplicate across 502 photos / 561 cards, with identical output for both inputs.

## Single-run specification

Use the same training release `card-geometry-training-reviewed-corners-v1`, corpus hash `41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf`. Keep the same official base checkpoint, 50 epochs, batch 16, seed 20260905, 640-pixel input, 16% real-image context padding, pinned Ultralytics 8.4.138 and no runtime augmentation. Synthetic augmentation remains baked into the existing corpus. Use one L4 with a four-hour timeout.

The comparison baseline is the completed reviewed-data YOLO11s checkpoint SHA-256 `0f5bc3e2509c98837b4c57745af55b75f5acac5739a76d68122c46f0b9995327`. The user's reviewed reference sidecar is pinned at SHA-256 `1c4b12c9808b44f874442ac4f3d62ba51fe4677eb57cc183b9ed5c1e4d257399`; those 502 photos remain evaluation-only.

The job saved its checkpoint, ran the 600-image real and 1,000-image synthetic frozen benchmarks plus recognition replay, and the results were verified against the pinned baseline and newly reviewed references. No production deployment is included. One seed and reuse of a development-guiding benchmark limit generalization claims.

Status: **training and comparison complete**. The job's final report failed on a zero-duplicate total and was repaired locally using saved outputs, without retraining. The candidate improved reviewed-reference misses but regressed on tight outlines and the complete real benchmark. Retain the previous model. See [results](RESULTS.md) and [the job and exact run pins](RUN.md). Inputs, receipts and recovery evidence are recorded in `.artifacts/card-geometry/cyclic-yolo11s-20260909/`.

The [follow-up diagnosis](DIAGNOSIS.md) includes paired border/orientation measurements, a four-orientation recognition replay and an inspected comparison gallery.
