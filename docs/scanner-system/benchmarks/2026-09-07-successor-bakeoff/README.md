# Successor bake-off launch — 2026-09-07

Four measurement jobs on the category-repaired successor corpus. This record freezes the inputs and preserves the submission receipts; it does not report results, and submission does not establish successful training or completed evaluation. Inspect the job pages for status.

## What this run measures

Round two trained on 749 train and 235 validation non-card targets imported as cards and lost real corner supervision to the strict polygon fit. The successor corpus removes those targets, recovers 1,252 real corner instances with `polygon-quad-fit-v2`, slices real multi-card frames by layout and binds `training-minimums-v4`. Fairness is otherwise unchanged from round two: input 640, 50 epochs, seed 20260905, real context margin `ceil(0.15 * max(width, height))`, no runtime augmentation, one repeat, one L4 each, 12-hour limit.

Two declared carry-overs differ from the original round-two configs:

- **YOLOX** uses the completed loss-repair objective (normalized L1 corner loss, weight 30, OKS assigner retained) with fresh detector-base initialization and all-train self-evaluation before held-out scoring. Its fairness hash therefore differs from the other three, exactly as in the loss-repair experiment.
- **Evaluation contract version 2** for every candidate: the shared evaluator hands Ultralytics BGR arrays. Only YOLO11 inference pixels change; version-1 round-two reports remain as published.

Real binder and tabletop supervision is still boxes only in this corpus, so binder-page tight geometry is not expected to move; that is the human-label follow-up in the [successor record](../2026-09-06-successor-corpus-prep/README.md), not this run.

## Pinned inputs

| Input | Identity |
|---|---|
| Training corpus | `card-geometry-training-successor-candidate-v1`, corpus hash `74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf`, dataset `ahzs645/tcger-scanner-images` revision `46049ce804ae235517d73ab7481850fc929ae487` (`dataset-publication.json`, 31,503 files, manifest hash verified after upload) |
| Policy | `training-minimums-v4`, SHA-256 `d1f38ac331ef3eef1e632f6f3874cd1f33967c073ca33dbbec26c8547a9080f6` |
| Preflight pin | `preflight-report.json`, SHA-256 `1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c`, all 20 checks pass, `readyFor: training`; the job recomputes it and compares corpus hash and policy binding |
| Real evaluation | `real-geometry-evaluation-v6-full-aliases-v2`, hash `631cc7f9…`, dataset revision `3e03b753…` |
| Synthetic evaluation | `synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2`, hash `fb3eca1a…`, same revision |
| Tooling | git `63fcb55fc506c1081acb926eeb1d9a7346f06f28`, tarball SHA-256 `03eaaad26a86604d079e28d9ae722a12bcd377d6fd3997fe519cbf3e7b2b28fb` |
| Input publication | model repo `ahzs645/tcger-universal-arcface` commit `10904992be84e6a3b8bbcee419cf5a04c1974477` (`input-publication.json`) |
| Recognition encoders | revision `3e51bbba…`, hashes inside each config |

Experiment hashes (`freeze.json`): fastvit-t8-four-corner `89592151…`, yolo11n-pose `02a49b70…`, yolo11s-pose `3ed309ce…`, yolox-pose `540e83de…`. Shared fairness hash `d4a63a8d…` for the three unrepaired candidates; yolox-pose `22ce98f2…`.

## Submission

Jobs were submitted with the Hugging Face CLI (`submit-jobs.sh`, generated from `job-commands.json`, SHA-256 `7a8da32d…`), each `hf jobs run --detach --flavor l4x1 --timeout 12h --secrets HF_TOKEN`. The bootstrap reasserts NumPy 1.26.4 after framework installs, verifies the tooling, config and preflight hashes before extraction, runs the YOLOX runtime fixture, and then the pinned training, self-evaluation (YOLOX), benchmarks and recognition replay.

| Candidate | Job |
|---|---|
| fastvit-t8-four-corner | [6a9e7f7d259f8e97255ea2ed](https://huggingface.co/jobs/ahzs645/6a9e7f7d259f8e97255ea2ed) |
| yolo11n-pose | [6a9e7f7de686246ca69a797f](https://huggingface.co/jobs/ahzs645/6a9e7f7de686246ca69a797f) |
| yolo11s-pose | [6a9e7f7e259f8e97255ea2ef](https://huggingface.co/jobs/ahzs645/6a9e7f7e259f8e97255ea2ef) |
| yolox-pose | [6a9e7f7f259f8e97255ea2f1](https://huggingface.co/jobs/ahzs645/6a9e7f7f259f8e97255ea2f1) |

At submission all four were scheduling (one pulling its container, three waiting for hardware). YOLO11 candidates remain evaluation-only under the declared license route; no asset-store publication was requested.

## Reproduce the freeze

`prepare-successor-inputs.py` rebuilds the configs, preflight pin, tooling tarball and `freeze.json` from the local release and `dataset-publication.json` at a clean tooling commit; `publish-successor-inputs.py` publishes them to the private model repo and writes `input-publication.json`, `job-commands.json` and `submit-jobs.sh`. Both scripts are copied here verbatim from their `.artifacts/card-geometry/` working locations.
