# Cross-app scanner comparison and experiment plan

**Purpose:** this is the canonical place to compare scanner ideas recovered
from Collectr 2.5.5, ManaBox 4.1.11, Purplemana 0.3.65, and TCGer's current
pipeline. The per-app reports remain the evidence record; this document turns
those observations into controlled TCGer experiments.

Do not compare the apps only as complete pipelines. Each app changes several
variables at once, so an apparent win could come from its crop policy,
descriptor, index, rejection threshold, temporal logic, or test conditions.
The experiments below keep those boundaries explicit and change one family of
variables at a time.

## Source documents

| App/system        | Evidence review                                                                                                                          | TCGer decisions                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Collectr 2.5.5    | [Android review](app-reviews/collectr-android-2.5.5.md) and [full recovered report](../collectr-2.5.5-decompiled/SCAN_ANALYSIS.md)       | [Collectr takeaways](collectr-scanner-takeaways.md)            |
| ManaBox 4.1.11    | [Android review](app-reviews/manabox-android-4.1.11.md) and [full recovered report](../manabox-4.1.11-decompiled/SCAN_ANALYSIS.md)       | [ManaBox takeaways](manabox-scanner-takeaways.md)              |
| Purplemana 0.3.65 | [Android review](app-reviews/purplemana-android-0.3.65.md) and [full recovered report](../purplemana-0.3.65-decompiled/SCAN_ANALYSIS.md) | [Purplemana takeaways](purplemana-scanner-takeaways.md)        |
| TCGer             | [Scanner model handoff](scanner-model-ai-handoff.md)                                                                                     | [Geometry experiment](manabox-inspired-geometry-experiment.md) |

The reviews describe recovered behavior, confidence, unknowns, and endpoint
boundaries. They do not grant permission to copy code, models, indexes, or use
private services. TCGer should reproduce useful general techniques with its
own code and licensed assets.

The August 18 review of four downloaded open-source scanner projects and one
new detector dataset is recorded in the
[open-source scanner project audit](scanner-open-source-project-audit-2026-08-18.md).
Its two promoted ideas are exact-print footer constraints and temporal
best-frame evidence; its new CC BY 4.0 detector dataset is archived in the
Google Drive Reference library.

## Pipeline comparison

| Boundary          | TCGer                                                                                      | Collectr                                          | ManaBox                                                   | Purplemana current                                               | Purplemana legacy                               |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Capture           | Live preview plus higher-resolution recognition crop; deliberate still for server fallback | Latest high-resolution preview frame on shutter   | Continuous CameraX NV21 stream                            | Continuous VisionCamera stream                                   | Continuous camera stream                        |
| Initial region    | YOLO11n OBB/guide crop                                                                     | UI-guide crop                                     | Full-frame classical localization                         | Centered 384 x 384 model crop                                    | Classical full-frame localization               |
| Corners           | OBB plus optional Sobel/RANSAC edge refinement; Vision rectangles on iOS                   | No homography found in recovered path             | Threshold/contour-derived quad                            | Learned four-corner ONNX keypoints                               | CLAHE/threshold/Canny/contours                  |
| Geometry policy   | Normal crop first; contour warp as rescue in measured web path                             | Crop only                                         | Warp before every HOG descriptor                          | Warp before every pHash                                          | Warp before every pHash                         |
| Visual descriptor | DINOv2-small embedding, int8 reference index                                               | JPEG image uploaded                               | 384-float HOG at 160 x 160                                | 1,024-bit DCT pHash                                              | 1,024-bit DCT pHash                             |
| Retrieval         | Local exact cosine within installed game indexes                                           | Private server matcher                            | Local exact top-10 L2                                     | Remote Hamming/catalog matcher                                   | Remote/local variants remain bundled            |
| Open-set control  | Card-face gate, similarity threshold, OCR, temporal evidence                               | Server behavior unknown; user confirmation        | Exact acceptance policy not fully recovered               | Similarity/stability policy; server rejection unknown            | Client thresholds visible for parts of old flow |
| Exact printing    | Set/game scope plus OCR and metadata                                                       | Server candidates plus variant/foil/grade UI      | Local visual-to-printing SQL mapping, filters, priority   | Server catalog candidates and grading flow                       | Similar catalog resolution                      |
| Temporal policy   | Multi-frame tracks and embedding evidence                                                  | User-triggered request; no continuous recognition | Serialized continuous frames; workflow duplicate controls | Hash every about 200 ms; normally require 2+ stable observations | Multi-frame smoothing/stability                 |
| Network boundary  | Local-first; optional authenticated server fallback                                        | Cropped camera image crosses network              | Models/index/catalog downloaded; scan frames stay local   | Hash crosses network; model downloaded                           | Depends on old lookup path                      |
| Asset contract    | Versioned model, gate, index, and metadata work in progress                                | Server-owned recognition                          | Coupled matching index, mapping DB, and catalog revision  | Downloaded model; dormant local catalog manager                  | Bundled native implementation                   |

