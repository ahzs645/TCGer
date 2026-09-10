# Completed session comparison — September 10, 2026

**Retain the existing reviewed-data YOLO11s baseline.** The cyclic epoch-50 candidate found fewer reviewed cards and produced fewer tight outlines on this completed session. This supports the existing decision to retain the baseline; no model was trained, promoted, or tuned using these results.

All 75 photos and 106 reviewed card instances were evaluated with both pinned checkpoints. All 75 overlays were inspected at contact-sheet scale, with detailed gallery checks on F3, F34 and F73. The original labels and images were preserved.

## Results

| Measurement | Baseline | Cyclic epoch 50 |
|---|---:|---:|
| Found cards, polygon IoU ≥ 0.50 | **96/106 (90.6%)** | 86/106 (81.1%) |
| Outlines with IoU ≥ 0.75 | **85/106** | 60/106 |
| Tight outlines, IoU ≥ 0.90 | **40/106 (37.7%)** | 26/106 (24.5%) |
| Missed reviewed cards | **10** | 20 |
| Unmatched predictions | **19** | 37 |
| Correct printed corner order among matched cards | **89/96 (92.7%)** | 52/86 (60.5%) |

IoU measures agreement between the predicted polygon and the saved reference polygon. A detection match does not guarantee an acceptable rectified crop. The shared scorer uses deterministic one-to-one greedy matching. Both models had zero separately counted duplicate predictions. **Unmatched predictions are not all confirmed false positives:** some identify real, partially visible background cards outside the annotated target set.

For the same 80 targets found by both models, median polygon IoU was 0.900 versus 0.857. Median mean corner distance, divided by the reference card's mean side length, was **5.23% versus 8.79% after allowing cyclic corner alignment**. Keeping each model's own printed corner order increased this to **5.53% versus 23.85%**. Alignment uses the reference answers for diagnosis; it is not a deployed orientation solution. All decoded quads had positive winding: these results show bad geometry and starting-corner errors, rather than reflected vertex winding.

Epoch 50 recovered six baseline misses but introduced 16 new misses. It gained one tight outline and lost 15. On the 12 multi-card photos (43 targets), it found 40 cards versus the baseline's 37, but tight outlines fell from 23 to 19. On the 63 single-card photos, found cards fell from 59 to 46 and tight outlines from 17 to seven.

The 11 upside-down targets showed a detection gain, seven to 11, but tight outlines fell from two to one and raw orientation remained unreliable. There are **zero targets in the defined sideways slice (45–135°)**, so this batch cannot establish 90-degree performance. The 44 cards with at least one occluded/outside corner also favored the baseline: 40 versus 30 matches and nine versus three tight outlines.

## What the images show

The epoch-50 candidate often places diamond-shaped outlines through the artwork. Changing crop rotation cannot repair that geometry. The baseline still has broad outlines that sometimes include the stack beneath the target; it is the stronger existing option, with substantial room to improve.

