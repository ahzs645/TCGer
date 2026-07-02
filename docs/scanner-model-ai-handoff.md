# Scanner Model AI Handoff

Last updated: 2026-07-01 (evening session: ground truth v2, rejection gate, full-res crops)

## Session Results 2026-07-01

Headline: the recognition pipeline is far better than the old benchmark said.
The v1 ground-truth fixture was systematically misaligned; 16/16 sampled
"wrong" labels were verified frame-by-frame to be CORRECT scanner output,
usually down to the exact collector number.

Benchmark (Sinnoh video, 10s sampling, scored against ground truth v2 with
`--tolerance-seconds 5`, jumbo excluded):

| run | crops | gate | coverage | top-1 name | committed-label precision |
|---|---|---|---|---|---|
| baseline | 640px frames | off | 73.7% | 27.6% | 22/26 = 85% |
| gated | 640px frames | 0.45 | 73.7% | 27.6% | 22/26 = 85% |
| gated + full-res | 1080p frames | 0.45 | 85.5% | 35.5% | **31/31 = 100%** |

Key takeaways:

- Crop resolution was the dominant error source. Cropping from the full-res
  frame (detect on 640, crop from source) removed every misidentification
  (Morpeko V -> Pikachu ex/Pachirisu ex, Furfrou -> Shiftry were 640px-crop
  confusions).
- The rejection gate (logistic head on the existing DINOv2 embedding) rejects
  ~66% of junk crops at 98.7% card-face recall on held-out video time. It did
  not change top-1 on this video (all above-threshold errors were real card
  faces), but it kills junk before retrieval and is the open-set safety net.
- Low top-1-per-window is now mostly a sampling artifact: most reveal windows
  are ~4s, so 10s sampling misses them entirely. Per-observation precision is
  the honest runtime metric.
- ffmpeg `fps=1/N` sampling has a phase offset of up to ~4s between different
  N. Ground-truth windows are padded and the evaluator has
  `--tolerance-seconds` for this. Do not compare runs at different sample
  rates without tolerance.

New artifacts and scripts (all in this repo):

- `backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.v2.json`
  — rebuilt evidence-based ground truth: 79 windows (76 scored, 3 jumbo),
  each tagged `verified-frame` (human/agent eyeballed the frame) or
  `proposal` (pipeline-confident, sim >= 0.75). v1 kept for history; USE V2.
- `backend/src/scripts/build-video-crop-dataset.ts` — auto-labeled crop
  dataset from a video + ground truth (card-face / negative / uncertain by
  window membership; ~650 crops from the Sinnoh video at 2s sampling).
- `backend/src/scripts/train-rejection-gate.ts` — trains the card-face gate:
  class-balanced logistic regression on the L2-normalized DINOv2 embedding,
  time-based train/val split, threshold table + recommendation.
- `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json` — trained
  gate artifact (384-d weights + bias + recommendedThreshold 0.45). Runtime
  cost: one dot product. Portable to web and iOS as-is.
- `backend/src/scripts/propose-video-ground-truth.ts` — dense full-res gated
  pipeline pass that groups confident identifications into draft ground-truth
  windows with per-window evidence frames (labeling tool, uses tfjs-node).
- `live-video-stream-scan.ts` new flags: `--gate <artifact>`,
  `--gate-threshold <x>`, `--full-res-crops`.
- `eval-video-stream.ts` new flag: `--tolerance-seconds <n>`.
- `docs/benchmarks/2026-07-01-sinnoh/` — the three eval reports above.

Reproduce the best run:

```bash
cd /Users/ahmadjalil/github/TCGer
# serve the YOLO model (any static server on 3003 works)
(cd frontend/public && python3 -m http.server 3003 &)

npm --prefix backend run scan:video-live-stream -- \
  --video "/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4" \
  --sample-seconds 10 \
  --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
  --full-res-crops \
  --out-dir /tmp/tcger-live-fullres

npm --prefix backend run eval:video-stream -- \
  --ground-truth /Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.v2.json \
  --results /tmp/tcger-live-fullres/live-stream-results.json \
  --exclude-tags jumbo --tolerance-seconds 5 \
  --out /tmp/tcger-live-fullres/eval-report.json
```

