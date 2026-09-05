# YOLOX-Pose validation repair and epoch-2 resume — 2026-09-05

Job `6a9c667be686246ca69a437a` completed two training epochs, then failed during validation with a CUDA index-out-of-bounds assertion. Its saved epoch-2 checkpoint contains the model, EMA, optimizer (288 parameter states), scheduler, and iteration 1684.

The pinned upstream pose head truncated score-filtered keypoint candidates to `max_per_img=300` before applying NMS indices. Those indices address the entire pre-NMS candidate list. Moreover, the parent uses a copied configuration and overrides its output limit in YOLOX mode, so it can return more than 300 boxes. The repair preserves both captured index lists and selects exactly the number of boxes returned by the parent, in their original order. It does not clamp indices or discard detections.

The source repair remains guarded by the original upstream SHA-256. Regression tests execute the upstream prediction method with captured parent outputs: the previous code reproduces the indexing failure, while the repair covers crowded predictions, more than 300 returned boxes, and empty-image alignment. A resumed run must pass the entire training release's validation split with the saved checkpoint before any further optimizer steps.

The corpus, policy, evaluation pins, fairness settings, seed, and total 50-epoch budget remain frozen. This is an execution repair after other candidate results became available; no data or training settings were selected using those results. The old failed experiment remains recorded, and the replacement configuration explicitly identifies its checkpoint and source job. Training resumes with optimizer and scheduler state from epoch 2.
