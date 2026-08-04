# ManaBox-inspired contour and perspective experiment

**Decision:** test card-boundary refinement and perspective warping as an
internal geometry policy, not as an end-user scanner option. Keep TCGer's YOLO
detector and DINOv2 recognizer. The production candidate is **rescue-only
rectification**: score the normal high-resolution detector crop first, then
attempt a contour-derived homography only when the normal crop is not accepted.

This document translates the ManaBox 4.1.11 review into an implementation and
validation plan for TCGer. The recovered evidence is in
[the ManaBox scanner report](../manabox-4.1.11-decompiled/SCAN_ANALYSIS.md).

## What ManaBox proves

ManaBox uses a coherent local pipeline:

```text
CameraX NV21 frame
  -> grayscale/OpenCV contour detection
  -> four card corners
  -> perspective warp to a normalized card
  -> 384-value HOG descriptor
  -> exact top-10 L2 search
  -> local visual-index-to-printing lookup
```

The contour detector is helped by an explicit product constraint: ManaBox asks
the user to place one card on a plain background with good contrast. That is a
reasonable operating point for thresholding and `findContours`, but it is not
TCGer's entire operating point. TCGer also targets cards in hands, pack-opening
video, fingers over edges, foil glare, partial cards, nonuniform playmats, and
multiple detections.

The transferable idea is therefore **not** "replace YOLO and DINOv2 with
OpenCV and HOG." It is "use detected card geometry to normalize difficult
inputs before retrieval, and measure when that normalization helps."

## What TCGer already has

### Browser/live scanner

The current browser DINO path already implements most of the recommended
architecture:

1. YOLO11n-OBB detects card candidates at 640 px.
2. The same frame is retained at higher resolution for recognition crops.
3. The normal oriented crop is embedded first.
4. If it does not clear the recognition threshold, `card-rectify.ts` examines a
   padded crop using grayscale, Sobel edges, per-side edge points, constrained
   RANSAC line fits, corner intersection, convexity/area checks, and a DLT
   homography.
5. The perspective-flattened crop is embedded, gated, and compared with the
   normal result. It replaces the result only when its score is higher.

Relevant code:

- [`frontend/src/components/scan/use-video-scan-processor.ts`](../frontend/src/components/scan/use-video-scan-processor.ts)
- [`frontend/src/lib/scan/card-rectify.ts`](../frontend/src/lib/scan/card-rectify.ts)
- [`frontend/src/lib/scan/yolo-detector.ts`](../frontend/src/lib/scan/yolo-detector.ts)

This is already more suitable for TCGer's scenes than running a global
plain-background contour detector. YOLO localizes each card; contour analysis
only needs to refine the four edges inside that region.

### Offline benchmark

The offline live-stream harness uses the same rectifier implementation. It now
supports three explicit policies:

| Mode | Behavior | Intended use |
| --- | --- | --- |
| `none` | Embed only the normal detector crop | Baseline |
| `rescue` | Rectify only a non-gated crop that failed recognition; keep the higher-scoring result | Production candidate |
| `always` | Use the rectified crop whenever a valid quad is found, even when the normal crop was good | Negative-control/ablation |

`--rectify` remains an alias for `--rectify-mode rescue`.

The harness records rectification attempts, valid quad/warp successes,
selected rectified results, and fallbacks. RANSAC sampling is deterministic in
both the frontend and offline copies so repeated A/B runs use the same line
hypotheses.

### iOS scanner

iOS already uses Apple Vision and Core Image:

- `VNDetectDocumentSegmentationRequest`, then `VNDetectRectanglesRequest` as a
  fallback;
- `CIFilter.perspectiveCorrection()` for the four-corner warp;
- a fixed normalized output size before embedding.

Relevant code:

- [`CardCropper.swift`](../mobile-apps/ios/TCGer/TCGer/CardScanner/CardCropper.swift)
- [`BoardCardEmbeddingScannerStrategy.swift`](../mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift)

