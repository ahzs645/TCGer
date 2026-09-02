# Synthetic card-geometry smoke — 2026-09-02

This is the first deterministic synthetic release for the shared
card-geometry workstream. It is a `smoke` release for tooling and baseline
diagnostics, not a training authorization. Synthetic records remain excluded
from `test`; frozen real sessions remain the release gate.

## Frozen release

- dataset repo: `ahzs645/tcger-scanner-images`;
- immutable dataset revision:
  `b4ef746b06c725cbe196e709d518dc53eea0ad13`;
- release path: `geometry/releases/synthetic-geometry-smoke-v1`;
- corpus hash:
  `544ec80646b61e8b3c5343b93ce9580061d164ad03cd1e25ed28c08d2eec9393`;
- compositor Git revision:
  `e54dc1de80fe915ccbef71f0005839b17aa2699e`;
- compositor revision:
  `eeb289adf7acb1cb8f3b68bb3e8b491f0cd34167733cb6fb32cc12c21b77a4c9`;
- readiness policy: `synthetic-compositor-smoke-v1`, SHA-256
  `ee2e51b2d3a65f94f41a4e71083a7baba01c84124cf7869932575403a13e9158`.

The release contains 2,000 frames and 6,332 instances: 1,800 train records,
200 synthetic-validation records, 525 `single_handheld`, 225 `binder_page`,
625 `duel_field`, and 625 `steep_playmat`. All 25,328 corners are known and
metric-eligible synthetic corners. Of those, 1,832 are `outsideFrame`, 2,333
are `occluded`, and 21,163 are visible.

The local preflight passed every check. The pinned Hub fail-first smoke changed
one image byte and failed with exactly `IMAGE_HASH` in job
`6a98829921c5aa7c8364eabf`; the positive job
`6a9883150718b0f6d8912027` passed with `readyFor: tooling`. Its report is
pinned in the private model repo at commit
`75c50cd77d63ab3cf8a028698dcce11642126325`.

## Baseline execution

Apple Vision and Core ML ran locally because those frameworks are unavailable
in Linux Jobs. DETR and DRAW2 ran on an NVIDIA A10G in job
`6a98969221c5aa7c8364eca6`, using the digest-pinned container recorded in
[`gpu-inference-summary.json`](gpu-inference-summary.json). The final portable
prediction bundle is pinned in the private model repo at commit
`903a1e2a4bb11262ac41e0da6889166aa9834548`.

The phone-recorded `device` localizer is the seventh real-release baseline but
has no synthetic-frame evidence. It is intentionally reported unavailable,
not replaced with generated device quads. The six applicable localizers each
produced a complete 2,000-line predictions file and were scored by the same
model-independent benchmark.

## Detection results

| Localizer | Single R@0.5 | Single R@0.75 | Single mean IoU | Duel R@0.5 | Duel R@0.75 | Duel mean IoU | Duel duplicate | Duel extra | Duel miss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `vision-app` | 0.952 | 0.615 | 0.808 | 0.171 | 0.099 | 0.759 | 24 | 89 | 2,618 |
| Vision document | 0.829 | 0.560 | 0.822 | 0.030 | 0.008 | 0.676 | 0 | 531 | 3,063 |
| App YOLO11s box | 0.950 | 0.128 | 0.625 | 0.168 | 0.051 | 0.674 | 0 | 91 | 2,628 |
| Pokémon DETR | 0.815 | 0.107 | 0.618 | 0.278 | 0.073 | 0.660 | 8 | 459 | 2,278 |
| DRAW2 YGO OBB | 0.629 | 0.183 | 0.708 | 0.209 | 0.122 | 0.756 | 3 | 90 | 2,497 |
| Vision rectangles | 0.499 | 0.453 | 0.906 | 0.160 | 0.130 | 0.830 | 35 | 651 | 2,652 |

`vision-app` provides the strongest distribution sanity check: its synthetic
single-handheld R@0.5 is 0.952, essentially the same as its 0.951 real-smoke
baseline. The narrower expectation that Vision document alone would remain
near its real 1.000 recall did not hold; it reaches 0.829. The deliberately
hard distractors and transformations can make a non-card rectangle win the
single-document request. Therefore this release is suitable for tooling and
challenger diagnostics, but it does not prove that the synthetic distribution
matches real captures in every localizer.

The duel-field result is the important new number. No existing baseline is
adequate: DETR has the best R@0.5 at 0.278, DRAW2 has the best R@0.75 at 0.122,
and every localizer misses at least 2,278 of 3,157 duel-field instances. That
is direct evidence for a shared multi-card corner model rather than another
single-document fallback.

Corner-error and orientation fields remain in each deterministic report, but
they are not used for the table above. These legacy localizers emit geometric
top-left ordering, while synthetic truth is printed-card-relative and
`orientationKnown: true`; fixed-order corner tails therefore combine
localization error with the already-known orientation problem. A candidate
must predict or calibrate card-relative corner order before those fields can
justify removing 0/180 recognition.

## Artifacts

The `reports/` directory contains all six deterministic benchmark reports.
Portable DETR and DRAW2 predictions are retained in the private model repo,
not committed to Git. Source card renders remain private training assets.