Two cautions are central:

1. ManaBox HOG and TCGer DINO both happen to contain 384 values. The values are
   unrelated and cannot share an index or distance calibration.
2. A perspective warp is part of ManaBox's HOG and Purplemana's pHash
   preprocessing contract. That does not prove the same warp should always be
   applied before TCGer's DINO encoder. TCGer's existing benchmark found
   blanket rectification worse than the normal crop.

## Testable idea inventory

These IDs make benchmark configurations compact and prevent names such as
"ManaBox mode" from hiding several simultaneous changes.

### Geometry

| ID   | Variant                                                            | Origin/status                                                   |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `G0` | Current YOLO OBB/high-resolution crop; no corner refinement        | TCGer baseline                                                  |
| `G1` | Sobel/RANSAC contour-derived quad inside a padded YOLO crop        | TCGer implementation; inspired by ManaBox/classical Purplemana  |
| `G2` | TCGer-owned learned four-corner model inside a padded YOLO crop    | Purplemana-inspired hypothesis; must be trained and implemented |
| `G3` | Platform document/rectangle quad inside the detector or guide crop | Current iOS capability; needs policy parity testing             |

Each geometry source has a separate policy:

| ID   | Policy   | Meaning                                                                               |
| ---- | -------- | ------------------------------------------------------------------------------------- |
| `P0` | `none`   | Embed only the normal crop                                                            |
| `P1` | `rescue` | Try a warp only after the normal result is not accepted; keep stronger valid evidence |
| `P2` | `always` | Use the warp whenever a valid quad exists; negative-control/ablation                  |

`G0/P0` is the baseline. `G1/P1` is the current production-shaped candidate.
`G2/P1` is the next high-value geometry experiment. `P2` is not a proposed
customer option; it shows whether rescue policy, rather than merely producing
a visually tidy crop, is responsible for a gain.

### Recognition and retrieval

| ID   | Variant                                                        | Required paired asset                                                       | Initial role                                             |
| ---- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `R0` | DINOv2-small embedding plus cosine search                      | Current TCGer DINO index built with identical preprocessing                 | Production baseline                                      |
| `R1` | 160 x 160 HOG plus exact L2                                    | New TCGer-owned HOG index built for every reference image                   | Offline classical baseline                               |
| `R2` | 1,024-bit pHash plus Hamming distance                          | New TCGer-owned pHash index built with the exact same warp/resize/DCT rules | Offline identification baseline only                     |
| `R3` | Authenticated remote matching of a compact TCGer-owned feature | Versioned server index and explicit public product contract                 | Deployment experiment, not required for core recognition |
| `R4` | Authenticated remote matching of a minimized JPEG crop         | TCGer service using owned data                                              | Architecture/quality ceiling only                        |

Never send a query descriptor to a reference index produced by another
descriptor or preprocessing recipe. Rebuild and version each reference index.
In particular, do not use Purplemana's model/hash index, ManaBox's downloaded
index, or Collectr's private endpoint.

### Rejection, temporal behavior, and candidate resolution