The important mismatch is policy: iOS currently accepts a Vision crop before
the first embedding whenever a rectangle is found, while the measured browser
policy is rescue-only. `CardCropper` also applies exposure, saturation,
contrast, and brightness changes in the same operation. Geometry and
photometric changes must be tested separately; prior TCGer experiments found
contrast normalization harmful when it did not match index preprocessing.

## Existing evidence: blanket warping is not the default

The July 2 Sinnoh benchmark already compared the policies on one video:

| Policy | Committed observations | Precision | Ground-truth windows found |
| --- | ---: | ---: | ---: |
| Normal crop | 275 | 93.8% | 85/91 |
| Always/blanket rectify | 252 | 91.7% | 81/91 |
| Rescue cascade | 287 | 93.0% | 87/91 |

Blanket rectification lost already-correct crops; one observed cause was a
small geometric shift on a good holo crop. Rescue rectification recovered two
additional windows without losing a baseline window. This is strong evidence
for the policy shape, but not enough to tune all games and camera conditions.

## Recommended implementation

### 1. Keep YOLO as the main detector

Do not replace YOLO with a full-frame OpenCV contour detector. ManaBox's
detector assumes a simpler single-card/high-contrast scene. TCGer's detector
already handles rotation, multiple cards, hands, and nonuniform backgrounds.

Use contours as a **corner refiner inside a padded YOLO crop**. The detector box
provides a fallback for at most one missing/occluded edge. If two or more edges
are uncertain, keep the normal crop.

### 2. Keep perspective correction rescue-only

The production order should remain:

```text
normal high-resolution crop
  -> quality gate
  -> DINOv2 + rejection gate + retrieval
  -> accepted? return it
  -> otherwise attempt quad refinement and warp
  -> DINOv2 + rejection gate + retrieval
  -> choose rectified only if it improves the accepted evidence
```

Do not expose `none/rescue/always` in customer settings. A user cannot judge
which geometry policy is correct for a frame, and a permanent setting would
fragment calibration. Keep it in the offline harness, debug builds, and replay
reports until one policy wins across the test matrix.

### 3. Align iOS with the measured policy

Add an internal iOS geometry policy with the same three values for tests and
replay, defaulting production to `rescue` after it passes device validation:

1. Embed the guide/OBB crop without Vision photometric adjustments.
2. If the result is accepted, do not warp it.
3. If it is below threshold, ask Vision for the rectangle and use Core Image
   perspective correction.
4. Re-embed and select only on stronger valid evidence.
5. Run collector-number OCR on the crop that supplied the selected shortlist.

Keep color/exposure transforms disabled for the embedding branch unless the
same preprocessing is used to rebuild the reference index and wins an
independent ablation. OCR may retain its own contrast/upscale variants.

### 4. Do not add HOG to production yet

ManaBox's HOG width is coincidentally also 384, but its values are not
compatible with TCGer's DINO index. Testing HOG requires building a separate
reference index from every catalog image using the exact 160 x 160/HOG
preprocessing.

If a cheap-classical baseline is useful, add it only to an offline benchmark:

- top-1 and top-5 name/printing recall;
- negative false-positive rate;
- foil/glare and borderless slices;
- index size and cold-load memory;
- feature-extraction and exact-search latency.

Only consider it as a fallback if it provides a measured latency or cold-start
advantage without materially harming precision. It should not delay geometry
and iOS-policy validation, which reuse the current production recognizer.

## Reproducible A/B/C run

Run all modes with the same video, sampling interval, index, model, gate,
ground truth, and tolerance. The existing Sinnoh fixture can establish
regression parity; add MTG and physical-device recordings before changing the
production policy.

