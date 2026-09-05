# Initial startup attempts — canceled

These four startup attempts were canceled before optimization after dependency installation upgraded NumPy to 2.4.6. See [the bootstrap repair](bootstrap-repair-v1/) for the replacement launch. The original input and submission receipts below remain unchanged for audit.

The four jobs below were submitted after the corpus and experiment freeze was pushed in commit `d63b4de8`. Each uses one L4 GPU, 50 epochs, seed 20260905, and a 12-hour limit. Expect several hours of execution once hardware is assigned; queue time is separate. Initial inspection showed all four scheduling, with YOLO11s pulling its container and the others waiting for hardware.

| Candidate | Job |
|---|---|
| yolo11n-pose | [6a9c64e5e686246ca69a4359](https://huggingface.co/jobs/ahzs645/6a9c64e5e686246ca69a4359) |
| yolo11s-pose | [6a9c64f9259f8e97255e408d](https://huggingface.co/jobs/ahzs645/6a9c64f9259f8e97255e408d) |
| yolox-pose | [6a9c6504259f8e97255e408f](https://huggingface.co/jobs/ahzs645/6a9c6504259f8e97255e408f) |
| fastvit-t8-four-corner | [6a9c650e259f8e97255e4091](https://huggingface.co/jobs/ahzs645/6a9c650e259f8e97255e4091) |

Training downloads the immutable dataset revision `cabee73ac46a5901cc3060cfd17b7c63408bf66a` and reruns preflight plus cross-release leakage checks before optimization. The input bundle is pinned at model-repository revision `d4a03700da4f4732208e2bf1265891747cf31596`. All four share fairness hash `64b2abc574cac41395b21945ce56f69bbd8c5173c7a2483529d1e72a65d041a5`.

Each job uploads completed training output, then runs the pinned geometry evaluations and recognition replay automatically. Submission does not establish successful training or completed evaluation. Inspect the job pages for current status and `launch-report.json` / `input-publication.json` for immutable input receipts. YOLO11 remains evaluation-only; no asset-store publication was requested or performed.

