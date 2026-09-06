# YOLOX epoch-50 evaluation repair

Training job `6a9c9300259f8e97255e4a0e` completed all 50 epochs and saved the final checkpoint, then failed in raw-image benchmark inference. The labeled test pipeline requires an annotation sample `id`, whereas MMDetection's array input supplies only `img_id`. Removing `id` from the labeled pipeline would break CocoMetric again.

The repair gives raw-array inference its own copied pipeline: use the ndarray loader with the same float conversion, retain all image transforms and other metadata, and omit only the unavailable annotation `id`. The original labeled pipeline remains unchanged. Portable prediction records retain their manifest record IDs. The runtime fixture covers both tools/test.py and raw-array inference.

The evaluation-only runner verifies the checkpoint and model configuration hashes at an immutable Hub revision, preflights both frozen evaluation releases, and runs the existing geometry benchmarks and recognition replay. It does not train. Outputs go under a separate `evaluation-reruns/<tooling revision>` prefix with lineage back to the original training experiment. No checkpoint, corpus, threshold, scoring rule, or fairness setting is selected or changed using these results.

Original training experiment: `c9bfaa144ceebe71ec70cc4978e3ce560413957fb5f1ad9e8f66f7113c0c9118`.

Checkpoint: `training/repeat-0/epoch_50.pth`, SHA-256 `0e377102d98e597502fad94f8ce6a1d37b70b4ef8c2dc4d09afcea4992bc8d7d`.

Model configuration SHA-256: `d6ed97cb6bbfeae6ec911acadaa85c188883cab15d7df58559fc7a24be4096cf`.

Source model repository revision: `9caa473da8ee42edef32c9aeaca407d7b2c59875`.

## Verified outcome

Evaluation job `6a9ce774259f8e97255e57c0` completed successfully. Both runtime paths passed; local verification passed 225 geometry tests and Ruff. Report and prediction hashes match the published evaluation summary. The predictions cover exactly all 600 real and 1,000 synthetic release records, and both successor/predecessor corpus hashes match the pinned manifests.

The frozen decoder accepted **zero quads**: recall is 0 on both real (700 truth instances) and synthetic (3,651 truth instances) benchmarks. Recognition replay produced 15 abstentions and 42 unknown outcomes across 57 frames, with no correct identifications. Successful execution does not make this checkpoint a usable geometry candidate.

Diagnostic job `6a9cea2ce686246ca69a4e6c` inspected the first two manifest records from each evaluation release with the same verified checkpoint, inputs, and thresholds. Three images produced 1, 9, and 9 raw detections; the other produced none. The recorded examples contain a third corner close to the first, creating non-convex quads that the existing decoder correctly rejects. This proves raw outputs reach the adapter in these four cases; it does not establish the root cause across the full corpus. Investigation of target construction, loss behavior, or pose decoding remains separate from this evaluation repair. No thresholds were relaxed and no retraining was performed on the frozen training corpus.

Evidence is in `reports/`, `report-verification.json`, `runtime-fixture-evidence.json`, and `raw-output-diagnostic.json`. Publication receipts pin the complete predictions and diagnostics on the private model repository. The saved epoch-50 checkpoint remains unchanged.
