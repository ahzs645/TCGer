# Incumbents on the v6-full successor — 2026-09-04

All seven incumbent exports were rerun after trainer repair and self-validation, before assembling the round-two corpus. Every export contains exactly the 600 release record IDs; normal release preflight passed and the shared benchmark scored 700 truth instances. Prediction files, reports, preflight and artifact pins are stored beside this document.

Release: `real-geometry-evaluation-v6-full-aliases-v2`, corpus hash `631cc7f9ac24b19d5e7587f5c5aefa401f911cfcf4ed52ab6858ea29d3740dd7`. Predecessor: `real-geometry-evaluation-v6-full`, corpus hash `7a75cc5ba2f0ac429136fa67f75b473e09c05f6edaee112bf0f5b1ba701a188a`. Each report carries both hashes. The [migration evidence](../2026-09-04-evaluation-v2/) verifies unchanged record/image bytes, splits and scene slices.

| Incumbent | Recall @ .5 | Recall @ .75 | Extra detections | Binder recall @ .5 | Duel recall @ .5 |
|---|---:|---:|---:|---:|---:|
| app-detector-box | 83.6% | 77.6% | 13 | 11.1% | 48.5% |
| detr-pokemon | 92.9% | 79.6% | 126 | 100.0% | 75.8% |
| device | 12.0% | 7.0% | 13 | 11.1% | 48.5% |
| draw2-ygo-obb | 71.9% | 55.1% | 92 | 77.8% | 69.7% |
| vision-app | 83.4% | 76.3% | 19 | 11.1% | 48.5% |
| vision-doc | 80.0% | 72.4% | 40 | 0.0% | 42.4% |
| vision-rect | 74.3% | 71.4% | 380 | 44.4% | 54.5% |

Overall scores are dominated by the 502-image archive slice (561 cards). Binder coverage is only three images / 27 cards; duel coverage is 18 images / 33 cards. Per-scene metrics in the reports are needed to interpret these totals.

`device` replays archived Dev Mode predictions; the 502 archive images have no device output, so its overall recall is a coverage-weighted result, not a fresh device inference score. `app-detector-box` is the single-box adapter. The archived device path and Vision app adapter do not represent the complete current multi-card binder pipeline; Vision rectangle requests cap observations at five, and the document request yields one observation. No ranking here removes those adapter limits.

No model was retrained for these incumbent exports. DETR and DRAW2 checkpoint revisions and every emitted artifact hash are recorded in `input-pins.json`. Core ML used a copied compiled detector with tree hash `8d65db21283201aa233a144c97de4a3eaa07e3991b85b0ae90ab797c86d55946`; its combined artifact identity matches the prior binder-v4 benchmark.

The next stage is corpus assembly and leakage review, followed by a frozen corpus, context policy, experiment config and training-minimums-v3 before any round-two candidate result.
