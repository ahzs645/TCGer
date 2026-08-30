# Camera data and model hardening framework

**Status:** proposed cross-game implementation contract

**Applies to:** Pokémon, Magic, Yu-Gi-Oh!, and future game packages

Catalog images are necessary for broad coverage, but clean catalog derivatives
alone do not teach a model every transformation introduced by a printed card,
camera, sleeve, lighting environment, detector, and rectifier. This document
defines the next training structure without tying it to one game or platform.

## Objective

Train a family retriever that is invariant to real capture conditions while
preserving the current product contract:

- retrieve a distinct visible design as a recognition family;
- keep same-design reprints as printing metadata;
- let quick mode choose the newest eligible printing;
- let precise mode verify or ask for the exact printing;
- use OCR and set evidence only after a credible visual retrieval; and
- abstain safely on unsupported or uncertain inputs.

The framework must improve real-camera coverage without increasing wrong
accepts or leaking evaluation captures into training.

## Data layers

The pipeline has four data layers with different ownership and retention rules.

| Layer | Purpose | Mutable? | Distributed to clients? |
|---|---|---:|---:|
| Source catalog metadata | Know releases, printings, image URLs, and relationships | Pinned snapshots plus controlled refresh | Catalog subset only |
| Canonical catalog images | Cover every trainable family | Immutable per prepared release | No |
| Private camera training corpus | Teach print/camera invariance | Append-only observations, immutable prepared releases | No |
| Frozen reference/evaluation sessions | Approve runtime behavior and prevent regression | Labels may be reviewed; captured pixels remain immutable | No |

Client packages contain only the exported encoder, packed family vectors,
family/printing metadata, integrity data, and applicable filters. They do not
contain training photos.

## Platform-neutral camera manifest

Every camera observation should be represented by a portable manifest record.
The image bytes may live in a private local/Hugging Face dataset; the manifest
must use relative paths and content hashes so the same release can be verified
on macOS, Linux, and Hugging Face Jobs.

```json
{
  "schemaVersion": 1,
  "observationId": "magic-session-abc-frame-0007-card-0",
  "gameId": "magic",
  "exactPrintingId": "scryfall-printing-uuid",
  "recognitionFamilyId": "magic-illustration-or-reviewed-family-id",
  "source": {
    "sessionId": "scan-session-YYYYMMDD-HHMMSS",
    "framePath": "frames/frame-0007.jpg",
    "frameSha256": "...",
    "licenseOrConsent": "private-project-training",
    "provenance": "tcger-dev-mode-export"
  },
  "geometry": {
    "coordinateSystem": "normalized-bottom-left",
    "detectorQuad": [[0.1, 0.2], [0.8, 0.2], [0.8, 0.9], [0.1, 0.9]],
    "rectifiedPath": "rectified/observation-id.jpg",
    "rectifiedSha256": "..."
  },
  "capture": {
    "platform": "ios",
    "deviceClass": "phone-wide-camera",
    "captureMode": "single-card",
    "conditions": ["sleeve", "glare", "oblique-angle"],
    "orientationDegrees": 0
  },
  "partition": {
    "physicalCardId": "operator-assigned-card-copy-id",
    "groupId": "same-card-same-session",
    "split": "train"
  },
  "review": {
    "labelSource": "visible-title-and-collector-number",
    "reviewStatus": "verified",
    "reviewedAt": "2026-08-29T00:00:00Z"
  }
}
```

Required invariants:

- `exactPrintingId` exists in the pinned game catalog.
- `recognitionFamilyId` equals the catalog's reviewed family mapping for that
  printing.
- source and derived images match their SHA-256 values.
- quads are finite, ordered, non-self-intersecting, and in range.
- train, validation, and test groups do not overlap by physical card, session,
  or derivative hash.
- unsupported formats, such as Pokémon Pocket in a physical build, are rejected
  before preparation.
- evaluation-session IDs are denied from a training release, even if copied or
  renamed.

## Collection plan

For the first Magic camera-hardening experiment, a useful starting target is:

- 300 to 500 distinct cards;
- 3 to 5 observations per physical card;
- approximately 1,000 to 2,000 rectified positive crops;
- both iOS and Android captures;
- deliberate variation in distance, rotation, perspective, light temperature,
  shadow, glare, focus, motion, compression, background, and sleeves; and
- deliberate hard categories: basic and nonbasic lands, visually similar card
  frames, foils, borderless/full-art treatments, showcase layouts, tokens,
  double-faced/split cards, same-name different-art printings, and same-art
  reprints.

Repeated photos of one card help with invariance, but do not replace identity
coverage. Report both observation count and distinct family/physical-card count.

The 2026-08-29 Magic session is an evaluation artifact. It must not be used as
training data for the candidate measured against it.

## Preparing camera examples

Preparation should be deterministic and produce an immutable manifest:

1. Verify source-session hashes and ground-truth labels.
2. Reconstruct a perspective-corrected crop using the recorded detector quad.
3. Preserve the original frame and quad so a future rectifier can be replayed.
4. Normalize orientation only from recorded/reviewed evidence; do not guess a
   semantic 180-degree rotation from model output.
5. Validate the exact printing and family against the pinned catalog.
6. Assign group-aware splits.
7. Write relative paths, image hashes, preprocessing version, source catalog
   revision, and family-map hash.
8. Upload the prepared release once and train from its immutable Hub revision.

Do not have the Hugging Face job discover or download the entire public image
universe. The local/source-planning phase should determine the exact required
catalog and camera objects; the job consumes a pinned prepared dataset.

## Training recipe

### Positive structure

For each recognition family, use:

