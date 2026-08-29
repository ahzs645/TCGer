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

### Idle throttling (`ScannerCameraThrottle.swift`, `CardScannerCamera.setIdle`)

The preview layer renders straight from the capture device, so a device-level
frame-rate cap shows up on screen — as a choppy viewfinder while capped, and
as a visible freeze/exposure-ramp during every sheet transition when toggled
(both were shipped and reverted; don't reintroduce a device cap). The sensor
always runs at its native rate; throttling happens on the delivery side —
`captureOutput` drops frames on the video queue before they reach the
analysis stream (15 yields/s scanning, 2/s idle or while a result sheet /
binder review covers the preview). The overlay state is pushed event-driven
from the view model's overlay `didSet`s so delivery resumes the instant a
sheet dismisses. Policy lives in `ScannerCameraThrottle` (pure, unit-tested):

- 8 consecutive card-free analyses (~8 s) → idle delivery. Must stay above
  `LiveScanConsensus`'s 3 s match window so a mid-confirmation candidate can
  never throttle analysis (`ScannerCameraThrottleTests` pins the invariant).
- A presented result sheet / binder review idles immediately AND pins the
  empty streak at zero, so dismissal returns to full delivery on the very
  next frame.
- "Card-free" is decided by a ~5 ms `VNDetectDocumentSegmentationRequest`
  presence check when a live analysis returns no match — an unrecognized card
  held by an actively trying user keeps the full analysis rate.
- Manual-trigger and binder framing modes process nothing (cheap guards in
  the consumer loop) while the preview stays native-smooth for composing.
- Restored staging-tray images are force-decoded as downsampled thumbnails on
  the store actor (`kCGImageSourceShouldCacheImmediately`); a lazily
  JPEG-backed `CGImage` would decode on the main thread at first draw and
  stutter the scanner's first seconds on screen.

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

## Scan-latency assessment + experimental speed options (2026-08-21)

### Where the time went

Measured from 407 recorded dev-mode frames (`elapsedMs` in the
TCGer-Session-Reference corpus) plus a read of the pipeline:

- Live preview frames: ~190–250 ms median. Single-card shutter captures:
  ~300 ms median but a 2–3.4 s tail that tracks the number of crop attempts
  (2 attempts ≈ 320 ms, 8–9 attempts ≈ 1.5–1.8 s). Binder pages: 1.3–2.8 s
  median, 6.3 s max, scaling with detections (worst when many pockets go
  unmatched, since each unmatched pocket runs the full rescue).
- Structural causes, in impact order:
  1. `AnnoyIndexStore` was a brute-force scalar-Swift Double cosine loop over
     all 21,828×384 vectors per query, serialized behind an actor (binder
     pocket concurrency queued on it).
  2. `CardIndexMetadataStore.physicalCardIndices` re-filtered all ~22k
     entries and rebuilt a `Set` on every crop-attempt recognition.
  3. Intentional captures embedded every crop hypothesis up front — up to 3
     crops × 2 orientations = 6 encoder inferences — before the first
     recognition could accept, so a clean accept still paid for all six.
  4. The 0°/180° orientation pair ran as two serial Core ML requests.
  5. (Suspected OCR overhead was already mitigated: both title and
     collector-number OCR crop to strips before the `.accurate` Vision pass.)

### The four options (`ScannerPerfOptions.swift`)

All DEFAULT OFF; each reads env `SCANNER_PERF_*` (drive tests via
`TEST_RUNNER_` passthrough) then a `UserDefaults` key, checked at call time.
User-facing toggles live in the Scanner Options popover ("Speed
(Experimental)" section, `ScannerSessionControls.swift`).

1. `scannerPerfVectorizedANN` — one vDSP matrix-vector product over a flat
   buffer ranks candidates, then the top-(limit+8) shortlist is re-ranked
   with the legacy scalar Double cosine so returned distances are
   bit-identical to the old path. The exact re-rank is deliberate: accepted
   results sit exactly at the 0.72 threshold in the replay corpus, and Float
   drift must not flip a policy decision. Do not remove it.
2. `scannerPerfAllowedIndexCache` — memoizes `physicalCardIndices` per
   (game, setCode); safe because the metadata cache is immutable after load.
3. `scannerPerfStagedHypotheses` — builds crop candidates without embeddings
   and evaluates them in fixed priority order (baseline detected crop →
   alternate box → whole frame → raw fallback), embedding each only after
   every earlier one abstained. Trades away the legacy gate-score-sorted
   hypothesis order; replay-validated below.
4. `scannerPerfBatchedOrientation` — both orientations of one crop through a
   single Core ML batch prediction (`predictions(fromBatch:)`).

### Measured results (Simulator, Debug, CPU-only Core ML — relative numbers)

16 recorded single-card shutter captures, one warm coordinator, per-config
warmup (`ScannerPerfOptionsBenchmarkTests`, needs
`TEST_RUNNER_DEVMODE_SESSIONS_DIR`):

| config              | median | p90     | total  |
|---------------------|--------|---------|--------|
| baseline (all off)  | 8422ms | 10716ms | 122.9s |
| vectorizedANN       | 4886ms |  6095ms |  64.4s |
| allowedIndexCache   | 8010ms | 10400ms | 116.9s |
| stagedHypotheses    | 5177ms | 10178ms |  96.1s |
| batchedOrientation  | 8163ms | 10545ms | 118.8s |
| all on              | 2806ms |  5786ms |  49.1s |

Zero outcome drift for every config in-benchmark. Device (Release + ANE)
ratios will differ — batched orientation in particular should gain more on
ANE than the CPU simulator shows. Device numbers not yet measured.

### Accuracy validation

- `ScannerPerfOptionsTests`: vectorized-vs-scalar ANN ranking parity
  (including ragged rows, dimension mismatch, zero query → infinite
  distances), memo parity, batch-vs-serial embedding parity, and an
  end-to-end fixture parity scan with everything on.
- Full 287-frame `DevModeSessionReplayTests` run flags-off vs flags-on:
  identical summaries (31/76 labeled correct). Nine frames differ, all
  favorably: seven accept the same card at a higher score because staged
  order answers from the tight detected crop instead of the whole frame
  (e.g. 0.64→0.78), one stays accepted at 0.95→0.91, and two frames in the
  2026-08-13 18:37 session stop falling into the `ecard3-146` whole-frame
  junk attractor — one of them recovering the exact device-recorded answer
  (me05-033 @0.92) that the legacy order flips on the Simulator.

### Pre-existing replay failures on main (NOT from this work)

With all flags off, the replay suite already fails on this corpus:
`scan-session-20260809-210958/frame-0008.jpg` wrong-accepts pop5-10 @0.72
(expected pl4-AR3), and three frames of `scan-session-20260818-144857` lost
their device-accepted me05-059. The bundled ANN index was regenerated
2026-08-15, after the last green replay validation — prime suspect. Triage
tracked separately.

### First device evidence (scan-session-20260821-211659)

A device session recorded with the options toggled between captures (ingested
into TCGer-Session-Reference) works as a natural A/B — attempt traces identify
the pipeline order per frame (a whole-frame attempt before the detected crop
proves legacy order):

- Staged accepted scans: 91–418 ms, median 322 ms (11 frames).
- Same-subject pairs: single card col1-63 legacy 583 ms vs staged 418/322 ms;
  one binder page captured three times — legacy 1,595 ms (3/4 pockets matched)
  vs staged 907/946 ms (the 946 ms capture matched 4/4).
- First scan of the session: 3,262 ms (lazy model/index loads; an identical
  warm capture took 258 ms).
- No-match frames: 151–856 ms, median 488 ms — the biggest remaining cost;
  each runs the full retry ladder (4–6 embeddings) plus `.accurate` Vision
  title/footer OCR per attempt.

Follow-ups shipped 2026-08-21 (same flag pattern):

- `scannerPerfWarmStart` ("Preload Scanner Models" toggle): the coordinator
  pre-warms detector/Vision first-use, the embedding model including its ANE
  compilation (triggered by a prediction, not the model load), the ANN index,
  and catalog metadata in a detached task at scanner init.
- Per-stage timings now record into dev-mode evidence: each attempt carries
  `embedMs` / `annMs` / `titleOCRMs` / `footerOCRMs`, and frames carry a
  `stageTimingsMs` map (currently `detect`). All fields are optional, so
  older recordings decode unchanged. The next device session can therefore
  split the no-match median into model vs retrieval vs OCR before anyone
  optimizes the wrong stage. Candidates waiting on that data: concurrent
  0°/180° evaluation, per-frame OCR reuse across attempts, and skipping the
  180° pass on confidently non-card upright gates — each changes
  accept/abstain behavior, so each needs the replay treatment first.

### Defaults flip + capture-path round (2026-08-21 evening)

The validated options are now ON by default (`ScannerPerfOptions` returns the
default when no explicit UserDefaults value exists; an explicit off sticks).
The Speed section in the Scanner Options popover only renders with Scanner
Debug enabled — regular users get the defaults with no dials. Two additions,
same pattern:

- `scannerPerfConcurrentOrientations` (default ON): the 0°/180° pair of one
  hypothesis is embedded and recognized concurrently. Both orientations still
  always run and arbitrate afterwards, so outcomes are order-independent —
  verified empirically: the full replay under the new defaults reproduced
  every previously-replayed frame identically (zero changed outcomes; same
  31/76 summary). Benchmark: −42% median alone; all-on median 7.8 s → 2.2 s
  on the 16-frame corpus (Simulator ratios).
- `scannerPerfFastCapture` (default ON): `.balanced` photo prioritization and
  a still capped near the pipeline's 2048 px decode target, instead of
  `.quality` multi-frame fusion at full sensor resolution — 300–1200 ms of
  post-shutter processing for pixels the decode path then discarded. The
  sensor-native rationale for binder OCR was already defeated by the 2048 px
  downsample in `makeCGImage`.

Capture-path fixes from the latency audit (no flags — pure scheduling):

- The captured still's HEIF encode + decode + downsample now runs off the
  main actor (`decodeCapturedPhoto`); it was freezing the preview 100–500 ms
  per shutter press.
- The capture-quality pass (its own Vision detection) runs concurrently with
  recognition instead of serially before it.
- `ArtworkFingerprintScannerStrategy` joins `warmUp()`: its 53 MB fingerprint
  JSON otherwise parsed lazily inside the first no-match scan while holding
  the same lock `supports(_:)` takes from SwiftUI body evaluation.

Audit backlog (larger, replay-gated, in impact order): fast-first footer OCR
with `.accurate` fallback and strip `minimumTextHeight` retuning instead of
2–4x upscales (Vision serializes text requests globally, so parallel OCR is
NOT an option — reorder/reduce instead); one shared crop localization passed
down the strategy chain (currently re-detected up to 4x per no-match);
`ArtworkFingerprintMatcher` flat-buffer treatment; binder pre-phase
parallelization (18 serial refinedQuad calls before the pocket task group);
gating the 450 ms live quality pass off manual-shutter mode; pinning video
output dimensions.

Test-isolation note: `CardScannerCoordinatorTests` now purges
`ScannerStagingStore.shared` in `setUp` — the tray persists in the app
container across view models, tests, and test runs on a reused simulator,
and restore/append timing races previously decided whether earlier tests'
staged scans leaked into later assertions. Separately, a reused simulator
can serve a stale app install after `build-for-testing` (symptom: bundled
resources suddenly "missing", suites finishing implausibly fast) — erase the
sim and rerun before believing such failures.

### Device stage profile (scan-session-20260821-231419, defaults build)

First device session on the instrumented defaults build (ingested; 42
frames). The new per-stage fields confirm the Simulator profile on real
hardware — and that the capture round worked: accepted scans now run 87–484
ms (median 232 ms, was 322) with no cold-start spike.

- Accepted (mean 252 ms): footerOCR 36% + titleOCR 31% of wall, ann 23%,
  detect 15%, embed 7%.
- No-match (mean 456 ms): titleOCR 44% + footerOCR 25%, ann 33%, embed 8%.
- Binder (mean 1,030 ms): ann 79% (!) — that figure is dominated by actor
  QUEUE WAITS, not compute: `annMs` wraps the `await` on the index actor,
  and concurrent pockets/orientations serialize on it. The vectorized scan
  itself is sub-millisecond.

Conclusions: OCR is ~2/3 of scan time on device — the fast-first footer
read + `minimumTextHeight` retune + pass-reorder round is the next lever.
Encoder retraining is definitively NOT a speed play at 7% embed share (it
remains an accuracy play — ArcFace-on-catalog per TCG-AR). And the index
actor's serialization is now worth removing (immutable post-load snapshot
so queries stop hopping the actor), which mostly benefits binder pages.

### OCR round + retrain scaffolding (2026-08-22)

Three OCR options attacked the device profile's ~⅔-of-wall OCR share; the
full-corpus replay gate did its job and shaped what shipped:

- `scannerPerfFastFooterOCR` (default ON): `.fast` recognition for the
  collector-number strip; a reading with no pairs/promos (bare digit runs
  are the noisy class) falls back to `.accurate`, and a conclusive fast
  reading that then fails to confirm any shortlist candidate gets one
  `.accurate` rescue read inside the strategy. That confirmation-driven
  rescue exists because a garbled-but-plausible fast pair otherwise
  suppressed the fallback and silently cost an OCR-rescued accept
  (measured). Replay: identical to baseline. Sim benchmark: −20% median.
- `scannerPerfFooterFirstOCR` (default ON): when OCR evidence is needed,
  the footer is read before the title, the title pass is skipped entirely
  once the collector number confirms, and a title constraint re-matches the
  cached reading instead of re-reading. Replay: identical to baseline (one
  frame same-card at a higher score).
- `scannerPerfLeanOCRStrips` (default ON, scoped): the initial variant (lean
  strips for BOTH readers' all passes) failed the gate hard — 29/76 labeled
  and five OCR-rescued accepts lost, because `.accurate` on a 1x strip at a
  raised `minimumTextHeight` misses footers the 4x upscale reads. Re-scoped
  to the fast footer pass only (accurate always keeps its upscale), the
  replay came back byte-identical to baseline.

Gate mechanics lesson recorded the hard way: the 16-frame benchmark showed
the trio "clean" while the 287+-frame replay exposed the losses — never
default an OCR change on benchmark evidence alone. Also: re-baseline the
replay after ingesting new sessions before attributing losses to a change
(two "new" losses were pre-existing frames of a freshly ingested session).

Retrain scaffolding (accuracy play, runs on Colab):

- `mobile-apps/ios/scripts/train-arcface-encoder-colab.ipynb` — ArcFace
  classification-as-retrieval student (FastViT-T8, 384-d, TCG-AR recipe)
  with the exact iOS preprocessing contract; exports a drop-in
  `CardEmbeddings-arcface.mlpackage` + `CardsIndexVectors-arcface.bin` to
  `MyDrive/TCGer-encoder/` and documents the local A/B procedure (worktree,
  delete `CardFaceGate.json`, run fixtures + replay against the shipped
  encoder's baseline).
- `mobile-apps/ios/scripts/train-card-detector-colab.ipynb` — the YOLO11s
  detector notebook, finally committed from Drive (`Untitled2.ipynb`).
- Inputs staged on Drive: `TCGer-encoder/CardsIndexMetadata.json` (repo
  copy; defines annIndex order) and the current DINOv2 bin for comparison.

## Dual-encoder recognition (2026-08-23): ArcFace default, DINOv2 rollback

> Cross-platform note: iOS and web are one recognition stack with two
> runtimes — the iOS index is converted from the same artifact the web
> serves, and the web currently still runs the DINOv2 generation. The
> plan to bring the web onto ArcFace (and give it the replay-gate +
> variant machinery below) is `docs/scanner-convergence.md` at repo root.

The scanner now ships TWO embedding encoders; `ScannerEncoderVariant`
selects one as an ATOMIC bundle of model + index + thresholds + gate:

| | `.arcface` (DEFAULT) | `.dinov2` (rollback) |
|---|---|---|
| Model | `CardEmbeddings-arcface.mlpackage` (FastViT-T8, 6.9 MB) | `CardEmbeddings.mlpackage` (dinov2-small, 44 MB) |
| Index | `CardsIndexVectors-arcface.bin` | `CardsIndexVectors.bin` |
| Strong accept / ambiguity | 0.65 / 0.05 | 0.72 / 0.02 |
| Rejection gate | none (gate is DINOv2-trained) | `CardFaceGate.json` |
| Replay corpus (76 labeled) | **46 correct, 0 wrong accepts** | 31 correct, 1 wrong accept |

Never mix pieces across variants: an index embeds the catalog in one
encoder's space, thresholds are operating points on one encoder's score
distribution, and the gate is a classifier over one encoder's embeddings.

Switching: Scanner Debug → Scanner Options → Encoder → "Recognition
Model" picker (applies on next scanner open), or `SCANNER_ENCODER=dinov2`
via `TEST_RUNNER_` for harness runs. Threshold env overrides
(`SCANNER_STRONG_ACCEPT`, `SCANNER_AMBIGUITY_MARGIN`) still win over the
variant for sweeps.

Known ArcFace gaps, each tracked in test allowlists so a NEW regression
still fails:

- 9 device-accepted frames it abstains on
  (`DevModeSessionReplayTests.knownArcFaceEncoderLosses`; 4 of the 9 are
  the swshp-SWSH204 promo — a class-level miss worth investigating in the
  index/image for that card).
- The boss-clean fixture retrieves Morty's Conviction instead of Boss's
  Orders (`knownFailingEncoders` in ScannerFixtures.json).
- In exchange it recovers base1-56 and two me05-059 frames DINOv2 loses,
  and kills the pop5-10 wrong accept.

### How the ArcFace encoder was trained (recipe + every lesson)

Trainer: `mobile-apps/ios/scripts/train_arcface_encoder.py` (headless, for
the Colab CLI) / `train-arcface-encoder-colab.ipynb` (Drive notebook).
Recipe (per TCG-AR, arXiv 2607.02090, adapted): one class per catalog card
(21,828), ArcFace s=16 m=0.5, FastViT-T8 student, 384-d output matching
the shipped index format, heavy synthetic augs (perspective 0.35, bright/
color/contrast jitter, blur, noise), 12 epochs ≈ 2 h on an L4. Catalog
self-retrieval: recall@1 97.9%. The preprocessing contract (shortest-edge
256 bicubic ceil → center-crop 224 → ImageNet norm, /255 + normalize baked
into the Core ML graph) is IDENTICAL to the DINOv2 conversion, so the Swift
side needed zero changes.

Hard-won convergence lessons (three failed runs before the good one):

1. **s=30 never lifts off under AdamW** — logit scale 30 saturates softmax
   and kills the gradient; every failed run used it, every successful probe
   used s=16. (TCG-AR's s=30 worked with ResNet-50/SGD dynamics.)
2. **21.8k classes need ~300+ margin-free steps before liftoff** — a margin
   ramp starting at epoch 1 froze training at chance; margin-free through
   epoch 3, ramp to 0.5 by epoch 8.
3. Head/proj LR 3x backbone (10x thrashes; 1x is too slow to observe).
4. Heavy augmentations were exonerated (99% acc at 2k classes) — don't
   soften them; they carry the capture-robustness burden.
5. Debug at small scale first: a 200-class memorize probe (100% in 20
   steps) proved the pipeline wired correctly; a 2k-class aug A/B and a
   full-class 400-step probe isolated scale effects. Probes live in
   `mobile-apps/ios/scripts/{memorize_test,aug_experiment}.py`.
6. Epoch-average metrics HIDE liftoff — the trainer reports per-100-step
   windows to status.json for a reason.

Operational lessons for Colab CLI runs (`uv tool install google-colab-cli`
+ pin `jupyter-kernel-client==0.15.0`; ADC auth with the four scopes):

- Run training as a DETACHED VM SUBPROCESS (`subprocess.Popen` of an
  uploaded script, stdout to a file), never as a notebook cell — the CLI's
  streaming client times out on quiet phases and kernel-context DataLoader
  workers can die; the subprocess survives both.
- The CLI PRUNES its local session record on transient 401s while the VM
  keeps running — verify server-side (`colab sessions`) before believing a
  loss, and re-adopt an orphan by rebuilding
  `~/.config/colab-cli/sessions.json` from `list_assignments()`s fresh
  `runtimeProxyInfo` (script pattern in the session notes).
- Download the checkpoint to the Mac EVERY epoch — VM-local checkpoints die
  with the VM (one full run's final weights were lost this way; only the
  exported mlpackage survived, which is why fine-tuning restarts from the
  epoch-5 checkpoint on Drive).
- Uploads >~100 MB 500 — split/reassemble (`split -b 30m`, `cat` on VM).
- The keep-alive daemon lives on the machine that ran `colab new`: laptop
  sleep kills the run eventually. `caffeinate` prevents idle sleep only —
  lid/battery sleep still bites. The durable fix is driving from an
  always-on box (homelab ai-node) or Colab Pro+ background execution.

### Recalibrating thresholds for a new encoder (reusable method)

1. Build the candidate into a worktree (swap model+index, delete/disable
   the gate), run the replay once with `TEST_RUNNER_REPLAY_EVIDENCE_DIR`
   set — every frame's full attempt evidence lands as JSON.
2. `python3 mobile-apps/ios/scripts/threshold_sweep.py <evidence-dir>` —
   approximates the acceptance ladder offline and grids
   strong-accept/ambiguity in seconds. Find the precision knee (the S below
   which wrong accepts appear) and step one notch above it.
3. Validate the chosen point with a REAL replay via
   `TEST_RUNNER_SCANNER_STRONG_ACCEPT` / `_AMBIGUITY_MARGIN` — the sweep's
   approximation ran ~4 frames conservative of the real ladder.
4. Bake the point into `ScannerEncoderVariant`.

ArcFace's original sweep found wrong accepts below S=0.59 and selected
0.60/0.05. After physical-card filtering removed Pocket rows from the ANN
ambiguity neighborhood, bundled pack/empty negatives reached 0.6285/0.6476;
the operating point moved to 0.65/0.05 on 2026-08-29. All positive and
negative fixtures plus the 38-session device replay remained green.

### Polish plan (to close the remaining ArcFace gaps)

1. **Fine-tune with real capture crops** (highest value): mix labeled crops
   from the session library (attempt JPEGs + `expectedCards` ground truth,
   ~100–200 frames) into training at high sampling weight, resuming from
   `Drive:TCGer-encoder/arcface-checkpoint-epoch5.pt` (~1.5 h L4). Targets
   the 9 known losses and the boss-clean fixture miss (synthetic augs
   don't fully cover real capture conditions).
2. **Investigate the SWSH204 promo class**: 4 of the 9 losses are this one
   card, all `noCandidates` — check its catalog image/index row before
   blaming the encoder.
3. **Retrain the rejection gate** on ArcFace embeddings
   (`backend/src/scripts/train-rejection-gate.ts`; needs a crop dataset —
   the original gate's source video is gone, so build one from dev-session
   crops). Until then ArcFace runs ungated; the policy tolerates it, but
   the gate's junk-rejection is a real loss on no-card frames.
4. **Tune the remaining DINOv2-scale constants for ArcFace**: the title
   printing guard (0.85 / 0.05 separation) and `minimumEvidenceScore`
   (0.55) were not swept; also fixture `minimumConfidence` floors.
5. Optional bigger swings: ResNet-50 recipe (TCG-AR exact) if a quality
   ceiling appears; W8A8/palettization for even faster ANE inference; and
   an ArcFace-era replay baseline set recorded on-device with the new
   encoder so the lost-floor stops being defined by DINOv2-era recordings.

### Running the replay/benchmark harnesses

- Replay tests need `-testPlan TCGer-Replay`; the default TCGer-CI plan
  excludes them and `-only-testing` then silently matches 0 tests, which
  reads as a false pass.
- The Replay plan enables test timeouts (600 s allowance); the corpus now
  lives on Google Drive (`~/Library/CloudStorage/GoogleDrive-…/My Drive/
  Projects/TCG/Reference/TCGer-Session-Reference/sessions`) and the first
  uncached read exceeds the allowance — pass `-test-timeouts-enabled NO`
  and/or prefetch the files first.
