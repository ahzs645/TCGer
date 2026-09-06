# YOLOX loss-repair follow-up — 2026-09-06

This is a new repair experiment declared after the original round-two benchmark exposed invalid YOLOX quads. The [paired fixture diagnostic](../2026-09-06-yolox-corner-learning/README.md) confirmed that the original OKS objective gives the distant third corner zero gradient, while normalized L1 learns the generated fixture. It does not establish generalization.

The [configuration](yolox-pose.json) and [freeze record](freeze.json) pin a fresh 50-epoch run from the original detector base checkpoint, seed 20260905, batch 16, input 640, the existing corpus and training-minimums-v3, and the existing real and synthetic successor evaluation releases. Optimizer state starts fresh. The coordinate objective is normalized L1 with weight 30; assignment still uses the original OKS calculator. The former experiment and its results remain historical evidence.

The PIL-to-MMDetection adapter now supplies BGR to match file loading. The integrated GPU fixture must pass mixed-precision training, validation, raw-array inference and exact file/array color parity before corpus training. Local validation: 234 geometry tests pass; Ruff is clean.

Execution is sequential: runtime fixture, corpus and cross-release leakage checks, training, checkpoint persistence, self-evaluation on **all 13,465 training records**, then the pinned real and synthetic benchmarks and recognition replay. Self-evaluation uses byte-verified records and images, the declared real margin policy and original synthetic margins, and the trainers' JPEG materialization. The fitting sanity gate requires at least one matched training instance. It is intentionally not a deployment-quality threshold. Failed self-evaluation stops held-out scoring and preserves its diagnostic report.

Experiment hash: `08c4024752c8b71b213f87ef1daa3fb3200470d9e681f951b7022e73670963d2`.

Fairness hash: `207664bfa5e9af2f6aea880e5795f182677d091eee683c59161dcfc42eeccdf0`.

No settings will be selected from this follow-up's held-out results. Passing execution checks will be reported separately from model accuracy. Any later export or device measurement remains separate from this training/self-evaluation/benchmark sequence.