| ID   | Variant                                                           | Question                                                       |
| ---- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `A0` | Descriptor threshold only                                         | What is the raw recognizer's calibrated open-set behavior?     |
| `A1` | Card-face rejection gate plus descriptor threshold                | How much does TCGer's gate reduce false positives?             |
| `A2` | `A1` plus OCR reranking/verification                              | Does text recover exact printings without weakening precision? |
| `T0` | Single-frame decision                                             | What is the independent-frame ceiling and error rate?          |
| `T1` | Current track-level DINO evidence/averaging                       | Does learned-feature fusion stabilize recognition?             |
| `T2` | Cheap pHash sameness gate before re-embedding                     | Can Purplemana's temporal idea reduce repeated work safely?    |
| `T3` | `T2` for result-cache reuse, while `T1` still controls acceptance | Can pHash save latency without becoming an identity signal?    |
| `F0` | All installed references for the selected game                    | Retrieval baseline                                             |
| `F1` | User-selected set/format allowed-index filter                     | ManaBox-inspired ambiguity/latency test                        |
| `F2` | Visual-group shortlist expanded into possible printings           | ManaBox-inspired same-art deduplication test                   |

Initially test `T2/T3` only as a sameness/cache mechanism. A pHash collision or
small Hamming distance must not itself assign a card identity.

### Runtime and product behavior

The following do not need to be entangled with model-accuracy experiments:

- one frame in flight, a dedicated worker/executor, and reusable buffers;
- per-game asset downloads with progress, cancellation, validation, atomic
  activation, rollback, and metered-network policy;
- quick-add mode, deliberate same-card override, restored sessions, and
  candidate confirmation;
- guide-aware cropping as both a quality and privacy boundary;
- local barcode decoding followed by authenticated catalog lookup of digits;
- server authentication, admission limits, payload validation, and explicit
  retry behavior for any TCGer-owned fallback.

These are strong product lessons from ManaBox and Collectr even if no alternate
descriptor beats DINO.

## Controlled experiment sequence

### Phase 0: lock the baseline

Record the exact detector, encoder, index manifest, rejection gate, catalog,
thresholds, sampling cadence, platform, and commit. Reproduce `G0/P0 + R0 +
A1 + T1 + F0` on every labeled suite before interpreting a new variant.

Use the existing Sinnoh video for regression continuity, but do not make a
production decision from that video alone. The current July 2 result was:

| Geometry policy        | Committed observations | Precision | Windows found |
| ---------------------- | ---------------------: | --------: | ------------: |
| Normal crop            |                    275 |     93.8% |         85/91 |
| Always contour rectify |                    252 |     91.7% |         81/91 |
| Contour rescue         |                    287 |     93.0% |         87/91 |

This supports rescue-shaped experimentation; it is not cross-game proof.

### Phase 1: geometry only

Keep `R0 + A1 + T1 + F0` fixed and run:

1. `G0/P0` — normal-crop baseline.
2. `G1/P1` — contour rescue.
3. `G1/P2` — contour always negative control.
4. `G2/P1` — learned-corner rescue after a TCGer model exists.
5. `G2/P2` — learned-corner always negative control.
6. `G3/P1` and `G3/P2` on iOS replay for platform-policy parity.

For every attempted refinement, retain the normal and warped crop, both
recognition results, the selected branch, rejection reason, and corners. This
supports paired per-frame analysis instead of comparing only aggregate totals.

### Phase 2: recognizers on identical source crops

Freeze a corpus of normal and ground-truth-rectified card crops. Build separate
owned reference indexes and compare `R0`, `R1`, and `R2` on those same images.
Report normal and rectified results independently; otherwise geometry quality
and descriptor quality are confounded.

This phase answers whether HOG or pHash offers a useful speed, memory, or
cold-start baseline. It does not require putting either into the live scanner.

### Phase 3: temporal and cache policy

Using the same ordered frame tracks, compare `T0`, `T1`, `T2`, and `T3` while
holding geometry and `R0` fixed. Measure identity changes, time to stable
result, embeddings avoided, stale-result reuse when a card leaves, and pHash
collisions across different cards.

### Phase 4: candidate resolution

Compare `F0`, `F1`, and `F2` with the same visual shortlist. Score name and
exact-print identity separately. Then add `A2` OCR verification and measure
whether it resolves same-art/set ambiguity without creating accepted false
positives.

### Phase 5: deployment boundary

