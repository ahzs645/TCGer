# Guarded checkpoint selection and rotation handling

The saved epoch-50 checkpoint recovers four correct identifications with the new rotation policy, while the cross-orientation family margin rejects the additional wrong match from the earlier four-way search. The previous reviewed-data checkpoint remains the development baseline because epoch 50 still loses real-capture detections. The user's reference-corner review is complete.

## Changes implemented

`recognition_orientation.py` implements `four-way-family-margin-v1`. It tries source-quad phases 0, 2, 1 and 3, preserving clockwise winding. Quarter-turn cases are rewarped from the original photo before the 720×1000 portrait crop; rotating an already stretched crop would preserve the distortion. Nonconvex, reversed and degenerate quads abstain. Repeated appearances of one recognition family do not compete with themselves: the winning family must beat the strongest different family across **all four** crops by the existing 0.05 margin. Per-game score thresholds, encoders, indexes and query normalization are unchanged. The frozen Pokémon index has 53 zero-vector rows that normalize to NaN; this policy explicitly excludes them, matching their previous placement at the end of score sorting. Invalid query embeddings fail the evaluation.

`evaluate_geometry_candidate.py` exposes the new policy as an explicit `--recognition-orientation-policy four-way-family-margin-v1` option. Its historical default remains reproducible. Version-2 recognition reports record all phase scores, the selected phase, acceptance reason, source verification and recognition-file hashes. `--checkpoint`, `--checkpoint-sha256` and `--evaluation-output` allow independent evaluation of any saved epoch without renaming it `best.pt` or overwriting another checkpoint's evaluation.

`select_geometry_checkpoint.py` compares pinned reports under identical detector and recognition contracts. A candidate must avoid regressions in matched cards, extras and duplicates in **each scene**, correct printed-order matches, and recognition correct/wrong counts by game and label type. Passing candidates are ranked by the mean tight-border recall across scenes; equal scores retain the incumbent. The best border candidate is also reported separately, with every failed guard. These conservative rules are a development selection policy, not a statistical significance claim or an automatic production promotion.

Future YOLO training writes a hash-bound `checkpoint-candidates.json` containing the saved epoch files, `best.pt`, `last.pt`, and validation coverage. Framework fitness therefore supplies a candidate, not a release recommendation. The trainer summary links this shortlist; the explicit-checkpoint evaluator and guarded selector provide the subsequent selection path. Training does not silently switch to test-based checkpoint selection. Existing export and production behavior are unchanged.

## Saved-model retest

All 57 recognition frames were rerun from source photos and frozen detector predictions for each of three saved models: **171 frame evaluations**. Exactly 11 frames have verified correct identities. Four others specify a forbidden identity only, and 42 have no verified identity. The table below includes only the 11 verified identities.

| Saved model | Historical two-way correct / wrong / abstain | Naive four-way | New family-margin four-way |
|---|---:|---:|---:|
| Previous reviewed-data model | 4 / 1 / 6 | 4 / 1 / 6 | **4 / 1 / 6** |
| Cyclic epoch 20 | 0 / 0 / 11 | 2 / 1 / 8 | **2 / 1 / 8** |
| Cyclic epoch 50 | 0 / 1 / 10 | 4 / 2 / 5 | **4 / 1 / 6** |

Epoch 50's rejected wrong match is `devmode-scan-session-20260827-223150-abb342bc426ce62a`: its cross-orientation margin is 0.03149, below 0.05. The new policy's remaining wrong match is `devmode-scan-session-20260829-200235-18315867b636a816`. This second case also fails with the previous detector and trusted human-label crops in the earlier diagnosis, so a corner-order fix alone does not resolve it. The wrong case changes relative to epoch 50's original two-way result; recovering four correct answers does not establish that every acceptance is safe.

Geometry weights and decoding were not changed, so the selector reuses the hash-verified 600-photo geometry outputs. It retains the previous checkpoint and separately names epoch 50 as best for borders:

| Geometry measurement | Previous | Epoch 20 | Epoch 50 |
|---|---:|---:|---:|
| Matches on 139 real-capture cards | **128** | 117 | 109 |
| Tight outlines on 561 reviewed references | 475 | 454 | **508** |
| Correct printed order among matched known-order cards | **126/128** | 73/117 | 48/109 |
| Mean scene tight recall on frozen real benchmark | 0.467586 | 0.436034 | **0.509372** |

The reviewed-reference row uses the user's completed corner sidecar. The selector's scene metrics use the original frozen benchmark labels. These are distinct measures; the 502 reviewed archive photos must not swamp the 98 human-capture photos. The four-way recognition policy corrects crop orientation, not the detector's raw corner identities.

## Validation gap and next training prerequisite

The current training release has **1,279 real validation photos, zero with known printed-top orientation**. All are archive scenes: 1,258 single-card, 13 scatter, five other multi-card and three grid. The new coverage audit reports the missing orientation and sideways examples explicitly. Nonzero coverage is only a minimum check, not a sufficient sample-size guarantee.

Before another training job, define a group-disjoint validation set from the training pool with known printed-top cards, sideways views and representative phone scenes. Preserve physical-card, source-asset and duplicate-image groups. Do not move these 600 repeatedly inspected test photos into validation and describe them as a fresh holdout. No additional user review, paid training job, encoder change or production deployment was performed for this follow-up.

## Verification and artifacts

33 focused tests pass, covering rotation pixels and winding, cross-family ambiguity, invalid vectors, checkpoint selection regressions, coverage auditing, explicit checkpoint loading, and existing loss/materialization/replay behavior. The new replay's 0/180 branch reproduces all **171 historical acceptance decisions and families**, with maximum score difference 0.000001073. Six fresh CPU detector checks (two photos for each checkpoint) preserve detection counts and achieve a minimum paired IoU of 0.999184 against frozen outputs.

Artifacts are under `.artifacts/card-geometry/selection-rotation-20260909/`: `candidates.json`, `selection.json`, `validation-coverage.json`, the three `*-recognition.json` reports, `verification.json`, reproducible retest/verification scripts, and `gallery/`. All checkpoint, prediction, benchmark, recognition and source-image bindings were verified. The new read-only page is served at [rotation and selection results](http://127.0.0.1:8771/policy/); the earlier `/final/` gallery remains intact.

Run the selector using the local artifact paths recorded in `candidates.json`:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/select_geometry_checkpoint.py \
  --config .artifacts/card-geometry/selection-rotation-20260909/candidates.json \
  --output /tmp/tcger-selection-recheck.json
```

The recognition policy was developed using these saved cases. Fresh identity-labeled capture sessions and device latency measurements are still needed before adopting four-way search in production. It performs four encoder queries per detected crop instead of two; the current evidence does not measure mobile latency or generalization.