Gotchas found this session:

- npm scripts run with `backend/` as cwd; relative `--ground-truth` paths in
  the older examples below resolve wrong. Pass absolute paths.
- `@tensorflow/tfjs-node` breaks on Node >= 23 (`util.isNullOrUndefined`
  removed); offline tools shim it (see build-video-crop-dataset.ts). Never
  needed for runtime code.
- tcgdex names differ from card wording in places ("Castform Rain Form" vs
  "Castform Rainy Form") — ground truth uses `acceptedNames` for aliases.

Highest-leverage next steps — ALL SHIPPED later the same day (session 2):

1. DONE — full-res cropping in the browser scanner. `extractCardCrop` takes a
   `sourceScale`; `processYoloWithEmbedding` captures a 1920px copy of each
   frame at the same instant as the 640px detection frame and crops
   embedding/OCR inputs from it (`CROP_FRAME_SIZE`). The sharpness gate
   downsamples to 96px internally, so its calibration is unaffected.
2. DONE — rejection gate wired into web AND iOS.
   - Web: artifact served as `/scan-index/card-face-gate.json` (service worker
     already caches that path). `embedding-matcher.ts` exports
     `ensureCardFaceGate` (null on missing artifact or encoder/dimension
     mismatch → gating disabled, never rejects) + `scoreCardFaceGate`;
     enforced in `matchDetectionEmbedding` before top-K (skip label
     `yolo-nonface`, outline still shown).
   - iOS: `CardScanner/Embedding/CardFaceRejectionGate.swift` loads bundled
     `Resources/ScanIndex/CardFaceGate.json`; `BoardCardEmbeddingScannerStrategy`
     returns nil for gated crops. Simulator build green, artifact verified in
     the .app bundle.
   - NOTE: both runtime copies are gitignored (scan-index JSONs are generated
     artifacts). The tracked canonical file is
     `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json`; on a
     fresh checkout copy it to `frontend/public/scan-index/card-face-gate.json`
     and `mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/CardFaceGate.json`.
3. DONE — dense-sampling benchmark. `live-video-stream-scan.ts` gained
   `--native-backend` (tfjs-node, accuracy runs only). 3s sampling + full-res
   + gate on the Sinnoh video: coverage 85.5% → **98.7%** (75/76 windows),
   top-1 name 53.9%, per-observation precision 87.9% (91 committed). The new
   wrong labels are one-frame transition misreads; simulating the doc's
   temporal rule (same name ≥2 observations within 9s) on the same results
   gives **100% precision (50/50)**. At browser frame rates (~2-5 fps
   effective vs 0.33 here) the 2-frame rule costs almost no coverage — the
   offline 17% coverage under the vote is purely a sparse-sampling artifact.
   Report: `docs/benchmarks/2026-07-01-sinnoh/gated-fullres-3s.eval-v2-tol5.json`.
4. DONE — twin-print OCR: slash-less digit-run recovery. Real-video finding:
   Tesseract reads the Morpeko V footer as "0079202" (= 079/202 with the
   slash dropped), so the strict NNN/NNN pair rule abstained on every frame.
   New conservative fallback in `collector-ocr.ts` (`runs` on OcrReading +
   fusion), `eval-recognition.ts`, and iOS `CollectorNumberOCR.swift`
   (`readFooter`, `extractDigitRuns`, `runsConfirm`): a 5-8 digit run counts
   only if it is exactly `0-padded collector number + 2-3 digit denominator`
   for EXACTLY ONE distinct shortlist number (ambiguity → abstain). Validated
   on full-res Morpeko V crops: 4/6 frames resolve to the verified-correct
   swsh1-79, zero false promotions, noisy reads abstain
   (`eval-recognition.ts` metrics: ocrMatchedRate 0 → 0.5, exact-print top-1
   2/9 → 4/9 on that set).

