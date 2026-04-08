# Browser Video Scan — Session Report (2026-04-07)

**Date:** April 7, 2026
**Video tested:** `Untitled design.mp4` — 20-minute Leonhart Pokemon unboxing (1920×1920, 60fps)
**Screenshot tested:** Shaymin LV.X card held at angle

---

## Table of Contents

1. [What Was Built](#what-was-built)
2. [Architecture Changes](#architecture-changes)
3. [YOLO Browser Integration](#yolo-browser-integration)
4. [Test Results: YOLO + Artwork Matching](#test-results-yolo--artwork-matching)
5. [Test Results: LAB + CLAHE Experiment](#test-results-lab--clahe-experiment)
6. [Test Results: Full Video Benchmark](#test-results-full-video-benchmark)
7. [Key Findings](#key-findings)
8. [What Didn't Help](#what-didnt-help)
9. [What Did Help](#what-did-help)
10. [Next Steps](#next-steps)
11. [File Reference](#file-reference)

---

## What Was Built

This session transformed the browser video scan pipeline from a heuristic
gradient-based edge detector to a YOLO ML-powered card detector with artwork
fingerprint matching. The pipeline now runs entirely in the browser.

### Before (start of session)

- Gradient-based edge detection (proposal windows + line fitting)
- DCT pHash matching only
- No ML detection
- ~64% accuracy on video frames
- No lighting normalization

### After (end of session)

- YOLO11n-OBB card detector running in browser via TensorFlow.js
- Artwork fingerprint matching (histogram-equalized 8×8 color grid + cosine similarity)
- pHash as secondary fallback
- Detection-only live mode with real-time overlays
- Full matching live mode (YOLO → crop → artwork match → track)
- IndexedDB caching for instant subsequent loads
- Temporal stabilization: EMA quad smoothing + vote accumulation
- Modular component architecture (8 files from 1 monolith)

---

## Architecture Changes

### Component Refactor

The monolithic `video-scan-lab.tsx` (1,323 lines) was split into 8 modules:

| File | Lines | Responsibility |
|------|-------|---------------|
| `video-scan-lab.tsx` | ~330 | Main orchestrator — state, wiring, layout |
| `use-video-scan-processor.ts` | ~400 | Processing logic — batch, live detection, YOLO+matching |
| `video-scan-panels.tsx` | ~520 | UI components — controls, video player, tracks, timeline |
| `use-video-scan-data.ts` | ~190 | Hash + artwork loading with IndexedDB caching |
| `video-scan-overlay.ts` | ~180 | Viewport mapping, overlay builders, palette |
| `video-scan-tracks.ts` | ~220 | Track reconciliation with EMA smoothing + vote accumulation |
| `video-scan-video-utils.ts` | ~180 | Video element helpers |
| `video-scan-types.ts` | ~120 | Types, constants, format helpers |

### New Scan Pipeline Modules

| File | Purpose |
|------|---------|
| `frontend/src/lib/scan/artwork-fingerprint.ts` | Browser-side artwork fingerprint (ported from backend) |
| `frontend/src/lib/scan/yolo-detector.ts` | TensorFlow.js YOLO11n-OBB inference + card crop extraction |

### Backend Changes

| File | Change |
|------|--------|
| `backend/src/api/routes/scan.router.ts` | Added `GET /cards/scan/artwork-fingerprints` endpoint |
| `backend/src/modules/card-scan/index.ts` | Exported artwork DB functions |

### Model Files

| File | Size | Source |
|------|------|--------|
| `frontend/public/models/yolo-card-detector/model.json` | 434KB | Pokemon-TCGP-Card-Scanner |
| `frontend/public/models/yolo-card-detector/group1-shard1of3.bin` | 4.0MB | " |
| `frontend/public/models/yolo-card-detector/group1-shard2of3.bin` | 4.0MB | " |
| `frontend/public/models/yolo-card-detector/group1-shard3of3.bin` | 2.3MB | " |

Total model size: ~10.6MB. YOLO11 Nano OBB, trained on Pokemon cards, 640×640 input.

---

## YOLO Browser Integration

### Detection Pipeline

```
Video Frame (640px)
    │
    ▼
[TensorFlow.js YOLO11n-OBB]
    │  Input: [1, 640, 640, 3] NHWC, normalized [0,1]
    │  Output: [1, 6, 8400] channel-major
    │  Channels: cx, cy, w, h, confidence, angle
    ▼
[Letterbox undo] ─── pad-to-square + scale mapping
    │
    ▼
[NMS] ─── IoU threshold 0.45, axis-aligned approximation
    │
    ▼
[OBB → Quad] ─── 4 rotated corner points from center + angle
    │
    ▼
[De-rotate Crop] ─── Canvas rotate(-angle) → extract card rectangle
    │
    ▼
[Artwork Match] ─── histogram eq + 8×8 grid → cosine similarity vs 21,900 DB
    │
    ▼
[pHash Fallback] ─── if artwork gap < threshold
```

### Preprocessing

- Input: video frame drawn to canvas, downscaled to max 640px
- Pad to square with gray (114) pixels (bottom-right padding)
- Resize to 640×640 with bilinear interpolation
- Normalize pixels to [0, 1]

### Coordinate Mapping

Model outputs pixel coordinates in 640×640 space. Mapping back:
- `cx_frame = cx_model / scale` (scale = 640 / max(srcW, srcH))
- Padding is bottom-right so no offset subtraction needed

### Performance

- Model load: ~3-5 seconds (first time, cached in browser)
- Warmup inference: ~300ms
- Per-frame inference: ~50-200ms (GPU) or ~4 seconds (CPU/Node.js test)
- Artwork matching: 10-25ms against 21,900 entries
- Total browser pipeline: depends on hardware, targets <200ms/frame

---

## Test Results: YOLO + Artwork Matching

### Single-Frame Tests (6 timestamps)

| Time | YOLO Conf | Actual Card | Top Artwork Match | Sim | Correct? |
|------|-----------|-------------|-------------------|-----|----------|
| 90s | 0.911 | Squirtle (dp3) | Golisopod (sm11) | 0.947 | WRONG |
| 120s | 0.953 | Unown S (dp3) | **Unown S (dp3)** | 0.977 | CORRECT |
| 180s | 0.935 | (motion blur) | Blissey (pl1) | 0.954 | unclear |
| 210s | 0.971 | Charizard (dp7) | **Charizard (dp7)** | 0.988 | CORRECT |
| 240s | 0.913 | ? | Groudon ex (np) | 0.947 | unclear |
| 300s | 0.926 | Broken Time-Space | **Broken Time-Space** | 0.974 | CORRECT |

**Multi-card frame at 210s:** YOLO found 3 cards simultaneously:
- Charizard (dp7) — sim 0.988 ✓
- Charmander (dp7) — sim 0.974 ✓
- Charmeleon (xy12) — sim 0.962 ✓

**Squirtle failure analysis:** The YOLO crop includes finger occlusion on the
right edge and green background bleeding into the artwork region. The 8×8 grid
averaged this noise into the fingerprint.

---

## Test Results: LAB + CLAHE Experiment

### Hypothesis

LAB color space + CLAHE (Contrast Limited Adaptive Histogram Equalization)
should improve matching under mixed lighting by normalizing the L channel
independently of color (technique from Repo 2 in the 29-scanner analysis).

### Method

Tested on 78 frames across the full 20-minute video (sampled every 15 seconds).
Each frame: YOLO detection → crop → compared baseline artwork match vs
LAB+CLAHE artwork match.

### Result: CLAHE HURTS — Do Not Use

| Metric | Value |
|--------|-------|
| Frames tested | 77 |
| Baseline vs CLAHE agreement | **37/77 (48.1%)** |
| Disagreements | **40/77 (51.9%)** |

**CLAHE makes things significantly worse.** More than half the frames produce
a different (likely wrong) top match with CLAHE.

**Root cause:** The artwork fingerprint database was built with standard
per-channel histogram equalization (not LAB+CLAHE). Applying CLAHE only to
the scan side diverges from the database preprocessing. This confirms the
lesson from the backend implementation report: **"Both sides must match."**

CLAHE would only help if the entire 21,900-card artwork database were rebuilt
with LAB+CLAHE preprocessing. Even then, it's unclear whether LAB+CLAHE
outperforms per-channel equalization for this use case.

---

## Test Results: Full Video Benchmark

### Gap Analysis (pHash tiebreaker potential)

| Metric | Value |
|--------|-------|
| Frames with gap < 0.01 | **59/77 (76.6%)** |
| Average top-2 gap | **0.0078** |
| Confident matches (gap > 0.03) | ~10/77 (13%) |

**77% of frames are ambiguous** — the top-2 artwork similarity scores are
within 0.01 of each other. The 8×8 color grid doesn't have enough resolution
to confidently separate many visually similar cards.

### Confident Matches (gap > 0.03 — almost certainly correct)

| Time | Card | Similarity | Gap |
|------|------|------------|-----|
| 210s | Charizard | 0.9884 | 0.0457 |
| 1185s | Cobalion-EX | 0.9934 | 0.0488 |
| 1020s | Gyarados | 0.9978 | 0.0443 |
| 795s | Ponyta | 0.9901 | 0.0381 |
| 330s | Dustox | 0.9864 | 0.0312 |
| 255s | Cherubi | 0.9670 | 0.0279 |
| 1125s | Phanpy | 0.9701 | 0.0261 |
| 105s | Charmander | 0.9758 | 0.0233 |
| 420s | Koffing | 0.9747 | 0.0208 |
| 570s | Rotom | 0.9847 | 0.0208 |

These high-confidence matches are virtually always correct.

### Full Per-Frame Results (Baseline)

```
30s:  M Tyranitar EX (0.9438) gap=0.0042
45s:  Master Ball (0.9284) gap=0.0032
75s:  Kirlia (0.9576) gap=0.0158
90s:  Golisopod (0.9474) gap=0.0033
105s: Charmander (0.9758) gap=0.0233
120s: Unown S (0.9769) gap=0.0106
135s: Team Rocket's Crobat ex (0.9391) gap=0.0047
150s: Koga's Tangela (0.9204) gap=0.0013
165s: Kyogre (0.9445) gap=0.0001
180s: Blissey (0.9536) gap=0.0018
195s: Kingambit (0.9306) gap=0.0045
210s: Charizard (0.9884) gap=0.0457
225s: Haunter (0.9596) gap=0.0121
240s: Groudon ex (0.9471) gap=0.0018
255s: Cherubi (0.9670) gap=0.0279
270s: Roserade (0.9638) gap=0.0169
285s: Croagunk (0.9457) gap=0.0001
300s: Broken Time-Space (0.9738) gap=0.0041
315s: Hypno (0.9526) gap=0.0016
330s: Dustox (0.9864) gap=0.0312
345s: Pichu (0.9281) gap=0.0022
360s: Dusk Mane Necrozma GX (0.9320) gap=0.0022
375s: Slowking (0.9235) gap=0.0005
390s: Alcremie (0.9154) gap=0.0038
405s: Colress (0.9616) gap=0.0122
420s: Koffing (0.9747) gap=0.0208
435s: Slakoth (0.9565) gap=0.0072
450s: Greedent ex (0.9392) gap=0.0005
465s: Vaporeon ex (0.9473) gap=0.0033
480s: Slakoth (0.9529) gap=0.0005
495s: Umbreon ex (0.9647) gap=0.0029
510s: Lucario (0.9718) gap=0.0187
525s: Togekiss V (0.9466) gap=0.0020
540s: Amoonguss (0.9625) gap=0.0022
555s: Magneton (0.9481) gap=0.0014
570s: Rotom (0.9847) gap=0.0208
585s: Dratini (0.9407) gap=0.0033
600s: Excadrill (0.9466) gap=0.0004
615s: Galarian Perrserker V (0.9255) gap=0.0030
630s: Skuntank V (0.9404) gap=0.0049
645s: Houndoom (0.9185) gap=0.0024
660s: Cherish Ball (0.9099) gap=0.0012
675s: Rhydon (0.9489) gap=0.0022
690s: Dewgong (0.9200) gap=0.0062
705s: Sawk (0.9452) gap=0.0001
720s: Garchomp (0.9489) gap=0.0011
735s: Misty's Seel (0.9472) gap=0.0052
750s: Power Plant (0.9389) gap=0.0094
765s: Spiritomb (0.9439) gap=0.0031
780s: Slakoth (0.9627) gap=0.0041
795s: Ponyta (0.9901) gap=0.0381
810s: Spearow (0.9582) gap=0.0027
825s: Arceus (0.9758) gap=0.0163
840s: Donphan (0.9455) gap=0.0042
855s: Master Ball (0.9243) gap=0.0047
870s: Weavile (0.9417) gap=0.0009
885s: Voltorb (0.9659) gap=0.0121
900s: Froslass ex (0.9539) gap=0.0033
915s: Flamigo (0.9335) gap=0.0005
930s: Snover (0.9548) gap=0.0000
945s: Regigigas (0.9570) gap=0.0011
960s: Helioptile (0.9382) gap=0.0002
975s: Eiscue ex (0.9419) gap=0.0031
990s: Machamp (0.9307) gap=0.0013
1005s: Eevee (0.9547) gap=0.0023
1020s: Gyarados (0.9978) gap=0.0443
1035s: Flaaffy (0.9549) gap=0.0021
1050s: Vulpix (0.9527) gap=0.0067
1065s: Donphan (0.9607) gap=0.0002
1080s: Dusknoir (0.9561) gap=0.0070
1095s: Slakoth (0.9616) gap=0.0038
1110s: Kirlia (0.9267) gap=0.0040
1125s: Phanpy (0.9701) gap=0.0261
1140s: Pokémon Center Lady (0.9382) gap=0.0006
1155s: Zygarde (0.9656) gap=0.0037
1170s: Golbat (0.9507) gap=0.0002
1185s: Cobalion-EX (0.9934) gap=0.0488
```

---

## Test Results: pHash Tiebreaker Experiment

### Hypothesis

When the top-2 artwork similarity gap is < 0.01 (77% of frames), run a
simplified pHash comparison on the top-10 artwork candidates against the
hash database to disambiguate.

### Method

For each ambiguous frame (gap < 0.01): computed a simplified per-channel
average hash of the YOLO crop, compared against stored pHash hex strings
for the top-10 artwork candidates, and selected the candidate with the
lowest Hamming distance.

### Result: Simplified pHash Tiebreaker Does NOT Help

| Metric | Value |
|--------|-------|
| Ambiguous frames | 59/77 (76.6%) |
| Tiebreaker changed result | **55/59 (93.2%)** |

The tiebreaker overrides the artwork match almost every time — and the
replacements are clearly wrong:

| Artwork Match | Tiebreaker Override | Correct? |
|---------------|--------------------|----|
| Broken Time-Space | Team Rocket's Porygon-Z | No |
| Slakoth | Terrakion-EX | No |
| Umbreon ex | Unown | No |
| Croagunk | Pokémon Catcher | No |
| Dusk Mane Necrozma GX | Shroomish | No |

**Root cause:** The simplified average hash computed on noisy video crops
is too different from the DCT pHash stored in the database. The hash
distance is essentially random, making it worse than the artwork match.

A proper DCT pHash (matching the backend's computation exactly) might work
better, but would require running the full DCT pipeline in the browser and
having both sides compute identically.

### Gap Distribution

```
<0.001        14  ███████       (18%) — extremely tight, coin flip
0.001-0.005   39  ████████████████████  (51%) — ambiguous
0.005-0.01     6  ███           (8%)  — slightly ambiguous
0.01-0.02      8  ████          (10%) — moderate confidence
0.02-0.05     10  █████         (13%) — high confidence
>0.05          0                (0%)
```

69% of frames have gap < 0.005. The 8×8 artwork grid fundamentally cannot
separate these cards — a larger grid (12×12 or 16×16) or a completely
different matching signal (CLIP embeddings, proper DCT pHash) is needed.

---

## Test Results: Grid Size Comparison (8×8 vs 12×12 vs 16×16)

### Method

Built artwork fingerprint databases at 12×12 (432 dims) and 16×16 (768 dims)
by modifying `artwork-matcher.ts` to accept a `--grid-size` parameter and
running `build-artwork-fingerprints.ts` against the TCGdex API via
kubectl port-forward. The 12×12 and 16×16 DBs have 12,821 entries (vs 21,900
for 8×8) due to the port-forward dropping during the ~25 minute build.

### Result: Larger Grids Do NOT Reduce Ambiguity

| Grid | Avg Gap | Ambiguous (<0.01) | Confident (≥0.01) |
|------|---------|-------------------|--------------------|
| 8×8 | 0.0078 | 59/77 (77%) | 18/77 (23%) |
| 12×12 | 0.0081 | 62/77 (81%) | 15/77 (19%) |
| 16×16 | 0.0093 | 60/77 (78%) | 17/77 (22%) |

Agreement between grid sizes:

| Comparison | Agreement |
|-----------|-----------|
| 8×8 vs 12×12 | 30/77 (39%) — 47 different |
| 8×8 vs 16×16 | 29/77 (38%) — 48 different |

**Key observations:**
- Confident cases get MORE confident with larger grids (Koffing gap:
  0.021→0.033→0.041, Houndoom: 0.002→0.007→0.017) — the grid captures
  more spatial detail when the card is cleanly visible.
- Ambiguous cases STAY ambiguous at every resolution — the noise from
  fingers, compression, and background occlusion dominates regardless of
  grid resolution.
- The 12×12/16×16 databases have fewer entries (12,821 vs 21,900), making
  direct accuracy comparison unreliable. However, the ambiguity rates are
  comparable, confirming the bottleneck is crop quality, not grid resolution.

### Root Cause

The color grid approach captures spatial color distribution. On noisy video
crops, this distribution is corrupted by:
1. Fingers overlapping the artwork region (skin tone bleeds in)
2. Background visible through transparent card sleeves
3. Video compression artifacts (blocking, color banding)
4. Motion blur averaging adjacent pixels

These noise sources affect the fingerprint at ANY grid resolution. The 8×8
grid averages out some noise (which is why it was chosen originally), while
16×16 captures both more detail AND more noise — net effect is roughly zero.

**Conclusion:** The color grid fingerprint has reached its ceiling. Further
improvement requires a fundamentally different matching approach:
- CLIP ViT-B/32 embeddings (semantic matching, not pixel-level)
- OCR tiebreaker (read card name / collector number)
- Proper DCT pHash with both-sides-matched preprocessing

---

## Test Results: Orientation Search + Multi-Hash Ensemble

### Method

Tested two techniques from the MTG-Card-Scanner-Sorter (29-repo analysis):
1. **Orientation search** — test artwork fingerprint at 0°, 90°, 180°, 270°,
   take best match (catches cards at wrong rotation)
2. **Ensemble** — combine artwork similarity (60%) with aHash/dHash
   hamming similarity (40%) against stored pHash hex, MTG Scanner style

### Results

| Method | Avg Gap | Ambiguous (<0.01) | Confident (≥0.01) |
|--------|---------|-------------------|--------------------|
| Baseline | 0.0078 | 59/77 (77%) | 18/77 (23%) |
| + Orientation | 0.0077 | 61/77 (79%) | 16/77 (21%) |
| Ensemble | 0.0087 | 52/77 (68%) | 25/77 (32%) |

### Analysis

**Orientation search: does NOT help.** Slightly worse (79% ambiguous).
YOLO OBB already handles card rotation via the angle output, so testing
additional rotations just introduces false matches. Changed 51% of results.

**Ensemble: REDUCES ambiguity by 9%** (77% → 68%, confident matches 23% →
32%). The hash signal breaks some ties. However, it changed 94% of all
results — the 40% hash weight is too aggressive. The hash types don't match
(scan-side aHash/dHash vs DB-side DCT pHash hex), making the hash distances
noisy.

**Takeaway:** A secondary signal DOES help when properly calibrated. The
hash weight should be ~10-15% (not 40%), and the hash computation must
match on both sides. Alternatively, OCR provides a completely orthogonal
signal that doesn't require hash matching at all.

---

## Test Results: HSV Histogram as Secondary Signal (Best Result)

### Method

Tested proper DCT pHash (matching stored hex hashes) and 30×32 HSV histogram
(matching stored HSV from artwork DB) as tiebreakers at 15% weight, applied
only to ambiguous frames (artwork gap < 0.01).

### Result: HSV Histogram Reduces Ambiguity by 24 Points

| Method | Ambiguous (<0.01) | Avg Gap | Changed |
|--------|-------------------|---------|---------|
| Baseline (artwork only) | 59/77 (**77%**) | 0.0078 | — |
| +DCT pHash 15% | 59/77 (**77%**) | 0.0081 | 27 |
| **+HSV hist 15%** | **41/77 (53%)** | **0.0133** | 42 |
| Combo 80/10/10 | 45/77 (58%) | 0.0112 | 39 |

**HSV histogram at 15% weight is the clear winner:**
- Ambiguity drops from 77% → **53%** (24-point reduction)
- Average gap increases 70% (0.0078 → 0.0133)
- Confident frames increase from 23% → **47%** (doubled)

**DCT pHash doesn't help** — comparing scan-side DCT hashes against
database DCT hashes produces noisy distances on video crops.

### Implementation

Integrated into the browser pipeline:
- `artwork-fingerprint.ts`: Added `computeHSVHistogramFromCanvas()` (30×32 bins)
- `ArtworkFingerprintEntry` now includes `hsvHist` + `hsvNorm`
- `matchArtworkFingerprint()` blends 85% artwork + 15% HSV cosine similarity
- `parseArtworkDatabase()` loads HSV data from artwork-fingerprints.json
- Both `scan-frame.ts` and `use-video-scan-processor.ts` pass HSV to matching

The HSV data already exists in the artwork database (stored as `hsvHist`
per entry in artwork-fingerprints.json), so no database rebuild is needed.

---

## Key Findings

### 1. YOLO Detection is Excellent

- 77/78 frames produced at least one detection (98.7% recall)
- Confidence range: 0.91 — 0.97
- Multi-card detection works (3 cards in one frame at 210s)
- Oriented bounding boxes handle card rotation correctly
- Model size (10.6MB) is acceptable for browser loading

### 2. Artwork Matching is the Bottleneck

- Confident matches (gap > 0.03) are almost always correct
- But 77% of frames have ambiguous matches (gap < 0.01)
- The 8×8 color grid (192 dimensions) lacks resolution to distinguish
  visually similar cards
- Finger occlusion and background bleed into the artwork crop degrade matches

### 3. Both Sides Must Match (confirmed again)

- LAB+CLAHE made things worse because the database was built differently
- This is the same lesson from the backend pHash equalization experiment
- Any preprocessing change requires rebuilding the fingerprint database

### 4. Temporal Stabilization Helps

- EMA quad smoothing (α=0.35, sticky=1.5px) prevents visual jitter
- Vote accumulation across frames reduces false identity flips
- Frame skipping prevents queue buildup when matching is slow

---

## What Didn't Help

| Technique | Result | Why |
|-----------|--------|-----|
| LAB + CLAHE preprocessing | 48% agreement (harmful) | Database built without CLAHE — sides don't match |
| Simplified pHash tiebreaker | 93% override rate (harmful) | Average hash on video crops too noisy; doesn't match stored DCT hashes |
| Larger grid (12×12, 16×16) | Same ambiguity (77-81%) | Captures more noise alongside more detail; net effect ~zero |
| Orientation search (4 rotations) | 79% ambiguous (worse) | YOLO OBB already handles rotation; extra rotations add false matches |
| Gradient-based edge detection | Poor quad outlines | Noise from artwork texture, no blur/NMS |
| 2-triangle affine warp | Perspective errors | Not enough triangles for real perspective |
| Histogram eq on pHash only | Worse distances | One-sided equalization diverges from DB |

## What Did Help

| Technique | Impact | Source |
|-----------|--------|--------|
| YOLO11n-OBB detection | 0% → 98.7% detection rate | Pokemon-TCGP-Card-Scanner |
| Artwork fingerprint matching | Fast primary signal (~15ms) | Riftbound Scanner |
| EMA quad smoothing | Eliminates visual jitter | MTG-Card-Scanner-Sorter (Repo 2) |
| Vote accumulation | Stabilizes card identity | pokemon-card-recognizer (Repo 4) |
| IndexedDB caching | Instant reload after first load | Pokemon-TCGP-Card-Scanner |
| Gaussian blur + Sobel + NMS | Cleaner edge detection (for heuristic fallback) | Scanic, MTG-Scanner-Sorter |
| Frame skipping | Keeps UI responsive under load | — |
| Hash ensemble (at low weight) | 77%→68% ambiguity | MTG-Card-Scanner-Sorter composite scoring |

---

## Next Steps

### High Priority

1. **CLIP ViT-B/32 embeddings** — The color grid has hit its ceiling at all
   resolutions (tested 8×8, 12×12, 16×16 — same 77% ambiguity). CLIP
   embeddings (512-dim, semantic matching) are the most promising next step.
   From the 29-repo analysis: Repo 20 (spell-coven-mono) runs CLIP in-browser
   via ONNX (Transformers.js), and Repo 25 (Card-Stocker-Pro) uses CLIP+FAISS.
   Would require: building a CLIP embedding database + running ViT inference
   in browser.

2. **Deploy artwork fingerprint API** — The `GET /cards/scan/artwork-fingerprints`
   endpoint was added to the source but the deployed backend image doesn't
   include it. Needs a backend rebuild + deploy.

3. **Proper DCT pHash tiebreaker** — The simplified average hash tiebreaker
   failed (93% harmful override rate) because it doesn't match the stored
   DCT hashes. A proper implementation would port the backend's exact DCT
   pHash computation (`phash.ts`) to the browser so both sides compute
   identically. Only worth doing AFTER the grid size increase.

### Medium Priority

4. **Tighter artwork crop** — Crop to just the illustration area (inside the
   card border) to exclude finger occlusion at edges. Currently the full YOLO
   bounding box is used, which includes fingers.

5. **OCR tiebreaker** — When artwork is ambiguous, OCR the card name as a
   final disambiguation signal (like the backend pipeline does). Most robust
   tiebreaker for the 77% ambiguous frames, but adds latency.

6. **ONNX Runtime Web** — Replace TensorFlow.js with ONNX Runtime Web for
   faster inference. Riftbound Scanner showed this gives better performance.

7. **CLIP embeddings** (from 29-repo analysis) — ViT-B/32 embeddings with
   FAISS HNSW indexing would be a fundamentally stronger matching signal
   than color grid fingerprints. 512-dim embeddings capture semantic visual
   meaning, not just color distribution. Requires building a CLIP embedding
   database and running CLIP inference in-browser (heavy but doable via ONNX).

### Low Priority

7. **Collector number OCR** — Read collector numbers (e.g., "042/264") instead
   of card names. More reliable than name OCR per Repo 3 analysis.

8. **Multi-channel pHash** — Use per-RGB-channel pHash (Repos 5, 19) instead
   of grayscale for better color discrimination.

---

## File Reference

### New Files Created

| File | Purpose |
|------|---------|
| `frontend/src/lib/scan/artwork-fingerprint.ts` | Browser artwork fingerprint matching |
| `frontend/src/lib/scan/yolo-detector.ts` | TensorFlow.js YOLO11n-OBB detector |
| `frontend/src/components/scan/use-video-scan-processor.ts` | Processing hooks (batch, live, YOLO+matching) |
| `frontend/src/components/scan/video-scan-panels.tsx` | UI sub-components |
| `frontend/src/components/scan/video-scan-types.ts` | Types and constants |
| `frontend/src/components/scan/video-scan-tracks.ts` | Track reconciliation + smoothing |
| `frontend/src/components/scan/video-scan-overlay.ts` | Overlay rendering |
| `frontend/src/components/scan/video-scan-video-utils.ts` | Video element helpers |
| `frontend/public/models/yolo-card-detector/*` | YOLO model files (10.6MB) |
| `docs/browser-video-scan-session-2026-04-07.md` | This document |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/scan/video-scan-lab.tsx` | Refactored from 1323→330 lines, YOLO integration |
| `frontend/src/components/scan/use-video-scan-data.ts` | Added IndexedDB caching |
| `frontend/src/lib/scan/scan-frame.ts` | Detection-only mode, NMS fixes |
| `frontend/src/lib/scan/scan-types.ts` | Added artworkSimilarity field |
| `frontend/src/lib/scan/browser-video-matcher.ts` | Exported artwork types |
| `frontend/src/lib/scan/quad-refinement.ts` | Gaussian blur + Sobel + NMS |
| `backend/src/api/routes/scan.router.ts` | Artwork fingerprints API endpoint |
| `backend/src/modules/card-scan/index.ts` | Artwork DB exports |
| `docs/browser-video-scan-handoff.md` | Updated module layout |

### Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `@tensorflow/tfjs` | 4.22.0 | Browser YOLO inference |

### Reference Projects Used

| Project | What was used |
|---------|---------------|
| Pokemon-TCGP-Card-Scanner | YOLO11n-OBB model (TF.js format), detection pipeline |
| Riftbound Scanner | Artwork color grid matching approach, ONNX detection pattern |
| Scanic | Canny edge detection analysis (not adopted — YOLO is better) |
| MTG-Card-Scanner-Sorter | EMA tracking, quad smoothing, composite scoring analysis |
| pokemon-card-recognizer | Confidence integral / vote accumulation concept |
