# Completed training and recovered comparison

[Hugging Face job 6aa0fd7c900620b5c77e5729](https://huggingface.co/jobs/ahzs645/6aa0fd7c900620b5c77e5729) completed all 50 training epochs, both frozen benchmarks and recognition replay. Its final Hub status is **ERROR** because Markdown report generation raised `KeyError: 'duplicates'` after the new model had zero duplicates on the reviewed references. The training and evaluation outputs had already been uploaded. The report was repaired and regenerated locally from hash-verified saved outputs on September 9; no second GPU job or retraining was needed.

**Recommendation: retain the previous reviewed-data YOLO11s.** On the reviewed 561 cards, the candidate reduced misses from 12 to 7 but reduced tight outline matches (IoU >= 0.90) from 475 to 454. Across the complete real benchmark, tight matches fell from 74.4% to 71.3% and extras rose from 47 to 65. Synthetic tight matches also fell, and the small recognition replay had 0 correct results versus 4 previously. This experiment does not justify replacement. See [verified results and interpretation](RESULTS.md).

The run was submitted at 2026-09-09 06:32:28 UTC (September 8, 23:32 Pacific). The training/evaluation wrapper recorded 2.843 hours; this is not a billing receipt.

- One YOLO11s-pose candidate, one L4, 50 epochs, four-hour timeout.
- Expected runtime is roughly three hours after hardware becomes available, based on the previous run. Current [L4 pricing](https://huggingface.co/docs/hub/jobs-pricing) is $0.80/hour: about $2.40 for three hours, or $3.20 for four hours of billed hardware time.
- All 24 focused tests passed; the two-epoch local training/checkpoint check passed. The full release preflight and cross-release checks passed. All 39,149 training and 5,003 validation targets passed the orientation metadata audit.
- The job saves training artifacts before running both frozen benchmarks and recognition replay. It then performs the hash-verified comparison against the previous reviewed-data model and the 502 photos / 561 cards from the completed reference review. No additional labeling or production deployment is part of this run.

## Pins and outputs

Tooling commit: `73ae5e61d7f667fb7cdc8e28fc0a30cf24208425`, created in the isolated `tooling-worktree` beneath the run's artifact directory. The user's working checkout and index were not committed.

Private model input revision: `7380f20db2a2e49c0e4c9b2706a7110b061c4aa7`.

Experiment: `c9908767e8d0ecd8441e9cd6b0a4e218b12f213d9d7535a1a67e16431e0531a2`.

Checkpoint/output prefix in `ahzs645/tcger-universal-arcface`:

```text
geometry/yolo11s-pose/41c110e13eef6c898d31ed9ba7e56bdc449f3651ffb6ad7f103655eac60495cf/c9908767e8d0ecd8441e9cd6b0a4e218b12f213d9d7535a1a67e16431e0531a2
```

`comparison/RESULTS.md`, `comparison/comparison.json`, `comparison/reviewed-reference-comparison.json` and `comparison/verification.json` contain the recovered verified results. The checkpoint is under `training-output/training/repeat-0/weights/best.pt`, SHA-256 `7e66c9e6734c86fea217831217785fd78cad1eaaea7434f29546d20f123f112e`. Training/evaluation outputs were downloaded at immutable Hub revision `083b31ab3e52020d86ede3b166e2a70318f8c79f`. The report repair uses `Counter.update` to preserve zero-valued totals; a regression test and the full comparison both pass. The frozen training code and training inputs were not changed during recovery.

The repaired comparison, assessment and recovery source were published at [Hub commit `d96ae9a08b8efb15847f2ed5c301feb12c6c9e18`](https://huggingface.co/ahzs645/tcger-universal-arcface/commit/d96ae9a08b8efb15847f2ed5c301feb12c6c9e18). Every published file was downloaded at that immutable commit and its hash checked. `comparison-publication.json` records the receipt. The original job status remains Error because the remote post-processing failed; the recovered comparison is complete.

Follow-up local evaluation also checked the saved epoch-50 `last.pt`, SHA-256 `54af5ba715e3620cfd74cbb6e85f85aa1ad7162db9dad3a120a56cf91ea711df`. It improves reviewed tight outlines to 508/561, but has lower full-real recall and worse printed-top order. Four-way crop recognition recovers four correct identifications with two wrong ones. See [the checkpoint comparison and next steps](DIAGNOSIS.md). No GPU job was resubmitted; the selected epoch-20 results above remain unchanged.

The complete diagnosis, local final-checkpoint results, recognition controls and both galleries were saved under `diagnosis/` at [Hub commit `1e733ea829eb815a0f98229516fc1aec15ea0983`](https://huggingface.co/ahzs645/tcger-universal-arcface/commit/1e733ea829eb815a0f98229516fc1aec15ea0983). All 165 published files passed hash-verified readback. `diagnosis-publication.json` records the receipt; checkpoint weights remain at their original saved run paths.

Local run directory: `.artifacts/card-geometry/cyclic-yolo11s-20260909/`. `freeze.json`, `input-publication.json`, `job-spec.json`, `submit-intent.json` and `job-receipt.json` bind preparation to the submitted job. `prepare_run.py` reproduces freezing/publication; `submit_run.py` refuses to submit again when a receipt or matching experiment already exists.

Submission used the saved local credential after an actual private-repository upload verified write access. The connected MCP OAuth credential has Jobs/read-repository scopes but no repository-write scope, which caused the earlier run's initial publication failure. No credential values are stored in these artifacts; the job receives `HF_TOKEN` as an encrypted secret.
