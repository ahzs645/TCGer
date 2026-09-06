# YOLOX corner-learning diagnostic — 2026-09-06

The epoch-50 benchmark emitted no accepted quads. A raw-output sample showed the third corner near the first, yielding non-convex polygons. The unchanged canonical corpus contains 39,316 supervised instances; all have four corners and none duplicates the first point at the third point.

The pinned MMYOLO OksLoss computes `1 - exp(-0.5 * (distance / sigma / boxDiagonal)^2)` with sigma 0.025 and weight 30. Large errors can underflow the exponential and produce exactly zero coordinate gradient. A 200-by-300 box with its third target at (200,300) but prediction at (2,2) reproduces a 7.5 loss contribution and exactly zero gradient in float32. This is a mechanistic hypothesis to test in the actual loader and training path, not evidence from a new benchmark sweep.

## Predetermined diagnostic

Both arms start from the same immutable epoch-50 checkpoint (SHA-256 `0e377102d98e597502fad94f8ce6a1d37b70b4ef8c2dc4d09afcea4992bc8d7d`). Each uses 80 steps, four generated fixture images (including unknown-corner boxes), resolution 640, seed 20260906, fixed LR 0.0000625, no augmentation, no scheduler and no EMA. Optimizer state starts fresh in both arms. No real benchmark images or labels are used for learning or selecting settings.

The probe checks every fixture coordinate and visibility bit after the actual dataset pipeline against the COCO annotation and recorded scale factor. It also checks a distinct-corner round trip through the actual pose decoder, records the actual coordinate gradient per corner at each optimizer step, and records raw and accepted fixture predictions.

The control retains OksLoss. The candidate uses visible-corner L1 distance normalized by the box diagonal, averaged over x/y and supervised corners, with the same loss weight 30. This avoids exponential saturation and gives exactly zero coordinate loss/gradient for box-only instances. The candidate is available as `yolox_corner_loss.NormalizedCornerLoss`; it is used only in this diagnostic and does not change the default trainer or any frozen experiment.

Local verification before launch: 228 geometry tests pass and Ruff is clean. Unit tests cover distant-corner gradient direction, exact zero unknown-corner gradients, mixed visibility, and scale invariance.
