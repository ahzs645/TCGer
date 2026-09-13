# SAM 3.1 card-segmentation pilot — September 11, 2026

**Completed and verified.** Both fixed text prompts together produced matching masks for 47 of 51 saved card outlines on 12 selected photos. This is promising as a labeling aid, but it is not a scanner replacement or a representative accuracy result.

[Open the mask and corner-proposal gallery](http://127.0.0.1:8773/follow-up/sam31-pilot/?photo=P06) · [Open coverage library](http://127.0.0.1:8775/?sourceKind=real&quality=reviewed)

## Findings

- `trading card`: 42/51 matches, 82 masks, 43 contour-derived quadrilateral proposals.
- `playing card`: 11/51 matches, 14 masks, 12 quadrilateral proposals. It recovered all five cards in F7, where `trading card` returned no masks.
- Both prompt outputs pooled: 47/51 matches, 96 candidate masks. The other 49 masks are unmatched or duplicated; some correspond to genuine background cards absent from the saved references. No per-photo oracle prompt choice was used, and this pool has not been deduplicated.
- Both prompts missed the four sideways cards inside labeled plastic bags (P08).
- On F42, the main card mask closely follows the saved outline, and several background/partially covered cards are also segmented. A visible mask does not recover a covered card’s full corners.
- Dense P11 and P12 examples matched all 13 and all 15 references with `trading card`.
- Peak allocated GPU memory was approximately 5.64 GB on one L4. This is not a mobile runtime measurement.

## Per-photo reference agreement

| Pilot / reference | Selection | Saved outlines | “trading card” matches | “playing card” matches |
|---|---|---:|---:|---:|
| P01 / F6 | recent-regression | 4 | 4 | 4 |
| P02 / F7 | recent-regression | 5 | 0 | 5 |
| P03 / F20 | recent-regression | 3 | 3 | 0 |
| P04 / F21 | recent-regression | 1 | 1 | 0 |
| P05 / F25 | recent-regression | 1 | 1 | 0 |
| P06 / F42 | recent-regression | 1 | 1 | 0 |
| P07 / F71 | recent-regression | 1 | 1 | 0 |
| P08 / F4 | sideways | 4 | 0 | 0 |
| P09 / F19 | upside-down | 2 | 2 | 2 |
| P10 / F33 | skew | 1 | 1 | 0 |
| P11 / F101 | overlap | 13 | 13 | 0 |
| P12 / F8 | edge | 15 | 15 | 0 |

## Evaluation limits and next use

The 12 photos include seven prior session regressions and five reviewed-library examples selected for rotation, skew, overlap and image-edge placement. It is a mixed-split exploratory pilot. Resizing preserves aspect ratio and caps the longest side at 1600 pixels. Each prompt uses the fixed 0.50 confidence threshold.

Each predicted visible mask is compared with a rasterized saved full-outline polygon, using one-to-one assignment at IoU ≥0.50. This is not the same metric as YOLO quad detection/border accuracy, and full outlines are not visible-mask ground truth for occluded cards. The 47/51 figure must not be compared directly with the YOLO session recall scores.

A useful next integration is a separate proposal layer in the labeling studio: run both prompts, deduplicate overlapping predictions, distinguish complete cards from visible fragments, then let the reviewer accept or edit four corners and printed top. Existing reviewed corners should win over proposals. None of that acceptance or replacement happened in this pilot.

Keep the current reviewed YOLO11s development baseline; this does not imply that the experimental detector has been deployed to the apps. For further supervised training, YOLO11m-pose is the most direct larger-capacity experiment; YOLO26s-pose is a separate architecture experiment requiring adaptation of the custom corner loss. SAM 3.1 is being evaluated here as a preprocessing assistant, with no fine-tuning.

## Reproducibility

- Successful job: [6aa43a4421047bf1b03778cc](https://huggingface.co/jobs/ahzs645/6aa43a4421047bf1b03778cc).
- Results SHA-256: `3dec054ae124eab9bd9a78a3d8e8f11161a5b7f7e6fc4f679f78c3fab3b3e0ad`.
- Verified downloaded files: 121 (masks, overlays and results).
- SAM 3.1 model revision: `daa63191845a41281374e725f4c9e51c7a824460`.
- SAM source commit: `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7`.
- Pilot script SHA-256: `a933e6be1436729880960715e4ab0621fd40d78b4e149c82d8f890f874330416`.
- All detector weights loaded strictly into the official SAM 3.1 TriHead construction; the ordinary SAM 3 image builder was rejected because its architecture differs.
- Private input/output repository and all pinned receipts are under `.artifacts/card-geometry/sam31-trial/`; compact verified scores are in `RESULTS.json` next to this report.
- Three failed setup attempts are retained: CLI argument parsing, the container Python package policy, and the intentionally strict rejection of an incompatible model construction. The successful run performed inference only. No human labels, frozen splits or production weights changed.

Official model documentation: [SAM 3.1](https://huggingface.co/facebook/sam3.1), [SAM 3.1 release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md).