Sampling-rate finding (user-driven, 2026-07-01 late): cards in this video are
on screen ~1.5-2.5s each during pack flips. At 2s sampling a card can land
entirely on its transition frames (Sinistea at ~203s was missed this way; a
0.5s rescan identifies it at 0.83 plus three more pack-1 cards every slower
pass missed: Fire Energy, Dubwool, Lucky Egg — all now in GT v2). Rule of
thumb: offline benchmarks of pack-opening content need >= 1 fps sampling; the
live browser scanner is busy-loop paced (~2-5 fps effective) and is not
affected. `--start-seconds/--end-seconds` on live-video-stream-scan.ts make
segment rescans cheap.

Miss taxonomy (from the scan-review sessions, 2026-07-01 late — every missed
card in the Sinnoh video falls into one of three classes):

1. Threshold-line misses — correct card IS top-1 but sits just under 0.72
   (Chinchou 0.715, energies/trainers 0.63-0.68). Recoverable: more frames,
   or the verified path (>=0.65 + OCR agreement).
2. Single-frame policy suppression — model right, smoothing hid it (Yamper,
   Sinistea, Metal Energy). Fixed by print-consensus confirmation (top-2
   candidates same name = self-confirming single frame); note an
   evolution-line neighbor as #2 (Swirlix/Slurpuff) defeats consensus.
3. Hard embedding failures — correct card not even in the top-20 shortlist,
   so OCR fusion cannot rescue it (Galarian Yamask swsh6-82: dark art +
   glare band → rank 46 @ 0.597 on a clean manual crop; index entry itself
   verified healthy). Only fixes: a glare-free frame, glare/dark
   augmentation at index build time, or a title-band OCR recognition path
   independent of the embedding.

Perspective rectification (2026-07-02, "what people do online" applied):

- `backend/src/scripts/card-rectify.ts` — pure-TS quad refinement + homography
  warp: Sobel edge scan per side -> RANSAC line fit (median rejection is NOT
  enough; fingers create contiguous outlier blocks) with 30-degree orientation
  constraint -> per-side detector-box fallback (max 1 side) -> DLT homography
  -> bilinear warp to a flat 480px card.
- Measured on the full Sinnoh video (1s sampling, GT v2 = 94 windows, tol 5):
  - plain full-res crops:        275 committed, 93.8% precision, 85/91 windows
  - BLANKET rectification:       252 committed, 91.7%, 81/91 — NET NEGATIVE
    (warping already-good crops shifts sims; a holo Slowking started misreading)
  - RESCUE CASCADE (`--rectify`): 287 committed, 93.0%, **87/91 windows,
    zero windows lost** — plain crop first, warp only when top-1 fails the
    threshold, keep whichever scores higher (65 rescues fired).
- Contrast standardization measured HARMFUL for the embedding path
  (normalise/CLAHE moved a hard case from rank 46 to rank 278-313; catalog
  ranks unchanged on good crops). Keep contrast ops OCR-only.
- Title-band OCR feasibility PROVEN for the dark-art class: Tesseract reads
  "Basic, Galarian Yamask w60" verbatim off the rectified crop's title band.
  The embedding-independent title fallback is the remaining rescue to build.
- Still missed at 1 fps after cascade (4/91): Chinchou (0.70-0.72 line),
  Energy Retrieval (0.69), Galarian Yamask (dark+glare, rank ~1 after rectify
  but ~0.61), Slowking-recap (fast flipping). All are title-OCR-rescuable.

Technique survey round 2 (2026-07-02, user-driven):

