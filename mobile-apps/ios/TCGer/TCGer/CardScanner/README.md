# On-device Embedding Scanner (Experimental)

This directory now contains the scaffolding for a third card recognition strategy that mirrors the "instance retrieval" pipeline outlined in the BG Snapshot article. The goal is to remove the dependency on server-powered OCR search by running three steps locally:

1. **Rectangle isolation** – `CardCropper` shares a Vision-powered rectangle detector plus a Core Image perspective normalizer so that every downstream strategy works with frames that look like the training distribution.
2. **Embedding inference** – `CardEmbeddingEncoder` is a thin wrapper around a Core ML encoder (for example a SimCLR/Barlow Twins tuned MobileNet). It expects a compiled model named `CardEmbeddings.mlmodelc` in the app bundle and returns the raw float vector produced by the model's `embedding` output.
3. **Approximate nearest-neighbor lookup** – `AnnoyIndexStore` (placeholder) and `CardIndexMetadataStore` represent the offline ANN index and the metadata table that maps ANN rows to `CardDetails`. Today the store reads JSON, but it is structured so you can drop in a SwiftAnnoy-backed memory-mapped `.ann` file without touching call sites.

The `BoardCardEmbeddingScannerStrategy` wires the three pieces together, exposes the `.mlDetector` `ScanStrategyKind`, and is registered in `CardScannerCoordinator.makeDefault()`. At runtime the flow is:

```
video frame -> CardCropper -> CardEmbeddingEncoder -> ANN lookup -> CardScanResult
```

## How to finish the pipeline

- **Train a model**: fine-tune a lightweight encoder (e.g., MobileNetV3, EfficientNet-Lite) with SimCLR/Barlow Twins/BOYL on your card catalog. Export the encoder head alone and compile it as `CardEmbeddings.mlmodelc` with an `image` input and `embedding` output.
- **Bake the index**: generate embeddings for every catalog item and build an Annoy (or Faiss/HNSW) index. Ship the `.ann` binary plus a compact metadata JSON (`CardsIndexMetadata.json`). Update `AnnoyIndexStore` to memory-map the ANN file and to return ids via `AnnoyIndex.getNNsForVector` instead of brute-force cosine distance.
- **Update metadata**: include enough context in each metadata entry (tcg, rarity, pricing seed) to build `CardDetails` without hitting the API, then optionally hydrate prices by calling the backend after a match is confirmed.
- **Tune heuristics**: `BoardCardEmbeddingScannerStrategy` currently transforms distances into confidence scores with a simple clamp. Feed device measurements back into this function and add multi-frame voting (store the top candidate for the last N frames and require agreement) before surfacing a result.

The scaffolding compiles on-device today even without the real assets, allowing you to iterate on the ML/index artifacts independently from the app code. Once the artifacts are ready, drop them into the app bundle (or download/cached them via `CacheManager`) and the scanner strategy will start returning results without blocking on network latency.

## Live pipeline mechanics (ported from The Tin, 2026-08-12)

Four mechanisms were ported from The Tin's scanner while keeping the
`ScanStrategy` protocol and coordinator dispatch unchanged. All of them were
validated against the full Reference replay matrix at the pre-port baselines
(2026-08-12: scene corpus 2,334/2,336 localized, mean IoU 0.928, 97.9%
IoU≥0.50, 18/50 accepted, 16 exact printings, 0 wrong accepts;
`DevModeSessionReplayTests` and `BinderSessionReplayTests` green against
`~/Downloads/Reference/TCGer-Session-Reference`).

### Frame back-pressure (`CardScannerCamera.swift`, `CardScannerViewModel.swift`)

`alwaysDiscardsLateVideoFrames` never engages when the capture delegate yields
and returns instantly — AVFoundation sees a delegate that is never late, so
the backlog lands wherever the frames go next. The camera therefore exposes
`makeFrameStream()`, an `AsyncStream<CVPixelBuffer>` with
`.bufferingNewest(1)`: the view model consumes it in ONE serial loop that
awaits each analysis, so while an analysis is in flight new frames collapse
into the single buffered slot instead of each allocating a `Task` and queueing
a main-actor hop. Dropped-frame telemetry is exposed via `droppedFrameCount`
(`captureOutput(_:didDrop:)`). `ScannerDebugView` consumes the same stream;
there is no `onSampleBuffer` callback anymore — do not reintroduce one.

### Idle frame rate (`ScannerCameraThrottle.swift`, `CardScannerCamera.setIdle`)

Scanning runs at 15 fps (the live pipeline analyzes at most 1 frame/s, so
30 fps only doubles the frames we throw away); an idle viewfinder drops to
2 fps. Only `activeVideoMinFrameDuration` is capped — never `max`, which
would also cap exposure time. The cap must be applied AFTER
`commitConfiguration` because setting a session preset resets frame
durations. Policy lives in `ScannerCameraThrottle` (pure, unit-tested):

- 8 consecutive card-free analyses (~8 s) → idle. Must stay above
  `LiveScanConsensus`'s 3 s match window so a mid-confirmation candidate can
  never idle the camera (`ScannerCameraThrottleTests` pins the invariant).
- A presented result sheet / binder review idles immediately AND pins the
  empty streak at zero, so dismissal returns to 15 fps on the very next frame.
- "Card-free" is decided by a ~5 ms `VNDetectDocumentSegmentationRequest`
  presence check when a live analysis returns no match — an unrecognized card
  held by an actively trying user keeps the full rate.
- Manual-trigger and binder framing keep 15 fps (the user is composing a
  shot); their frames are discarded by cheap guards in the consumer loop.

### Footer-OCR cache (`BoardCardEmbeddingScannerStrategy.swift`)

A steady card re-read the same footer through an `.accurate` Vision text
request every second. The strategy now keeps a single-slot cache of the last
footer reading, reused only when the new crop's embedding is within cosine
0.97 of the cached crop's and the reading is under 3 s old, and only for
`.livePreview` (intentional captures always read fresh; every source seeds
the slot). The bar is deliberately strict: two different cards this close are
near twins, and twins are exactly where a stale footer reading could confirm
the wrong printing. A cache hit short-circuits the Vision request only —
every downstream confirmation rule runs unchanged.

### Persistent staging tray (`ScannerStagingStore.swift`)

The session tray used to die with the view model (sheet dismissal, let alone
relaunch). `ScannerStagingStore` is an actor persisting each staged scan to
`Application Support/ScannerStaging/` as one record in `staged-scans.json`
(atomic full rewrite per mutation) plus a JPEG sidecar for the captured
image. The view model restores on init and persists on append / remove /
clear / candidate correction / mark-added. Rules worth keeping:

- New manifest fields must be optional (or defaulted): the file is one JSON
  document and a single unreadable field would fail the whole tray.
- 100-scan cap mirrors the in-memory session; oldest records and their
  sidecars are dropped together.
- `sourceCard` (full catalog `Card`) is persisted so a restored tray keeps
  the lossless add-to-binder path.
- Binder pages are deliberately NOT persisted (full-resolution, session-only).