Examples in the read-only [comparison gallery](http://127.0.0.1:8773/):

- [F3](http://127.0.0.1:8773/?photo=F3): epoch 50 recovers an overlapping card, but has fewer tight outlines.
- [F34](http://127.0.0.1:8773/?photo=F34): both models include underlying cards despite passing the detection threshold.
- [F53](http://127.0.0.1:8773/?photo=F53): the sole tight-outline gain (IoU 0.868 → 0.912) still has a quarter-turn starting-corner error.
- [F69](http://127.0.0.1:8773/?photo=F69) and [F74](http://127.0.0.1:8773/?photo=F74): epoch 50 predicts inner artwork/diamond regions and misses the reviewed card.
- [F63](http://127.0.0.1:8773/?photo=F63) and [F75](http://127.0.0.1:8773/?photo=F75): unmatched predictions can correspond to real background cards.

September 10 correction: full-resolution inspection of **F11, F28, F60 and F73** did not support the initial claim of confirmed outline errors. The questioned corners extend outside the captured photos; retain these amodal estimates. The gallery’s **Completed reference checks** filter shows the adjudications. This was an assistant visual check, not independent human relabeling. `reference-adjudication.json` supersedes the initial visual QC flags while preserving `visual-inspection.json` as history. Labels and scores are unchanged; the four earlier visibility-only corrections remain separate.

## Frozen inputs and reproducibility

Completion snapshot and visibility derivation: [session record](2026-09-09-231206.md). The two checkpoint choices, decoder settings, hashes and scoring rules were recorded before inference in `protocol.json`.

| Input | SHA-256 |
|---|---|
| Original reviewed-label backup | `7a586bf33768e8195a5ff008134e2e2f167f0978b6b2e1bcb28baa126d39586b` |
| Derived evaluation geometry | `76bfcd87fdef10736ccf61904e5b53e4991195db32c5f0c9de3b72e8ecda9357` |
| Reviewed-data baseline checkpoint (`previous`) | `0f5bc3e2509c98837b4c57745af55b75f5acac5739a76d68122c46f0b9995327` |
| Cyclic epoch-50 checkpoint (`cyclic-epoch50`) | `54af5ba715e3620cfd74cbb6e85f85aa1ad7162db9dad3a120a56cf91ea711df` |
| Completed comparison | `7826d2eec4d9e6ef4fad1d4ae757cf422711611544b635d698a8a3eae948b07c` |

Runtime: Torch 2.6.0, Ultralytics 8.4.138, CPU with four threads, 640px input, evaluation contract v2/BGR, and the existing shared predictor/decoder. Both models use 192px black context margins on all sides; raw predictor confidence 0.01, NMS IoU 0.99 and max 100 detections; shared decoder confidence 0.05, minimum quad area 0.001, exterior margin 0.25, polygon NMS 0.5, and aspect range 0.5–3.0. No setting was optimized on this session. Recorded CPU timings are diagnostic, not a controlled device-latency benchmark.

The 75 source-image hashes are unique, with zero exact matches against the 15,744-record reviewed training release or the earlier 600-photo evaluation release. This does not prove independence of physical cards or near-duplicate captures. The batch is one session with repeated views, and its references are reviewer-approved starting outlines rather than a blind second annotation. Recognition identities are not independently verified; recognition accuracy was not measured.

Full local outputs are under:

```text
.artifacts/card-geometry/new-session-20260909-231206/model-comparison-20260910-v2/
  protocol.json, session-inputs.json, source/
  baseline.predictions.jsonl, baseline.metrics.json
  candidate.predictions.jsonl, candidate.metrics.json
  comparison.json, verification.json, visual-inspection.json
  inspection-sheets/, gallery/
```

A compact [machine-readable summary](2026-09-09-231206-model-comparison.json) accompanies this report. All 102 result, source-snapshot and gallery files were also archived under the canonical Reference labeling backup directory:

```text
Reference/TCGer-Labeling/fiftyone-sessions/backups/
  scan-session-20260909-231206-model-comparison-20260910-v2/
    model-comparison.tar.gz
    backup-verification.json
```

Every archived file was read back and hash-verified. Archive SHA-256: `73e2ea5d953e2131c46dd2815e52a08c96e207fbf3c9662b860803ba131d54b9`. This verifies the local copy in the Google Drive folder, not completion of the provider's remote sync.

The verification receipt confirms both 75-row prediction exports passed the shared schema, source inputs were reverified, and live labels were not written. Two focused adapter/scorer tests passed. Browser checks verified all 75 frame score rows, filters, card links, refresh, and narrow layout without page errors. The final reference filter contains exactly the four adjudicated photos. An initial attempt stopped on a schema-invalid slash in an exported record ID; the adapter now uses schema-safe IDs while preserving original studio keys. Both models were rerun into the separate `-v2` directory before any comparison scores were produced; no model or threshold was changed.

To reproduce into a new, nonexistent output directory:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/evaluate_reviewed_session.py \
  --receipt .artifacts/card-geometry/new-session-20260909-231206/completion-20260910T153119Z/verification.json \
  --candidates .artifacts/card-geometry/selection-rotation-20260909/candidates.json \
  --exclude-release .artifacts/card-geometry/releases/card-geometry-training-reviewed-corners-v1 \
  --exclude-release .artifacts/card-geometry/releases/real-geometry-evaluation-v6-full-aliases-v2 \
  --output /tmp/tcger-session-comparison-reproduction
```

To reopen the saved gallery:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python -m http.server 8773 \
  --bind 127.0.0.1 \
  --directory .artifacts/card-geometry/new-session-20260909-231206/model-comparison-20260910-v2/gallery
```

## Next work

Keep the current baseline and the session's frozen scores. Address diamond-shaped geometry and raw corner ordering using separate development data with known printed-top orientation and documented grouping by session, source image and physical card. Include real sideways photos; this session does not fill that gap. Any independent adjudication of the four reference flags should be versioned and reported alongside these original scores. There is no need to repeat the entire 75-photo review.

More images help when they add those missing conditions and have reliable labels and split assignments. Repeated views of the same cards do not supply equivalent independent evidence. A recognition comparison additionally needs verified identities. No new GPU job, photo upload or production model replacement was part of this comparison.