- its clean catalog representative;
- controlled catalog augmentations; and
- verified camera crops from the same family.

The key positive pair is catalog-to-camera. It explicitly teaches that the
printed capture and its clean source belong together.

Continue family-level ArcFace classification, then A/B one metric-learning
addition such as supervised contrastive loss. The comparison should isolate the
effect of each change:

1. current catalog-only baseline;
2. baseline plus camera positives;
3. camera positives plus hard-negative sampling;
4. the best of those plus a dual-region representation.

Oversample camera observations enough to affect learning, while preventing a
few repeatedly photographed cards from dominating batches.

### Camera-specific augmentation

Extend the existing perspective, brightness, contrast, color, blur, sharpen,
and Gaussian-noise transforms with measured or bounded simulations for:

- white-balance/tint shift;
- local gradients, cast shadows, and controlled specular glare;
- halftone, moiré, and screen/print interference;
- chroma and demosaic noise;
- JPEG/WebP recompression;
- lens falloff and mild chromatic aberration;
- motion blur;
- sharpening halos/ringing; and
- residual corner/crop perturbation after rectification.

Every transform must preserve card identity and be recorded in the training
configuration. Extreme augmentations that erase identity should be rejected by
sample inspection and baseline-family self-retrieval checks.

### Hard-negative mining

Run current real queries against the complete family gallery. For each query,
save the highest-scoring wrong families and mine categories such as:

- the same dominant palette or composition;
- land and mana-frame lookalikes;
- the same card name with different artwork;
- different cards sharing a character or scene;
- border/layout variants;
- tokens, art cards, backs, placeholders, and unsupported non-card inputs; and
- exact-vector or perceptual-near-collision groups found during index audit.

Train the correct camera/catalog family closer and the actual confusing
families farther apart. Refresh mined negatives between candidate stages, not
from the frozen final test result after choosing a winner.

## Dual full-card and art-region experiment

A full-card embedding captures frame, title area, set/treatment styling, and
overall art. An art-region embedding reduces the influence of small print and
can improve illustration matching under glare or blur.

The proposed A/B:

1. Run the same encoder on the normalized full-card crop.
2. Run it again on a game/layout-aware art-region crop.
3. L2-normalize both embeddings.
4. Combine them with a fixed, validated weight and normalize again.
5. Generate gallery family vectors with the identical procedure.
6. Store only the combined 384-dimensional vector per family.

This adds inference work but does not double the vector index. The art crop
needs fallbacks for full-art, showcase, split, adventure, double-faced, and
other layouts; otherwise the full-card path remains authoritative.

## Family and exact-print outputs

Model training and runtime resolution must use different targets:

- **Model target:** recognition family, meaning a visible design the image can
  reasonably distinguish.
- **Resolver target:** exact printing, selected from family metadata.

For same-art and same-layout reprints, the model should not be punished for
choosing the shared family. Exact-print metrics then evaluate:

- newest-print default in quick mode;
- correct alternative list;
- exact resolution when collector/set/treatment evidence is available; and
- an explicit user-choice state when evidence is insufficient.

Different illustrations remain separate families even when they have the same
Oracle/card identity or name.

## Cross-game application

### Magic

Use Scryfall relationships and reviewed visual-family data, then train real
camera invariance. Prioritize lands, reused art, foils, and alternate frames.
Search printing alternatives for OCR/set evidence.

### Pokémon

Keep the current physical-only v2 as the production control. A camera-hardened
candidate must improve frozen camera replay without adding a wrong accept.
Build a reviewed artwork-family overlay separately because no authoritative
source currently supplies the needed illustration grouping. Never mix Pocket
rows into the physical scanner.

### Yu-Gi-Oh!

Adopt the same camera manifest, group-aware splitting, hard-negative mining,
and quick/precise resolver contract. Define family grouping from its own catalog
and reviewed imagery; do not assume Magic-specific identifiers exist.

### Future games

A game adapter must provide:

- stable exact-print IDs;
- a physical/digital eligibility policy;
- a recognition-family mapping or singleton fallback;
- release-date/newest-print ordering;
- optional title, collector, set, language, and treatment evidence fields;
- declarative filters; and
- catalog/image source revision checks.

The common trainer and package exporter consume that contract. A community
manifest may declare data but cannot introduce executable training or runtime
behavior.

## Release gates

Each candidate must pass all applicable layers:

1. **Artifact integrity:** pinned inputs, row-order checks, hashes, dimensions,
   and zero forbidden rows.
2. **Catalog self-retrieval:** representative and alternate canonical images
   retrieve their expected family.
3. **Family-disjoint synthetic evaluation:** Recall@1, Recall@5, and family
   slices.
4. **Frozen rectified camera crops:** correct-family rank, similarity, margin,
   and visual-only recall.
5. **Full session replay:** detector through resolver, with correct, wrong, and
   abstained counts.
6. **Open-set negatives:** backgrounds, card backs, unsupported cards, synthetic
   packs, and accidental shutter captures must not produce matches.
7. **Mode behavior:** quick newest-print defaults and precise alternative
   selection are correct.
8. **Platform parity:** Core ML and ONNX preprocessing/embeddings/index rows
   agree within tolerance.
9. **Package upgrade:** downloaded candidate verifies, activates atomically,
   and rolls back safely.

Report slices for game, device/platform, card frame, foil/sleeve, capture mode,
same-art families, and OCR enabled/disabled. Never approve from a single average.

## Promotion rule

A candidate replaces production only when it materially improves correct
camera accepts, does not increase wrong accepts or open-set failures, maintains
family/catalog coverage, and passes all three platform gates. Publish immutable
objects first and mutable platform manifests last.