Only after the local accuracy experiments are calibrated, compare:

- local exact search over partitioned int8 DINO indexes;
- local approximate search if measured scale makes exact search too slow;
- a TCGer-owned compact-feature service;
- a TCGer-owned minimized-image service as an authorized quality ceiling.

Collectr and Purplemana demonstrate two remote boundaries, not endpoints that
TCGer may depend on. Network tests must include offline behavior, p50/p95
round-trip time, payload size, server cost, authentication failure, quota
behavior, and privacy/retention policy.

## Shared fixtures and split discipline

Every fixture manifest should identify:

- source capture, timestamp/frame, device, orientation, and game;
- card name plus exact printing/external ID where known;
- set, collector number, visual-art group, language, finish, and card style;
- true four corners when the fixture is used for geometry scoring;
- tags for flat/keystone/rotated/edge-clipped, borderless/full-art, sleeve,
  foil/glare, fingers/occlusion, blur, low light, clutter, and multi-card scene;
- open-set class for card back, pack, hand, empty scene, non-card rectangle,
  or unsupported card;
- contiguous ground-truth windows for temporal evaluation.

Minimum suite coverage:

| Slice              | Required coverage                                                                 |
| ------------------ | --------------------------------------------------------------------------------- |
| Games              | Pokémon, MTG, and Yu-Gi-Oh after each licensed index exists                       |
| Capture sets       | At least two independent recordings per promoted game; more than one device class |
| Geometry           | Flat, rotation, mild/strong keystone, partial/edge-clipped                        |
| Surface/background | Matte, sleeve, foil/glare; plain, playmat, clutter, hand                          |
| Card styles        | Normal border, borderless/full-art, dark art, trainer/energy where applicable     |
| Negatives          | Packs, backs, hands, empty frames, non-card rectangles, unsupported games         |
| Scene dynamics     | Entering/leaving, repeated same card, rapid replacement, multiple cards           |

Split by physical capture session and card identity/art group where practical,
not by adjacent frames. Tuning and threshold calibration must not see the final
evaluation sessions. Synthetic projective transforms are useful for training
a corner model, but real-camera captures remain the promotion set.

## Required metrics

### Recognition quality

- committed top-1 name precision and coverage;
- exact-print precision and coverage;
- top-1 and top-5 name/printing recall before the acceptance policy;
- open-set false-positive count and rate;
- newly recovered ground-truth windows and baseline-correct windows lost;
- time to first stable correct result and incorrect identity-switch count;
- results for every major slice, not only the aggregate.

### Geometry quality

- normalized corner error and reprojection error on corner-labeled fixtures;
- valid-quad, valid-warp, rescue-selected, and fallback rates;
- normal-versus-warped recognition delta on the exact same observation;
- invalid ordering, extreme area/aspect, clipped output, and missing-edge rates.

### Runtime and delivery

- detector, corner, warp, descriptor, search, OCR, and end-to-end p50/p95;
- second-embedding rate and embeddings avoided by temporal caching;
- frames skipped because of backpressure and UI-frame impact;
- cold-load time, peak/resident memory, index bytes, and download bytes;
- battery and thermal behavior on representative physical devices;
- for remote paths: encoded payload, round-trip latency, availability, error
  rate, and estimated service cost.

## Promotion gates

A variant may replace the baseline only when all of the following hold:

1. It introduces no new accepted false-positive window on the primary labeled
   suites, unless an explicit calibration review accepts a clearly quantified
   tradeoff.
2. It improves coverage or exact-print resolution on at least two independent
   capture sets and does not hide a major per-game/card-style regression.
3. It preserves preprocessing/index compatibility and produces reproducible
   results from a versioned configuration.
4. Its p95 latency, memory, battery, and thermal behavior fit the lowest device
   class TCGer supports.
5. Browser and iOS either achieve equivalent policy behavior on shared
   fixtures or document why a platform-specific choice is necessary.
6. Any network dependency has an owned, authenticated contract and acceptable
   offline, privacy, quota, and failure behavior.

For geometry specifically, a cleaner-looking warp is not evidence. It must
reduce corner error or improve the final recognition policy. An `always` mode
is expected to remain a negative control unless it independently clears every
gate.

