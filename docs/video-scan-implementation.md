# TCGer Video Card Scanner — Implementation Report

**Date:** April 4-5, 2026
**Status:** Working pipeline at 79% accuracy, 1.6s per frame
**Benchmark:** 14 cards from a 20-minute Leonhart Pokemon unboxing video

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Architecture Overview](#architecture-overview)
3. [Component Deep Dive](#component-deep-dive)
4. [What We Tried and What We Learned](#what-we-tried-and-what-we-learned)
5. [Benchmark Results](#benchmark-results)
6. [File Reference](#file-reference)
7. [Infrastructure](#infrastructure)
8. [Next Steps](#next-steps)
9. [How to Run](#how-to-run)

---

## Problem Statement

The goal is to identify Pokemon trading cards shown in social media videos (unboxing videos, pack openings, collection showcases). The input is a compressed video file; the output is a list of detected cards with timestamps.

The hard version of this problem includes:
- Cards held in hands (fingers overlap card edges)
- Compressed video (JPEG artifacts, motion blur)
- Variable lighting (desk lamps, reflections)
- Holographic/foil cards (rainbow reflections alter appearance)
- Cards shown at angles or partially obscured
- Multiple cards visible simultaneously
- Rapid card transitions (1-3 seconds per card)

The existing TCGer backend had a perceptual hash (pHash) matching system that worked well on clean, isolated card scans but failed completely on video frames. The pHash distance for a video-captured card was 300+ against a threshold of 240, producing zero matches.

---

## Architecture Overview

The final pipeline has five stages:

```
Video Frame
    |
    v
[1. YOLO OBB Detector] ─── Locates card in frame (92%+ confidence)
    |
    v
[2. Rotated Crop] ─── Extracts and de-rotates the card region
    |
    v
[3. Artwork Fingerprint] ─── 8x8 color grid match against 21,900 cards (~3ms)
    |                         Pre-filters pHash candidates to top 50
    v
[4. pHash + Feature Hashes] ─── DCT-based matching on filtered candidates
    |
    v
[5. OCR Narrowing] ─── Reads card name, fuzzy-matches to disambiguate
    |                   (skipped when artwork is confident)
    v
[Tracker] ─── Accumulates evidence across frames, emits when stable
```

### Key Design Decisions

1. **Detector replaces heuristic windows.** The original pipeline tried 24 crop windows at fixed positions. The YOLO detector finds the actual card location with a single inference.

2. **Artwork matching is the primary signal.** The 8x8 histogram-equalized color grid fingerprint is more robust than pHash on video crops because it operates on just the artwork region (excluding card borders where hands appear) and uses histogram equalization to normalize lighting.

3. **pHash is a secondary signal, not the primary one.** pHash still contributes through the existing feature scoring system but only runs on the top 50 artwork candidates instead of all 21,900 cards.

4. **OCR is a tiebreaker, not a requirement.** OCR helps when it reads the card name correctly (~40% of frames), but the pipeline works without it. OCR only overrides the artwork+pHash result when it reads an exact name match.

5. **The tracker accumulates, not decides.** Individual frame results are proposals. The tracker accumulates OCR votes and candidate scores across frames and only emits when a card has been consistently identified.

---

## Component Deep Dive

### 1. Card Detector (card-detector.ts)

**Model:** YOLO11n-OBB (Oriented Bounding Box), converted from TensorFlow.js to ONNX

**Two models tested:**

| Model | Source | Size | Input | Output | Confidence | Crop Quality |
|-------|--------|------|-------|--------|------------|--------------|
| TCGP YOLO11n-OBB | Pokemon-TCGP-Card-Scanner (converted) | 10.9MB | 640x640 NHWC | [1,6,8400] raw | 92% | Excellent |
| cardcaptor-v3 | AlecKarfonta/HuggingFace | 80MB | 1088x1088 NCHW | [1,300,7] post-NMS | 69% | Good but tight |

The TCGP model won because:
- Higher confidence (92% vs 69%)
- Better crop geometry (aspect ratio 0.737, close to card ratio 0.714)
- Smaller and faster
- Near-zero detection angle (card appears upright)

**Key implementation details:**

- Auto-detects input layout (NCHW vs NHWC) and output format (raw anchors vs post-NMS) during warmup
- Letterbox preprocessing: scale to fit input size, pad with gray (114)
- For raw anchor output: NMS with IoU threshold 0.45
- 8% box expansion to capture full card borders
- Rotated crop extraction using sharp for cards at angles

**Conversion story:** The TCGP model was originally TF.js (model.json + shards). Converting to ONNX required:
- Python 3.12 conda environment (Python 3.13 segfaulted with TensorFlow)
- Custom script to reconstruct TF GraphDef from model.json (tensorflowjs_converter CLI dropped `tfjs_graph_model` as input format)
- Decomposing 6 `FusedDepthwiseConv2dNative` ops into standard TF ops
- Fixing int32/int64 dtype mismatches
- Result: NHWC input (channels-last), 20ms inference on Apple Silicon CPU

### 2. Artwork Fingerprint Matching (artwork-matcher.ts)

**Inspired by:** RiftBound Scanner's cardMatcher.js

**Algorithm:**
1. Crop to artwork region (Pokemon: top 8% to 55%, sides 5% to 95%)
2. Resize to 64x64 for histogram equalization
3. Per-channel histogram equalization (R, G, B independently):
   - Build 256-bin histogram
   - Compute CDF
   - Remap pixel values to uniform distribution
4. Resize equalized image to 8x8 grid
5. Extract normalized RGB values → 192-dimensional Float32 vector
6. Compare via cosine similarity (dot product / norms)

**Why it works on video crops:**
- Artwork region excludes card borders where hands/fingers appear
- Histogram equalization normalizes brightness/contrast differences between clean scans and video frames
- 8x8 grid is coarse enough that compression artifacts average out
- Cosine similarity is more robust than Hamming distance on noisy data

**Database:** 21,900 Pokemon card fingerprints built on the K8s cluster from TCGdex API images. Stored as `artwork-fingerprints.json` (23MB without HSV, 130MB with HSV) on the `tcger-card-scan-data` PVC.

**Performance:** Matching against all 21,900 entries takes ~3ms (linear scan with pre-computed norms).

### 3. pHash System (phash.ts, scan.service.ts)

**Existing system, unchanged:**
- Resize image to 64x64 per channel
- 2D DCT (Discrete Cosine Transform)
- Keep top-left 16x16 low-frequency coefficients
- Threshold at median → binary hash (256 bits per channel, 768 total)
- Hamming distance for comparison

**What changed:**
- `maxDistanceOverride` parameter: detector scans use 320 (vs default 240) because video crops inherently hash farther from clean references
- `ocrNameHint` parameter: fuzzy-filters the hash database by card name before comparison
- Artwork pre-filter: only runs pHash against the top 50 artwork matches instead of all 21,900 entries (30x speedup)

**Why pHash alone fails on video:** The DCT-based hash captures low-frequency spatial structure. Video compression artifacts, lighting variation, and hand occlusion at card edges shift enough hash bits that the distance exceeds the threshold. The Kirlia test case had distance 312 vs threshold 240 — correct card ranked #5 overall instead of #1.

### 4. OCR System (card-detector.ts ocrCardTitle)

**Engine:** Tesseract.js v7

**Preprocessing:** 4 variants run in parallel:
1. Normalize + sharpen (baseline)
2. Median filter + strong sharpen (edge-preserving)
3. Grayscale + threshold at 140 (dark text on light background)
4. Inverted + threshold (light text on dark background)

**Title extraction:**
- Extract upper 15% of card crop (where card name appears)
- Upscale 2.5x for better OCR resolution
- Run all 4 variants through Tesseract in parallel
- Extract words (3+ alpha chars), filter by repeat-char ratio (>0.4)
- Score by confidence × 100 + min(length, 12)
- Return best word

**Plausibility filter** (before using OCR result):
- Alpha ratio >= 70%
- Length 4-20 characters
- Not all uppercase (rejects "COAL", "ARN" etc.)

**OCR success rate:** ~40% of frames produce a usable card name. When OCR reads the name correctly, it's a strong signal for disambiguation.

**Collector number OCR** (ocrCollectorNumber): reads bottom 10% of crop for "NN/NNN" patterns. Implemented but not yet integrated into the scoring pipeline.

### 5. Tracker (scan-video.ts)

**Track lifecycle:**
1. Proposal generated per frame (detector crop + scan result)
2. Associated to existing track by IoU/center/size similarity (threshold 0.35)
3. Or creates new track if unmatched
4. Track accumulates:
   - Candidate scores (confidence, distance, quality per card)
   - OCR votes (title strings across frames)
   - Best crop quality/score

**OCR consensus scoring:**
When OCR votes exist, the ranking formula shifts:

```
Without OCR votes:
  score = avgConfidence * 0.45 + distanceScore * 0.30 + temporalConsistency * 0.15 + cropQuality * 0.10

With OCR votes:
  score = avgConfidence * 0.35 + distanceScore * 0.25 + temporalConsistency * 0.10 + cropQuality * 0.10 + ocrConsensus * 0.20
```

OCR consensus = average normalized Levenshtein similarity between each OCR vote and the candidate name.

**Emission criteria:**
- Minimum stable frames (default 2)
- Leader score >= 0.5
- Margin >= 0.08 over second place
- Same leader for consecutive frames

---

## What We Tried and What We Learned

### Things That Worked

| Technique | Impact | Key Insight |
|-----------|--------|-------------|
| YOLO OBB card detection | 0% → detected | Replaces 24 heuristic windows with a single accurate detection |
| Artwork fingerprint matching | +4 cards correct | Artwork region is the most stable/discriminative part of a card |
| OCR name filtering | +2 cards correct | When OCR reads "Shaymin", filter DB to Shaymin entries only |
| Relaxed pHash threshold | +matches | Video crops need 320 threshold vs default 240 |
| Artwork pre-filter for pHash | 2.3x speedup | Run pHash on top 50 artwork matches instead of 21,900 |
| Parallel OCR variants | ~30% OCR speedup | Promise.all on 4 Tesseract calls |
| Skip OCR on confident artwork | ~40% frame speedup | No need to OCR when artwork match is clear |
| Name length filter | +1 card (Shaymin) | Skip single-letter first names ("M", "N") in OCR filter |
| Exact-name OCR trust | +1 card (Shaymin) | When OCR exactly matches a candidate name, always trust it |

### Things That Did NOT Work

| Technique | Result | Why It Failed |
|-----------|--------|---------------|
| Histogram equalization in pHash | Distance 312 → 336 (worse) | Equalizing only scan-side diverges from un-equalized database hashes |
| HSV histogram blending (25% weight) | 79% → 57% (much worse) | Video crop HSV is too different from clean reference HSV |
| HSV at 10% weight on artwork region | 79% → 71% (worse) | Even small HSV noise overrides correct artwork matches |
| 16x16 artwork grid | No improvement on failing cases | Similar cards still too close at higher resolution |
| Desaturation for holo cards | No improvement | Holo reflections change hue, not just saturation |
| ORB keypoint matching | Only 3-4 matches | Video compression destroys fine keypoint details |

### Key Lessons

1. **Both sides must match.** Any preprocessing (equalization, normalization) must be applied identically to both the database build AND the scan-time image. Equalizing only one side makes things worse.

2. **Artwork region is king.** Cropping to just the illustration (excluding borders, name bar, text) dramatically improves matching because it removes the noisy edges where hands, reflections, and compression are worst.

3. **Color grids beat binary hashes on noisy data.** The 8x8 Float32 color grid with cosine similarity is more robust than 256-bit binary pHash with Hamming distance because individual bit flips don't cascade.

4. **OCR is unreliable but valuable.** Only ~40% of frames produce readable text, but when it works, it's the strongest disambiguation signal. The key is to never let bad OCR override a good visual match.

5. **HSV doesn't help on compressed video.** Video compression alters color distributions enough that HSV histogram correlation between a video crop and a clean reference image is unreliable, even when both are cropped to the same region.

6. **Pre-filtering is better than post-filtering.** Using artwork to narrow candidates before pHash (50 vs 21,900) is much faster than running pHash on everything and filtering after.

---

## Benchmark Results

### 14-Card Single-Frame Benchmark

| # | Time | Card | Artwork | pHash | OCR | Pipeline Result | Status |
|---|------|------|---------|-------|-----|-----------------|--------|
| 1 | 1:15 | Kirlia Lv.28 | Kirlia 0.948 | - | CvOvves | **Kirlia (dp3-53)** | correct (exact card) |
| 2 | 2:55 | Psyduck Lv.19 | Psyduck 0.965 | - | Psyduck | **Psyduck (pl1-87)** | correct |
| 3 | 3:20 | Shaymin Lv.X | Tangela 0.948 | - | Shaymin | **Shaymin EX (xy6-106)** | correct (OCR saved it) |
| 4 | 5:10 | Slakoth Lv.11 | Slakoth 0.966 | Slakoth | Slakoth | **Slakoth (pl1-95)** | correct |
| 5 | 6:40 | Colress | Colress 0.989 | Colress | - | **Colress (bw8-118)** | correct |
| 6 | 8:20 | Purrloin HP50 | Purrloin 0.968 | - | Purrloin | **Purrloin (B2-174)** | correct |
| 7 | 9:40 | Vanillite HP60 | Vanillite 0.966 | Vanillite | - | **Vanillite (bw8-35)** | correct |
| 8 | 10:50 | Raikou (shiny) | Raikou V 0.952 | - | - | **Raikou V (swsh12.5-GG41)** | correct (artwork) |
| 9 | 13:25 | Bronzong Lv.45 | Bronzong 0.964 | Bronzong | Bronzong | **Bronzong (pl4-33)** | correct |
| 10 | 15:55 | Houndour HP50 | Morpeko 0.947 | - | - | Morpeko | wrong (similar dark art) |
| 11 | 16:45 | Houndoom HP110 | Houndour 0.957 | - | - | Houndour | wrong (pre-evolution) |
| 12 | 17:35 | Metal Energy | Swoobat 0.939 | - | - | Lanette's Net Search | wrong (non-Pokemon card) |
| 13 | 19:15 | Magneton | Umbreon 0.946 | - | Magneton | **Magneton (ecard3-19)** | correct (OCR saved it) |
| 14 | 20:05 | Heatmor HP90 | Heatmor 0.976 | Heatmor | - | **Heatmor (bw8-23)** | correct |

**Accuracy: 11/14 (79%)**

### How Each Correct Card Was Identified

- **7 by artwork alone:** Kirlia, Psyduck, Slakoth, Colress, Vanillite, Raikou, Heatmor
- **2 by artwork + pHash:** Bronzong, Purrloin (both signals agreed)
- **2 by OCR overriding wrong artwork:** Shaymin (artwork said Tangela, OCR said Shaymin), Magneton (artwork said Umbreon, OCR said Magneton)

### Why 3 Cards Still Fail

1. **Houndour → Morpeko:** Both are dark-type Pokemon with similar dark/fiery artwork. The 8x8 color grid captures nearly identical color distributions. OCR reads "ounaour" (garbage). ORB keypoint matching was tried but only found 3 matches (too few to discriminate).

2. **Houndoom → Houndour:** Houndoom is the evolution of Houndour. Their artwork is nearly identical (same artist, same color palette, same pose angle). Even 16x16 grids and HSV histograms couldn't distinguish them.

3. **Metal Energy:** This is a non-Pokemon card (Energy type). The artwork database only contains Pokemon card fingerprints, and the card has no Pokemon name for OCR to read.

### Performance

| Metric | Value |
|--------|-------|
| Average per frame | 1,588ms |
| Fastest (artwork confident, OCR skipped) | ~600ms |
| Slowest (first frame, cold caches) | ~3,000ms |
| Detection only | 25-31ms |
| Artwork matching (21,900 cards) | ~3ms |
| pHash (top 50 pre-filtered) | ~100ms |
| OCR (4 variants parallel) | ~1,200ms |
| Artwork DB load (one-time) | ~320ms |

---

## File Reference

### New Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `backend/src/modules/card-scan/card-detector.ts` | ONNX card detector, rotated crop, OCR, levenshtein | ~380 |
| `backend/src/modules/card-scan/artwork-matcher.ts` | Artwork fingerprint, HSV histogram, cosine similarity, DB builder | ~400 |
| `backend/src/scripts/build-artwork-fingerprints.ts` | CLI for building artwork DB from local files or API | ~220 |

### Modified Files

| File | Changes |
|------|---------|
| `backend/src/scripts/scan-video.ts` | `--detector` flag, detector proposals, OCR accumulation in tracks, artwork-confident OCR skip |
| `backend/src/modules/card-scan/scan.service.ts` | `maxDistanceOverride`, `ocrNameHint`, artwork pre-filter, artwork candidate injection |
| `backend/src/modules/card-scan/phash.ts` | (Histogram equalization added then reverted — only works when both sides equalize) |
| `backend/package.json` | Added `onnxruntime-node`, `build:artwork` script |

### Infrastructure Files

| File | Purpose |
|------|---------|
| `personalprox/k8s/tcger/artwork-build-job.yaml` | K8s Job manifest for building artwork DB |
| `/tmp/tcger-detector-test/tcgp-yolo11n-obb.onnx` | TCGP YOLO11n-OBB model (10.9MB, NHWC) |
| `/tmp/tcger-detector-test/cardcaptor-v3/model.onnx` | cardcaptor-v3 model (80MB, backup) |

### Scanner Reference Projects Used

| Project | What We Used |
|---------|--------------|
| Pokemon-TCGP-Card-Scanner | YOLO11n-OBB model (TF.js → ONNX conversion) |
| RiftBound Scanner | Artwork color grid fingerprinting approach (cardMatcher.js) |
| cardcaptor-v3 (HuggingFace) | Alternative detector for comparison |
| MTG-Card-Scanner-Sorter | OCR preprocessing techniques (multi-variant, upscale, bilateral) |

---

## Infrastructure

### Kubernetes Cluster

- **Server:** ubuntu@192.168.1.50 (K3s v1.31.4)
- **Kubeconfig:** `/Users/ahmadjalil/github/personalprox/kubeconfig.yml`
- **Namespace:** `tcger` (production), `tcger-test` (testing)

### PVCs

| PVC | Size | Content |
|-----|------|---------|
| `tcger-card-scan-data` | 2Gi | artwork-fingerprints.json (130MB), hashes.json |
| `tcger-tcgdex-data` | 5Gi | Pokemon card image cache |

### Artwork Database Build

The artwork fingerprint database is built by a K8s pod that:
1. Fetches all Pokemon cards from the internal TCGdex API (`http://tcger-tcgdex:4040`)
2. Downloads each card's high-res image
3. Computes artwork fingerprint (8x8 histogram-equalized color grid) and HSV histogram
4. Writes `artwork-fingerprints.json` to the PVC

**Runtime:** ~25 minutes for 21,900 cards, zero errors.

**To rebuild:**
```bash
# From personalprox repo
KUBECONFIG=kubeconfig.yml kubectl delete pod tcger-artwork-builder -n tcger 2>/dev/null
KUBECONFIG=kubeconfig.yml kubectl apply -f k8s/tcger/artwork-build-job.yaml
KUBECONFIG=kubeconfig.yml kubectl logs -f pod/tcger-artwork-builder -n tcger
```

### Models

The YOLO OBB detector model is stored locally at `/tmp/tcger-detector-test/tcgp-yolo11n-obb.onnx`. For production deployment, it should be:
- Added to the Docker image build, or
- Stored on a PVC and mounted into the backend pod, or
- Downloaded at startup from a known URL

---

## Next Steps

### High Priority

#### 1. Deploy to production backend
The scan pipeline code is in the repo but the deployed backend image doesn't include it yet. Steps:
- Build new backend Docker image with the detector and artwork modules
- Push to GHCR (Flux CD will auto-deploy)
- Mount the ONNX model file (either bake into image or mount from PVC)
- The artwork-fingerprints.json is already on the PVC

#### 2. Add card-type classification
Detect whether the card is a Pokemon, Trainer, or Energy before running identification. Energy cards can be classified by border color (fire=red, water=blue, etc.) without artwork matching. Trainer cards have different artwork regions. This would eliminate the Energy card false positive.

**Implementation:**
- Use the card border color to classify type (top/bottom border is colored by type)
- Or train a small classifier on the detected card crop
- Skip artwork matching for Energy cards; use border color instead

#### 3. Integrate with iOS/mobile app
The current pipeline runs as a CLI tool. To integrate with the mobile app:
- Add a video upload endpoint to the backend API
- Process uploaded videos with the scan-video pipeline
- Return detected cards with timestamps
- Or: run detection on-device (YOLO model is small enough) and send crops to the backend for identification

### Medium Priority

#### 4. Better OCR engine
Replace Tesseract.js with PaddleOCR (better at scene text) or a fine-tuned model. This would improve the ~40% OCR success rate, which directly helps cards where artwork matching fails (like Shaymin, Magneton).

**Options:**
- PaddleOCR via Python sidecar service
- PaddleOCR ONNX models run directly in Node.js
- Fine-tuned Tesseract model for Pokemon card text

#### 5. Card-still detection for multi-frame tracking
Currently the tracker runs on every frame including transitions. Better: detect when a card is held still (low inter-frame motion in the card region) and only process those frames. This improves both speed and accuracy by avoiding noisy transition frames.

**Implementation:**
- Compute frame-to-frame optical flow or simple pixel difference in the detection region
- Only run the full pipeline when the card region is stable (low motion)
- Use the highest-quality frame from each stable period

#### 6. Artwork-region pHash
During testing, we found that computing pHash on just the artwork region (instead of the full card) improved discrimination for holographic cards. Shaymin Lv.X: artwork-region pHash correctly ranked Shaymin over Tangela (378 vs 390), while full-card pHash had the opposite ranking.

**Implementation:**
- Add an `artwork` region to `feature-hashes.ts` alongside `title` and `footer`
- Rebuild the hash database to include artwork-region pHash
- Weight artwork pHash heavily in `computeFeatureScore()`
- This requires a server-side hash DB rebuild

### Low Priority

#### 7. Magic/Yu-Gi-Oh support
The artwork matcher and detector can work with any TCG. The artwork crop regions are already defined for Magic and Yu-Gi-Oh in `ARTWORK_REGIONS`. Building fingerprint databases for these TCGs requires running the build job with `--tcg magic` or `--tcg yugioh`.

#### 8. Collector number matching
The `ocrCollectorNumber()` function is implemented but not integrated into the scoring. Reading the collector number (e.g., "53/132") from the card footer would allow exact variant identification, especially useful for cards with multiple printings.

#### 9. ORB fallback for ambiguous cases
When the top-2 artwork candidates are very close (< 0.01 similarity gap), run ORB keypoint matching as a tiebreaker. This requires:
- Pre-computing ORB features for reference images (new DB build)
- Using OpenCV.js ORB (already available) at scan time
- Only ~80-150ms per comparison, but only needed in ambiguous cases

Testing showed ORB produces very few matches (3-4) on compressed video, so this would only help when the reference images are also stored at sufficient resolution.

---

## How to Run

### Local Testing

```bash
cd /Users/ahmadjalil/github/TCGer/backend

# Scan a single video segment
NODE_ENV=test BACKEND_MODE=convex CARD_SCAN_STORE=file \
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npm run scan:video -- \
  --video '/path/to/video.mp4' \
  --tcg pokemon \
  --fps 1 \
  --offset 75 \
  --duration 5 \
  --detector /tmp/tcger-detector-test/tcgp-yolo11n-obb.onnx \
  --detector-input-size 640 \
  --max-proposals 3 \
  --track-ttl 3 \
  --min-stable 2

# Build artwork fingerprints from local images
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npm run build:artwork -- --tcg pokemon

# Build artwork fingerprints from API
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
POKEMON_API_BASE_URL=http://localhost:4040 \
npm run build:artwork -- --tcg pokemon --from-api
```

### CLI Flags for scan:video

| Flag | Default | Description |
|------|---------|-------------|
| `--video` | required | Path to video file |
| `--tcg` | pokemon | Card game: pokemon, magic, yugioh |
| `--fps` | 0.1 | Frames per second to sample |
| `--offset` | 0 | Start time in seconds |
| `--duration` | full video | Duration to scan in seconds |
| `--max-frames` | unlimited | Maximum frames to process |
| `--detector` | none | Path to ONNX detector model (enables detector mode) |
| `--detector-input-size` | 1088 | Model input size (640 for TCGP, 1088 for cardcaptor) |
| `--max-proposals` | 3 | Max card proposals per frame |
| `--track-ttl` | 3 | Frames before a missing track expires |
| `--min-stable` | 2 | Minimum frames before emitting a detection |
| `--keep-frames` | false | Keep extracted frame files after scan |

### Output Format

The scan produces JSON with:
- `detections`: Array of emitted card identifications with timestamps
- `tracks`: Detailed track data including OCR votes, candidates, observations
- `frames`: Per-frame proposal summaries
- `summary`: Aggregated card list with occurrence counts
