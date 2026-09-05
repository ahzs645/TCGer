# YOLOX test-loop metadata repair and epoch-2 resume

The previous restart, `6a9c8770e686246ca69a45e5`, stopped before any optimizer steps. Its full pre-resume test loop failed in MMPose CocoMetric.process with `KeyError: 'id'`. The generated annotation-free inference pipeline preserved `img_id` but omitted the separate sample `id` required by the metric. The regular validation pipeline already retained both fields.

The repair adds `id` to the inference packing metadata. Image transforms, predictions, evaluator settings, and training settings remain unchanged. The runtime fixture now exercises the exact tools/test.py subprocess used by the resume gate, in addition to its training loop, box-only loss check, and regular validation loop. Its zero-worker configuration is written to disk so subprocess validation uses the same runtime overrides. YOLOX training jobs run this fixture before downloading the full release.

The original epoch-2 checkpoint remains the resume source, including optimizer, scheduler, and EMA state. Full validation of that checkpoint must pass before epoch 3 begins. The previous CUDA indexing repair remains in place. Corpus, policy, evaluation pins, fairness hash, seed, and total 50-epoch budget remain frozen; other candidates' results have not been used to tune this repair.

## Runtime confirmation

Job `6a9c9300259f8e97255e4a0e` passed the runtime fixture, the release preflight, and all 143 batches of the full checkpoint validation loop. Epoch 3 reached batch 50/842 at 22:35:36 UTC on 2026-09-05 with finite losses. See `runtime-fixture-evidence.json`, `preflight-report.json`, and `resume-verification.json`. Training remains in progress; this is restart confirmation, not a completed-training result.
