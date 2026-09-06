# YOLOX loss-repair follow-up — 2026-09-06

This is a new repair experiment declared after the original round-two benchmark exposed invalid YOLOX quads. The [paired fixture diagnostic](../2026-09-06-yolox-corner-learning/README.md) confirmed that the original OKS objective gives the distant third corner zero gradient, while normalized L1 learns the generated fixture. It does not establish generalization.

The [configuration](yolox-pose.json) and [freeze record](freeze.json) pin a fresh 50-epoch run from the original detector base checkpoint, seed 20260905, batch 16, input 640, the existing corpus and training-minimums-v3, and the existing real and synthetic successor evaluation releases. Optimizer state starts fresh. The coordinate objective is normalized L1 with weight 30; assignment still uses the original OKS calculator. The former experiment and its results remain historical evidence.

The PIL-to-MMDetection adapter now supplies BGR to match file loading. The integrated GPU fixture must pass mixed-precision training, validation, raw-array inference and exact file/array color parity before corpus training. Local validation: 234 geometry tests pass; Ruff is clean.

Execution is sequential: runtime fixture, corpus and cross-release leakage checks, training, checkpoint persistence, self-evaluation on **all 13,465 training records**, then the pinned real and synthetic benchmarks and recognition replay. Self-evaluation uses byte-verified records and images, the declared real margin policy and original synthetic margins, and the trainers' JPEG materialization. The fitting sanity gate requires at least one matched training instance. It is intentionally not a deployment-quality threshold. Failed self-evaluation stops held-out scoring and preserves its diagnostic report.

Experiment hash: `08c4024752c8b71b213f87ef1daa3fb3200470d9e681f951b7022e73670963d2`.

Fairness hash: `207664bfa5e9af2f6aea880e5795f182677d091eee683c59161dcfc42eeccdf0`.

No settings will be selected from this follow-up's held-out results. Passing execution checks will be reported separately from model accuracy. Any later export or device measurement remains separate from this training/self-evaluation/benchmark sequence.

## Launch and runtime evidence

[Job 6a9d91e8259f8e97255e75af](https://huggingface.co/jobs/ahzs645/6a9d91e8259f8e97255e75af) was submitted on one L4 with a 12-hour limit. The [published input receipt](input-publication.json), [exact job command](job-command.json) and [launch receipt](launch-report.json) preserve its execution lineage.

The [runtime fixture report](runtime-validation.json), captured from this job's `TCGER_RUNTIME_EVIDENCE` log, passes the integrated normalized-loss mixed-precision path, the separate `tools/test.py` validation process, raw-array inference and exact colored-image file/array preprocessing parity. Its box-only batch has corner loss exactly zero while retaining finite box/objectness losses. This one-step fixture is an execution check, not an accuracy result.

Full-corpus training, train-split self-evaluation, both geometry benchmarks and recognition replay completed. The [verification receipt](result-verification.json) pins the immutable result revision and report hashes.


## Final results

All 50 epochs finished. Self-evaluation covered all 13,465 training images and passed the declared fitting gate: 34,687 matches among 36,078 scorable truth instances (96.14% recall at IoU 0.5). This diagnostic used training pixels and is not a generalization score.

| Evaluation | Recall @ 0.5 | Recall @ 0.75 | Recall @ 0.9 | Extra | Duplicate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Real successor: 600 images / 700 cards | 60.14% | 58.29% | 53.86% | 7 | 0 |
| Synthetic successor: 1,000 images / 3,651 cards | 92.52% | 89.13% | 80.22% | 97 | 4 |

The original YOLOX run emitted no accepted quads. The repair now yields accurate geometry for many detections, but it misses 279 of the 700 real cards. Real binder recall is 0/27 cards across three images, and real duel recall is 6/33 (18.18%). Synthetic binder recall is 100%, illustrating a substantial synthetic-to-real performance gap on these slices. The binder real sample is small.

Recognition replay: 2 correct, 0 wrong, 44 unknown and 11 abstentions across 57 frames. YOLO11s remains ahead on broad real detection recall (95.86% at IoU 0.5, 77.71% at 0.75), while the repaired YOLOX emits far fewer extra detections (7 versus 288). Those operating-point differences do not establish a deployment winner. This repair was declared after the original results and has its own experiment and fairness hashes.

The [real benchmark](reports/real-v3.benchmark.json), [synthetic benchmark](reports/synthetic-duel-field.benchmark.json), [recognition replay](reports/recognition-replay.json), [trainer summary](reports/trainer-summary.json), and [train self-evaluation summary](reports/train-self-evaluation-summary.json) are committed here. The full train self-evaluation report, including all input identities, is pinned by its Hub path and SHA-256 in the summary. No export or deployment is implied by completion of these evaluations.
