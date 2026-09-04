# Shared card-geometry plan — 2026-09-02

**Status:** approved direction. The geometry, crop, and benchmark contracts
are frozen. Candidate training remains gated by licensing, approved coverage
targets, and a training-purpose corpus release.

**Scope:** card detection, corner localization, and crop rectification for
iOS, Android, and web. Recognition stays per game and is out of scope here
except where the crop contract feeds it.

This plan replaces three unrelated croppers with one shared geometry model,
one output contract, and one decoder specification. It sits beside
[System architecture](architecture.md), which already describes a shared
detector in front of per-game encoders, and it consumes the evidence in
[Detection is the bottleneck](../scanner-detection-evidence-2026-08-24.md),
the [localizer bake-off](camera-corpus-2026-08-29.md#localizer-bake-off-2026-08-30),
and the [art-panel crop findings](mtg-visual-first-policy-2026-08-29.md#art-panel-crops--the-largest-single-failure-class-2026-08-30).

## Why

Today each platform localizes cards differently:

| Platform | Localizer | Corner source | Warp output |
|---|---|---|---|
| iOS | YOLO11s box (`CardDetector.mlpackage`, NMS bundled in the Core ML export) | Vision document segmentation, then Vision rectangles, gated by IoU and orientation agreement with the box | Core Image perspective correction, 720 × 1000 |
| Android | none; the guide frame or a manual four-corner editor | user | `Matrix.setPolyToPoly`, filtered bitmap draw, 720 × 1000 |
| Web | YOLO11n-OBB via TensorFlow.js (trained 2025-03 on Pokémon only; original weights not recoverable) | de-rotated box, Sobel/RANSAC rectifier as a rescue | 480 × 670 |

The evidence for changing this is already recorded:

- The 2026-08-24 labeling round found 19 of 19 device losses were crop
  failures on full-art and foil cards, where Vision has no border contrast.
  Re-cropped, the shipped encoder recovered all 19 at rank 0.
- The 2026-08-30 art-panel audit found 12 of 108 labeled Magic frames were
  cropped to the card's art panel. Two heuristics (nested-box suppression and
  orientation agreement) patched it; both compensate for the lack of a model
  that predicts corners.
- The 2026-08-30 bake-off found no third-party localizer beats the app's own
  detector on single-card precision, and that swapping localizers moves at
  most two frames on ordinary single-card sessions. The remaining detection
  work is therefore hard cards, multi-card scenes, steep angles, and platform
  parity, not single-card box quality.
- Android has no detector at all, and the web detector cannot be retrained
  from its original weights.
- On the first 3,157-card synthetic duel-field benchmark, every existing
  localizer misses at least 2,278 cards. This is the first quantified
  multi-card evidence and rules out treating the shared detector as only a
  single-card crop cleanup.

A shared corner-predicting model addresses all four at once.

## Formulation

The primary candidate is a single-class instance detector with four ordered
corner keypoints per card. Its properties, and why they matter here:

- **Per-instance output.** Each detection carries its own quad, so binder
  pages and duel fields return one quad per card in one pass. Single-quad
  regressors (LDRNet, DocAligner) assume one dominant document; the 2026-08-24
  survey recorded that such models fail on card scenes.
- **True perspective quads.** Oriented bounding boxes cannot express
  perspective, which is why OBB scored poorly on steep-angle photos.
- **Learned edges.** Corners are regressed from card appearance rather than
  edge contrast, which is the failure mode on full-art and foil cards.
- **Amodal corners.** Keypoint training supports a labeled-but-occluded
  state, so the model learns to place a corner hidden by a finger or an
  overlapping card and reports that it did so. Segmentation is modal: an
  overlapped card yields an L-shaped mask and the quad fit fails.
- **Ordered corners carry orientation.** Labeling the printed card's top-left
  as keypoint 0 lets the model learn orientation from the frame layout.

Prior art for the formulation, none of it card-specific:

- WPOD-NET (ECCV 2018) and IWPOD-Net for license plates; a 2025 paper adapts
  IWPOD-Net to document corners on MIDV/NBID and finds rectification need not
  be perfect for downstream reading. Note that the original WPOD affine head
  cannot represent every strong-perspective quad; a WPOD-style challenger must
  predict four independent corners or an eight-degree-of-freedom homography.
- YOLOv8/YOLO11 pose with `kpt_shape [4, 3]` for plate corners followed by a
  perspective transform (several public projects).
- LDRNet and DocAligner for single documents; DocAligner is already wired into
  the session-labeling tool.
- TCG-AR (arXiv 2607.02090) detects, orients, and identifies many cards on a
  table from synthetic composites and open-sources its data; read it before
  labeling table scenes.
- Instance segmentation plus quad fitting has been used for trading cards
  (RTMDet). Our own tooling already falls back from `approxPolyDP` to
  `minAreaRect` when masks are not clean; the fit step is where precision is
  lost under sleeves, glare, and fingers.

### Candidate matrix

| Candidate | Multi-card | Perspective | Occluded corners | Cross-platform export | Role |
|---|---|---|---|---|---|
| Pose, four keypoints | yes | yes | yes, with visibility labels | strong | primary |
| Oriented bounding box | yes | no | extrapolates extent | strong | baseline; possible overhead-table fallback |
| Instance segmentation + quad fit | yes | via fit | no (modal mask) | strong | challenger; slabs and evaluation ground truth |
| WPOD/IWPOD-style corner head | yes | yes if corner or homography head | yes | custom decoder work | main line only if the licensing gate forbids the Ultralytics family |
| LDRNet-style single-quad regressor | no | yes | partial | custom | not pursued |

OBB, segmentation, and pose can share one corpus release and one experiment
batch. They remain separate training jobs.

## Gate 0: train freely, ship gated

The licensing gate applies to publication, not to this internal bake-off.
Any candidate may be trained, exported privately for evaluation, and
benchmarked. No Ultralytics-derived export may be published to the shared
asset store while its run has `licenseRoute: evaluation-only`. Publication is
unlocked only after the human records either an Ultralytics Enterprise route
or an AGPL-compatible route. Apache/permissive candidates use
`licenseRoute: permissive` and keep the existing publication path.

This is an operating rule for the experiment, not a conclusion inferred from
model quality. Checkpoint, pretrained-backbone, framework, and dataset
licenses still receive provenance records. FastViT's license is Apple's custom
redistributable license and its acknowledgements must be audited before a
FastViT-derived model ships.

The licensing bake-off contains four runs across three architecture families:

| Candidate | Framework | License family | Purpose in the bake-off |
|---|---|---|---|
| YOLO11n-pose, four card corners | Ultralytics | AGPL-3.0 or Enterprise for publication | smallest pose baseline and one-epoch wrapper smoke |
| YOLO11s-pose, four card corners | Ultralytics | AGPL-3.0 or Enterprise for publication | higher-capacity pose candidate |
| YOLOX-Pose, four card corners | MMYOLO | Apache-2.0 | permissive one-stage pose candidate |
| FastViT-T8 custom four-corner head | TCGer/PyTorch | custom head; audit the FastViT backbone terms | architecture under project control |

RTMPose is not shortlisted: it is top-down and requires a detector in front,
which would confound the comparison of one-stage card localizers. The bake-off
produces a recommendation; the human makes the licensing decision after seeing
the results.

Every shipped geometry model records the same provenance the encoder releases
already do: corpus release hash, code revision, checkpoint hash, export hash,
input contract, and evaluation artifact.

### Bake-off fairness and measurements

Every run uses a fully resolved, hashed experiment configuration. The shared
rules are the same training-purpose corpus release, 640-pixel input, the same
epoch or wall-clock budget, the same augmentation where the framework allows,
the same seed policy, and the same evaluation script. A framework limitation
or other exception is an explicit `deviations` entry in that resolved config;
it is never an unrecorded change. Private checkpoints live at
`geometry/<candidate>/<corpus-hash>/<experiment-hash>/`.

For the first bake-off the resolved augmentation profile is
`canonical-corpus-baked-v1:no-runtime-augmentation`: all shared photometric and
geometric variation is rendered into the canonical synthetic records before
the split is published, and framework-local random augmentation is disabled.
That makes the pixels and labels comparable across all four trainers instead
of silently inheriting different Ultralytics, MMYOLO, and PyTorch defaults.

The comparison table records, for every candidate:

- the geometry benchmark on the frozen real v3 release and the synthetic
  duel-field slice;
- full recognition replay (`correct`, `wrong`, and `abstain`) on the labeled
  sessions;
- exported bytes for every platform;
- model, decoder, and end-to-end latency on one physical iPhone and one
  physical Android phone;
- Core ML versus ONNX parity on the golden fixtures;
- decoder source-code size; and
- L4 GPU hours.

The synthetic duel-field benchmark is a split-only, immutable compositor
release whose source assets and backgrounds are disjoint from the production
training split. It is diagnostic rather than a promotion gate, but it must not
reuse exact training frames; the frozen real release remains the deciding
geometry evaluation.

Gate 0 does not authorize a corpus. The approved
`tools/card-geometry/policies/training-minimums-v2.json` is frozen at SHA-256
`b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d`.
A training-purpose release must bind those exact bytes; a builder must never
generate a training policy from the corpus it is evaluating. The policy admits
only `shippable` source tiers and requires 1,000/100/100 complete
metric-eligible instances in train/validation/test.
Each required test scene slice also requires the same number of fully
metric-eligible instances as its total-instance minimum. This prevents a slice
filled only with `maskFit` geometry from satisfying readiness while remaining
unmeasurable. `training-minimums-v1` was superseded before any corpus release
bound it; its bytes remain checked in only as history.

## Runtimes

One inference runtime per platform, and it is the one the encoder already
uses:

| Platform | Runtime | Notes |
|---|---|---|
| iOS | Core ML | raw-head export, no bundled NMS |
| Android | ONNX Runtime | already pinned for the encoder (`onnxruntime-android` 1.24.3) |
| Web | ONNX Runtime Web | already used for the encoder; TensorFlow.js is imported only by `yolo-detector.ts` and is removed with it |

LiteRT is not added unless physical-device measurement shows a gain that
justifies a second runtime.

## Geometry contract

Every candidate's output is converted to the same structure before anything
downstream runs.

```
CardGeometryResult
- detectionClass: card             (the only detection class)
- corners[4]: { point, confidence } normalized, top-left-origin source-image
                                   space, ordered printed-card TL, TR, BR, BL
- confidence                       (instance confidence)
- cornerOrderConfidence            (may be unknown; see Orientation rule)
- containment: inside | partiallyOutside
- side: faceUp | faceDown | unknown
- container: rawCard | slab | unknown
- boundingBox                      (derived, axis-aligned, clipped to frame)
- mask                             (optional, lazy, off the hot path)
- releaseVersion                   (asset-store release, monotonic)
- artifactSha256                   (immutable identity of the model bytes)
```

Runtime output is separate from annotation. Pose-style models return corner
coordinates plus a per-keypoint confidence, not categorical visibility, so the
runtime carries `corners[4].confidence` and nothing more. The semantic
visibility labels live in the corpus schema only. An optional estimated
visibility field may be added later if a model explicitly predicts it.

`side` and `container` are properties, not detection classes. Geometry must
not fail because side classification is uncertain, and slabs need their own
aspect-ratio validation band. `container` is `unknown` for any candidate that
does not predict slab classification.

Rules that are part of the contract and shared as code, not prose:

- the input transform chain, in this fixed order:

  ```
  source capture coordinates
    -> add fixed exterior context margin
    -> resize / letterbox to model input
    -> inference
    -> undo letterbox
    -> undo context margin
    -> source coordinates, possibly outside [0, 1]
  ```

  Context padding and letterboxing are two separate transforms and must stay
  separate in code. Letterboxing (padding value, alignment, resize kernel)
  fits the aspect ratio to the model input. The context margin is a fixed
  exterior border added so that amodal corners can be expressed inside the
  model canvas; training and inference must share its value, fill policy,
  and position in the transform order. Because the margin lowers the source
  image's effective model resolution, its value is a benchmarked choice, not
  a default;
- coordinate conversion back to source space (Vision's bottom-left origin is
  converted inside the iOS adapter only). Normalized source coordinates use
  the frozen image-edge mapping `x × width`, `y × height`, documented beside
  the destination-corner convention;
- corner ordering and orientation assignment;
- quad validation: finite, convex, non-self-intersecting, aspect ratio within
  the card band (or the slab band when `container` is `slab`). Amodal corners
  may legitimately fall outside `[0, 1]`, so validation permits a bounded
  exterior margin and records `containment` separately rather than rejecting
  the quad;
- quad NMS on the quads themselves, not on axis-aligned boxes;
- overlap handling and duplicate suppression;
- stable result ordering.

## Crop contract

The warp output is part of the contract because the encoder gallery was
embedded through one preprocessing path and the bake-off measured one crop
size. Today iOS and Android produce 720 × 1000, the web produces 480 × 670,
the bake-off uses 720 × 1000 with cubic interpolation, and Android uses a
filtered bitmap draw.

The crop-parity experiment froze the contract as:

- normalized source mapping: image-edge, `x × width`, `y × height`;
- destination size: 720 × 1000, portrait;
- destination corners are pixel centers `(0, 0)`, `(719, 0)`, `(719, 999)`,
  `(0, 999)`, mapped from the source corners TL, TR, BR, BL respectively.
  Width and height coordinates are not used as destination corners;
- inset: 0%;
- interpolation: bilinear;
- border behavior: constant black for source samples outside the frame; and
- encoder input representation: untagged sRGB 8-bit RGB.

With destination pixel centers at 0 and 719, the card edges land at -0.5 and
719.5, which is a built-in half-pixel inset under the OpenCV convention. The
same rule applies vertically at -0.5 and 999.5. Source image-edge mapping and
destination pixel-center mapping are deliberately different conventions;
their combination is part of the contract.

The decision evidence is tracked in
[Crop parity experiment — 2026-09-02](crop-parity-2026-09-02.md). The mapping
remains the benchmark's prior `x × width`, `y × height`, so the three baseline
sets do not require rescoring. New benchmark reports mark it frozen.

Golden crop fixtures compare platform outputs with MAE at most `2/255` and
encoder cosine at least `0.995`, because the warp implementations are
platform-native. When a measured native implementation cannot meet the pixel
tolerance, cosine remains binding and MAE becomes a recorded diagnostic; the
pixel tolerance is not loosened retroactively. The eight license-free
procedural fixtures live under `tools/card-geometry/fixtures/crop-parity.v1`.
Decoder fixtures (raw tensor in, `CardGeometryResult[]` out) are deterministic
and compare exactly after canonical rounding.

## Corpus schema

One annotation feeds every candidate. Each card instance records:

- four corners in source-image space, each
  `{ point?, visibility, coordinateKnown, cornerSource? }`. `cornerSource` is
  per corner, because a partially visible card can mix provenance (three
  human-confirmed corners and one fitted or unknown one). It is required
  whenever `coordinateKnown` is true and takes `human`, `synthetic`,
  `maskFit`, or `detector`; absent means unknown. Only sources listed in the
  bound readiness policy's `metricEligibleCornerSources` enter corner-error
  metrics, and the policy schema limits that list to `human` and
  `synthetic`, so fitted or detected corners are reported but can never
  become ground truth by configuration. Corners may lie outside `[0, 1]`
  within the same bounded margin the runtime validator allows. A full amodal
  quad is required for synthetic frames, where every hidden or out-of-frame
  corner is known by construction, and optional for real annotations where a
  corner is genuinely unknowable; such a corner has `coordinateKnown: false`
  and receives no coordinate loss;
- `visibility` takes the semantic values `unlabeled`, `occluded`, `visible`,
  and `outsideFrame`. `outsideFrame` is defined relative to the original
  capture, never to the padded model canvas. These labels are annotation only
  and do not appear in the runtime contract. The canonical corpus always
  preserves the original coordinate, including out-of-frame ones; export
  ```
  visible                    -> 2
  occluded, in frame         -> 1
  unlabeled                  -> 0, no supervised coordinate
  outsideFrame               -> 0 for a standard pose export with no context
                                margin, because the toolchain's label loader
                                rejects coordinates outside normalized range;
                                or, after the context margin is applied and
                                the corner lands in range, exported as an
                                in-range label with value 1 while the
                                canonical record keeps `outsideFrame`
  ```

  Context-margin export is the default for synthetic data, since the
  compositor controls the canvas and out-of-frame corners are the cases table
  scenes most need supervised;
- visible polygon or mask;
- card-relative corner order and an orientation-known flag;
- `side` (face-up, face-down, unknown) and `container` (raw card, slab) as
  separate fields; the detection label is always `card`;
- occlusion order within the scene;
- physical-card, session, and source-archive grouping for split assignment;
- scene and transformation seed for synthetic frames.

From this, pose consumes corners and visibility, OBB derives a rotated
rectangle, segmentation consumes the visible polygon, and a corner-head
challenger consumes the full quad.

Amodal labels for overlapped cards do not exist yet: the TCGX polygons and
Dev Mode quads are single-card, the Roboflow segmentation archives are modal,
and the Yu-Gi-Oh acceptance schema carries `targetQuad` only. The first source
is a deterministic, permissively licensed synthetic compositor checked into
the repository with a pinned configuration. Compositing yields every full
quad, occlusion order, and hidden corner for free. Real sessions stay frozen
for evaluation; a session-separated real-overlap training set is added later
to close the synthetic-to-camera gap.

The first two-background, 71-render compositor release is tooling smoke only.
Before a training-purpose release, the pool expands to several thousand
Pokémon, Magic, and Yu-Gi-Oh renders (including 59:86 Yu-Gi-Oh cards), three
game backs, and 50–100 self-captured surface photographs. Backgrounds remain
self-captured or explicitly CC0. A distractor-free single-handheld synthetic
sub-slice and per-frame `distractorCount` separate distractor-density failures
from transformation-range failures before those distributions are tuned.

## Benchmark and winner rule

`tools/camera-corpus/bench_localizers.py` already measures IoU, recall at
0.75, latency, and downstream correct and wrong accepts. Its real annotations
cannot yet measure multi-card behavior: the Yu-Gi-Oh acceptance schema carries
one `targetQuad` per record, which is insufficient for one-to-one matching,
duplicate rate, and full-scene recall. Before the evaluation set is frozen,
every relevant card in a selected duel-field and binder subset must be
annotated with the full corpus schema. This changes labels only, not the
frozen images, and can start immediately.

The canonical-corpus audit found 304 existing multi-card records. The
reviewable `grid-size-overlap-rotation-v1` pass provisionally assigns 99 to
`binder_page`, 125 to `duel_field`, and 80 to `other`, with its measured
features and a deterministic 24-frame human spot-check recorded in
`benchmarks/2026-09-02-canonical-multi-card-scenes.json`. These assignments
are candidate labels, not frozen truth; human corrections are stored as
overrides rather than used to retune the heuristic after model results exist.

Extend the benchmark with:

- one-to-one matching between predictions and ground truth;
- corner error in source pixels and normalized, at p50, p90, and p95;
- visible-corner versus occluded-corner accuracy, computed only over corners
  with `coordinateKnown: true` and a metric-eligible `cornerSource`,
  reporting `eligible / evaluated / skipped` and
  `metricEligible / metricExcluded` corner counts per source and per scene
  slice rather than one global count, with synthetic and real corner results
  kept separately visible;
- multi-card recall at quad IoU 0.75;
- duplicate and extra-detection rate;
- orientation accuracy where orientation is knowable;
- model, decode, rectification, and total latency on physical phones, plus
  thermal behavior over a sustained session;
- correct accepts, wrong accepts, and abstentions per game and per scene slice
  through the full recognition pipeline.

Winner rule, in order:

1. no unacceptable increase in wrong accepts;
2. highest paired increase in correct accepts across Magic, Pokémon, and
   Yu-Gi-Oh;
3. geometry and latency within their safety budgets.

Do not select on aggregate IoU alone. The bake-off has already shown that
localizer IoU and downstream acceptance can disagree.

### Proposed geometry regression budgets

The first shared baseline on corpus
`d14c97a428e7295e10e75644189528dce297d5990d9c76435eeb9e1cf64dc242`
supports the following proposed budgets. They remain pending human approval.
If approved, record the approval before any candidate result is viewed; never
tune these values after a candidate is evaluated.

- recall at quad IoU 0.5 at least 0.98 and recall at 0.75 at least 0.85;
- normalized corner-error p50 at most 0.03, p90 at most 0.10, and p95 at most
  0.15;
- `outsideFrame` normalized corner-error p50 at most 0.08;
- zero duplicates and at most three extras on the 61-frame frozen release;
- no increase in wrong accepts through the full recognition replay.

These are candidate regression budgets, not `training-minimums-v2`; corpus
coverage targets remain a separate human decision.

## Orientation rule

Ordered corners make the 0° and 180° double inference removable, but the
orientation-contradiction rule is a measured safety net: it fired on the one
remaining hand-held wrong accept and voids degenerate crops nothing else
catches. The final rule is:

```
high, calibrated cornerOrderConfidence
    -> single recognition orientation

unknown or low cornerOrderConfidence
    -> retain 0°/180° recognition and contradiction rejection
```

`cornerOrderConfidence` needs an implementation definition before it can gate
anything. Ordinary per-keypoint confidence says how well each corner was
located, not whether the four identities were assigned in the right order, so
it does not prove orientation. Two acceptable implementations:

1. an explicit orientation or order-confidence head trained alongside the
   corners; or
2. a derived score, calibrated on the frozen real-camera sessions, that is
   shown to predict 180° ordering errors.

Until one of these exists and is measured, `cornerOrderConfidence` is reported
as unknown and double inference remains mandatory. Removing the second
inference requires showing that wrong accepts do not increase, not merely good
orientation accuracy.

## Work that starts now

The three foundation workstreams were independent of the final licensing
decision. The contract freeze, benchmark, and compositor tooling are landed.
Candidate configuration and license-route enforcement are also implemented;
training now waits on a combined shippable release that meets the frozen
`training-minimums-v2` policy.

1. **Contract freeze**
   - commit JSON schemas for `CardGeometryResult` and the corpus record;
   - run the crop-kernel and parity experiment, freeze the crop values, and
     select the normalized-to-pixel source mapping;
   - commit model-agnostic golden fixtures for the stage
     `decoded candidates -> validation/NMS -> CardGeometryResult[]` (exact
     after canonical rounding), including NMS threshold boundaries and
     invalid, crossed, tiny, out-of-frame, and partially-outside quads;
   - commit context-padding and inverse-coordinate fixtures: source
     coordinates through margin and letterbox and back, including corners
     that leave `[0, 1]`, so every platform proves the transform chain
     round-trips before any model exists;
   - commit crop fixtures (tolerance). Raw-tensor-to-candidate fixtures are
     model-specific and are added per trained model in export step 3, so this
     workstream stays independent of the final licensing decision.

   The first implementation commit is therefore: the two JSON schemas, the
   validation/NMS fixtures, and the context-padding and inverse-coordinate
   fixtures.

   **Release manifest and readiness gate.** A corpus release binds to a
   readiness policy by id and file hash and declares a `releasePurpose` of
   `fixture`, `smoke`, or `training`. The model-independent preflight
   (`tools/card-geometry/preflight.py`) validates schemas, hashes, split
   leakage, the frozen-session denylist, and the policy minimums, and reports
   `readyFor: none | tooling | training`. Only a `training`-purpose release
   with every check passing is ready for training, and the GPU wrapper must
   additionally pass the policy hash it expects, so a release cannot lower its
   own bar by binding a weaker policy. The corpus hash is the canonical
   manifest without its own hash member; every record and image hash is a
   manifest member.

   Until a geometry corpus release exists at a pinned dataset revision (none
   did on 2026-09-02), every preflight run is a tooling test against the
   checked-in fixture releases. The first meaningful preflight is the output
   of publishing the first real release, not of the smoke.
2. **Benchmark extension**
   - annotate every card in the selected duel-field and binder subset;
   - implement one-to-one prediction-to-truth matching;
   - add corner, orientation, duplication, and downstream recognition metrics;
   - define numeric regression budgets before any training run.
3. **Synthetic compositor**
   - deterministic from seeds, checked into the repository with a pinned
     configuration;
   - source-image and background licenses and hashes tracked per asset;
   - emits amodal quads, occlusion relationships, and corner visibility;
   - prevents physical-card and source leakage across splits.

## Execution order

1. Build the training-purpose release against the frozen
   `training-minimums-v2` policy and hash, and require the pinned preflight to
   report `readyFor: training`.
2. Run one epoch of YOLO11n-pose on an L4 to prove corpus download, preflight,
   training, private checkpoint persistence, config hashing, private export,
   and evaluation end to end.
3. Run the full four-candidate batch (the three architecture families in the
   Gate 0 table) under the shared fairness configuration.
4. Export raw heads privately to Core ML and ONNX; implement each model's
   raw-tensor-to-candidate decoder in Swift, Kotlin, and TypeScript and add
   its model-specific golden fixtures beside the shared validation/NMS
   fixtures.
5. Run offline geometry evaluation, full recognition replay on the labeled
   Magic, Pokémon, and Yu-Gi-Oh sessions, and physical-device latency and
   thermal tests.
6. Produce the comparison table and a recommendation. The human then chooses
   the license route. An `evaluation-only` Ultralytics run cannot proceed to
   the asset-store publication step.
7. Ship the licensed winner through the shared asset store as a
   content-addressed release with a mutable manifest published last.
8. Retire the bundled iOS `CardDetector.mlpackage`, the web TensorFlow.js
   detector and its runtime dependency, and, under the orientation rule
   above, the unconditional 0°/180° double inference.

## Non-goals

- Shipping MobileSAM or FastSAM on device.
- Another third-party localizer bake-off. The 2026-08-30 run settled it.
- Maintaining four independent production croppers. Candidates are trained
  and compared; one ships.
- Lowering recognition thresholds to absorb crop error.

## Cleanup items

Tracked separately from the plan; none of these gate it.

- Delete the stray `FastSAM-s.pt` at the repository root. It is referenced by
  no code, script, or document.

## Related records

- [System architecture](architecture.md)
- [Detection is the bottleneck (2026-08-24)](../scanner-detection-evidence-2026-08-24.md)
- [Camera corpus and localizer bake-off (2026-08-29/30)](camera-corpus-2026-08-29.md)
- [Magic visual-first policy, art-panel crops, and two-card frames](mtg-visual-first-policy-2026-08-29.md)
- [Yu-Gi-Oh Duel/Table and Deck Scan](yugioh-duel-deck-scan-2026-08-30.md)
- [Import path and YOLO11s detector (2026-08-09)](../scanner-import-path-and-detector-2026-08-09.md)
- [Canonical card-segmentation data](../../tools/card-segmentation-data/README.md)
