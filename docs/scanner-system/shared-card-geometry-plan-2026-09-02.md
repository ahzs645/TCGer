# Shared card-geometry plan — 2026-09-02

**Status:** approved direction, not yet implemented

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

## Gate 0: licensing and provenance

This gate is already open. The web detector's `metadata.yaml` declares
AGPL-3.0, the iOS training notebook installs Ultralytics and starts from
`yolo11s.pt`, and the repository has no root license file. Ultralytics offers
AGPL-3.0 and Enterprise licensing. No further Ultralytics model is trained or
shipped until one of these is chosen:

1. make the applicable product and source AGPL-compatible;
2. purchase an Ultralytics Enterprise license; or
3. replace the Ultralytics detector and training dependency.

If option 3 is chosen, the permissive path becomes the main line: an
RTMDet/RTMPose prototype (MMDetection and MMPose are Apache-2.0) as the faster
baseline, and a custom four-corner head on the FastViT backbone the encoder
trainer already uses as the architecture under full control. Checkpoint,
pretrained-backbone, and dataset licenses need their own provenance records;
FastViT's license is Apple's custom redistributable license and its
acknowledgements must be audited.

Every shipped geometry model records the same provenance the encoder releases
already do: corpus release hash, code revision, checkpoint hash, export hash,
input contract, and evaluation artifact.

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
- quad: four points, normalized, top-left-origin source-image space
- order: printed-card TL, TR, BR, BL
- confidence
- orientationConfidence            (may be unknown)
- cornerVisibility[4]              (see corpus schema)
- class: faceUp | faceDown | slab
- boundingBox                      (derived, axis-aligned)
- mask                             (optional, lazy, off the hot path)
- releaseVersion                   (asset-store release, monotonic)
- artifactSha256                   (immutable identity of the model bytes)
```

Rules that are part of the contract and shared as code, not prose:

- input letterboxing (padding value, alignment, resize kernel);
- coordinate conversion back to source space (Vision's bottom-left origin is
  converted inside the iOS adapter only);
- corner ordering and orientation assignment;
- quad validation: finite, convex, non-self-intersecting, in range, aspect
  ratio within the card band;
- quad NMS on the quads themselves, not on axis-aligned boxes;
- overlap handling and duplicate suppression;
- stable result ordering.

## Crop contract

The warp output is part of the contract because the encoder gallery was
embedded through one preprocessing path and the bake-off measured one crop
size. Today iOS and Android produce 720 × 1000, the web produces 480 × 670,
the bake-off uses 720 × 1000 with cubic interpolation, and Android uses a
filtered bitmap draw. The contract fixes:

- destination size: 720 × 1000, portrait;
- destination corner pixel convention (pixel centers versus edges);
- inset or padding applied to the source quad before warping;
- interpolation kernel;
- border behavior for source pixels outside the frame;
- color space and bit depth handed to the encoder;
- orientation handling: which quad corner maps to the destination top-left.

Golden crop fixtures compare with tolerances, not pixel equality, because the
warp implementations are platform-native. Decoder fixtures (raw tensor in,
`CardGeometryResult[]` out) are deterministic and compare exactly after
canonical rounding.

## Corpus schema

One annotation feeds every candidate. Each card instance records:

- full amodal quad in source-image space;
- `cornerVisibility[4]` with semantic values `unlabeled`, `occluded`,
  `visible`, and optionally `outsideFrame`; export adapters map the first three
  to the pose toolchain's `{0, 1, 2}`;
- visible polygon or mask;
- card-relative corner order and an orientation-known flag;
- face-up, face-down, or slab;
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

## Benchmark and winner rule

`tools/camera-corpus/bench_localizers.py` already measures IoU, recall at
0.75, latency, and downstream correct and wrong accepts. Extend it with:

- one-to-one matching between predictions and ground truth;
- corner error in source pixels and normalized, at p50, p90, and p95;
- visible-corner versus occluded-corner accuracy;
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

## Orientation rule

Ordered corners make the 0° and 180° double inference removable, but the
orientation-contradiction rule is a measured safety net: it fired on the one
remaining hand-held wrong accept and voids degenerate crops nothing else
catches. The final rule is:

```
high, calibrated orientationConfidence
    -> single recognition orientation

unknown or low orientationConfidence
    -> retain 0°/180° recognition and contradiction rejection
```

"High" is calibrated against the frozen real-camera sessions. Removing the
second inference requires showing that wrong accepts do not increase, not
merely good orientation accuracy.

## Execution order

1. In parallel, none blocking the others:
   - resolve licensing and create the model/data provenance manifest;
   - freeze the geometry, crop, and benchmark contracts and the evaluation
     sessions;
   - check in the deterministic compositor and the corpus schema, and build
     one versioned corpus release.
2. After the licensing decision:
   - select the allowed training family;
   - train the candidate batch (pose primary with OBB and segmentation
     challengers, or RTMDet/RTMPose plus the custom FastViT corner head).
3. Export raw heads to Core ML and ONNX; implement the decoder in Swift,
   Kotlin, and TypeScript against shared golden fixtures; add crop fixtures
   with tolerances.
4. Run offline geometry evaluation, full recognition replay on the labeled
   Magic, Pokémon, and Yu-Gi-Oh sessions, and physical-device latency and
   thermal tests.
5. Ship the winner through the shared asset store as a content-addressed
   release with a mutable manifest published last.
6. Retire the bundled iOS `CardDetector.mlpackage`, the web TensorFlow.js
   detector and its runtime dependency, and, under the orientation rule
   above, the unconditional 0°/180° double inference.

## Non-goals

- Shipping MobileSAM or FastSAM on device. The stray `FastSAM-s.pt` at the
  repository root is referenced by nothing and should be deleted.
- Another third-party localizer bake-off. The 2026-08-30 run settled it.
- Maintaining four independent production croppers. Candidates are trained
  and compared; one ships.
- Lowering recognition thresholds to absorb crop error.

## Related records

- [System architecture](architecture.md)
- [Detection is the bottleneck (2026-08-24)](../scanner-detection-evidence-2026-08-24.md)
- [Camera corpus and localizer bake-off (2026-08-29/30)](camera-corpus-2026-08-29.md)
- [Magic visual-first policy, art-panel crops, and two-card frames](mtg-visual-first-policy-2026-08-29.md)
- [Yu-Gi-Oh Duel/Table and Deck Scan](yugioh-duel-deck-scan-2026-08-30.md)
- [Import path and YOLO11s detector (2026-08-09)](../scanner-import-path-and-detector-2026-08-09.md)
- [Canonical card-segmentation data](../../tools/card-segmentation-data/README.md)