```bash
npm --prefix backend run scan:video-live-stream -- \
  --video /absolute/path/to/labeled-video.mp4 \
  --sample-seconds 1 \
  --full-res-crops \
  --native-backend \
  --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
  --rectify-mode none \
  --out-dir /tmp/tcger-geometry-none

npm --prefix backend run scan:video-live-stream -- \
  --video /absolute/path/to/labeled-video.mp4 \
  --sample-seconds 1 \
  --full-res-crops \
  --native-backend \
  --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
  --rectify-mode rescue \
  --out-dir /tmp/tcger-geometry-rescue

npm --prefix backend run scan:video-live-stream -- \
  --video /absolute/path/to/labeled-video.mp4 \
  --sample-seconds 1 \
  --full-res-crops \
  --native-backend \
  --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
  --rectify-mode always \
  --out-dir /tmp/tcger-geometry-always
```

Evaluate each result with `eval:video-stream` against the same ground-truth
manifest. `--native-backend` is appropriate for accuracy runs; rerun on actual
browser/iOS hardware for latency and memory decisions.

## Test matrix

Every mode should be evaluated on these slices:

| Area | Required cases |
| --- | --- |
| Games | Pokémon, MTG, Yu-Gi-Oh once each index is available |
| Geometry | Flat, rotated, strong keystone, edge-clipped, partial frame |
| Background | Plain light/dark, playmat, clutter, cards in hand |
| Card style | Normal border, borderless/full-art, dark art, trainer/energy |
| Surface | Matte, sleeve, foil, strong glare |
| Occlusion | No fingers, one edge covered, two edges covered |
| Motion/quality | Sharp still, blur, low light, compression |
| Open set | Card back, pack, hand, empty background, non-card rectangle |
| Scene | One card, multiple cards, card entering/leaving frame |

For a smaller geometry-specific fixture set, label the four true corners as
well as card identity. That permits corner error and warp validity to be scored
without using recognition confidence as a proxy for geometric correctness.

## Metrics and promotion gates

Record:

- committed top-1 name and exact-print precision;
- ground-truth-window coverage and top-5 recall;
- new false positives, newly recovered windows, and baseline windows lost;
- quad-attempt, valid-warp, selected-warp, and fallback rates;
- corner/reprojection error where corner labels exist;
- p50/p95 total frame time, incremental rectification time, second-embedding
  rate, peak memory, and thermal behavior on physical devices;
- metrics by the slices above, not only one aggregate score.

Promote rescue rectification only when:

1. It does not introduce a new accepted false-positive window on the primary
   labeled suites.
2. It does not lose a baseline-correct window in any major game/card-style
   slice without a larger, reviewed gain.
3. Coverage improves on at least two independent capture sets rather than only
   the Sinnoh video.
4. The browser and iOS implementations choose materially equivalent crops and
   identities on shared fixtures.
5. The p95 live-frame cost remains within the scanner's device budget; the
   rescue attempt rate must remain low enough that a second embedding is an
   exception, not the common path.

`always` is expected to fail these gates and exists to prove that rescue policy
is adding value rather than the warp merely looking cleaner to a human.

## Follow-up order

1. Run `none/rescue/always` on the existing labeled Pokémon videos.
2. Add a small labeled MTG geometry set emphasizing borderless, foil, and
   same-art reprints.
3. Add quad corner labels to representative successes and failures.
4. Change iOS `CardCropper` into geometry-only correction and test
   raw/rescue/always through replay; keep photometric variants OCR-only.
5. Tune edge/quad confidence from labeled geometry failures, not recognition
   anecdotes.
6. Only if the pure-TypeScript refiner is the measured bottleneck, compare an
   OpenCV implementation behind the same interface. Do not add OpenCV.js or a
   new native dependency merely to match ManaBox's library choice.
7. Consider a separate HOG baseline last.

## Bottom line

TCGer should test the ManaBox idea at the **geometry boundary**, where it is
most transferable. We already have the correct production-shaped design on
the web: YOLO localization, normal DINO retrieval first, then contour-derived
perspective correction as a guarded rescue. The next work is reproducible
cross-game validation and iOS policy alignment—not a second customer-visible
scanner mode and not a wholesale HOG rewrite.

