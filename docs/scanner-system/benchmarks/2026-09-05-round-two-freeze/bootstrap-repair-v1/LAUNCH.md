# Replacement training jobs — 2026-09-05

These jobs use the verified NumPy bootstrap repair. The four original startup attempts are canceled and have no training results. Corpus, policy and fairness settings are unchanged.

| Candidate | Job |
|---|---|
| yolo11n-pose | [6a9c6665e686246ca69a4373](https://huggingface.co/jobs/ahzs645/6a9c6665e686246ca69a4373) |
| yolo11s-pose | [6a9c6670e686246ca69a4377](https://huggingface.co/jobs/ahzs645/6a9c6670e686246ca69a4377) |
| yolox-pose | [6a9c667be686246ca69a437a](https://huggingface.co/jobs/ahzs645/6a9c667be686246ca69a437a) |
| fastvit-t8-four-corner | [6a9c6687e686246ca69a437c](https://huggingface.co/jobs/ahzs645/6a9c6687e686246ca69a437c) |

Each job uses one L4 GPU, 50 epochs and seed 20260905, then automatically evaluates both pinned successor releases and recognition replay. Expect several hours after hardware assignment; each has a 12-hour limit. Completed training output uploads before evaluation. Current status is available on the job pages; submission is not a completed result. `launch-report.json` and `input-publication.json` preserve the input and job receipts.