- Statistical acceptance (Magic Card Detector's 4-sigma rule) — TESTED, does
  NOT transfer to DINOv2 cosine distributions: z-scores of junk (2.5-2.8) and
  wrong matches (2.75) interleave with good matches (2.6-3.5). Fixed
  threshold + gate stays. (z/margin could still be gate-v2 features.)
- Track-level embedding averaging — TESTED offline, strong WHEN fused with
  rectification and track purity: Energy Retrieval rank 23 -> 1, Morpeko V
  rank 239 -> 2 (twin print), Spheal +0.055. Does not fix all-frames-glared
  (Yamask) or mixed-card windows. PORTED TO BROWSER: `EmbeddingTrackAverager`
  in use-video-scan-processor.ts (spatial-bucket tracks like the OCR voters,
  sliding window 5, mean-normalized query once >=2 frames) + the rescue
  cascade via `frontend/src/lib/scan/card-rectify.ts` (copy of the backend
  module — keep in sync). Production build passes. The offline harness
  remains per-frame (no tracker), so browser recall should now EXCEED the
  benchmark numbers.
- Still on the shelf, in rough priority: art-crop fallback index (occluded
  cards; Magic detector future-work + our old artwork pipeline), ArcFace-style
  fine-tuned embedding (Ximilar's approach — GT v2 + crop dataset now provide
  the training data), rotation TTA in the cascade (for upside-down cards in
  live use), alpha-QE query expansion (margin-gate it: blurs twins).

Title-band OCR fallback (2026-07-02) — **100% window coverage reached**:

- `backend/src/scripts/title-ocr.ts` + `--title-ocr` on the harness: when the
  cascade still fails on a gate-approved card face, OCR the title band
  (top 2-12% of the rectified/plain crop, 3x upscale), match the longest
  index card name contained verbatim in the collapsed text, then let the
  embedding pick the PRINT within that name's entries (restricted re-rank —
  reliable even when the global rank is not; sanity floor 0.45).
- Full Sinnoh video (1s, GT v2 = 94 windows): **91/91 scored windows
  identified (100%)**, up from 87/91 with the cascade alone; the 4 gains are
  exactly the prior misses (Chinchou, Energy Retrieval, Galarian Yamask,
  Slowking-recap), 14 title-OCR observations, zero windows lost. Report:
  `docs/benchmarks/2026-07-02-sinnoh-rectify/full-1s-titleocr.eval-v2-tol5.json`.
- PITFALL FIXED: Stage-1/2 cards print "Evolves from <pre-evolution>" under
  the title; when OCR reads that line but misses the stylized title, the
  pre-evolution matches (observed: Slurpuff -> "Swirlix" x3). matchTitleText
  strips `evolvesfrom<name>` before matching.
- GOTCHA: terminate the Tesseract worker (`terminateTitleWorker`) or the
  Node process never exits.
- NOT yet in the browser: title-OCR port needs a letters-whitelist Tesseract
  worker beside the digits one in collector-ocr.ts, plus the name index
  (entries are already client-side). Basic-energy cards have no collector
  number AND single-word names shorter than the 6-char floor ("Fire Energy"
  passes; bare "Potion" would not) — keep the floor, it is the false-positive
  guard.

Remaining follow-ups:

- Real-camera validation on a physical iPhone (still never done — no device).
- Web/iOS preprocessing parity (resize-256+crop vs resize-224) is still the
  known top-1 gap on iOS; see earlier session notes.
- Grow the crop dataset + retrain the gate on new eval videos (one command
  each: build-video-crop-dataset.ts → train-rejection-gate.ts). If the
  embedding model ever changes, the gate MUST be retrained (loaders check
  model/dimension and disable gating on mismatch).
- Browser track layer already accumulates per-track evidence; consider making
  the 2-frame same-name agreement an explicit surfacing rule in
  `video-scan-tracks.ts` to match the measured 100%-precision policy.

## Purpose

This document is for an AI agent or engineer building, replacing, or testing
TCGer card-scanning models. It explains the current scanner shape, where card
metadata comes from, how to run video/live-scan evaluations, and the constraints
that matter for web and iOS.

The goal is not just to identify one clean card image. The goal is live scanning:
detect card-like objects in video frames, reject non-card crops, recognize real
card faces conservatively, and only surface a card label after enough temporal
evidence.

## Current Diagnosis

The embedding model is not the main runtime bottleneck. The main risks are:

