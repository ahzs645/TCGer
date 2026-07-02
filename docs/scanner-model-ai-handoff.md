# Scanner Model AI Handoff

Last updated: 2026-07-01

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