## Run identity and result record

Give every run an immutable configuration instead of encoding only the app
name in a folder. A minimal record is:

```json
{
  "runId": "2026-08-04_sinnoh_g1-p1_r0_a1_t1_f0",
  "commit": "<git-sha>",
  "fixtureManifest": "<path-and-sha256>",
  "platform": "backend-native",
  "geometry": { "source": "G1", "policy": "P1" },
  "recognizer": "R0",
  "acceptance": "A1",
  "temporal": "T1",
  "filter": "F0",
  "assetManifest": "<path-and-sha256>",
  "thresholds": {},
  "results": "live-stream-results.json",
  "evaluation": "eval-report.json"
}
```

Store benchmark records under a consistent path such as
`docs/benchmarks/scanner/<fixture>/<run-id>/` only when they are small and
appropriate for Git. Large frames, videos, crops, and model artifacts should
remain in external fixture storage; commit their manifest, hashes, commands,
and summarized results.

The existing runner/evaluator pair is:

```bash
npm --prefix backend run scan:video-live-stream -- --help
npm --prefix backend run eval:video-stream -- --help
```

The current harness directly exposes contour policies as
`--rectify-mode none|rescue|always`. Learned-corner, HOG, pHash, and temporal
cache variants require implementation before their IDs become runnable.

## Current recommendation

Keep TCGer's main path as YOLO localization, normal high-resolution crop,
DINOv2 retrieval, card-face rejection, OCR verification, and temporal evidence.
Continue contour rectification as the measured rescue candidate, not a
customer-facing option.

The next highest-value model experiment is a small TCGer-owned four-corner
model tested as `G2/P1` against `G1/P1`. The next cheap systems experiment is
pHash as `T2/T3` for temporal sameness and cache reuse. HOG and pHash identity
indexes belong in offline baselines until they show a clear resource advantage
without weakening open-set precision. Private third-party endpoints and assets
are out of scope for integration.

## Documentation completeness and open gaps

| Area                                                                               | Documented now?           | Remaining unknown/gap                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Collectr client capture, crop, transport, barcode branch, headers, response flow   | Yes, with evidence labels | Server recognition internals, retention, and exact current auth/header policy are not visible in the APK |
| ManaBox capture, contour/warp, HOG parameters, local index/mapping, asset delivery | Yes, with evidence labels | Exact acceptance logic in every mode and real-device performance need runtime evaluation                 |
| Purplemana learned/legacy geometry, warp, pHash, temporal calls, remote mutation   | Yes, with evidence labels | Model training data/license, exact server matcher/catalog behavior, and anonymous policy are unknown     |
| TCGer contour policies and July 2 benchmark                                        | Yes                       | Cross-game/device replay and iOS policy parity are incomplete                                            |
| Learned-corner TCGer variant                                                       | Experiment specified      | TCGer-owned training set/model and runner integration do not exist yet                                   |
| HOG/pHash recognition baselines                                                    | Experiment specified      | Owned reference builders/indexes and calibrated rejection thresholds do not exist yet                    |
| Shared fixture/result contract                                                     | Specified here            | Additional MTG/Yu-Gi-Oh, corner-labeled, negative, and device fixtures must be collected                 |
| Cross-app comparison                                                               | Yes, this document        | Update it whenever a new app version or benchmark materially changes a conclusion                        |

The static app behavior needed to test the architectural ideas is now
documented. What is intentionally not claimed is proprietary server behavior,
model provenance that the artifacts do not reveal, or performance that has not
been measured on shared fixtures. Those remain explicit experiments or
unknowns rather than being filled in by inference.

## Update rule

For each newly reviewed app or version:

1. create a separate versioned evidence review under `docs/app-reviews/`;
2. retain the complete recovered report next to the decompilation output;
3. add a short TCGer decision note identifying adopt/adapt/retain/defer/reject;
4. add genuinely new variables to the idea inventory rather than naming a
   whole-app mode;
5. record benchmark configurations and results against the same fixture
   contract; and
6. update the completeness table with unresolved server, model, or runtime
   gaps.