- YOLO runtime selection on web. A CPU fallback is too slow for live scanning.
- Open-set recognition. Packs, backs, tins, hands, backgrounds, and bad crops
  must not be forced to the nearest card.
- Confidence calibration. Margin-only acceptance causes false labels.
- Temporal instability. One-frame guesses should not be shown as final labels.
- iOS parity. The iOS scanner should stay native SwiftUI/CoreML/Vision, not a
  WebView wrapper.

The desired behavior is:

- high-confidence cards get names
- weak detections show "card detected"
- bad/non-card crops are rejected
- labels require repeated agreement across frames

## Key Repositories And Services

Main app repository:

- `/Users/ahmadjalil/github/TCGer`

Infrastructure/GitOps repository:

- `/Users/ahmadjalil/github/personalprox`

The production-like cluster card library is defined in personalprox:

- `/Users/ahmadjalil/github/personalprox/k8s/tcger/caches.yaml`
- `/Users/ahmadjalil/github/personalprox/k8s/tcger/backend.yaml`
- service: `tcger-tcgdex`
- namespace: `tcger`
- internal service URL: `http://tcger-tcgdex:4040`

The backend is configured to use that library:

```text
POKEMON_API_BASE_URL=http://tcger-tcgdex:4040
TCGDEX_API_BASE_URL=http://tcger-tcgdex:4040
```

External/backend route from the LAN:

```bash
curl 'http://tcger.k8s.home/api/cards/search?query=Pikachu&tcg=pokemon'
```

Direct cache debug route with port-forward:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  port-forward -n tcger svc/tcger-tcgdex 14040:4040

curl 'http://127.0.0.1:14040/health'
curl 'http://127.0.0.1:14040/cards?q=turtwig&page=1&pageSize=3'
```

Known cache state from the last check:

- `tcger-tcgdex` was healthy
- it had `23,315` Pokemon cards
- backend `/api/cards/search` worked with a normal timeout

Important caveat: backend search responses may contain image URLs like
`http://tcger-tcgdex:4040/images/...`. That hostname is valid inside the
cluster, not in a normal browser outside the cluster. Browser-facing image URLs
need a proxy or rewrite.

## Scanner Architecture

The intended scanner pipeline is:

1. Detect card candidates.
2. Crop and rectify each card candidate.
3. Reject non-card/card-back/bad crops before recognition.
4. Embed or fingerprint the crop and retrieve a top-K shortlist.
5. OCR title/footer regions as verification and reranking signals.
6. Track detections over time.
7. Surface a final card label only after stable evidence.

Relevant web files:

- `/Users/ahmadjalil/github/TCGer/frontend/src/lib/scan/yolo-detector.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/lib/scan/embedding-matcher.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/use-video-scan-processor.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/video-scan-tracks.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/video-scan-lab.tsx`

Relevant backend/eval files:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/live-video-stream-scan.ts`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/eval-video-stream.ts`
- `/Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json`

Relevant iOS files:

- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/CardScanner/Embedding/CardEmbeddingEncoder.swift`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/README.md`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/scripts/convert-dinov2-coreml.py`

## Current Model Assets

Web YOLO model:

- `/Users/ahmadjalil/github/TCGer/frontend/public/models/yolo-card-detector/model.json`
- shard files in the same directory

Web Pokemon embedding index:

- `/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/pokemon-embeddings.json`
- manifest: `/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/manifest.json`

iOS model/index resources:

- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/`

