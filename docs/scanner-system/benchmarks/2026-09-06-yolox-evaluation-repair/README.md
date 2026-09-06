# YOLOX epoch-50 evaluation repair

Training job `6a9c9300259f8e97255e4a0e` completed all 50 epochs and saved the final checkpoint, then failed in raw-image benchmark inference. The labeled test pipeline requires an annotation sample `id`, whereas MMDetection's array input supplies only `img_id`. Removing `id` from the labeled pipeline would break CocoMetric again.

The repair gives raw-array inference its own copied pipeline: use the ndarray loader with the same float conversion, retain all image transforms and other metadata, and omit only the unavailable annotation `id`. The original labeled pipeline remains unchanged. Portable prediction records retain their manifest record IDs. The runtime fixture covers both tools/test.py and raw-array inference.

The evaluation-only runner verifies the checkpoint and model configuration hashes at an immutable Hub revision, preflights both frozen evaluation releases, and runs the existing geometry benchmarks and recognition replay. It does not train. Outputs go under a separate `evaluation-reruns/<tooling revision>` prefix with lineage back to the original training experiment. No checkpoint, corpus, threshold, scoring rule, or fairness setting is selected or changed using these results.

Original training experiment: `c9bfaa144ceebe71ec70cc4978e3ce560413957fb5f1ad9e8f66f7113c0c9118`.

Checkpoint: `training/repeat-0/epoch_50.pth`, SHA-256 `0e377102d98e597502fad94f8ce6a1d37b70b4ef8c2dc4d09afcea4992bc8d7d`.

Model configuration SHA-256: `d6ed97cb6bbfeae6ec911acadaa85c188883cab15d7df58559fc7a24be4096cf`.

Source model repository revision: `9caa473da8ee42edef32c9aeaca407d7b2c59875`.
