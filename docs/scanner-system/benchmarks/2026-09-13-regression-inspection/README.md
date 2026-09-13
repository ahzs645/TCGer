# Seven regression photos: inspection and review guide

September 13, 2026. Assistant inspection is complete; the user's comparison is pending. No additional model was trained.

[Open the seven-photo comparison at F7](http://127.0.0.1:8773/follow-up/session-comparison/gallery/?photo=F7&filter=newmiss). Each photo has a short inspection note and a link to its two SAM prompt results. **Next / Previous stays within these seven photos.** Gold outlines are saved references, green is the September 8 baseline, and blue is the latest validation-selected YOLO11s.

## What the saved outputs show

| Photo | Baseline → candidate found | Main inspection finding |
|---|---|---|
| F6 | 4/4 → 3/4 | C2 has a displaced/shrunken candidate outline, IoU 0.482. This falls just below the 0.50 matching cutoff. |
| F7 | 4/5 → 1/5 | Only one candidate prediction survives in the saved output, at confidence 0.077. The five separated cards are seen at an oblique angle. |
| F20 | 3/3 → 0/3 | Five confident candidate predictions cluster inside the upside-down foreground card; the two saved background targets receive no overlapping candidate outline. |
| F21 | 1/1 → 0/1 | Two confident inner-card predictions replace the full upside-down outline; best IoU 0.169. The baseline's printed order also differs, despite finding the border. |
| F25 | 1/1 → 0/1 | The candidate extends upward into the desk background, IoU 0.482. Strong foreshortening and blur are visible. |
| F42 | 1/1 → 0/1 | Nested candidate outlines sit inside the foreground Trainer card; best IoU 0.390. Other cards lie beneath and behind it. |
| F71 | 1/1 → 0/1 | A narrower candidate outline falls just below the cutoff, IoU 0.498, despite confidence 0.979. |

These seven photos contain 16 saved targets. The baseline matches 15 and the candidate matches four. This deliberately selected regression subset is not an overall accuracy estimate. In particular, **“unmatched” does not always mean the model produced no prediction**. F6, F25 and F71 are border failures close to the matching cutoff. Lowering a confidence threshold would not correct the confident, inaccurate outlines in the other examples.

## What F7 establishes—and what it does not

The same SAM checkpoint, same image and fixed 0.50 threshold produce **zero masks for “trading card” and five matching masks for “playing card.”** This demonstrates sensitivity to the text prompt. It does not establish that YOLO's regression is caused by scene coverage, and it does not rule out model capacity as a factor.

The visible failures make perspective, printed orientation, border localization and overlapping-card scenes worthwhile diagnostic targets. F6 and F7 are desk layouts even though the saved scene metadata calls them `binder_page`; scene taxonomy also deserves checking before relying on scene-balanced scores. This observation has not changed dataset records or evaluation scores.

The immediate recommendation is to inspect these failure types before choosing the next training experiment. A larger model remains an untested hypothesis. The diagnostic overlap calculations reuse the saved predictions and existing polygon metric; they do not tune thresholds or rerun inference. Full source-image hashes and SAM/reference corner bindings were checked. [Machine-readable observations](OBSERVATIONS.json)

## How to review

1. Compare which saved cards each model finds, then check the outer border separately from printed orientation.
2. Use **Rectified previews** to select C1, C2, etc. C# is a saved target; P# is a model prediction and may refer to a different card in each panel.
3. Open **Compare both SAM prompts** to inspect masks and drafts. Visible fragments and background cards are not automatically false positives; SAM mask agreement is not the YOLO outline metric.
4. Send observations in chat using the reference, for example: “F7 / C2: the baseline cuts off the bottom border.” This gallery displays results; it does not save human review decisions.

Existing labels, frozen benchmark results and trained checkpoints remain unchanged. The assistant notes are a separate comparison-bound sidecar and are not human approvals.

To restart the current local review server from the repository root:

```sh
python3 -m http.server 8773 --bind 127.0.0.1 --directory .artifacts/card-geometry/regression-review-20260913
```

The local server root links `follow-up` to the existing orientation-validation report directory. Generated gallery files can be rebuilt with `tools/card-geometry/render_session_comparison.py`; it checks the inspection's comparison hash before adding notes.