Backend embedding/export scripts:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/build-embedding-index.ts`
- `/Users/ahmadjalil/github/TCGer/backend/scripts/export-external-embedding-assets.py`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/benchmark-embeddings.ts`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/build-ios-index.ts`

## Recognition Policy

Use conservative open-set behavior. Do not force every crop to a card.

Recommended defaults:

- raw embedding label requires similarity around `0.70-0.72`
- similarity around `0.65` should only be used with OCR or temporal
  confirmation
- do not accept a card because margin alone is high
- use top-K internally, usually `20` or more
- show "card detected" when below recognition threshold
- require the same card/name across `2-3` good frames before showing a final
  label

Non-card examples that must not receive card names:

- sealed packs
- card backs
- tins
- hands
- playmats
- transition frames
- heavily blurred crops
- partial crops with no readable face

## Web Runtime Rules

For browser live scanning, backend choice matters more than embedding math.

Preferred TF.js backend order:

```text
WebGPU -> WebGL -> WASM -> CPU
```

Rules:

- log the selected backend
- treat CPU as dev-only/non-live
- avoid synchronous tensor reads such as `dataSync()`
- prefer async `data()`
- run heavy scanning on a fixed detector cadence, not every animation frame
- use `requestVideoFrameCallback` where practical
- move expensive work to a Worker with OffscreenCanvas/ImageBitmap when the UI
  starts janking

If a benchmark says YOLO is several seconds per frame, first check whether it is
using a CPU backend. A Node script using plain `@tensorflow/tfjs` is not a fair
browser WebGPU/WebGL benchmark.

## iOS Runtime Rules

iOS should remain native:

- SwiftUI UI
- CoreML embedding encoder
- Vision rectangle/document detection and OCR
- Accelerate/vectorized lookup where needed

Do not wrap the web scanner in a production WebView.

Critical parity rule:

- the model preprocessing used to build the index must match runtime
  preprocessing exactly
- for DINOv2-style models, the current expectation is shortest-edge resize to
  `256`, then center crop to the model input size

Use Vision rectangle/document detection first. Only export YOLO to CoreML if
real phone captures show Vision crop recall is bad.

## Evaluation Video

Primary test video:

```text
/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4
```

Ground truth:

```text
/Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json
```

This video includes non-card objects and transition states. That is useful. The
scanner should not score well by guessing card names for everything.

## Live-Stream Benchmark

Run from the repo root or backend directory.

Example full live-stream scan:

```bash
cd /Users/ahmadjalil/github/TCGer

npm --prefix backend run scan:video-live-stream -- \
  --video "/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4" \
  --sample-seconds 10 \
  --out-dir /tmp/tcger-live-video-full-10s
```

Then evaluate:

```bash
npm --prefix backend run eval:video-stream -- \
  --ground-truth backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json \
  --results /tmp/tcger-live-video-full-10s/live-stream-results.json \
  --exclude-tags jumbo \
  --out /tmp/tcger-live-video-full-10s/eval-report.json
```

Useful evaluator options:

```bash
npm --prefix backend run eval:video-stream -- --help
```

Use `--include-proposals` only when intentionally scoring every proposal. The
default is best-observation scoring, which better matches what the UI should
surface per frame.

## What To Measure

Do not optimize only top-1 accuracy. A useful scanner needs these metrics:

- top-1 name hit rate
- top-1 externalId hit rate
- top-K candidate recall
- false-positive observation count
- covered ground-truth windows
- confident-frame rate
- latency per detector frame
- latency per embedding crop
- selected web runtime backend
- number of frames skipped due to processing backpressure

For model development, prioritize:

- false positive reduction first
- top-K recall second
- top-1 reranking third
- raw FPS only after the pipeline is conservative

## Model Development Contract

A new recognition model should provide:

- deterministic image preprocessing
- documented input size and normalization
- an encoder usable on web and iOS
- an index builder using the exact same preprocessing
- top-K retrieval output with scores
- calibration data for thresholds
- a failure mode report, especially for packs/backs/bad crops

Minimum artifact set:

```text
model metadata
web model artifact
iOS/CoreML model artifact if applicable
reference vector/index file
metadata mapping vector row -> card externalId/name/set/collector number
benchmark report against the Sinnoh video
threshold recommendation
```

If preprocessing changes, rebuild the entire reference index. Do not compare
new runtime embeddings against an old index.

## OCR And Reranking

Embedding should produce a shortlist, not final truth.

Use OCR as verification:

- title band for visible names
- footer/collector number for exact print identity
- denominator/set code where readable
- temporal OCR votes per tracked card, not one global OCR vote bucket

Expected behavior:

- OCR agreement can allow lower embedding similarity
- OCR disagreement should down-rank a candidate
- absence of OCR should not force rejection if embedding is strong and stable
- OCR from one detection should not influence a different spatial track

## Card-Face Rejection

Add or improve a card-face rejection stage before embedding. It can be a small
classifier, heuristic gate, or both.

Signals to consider:

- visible title/text band
- border/card aspect sanity
- artwork/text layout consistency
- card-back color/layout detection
- pack/sealed-product rejection
- blur/sharpness threshold
- crop coverage and occlusion estimate

YOLO confidence alone is not enough because non-card or non-face objects can
still be detected with high confidence.

## Existing Local/Cluster Commands

Check cluster TCGer resources:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  get pods,svc,ingress -n tcger -o wide
```

