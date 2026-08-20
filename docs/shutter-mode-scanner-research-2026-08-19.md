# Shutter-mode scanner research — August 19, 2026

## Decision

Keep TCGer's shutter pipeline as the production baseline. The best next
experiment is a **learned four-corner fallback**, invoked only when the current
detector/refiner cannot produce a plausible quad. Do not replace the current
embedding model, add an unconditional local-feature reranker, or lower the
acceptance threshold from the evidence available today.

This review is deliberately about one high-resolution photo after the user
presses the shutter. Temporal voting, frame scheduling, and best-frame logic
belong to the separate live/binder-video benchmark.

## What TCGer already does in shutter mode

The camera asks AVFoundation for its largest supported photo dimensions and
passes the captured image through the `.photoCapture` path. A still capture can
evaluate three geometry hypotheses:

1. the refined four-corner crop;
2. the detector's plain box crop; and
3. the normalized whole/guide crop.

The still path also tests upright and 180-degree orientations and can use title
and collector-footer OCR as constrained rescue evidence. A user can correct an
uncertain result with an editable four-corner crop and run recognition again.

The small fixture suite now calls `.photoCapture` explicitly, so it will no
longer silently benchmark the imported-photo label when its purpose is shutter
regression testing. All four selected tests passed on the iPhone 17 Pro
Simulator (iOS 26.5): manifest coverage, clean-card top-1, distorted-card
recognition, and no-match negatives.

## Open-source implementations reviewed

| Project | Relevant implementation | TCGer decision |
| --- | --- | --- |
| HanClinto/CollectorVision | MobileViT-XXS + SimCC predicts four corners at 384×384; the original frame is perspective-warped and a second MobileViT/ArcFace model retrieves catalog candidates | Benchmark as a corner fallback. Do not copy into production without an AGPL or separate commercial-license decision. |
| Nekoraru22/riftbound-scanner | YOLO11 pose keypoints, crop from the original full-resolution frame, manual four-corner correction, orientation variants, Laplacian sharpness, and aligned artwork/color descriptors | TCGer already has the full-resolution crop, manual correction, upright/180 tests, and quality diagnostics. Its pose-corner pattern is worth reproducing independently; its color grid is not worth promoting without new evidence. |
| ULiege-VIULab/tcg-ar | Oriented R-CNN localization, a separate orientation classifier, ArcFace identity embeddings, synthetic training, and open-set/deck-restricted evaluation | Preserve its evaluation pattern: report open-set rejection separately and never treat a deck-restricted score as full-catalog accuracy. No production model swap yet. |
| ShreyShingala/Pokemon-Card-Scanning-Webapp | YOLO box, EasyOCR title/number, CLIP+FAISS top five, then OCR-based shortlist selection | TCGer already implements the safer form. Do not adopt its loose any-word search through up to 1,000 candidates; OCR noise could force a wrong identity. |
| tranhd95/tcg-scanner and elheck/cards_scanner | Classical contours, polygon approximation, perspective correction, then fixed card regions or perceptual hashes | Keep only as cheap fallback/stress baselines. TCGer's learned detector plus refinement already has much stronger real-scene coverage. |
| ityou-tech/lorscana | Binder tiling and CLIP retrieval with a set-restricted candidate pool | Useful only when the user explicitly supplies a deck/set constraint. Report that restricted result separately from the full database. |

## Experiment A — learned corner challenger

CollectorVision's bundled Cornelius 2.12 ONNX model was run unchanged on 25
deterministic shutter-style scenes generated from TCGer's five real demo card
identities. Each identity was tested centered with glare, under deep
perspective, small and blurred, partly outside the frame, and rotated. Ten
no-card scenes covered blank, noise, booster-like rectangle, hand-like shape,
and text-only backgrounds.

| Metric | Result |
| --- | ---: |
| Card scenes | 25 |
| Localized | 23/25 |
| Median polygon IoU | 0.967 |
| IoU at least 0.90 | 17/25 |
| Median corner RMSE among localized cases | 11.6 px on 1200×1600 scenes |
| Median detector latency | 20.2 ms on this Mac CPU |
| Top-1 against the five-card fixture catalog | 22/25 |
| False card-present on no-card scenes | 0/10 |

The two localization misses were the same Rayquaza reference under deep skew
and when partly outside the frame. The one additional identity error was an
edge-cropped Boss's Orders. This is encouraging enough for a fallback
challenger, but not a replacement decision: the set is small and synthetic,
latency is not measured on iPhone, and the model was not compared head-to-head
on identical real shutter captures.

For context, TCGer's frozen 2,336-image real-scene replay localized 2,334 images
with mean IoU 0.928. Those figures are not directly comparable to the controlled
challenger scenes, but they show why a wholesale detector replacement is not
the priority.

## Experiment B — recognition ideas against the database

The existing shutter challenger used 23 labeled, in-index physical-card crops,
an identity-disjoint 12/11 calibration/holdout split, and 19,501 available
physical references from the current 19,507-row target set.

| Challenger | Holdout result | Decision |
| --- | --- | --- |
| Full-card DINOv2 letterbox | top-1 7/11; top-5 9/11 | Do not replace production retrieval |
| Full-card DINOv2 center crop | top-1 8/11; top-5 10/11 | Do not replace production retrieval |
| 0.25 center/letterbox fusion | top-1 9/11 | Interesting, but it was not the calibration-selected policy; do not promote from holdout hindsight |
| ORB shortlist reranker | 8/11 correct; 0 corrections, 0 regressions | Do not add; no measured benefit |
| AKAZE shortlist reranker | 8/11 correct; 0 corrections, 0 regressions | Do not add; no measured benefit |
| SIFT shortlist reranker | 8/11 correct; 0 corrections, 0 regressions | Do not add; no measured benefit |

Median sequential top-five reranking cost was approximately 602 ms for ORB,
741 ms for AKAZE, and 1,067 ms for SIFT on the evaluation machine. The measured
result therefore rejects an unconditional local-feature stage.

An older pseudo-labeled binder experiment found that grayscale NCC could
recover 13/14 wrong top-1 cases when the truth already existed in the pooled
top five. That remains a useful hypothesis, not a production result: it used
different crops, CDN reference art, simulator OCR, and pseudo-labels. Re-test
it on real shutter captures with bundled reference thumbnails, a frozen gate,
and no-match negatives before integration.

## Production-shaped next test

1. Freeze 100–200 real iPhone shutter captures by capture session, including
   glare, sleeves, partial card, card back, no-card, and out-of-index cards.
2. Save the original full-resolution photo, detector box, refined quad,
   rectified preview, top ten candidates, title/footer OCR, quality metrics,
   latency, and final user-corrected identity.
3. Run the current detector/refiner and an independently implemented pose-quad
   challenger on the same photos. Compare detection recall, polygon IoU,
   corner error, downstream top-1/top-5, and abstention—not geometry alone.
4. Invoke the challenger only when the baseline has no plausible quad or when
   the two methods disagree materially. Never make a second model an automatic
   acceptance signal merely because it returned corners.
5. Re-test NCC or another independent visual verifier only inside the existing
   top five. Let it change identity only after calibration establishes both a
   verifier floor and a top-two margin; disagreement should otherwise send the
   item to Review.

The result screen should continue to show the predicted card name and printing,
the original shutter photo, the detected polygon overlay, the rectified card,
the candidate list, and a one-tap four-corner correction path. That gives the
user visibility into both parts of the scanner: “did we flatten the right
pixels?” and “did we identify the right printing?”