Check backend health:

```bash
curl http://tcger.k8s.home/api/health
```

Check Pokemon search through backend:

```bash
curl 'http://tcger.k8s.home/api/cards/search?query=Pikachu&tcg=pokemon'
```

Check TCGdex cache directly:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  port-forward -n tcger svc/tcger-tcgdex 14040:4040

curl http://127.0.0.1:14040/health
```

Local frontend:

```bash
cd /Users/ahmadjalil/github/TCGer
npm run dev:frontend
```

Default local frontend URL:

```text
http://localhost:3003/scan
```

## Verification Commands

Frontend typecheck:

```bash
cd /Users/ahmadjalil/github/TCGer/frontend
npx tsc --noEmit --pretty false --incremental false
```

Backend focused script typecheck:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
npx tsc --noEmit \
  --target ES2021 \
  --module commonjs \
  --moduleResolution node \
  --esModuleInterop \
  --strict \
  --skipLibCheck \
  --types node \
  src/scripts/live-video-stream-scan.ts \
  src/scripts/eval-video-stream.ts
```

iOS static parse for edited scanner files:

```bash
cd /Users/ahmadjalil/github/TCGer
xcrun swiftc -parse \
  mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift \
  mobile-apps/ios/TCGer/TCGer/CardScanner/Embedding/CardEmbeddingEncoder.swift
```

Python conversion script syntax:

```bash
cd /Users/ahmadjalil/github/TCGer
python3 -m py_compile mobile-apps/ios/scripts/convert-dinov2-coreml.py
```

Whitespace check:

```bash
cd /Users/ahmadjalil/github/TCGer
git diff --check
```

## Known Pitfalls

- Do not trust Node TF.js CPU timings as browser live-scan timings.
- Do not accept labels from margin-only nearest-neighbor matching.
- Do not globally share OCR votes across unrelated detections.
- Do not evaluate only frames that contain clean front-facing cards.
- Do not compare embeddings built with one preprocessing pipeline against
  runtime embeddings from another.
- Do not use WebView-wrapped web scanning as the production iOS answer.
- Do not treat card search metadata as the same thing as scanner ground truth.
- Do not forget non-card negatives; open-set rejection is part of recognition.

## Immediate Useful Work

Best next tasks for a model/scanner AI:

1. Add a card-face/non-card rejection model or heuristic gate.
2. Run the Sinnoh live-stream benchmark after each threshold/model change.
3. Add more ground-truth windows and explicit negative windows.
4. Generate a crop dataset from the video with labels:
   - card face
   - card back
   - pack/sealed product
   - hand/background
   - blurry/transition
5. Benchmark DINOv2/CLIP or any new embedding model on top-K recall and false
   positives, not only top-1.
6. Improve OCR reranking with collector-number/footer verification.
7. Validate iOS preprocessing parity against web/index-builder outputs.

## Success Criteria

A change is genuinely useful when it improves live-scan behavior:

- fewer false card names on non-card objects
- fewer one-frame bad labels
- similar or better top-K recall on true visible cards
- no CPU-only web runtime regression
- no iOS/web preprocessing divergence
- evaluation report is saved and reproducible

Always leave behind the command, output directory, and threshold/model version
used for the benchmark.
