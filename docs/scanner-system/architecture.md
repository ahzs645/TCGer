# System architecture

## Product goal

TCGer should identify cards locally across multiple trading card games while
remaining usable offline. A game can provide three user-installable capability
families:

- a card catalog for search, browsing, ownership, and identity resolution;
- optional pack-opening and sealed-product data;
- an optional local scanner runtime.

The current implementation delivers those capabilities through separate
manifest systems. The proposed game-package registry will unify discovery and
installation without combining all bytes into one mandatory download.

## Recognition architecture

```text
camera frame
    |
    v
shared card detector and crop/rectification
    |
    +--> selected game --> that game's encoder --> that game's vector shard
    |
    +--> automatic mode --> each compatible installed encoder/shard
                              |
                              v
                     merge calibrated candidates
                              |
                              v
                OCR, set code, collector number,
                card face, and printing verification
```

The detector answers “where is the card?” The encoder and index answer “which
visual identity is closest?” Metadata and OCR answer “which exact printing is
this?” Those are separate failure domains and must be measured separately.

## Shared runtime contract, per-game models

All three current models share:

- FastViT-T8 backbone (`fastvit_t8.apple_in1k`);
- 224 × 224 RGB input;
- float32 input in `[0,1]`;
- ImageNet normalization embedded in the deployed graph;
- 384-dimensional L2-normalized output;
- packed int8 reference vectors using scale 127;
- cosine similarity search;
- metadata and vectors joined by contiguous `annIndex`.

They do not currently share weights. Pokémon, Magic, and Yu-Gi-Oh were trained
as isolated jobs with independent ArcFace classification heads and checkpoints.
This avoids one game dominating another and lets each game update, calibrate,
and roll back independently.

The browser supports automatic mode even when models differ. It groups shards
by model contract, computes an embedding with each required model, searches the
compatible shard, and merges candidates by their calibrated similarity. This
costs more inference than a true shared encoder, so automatic mode remains an
optimization and calibration target rather than proof that the encoders are
universal.

## Two scanning modes

### Explicit game mode

The user selects Pokémon, Magic, or Yu-Gi-Oh. Only that game's installed model
and index are searched. This is the safest production path because its
threshold and ambiguity margin are calibrated within one game.

### Automatic mode

The runtime searches every compatible installed game and lets the winning
candidate determine the game route. With heterogeneous encoders, the browser
runs each model separately. Mobile downloaded runtimes are intentionally kept
explicit-mode until cross-game score calibration is supported by held-out
real-phone evidence.

## Identity layers

The system needs several identifiers because “card” is ambiguous:

| Identifier | Meaning |
|---|---|
| `game` | Stable lowercase namespace such as `pokemon`, `magic`, or `yugioh` |
| `cardId` | Provider/catalog identity returned to product features |
| `visualIdentityId` | Stable artwork/face identity used for training and split assignment |
| `recognitionFamilyId` | Visual class and split group; several exact printings may share it |
| `exactPrintingId` | Collection printing selected by second-stage evidence |
| `sampleId` | One concrete image sample for a visual identity |
| `annIndex` | Contiguous row position in one exported vector shard |
| catalog fingerprint | Hash of the ordered class-to-metadata mapping |
| image-library fingerprint | Hash of validated training-image identities and bytes |

`annIndex` is never a durable card identity. It can change whenever an index is
rebuilt. Catalog and visual identities must remain stable across row reorder,
provider URL tokens, and incremental releases.

Magic may have multiple visible faces for one catalog object and reprints that
share one Scryfall illustration. Yu-Gi-Oh may have multiple artwork images for
one passcode. Those remain separate gallery rows while shared artwork maps to
one recognition family and exact-print evidence resolves the product identity.
See [Two-stage recognition](two-stage-recognition.md).

## Format and eligibility

Game identity is not enough to decide whether a row belongs in a physical
scanner. Each row needs an explicit format/domain field, for example:

- `tabletop` or `paper` — physical scanner eligible;
- `pocket` or `digital` — collection-catalog eligible but physical scanner
  ineligible.

The Pokémon catalog intentionally supports TCG Pocket for collection browsing,
but the physical-scanner pipeline must reject TCGdex series `tcgp`. The stable
`/tcgp/` asset path is defense in depth, not the primary semantic marker. Set
code patterns are not safe eligibility rules.

## Catalog, pack, and scanner boundaries

### Catalog

The catalog is the product identity foundation. It powers search, set browsing,
collection features, and printing metadata. Catalog packs are relatively small
because they contain metadata and remote image references rather than every
card image.

### Offline packs

“Offline packs” currently covers two different concepts that should remain
distinguishable:

1. Sealed-product and pack-collation metadata.
2. Cached visual assets needed to open selected sets without a network.

These are optional and can be installed per game or per set. They depend on
catalog identities but should not duplicate the catalog's canonical card rows.

### Offline scanner

The scanner runtime is a calibrated atomic unit:

- model;
- vector index;
- metadata in the exact same row order;
- thresholds and ambiguity policy;
- evaluation and provenance references.

A model from one release must never be paired with vectors from another.
Clients stage and validate the complete unit before changing the active
version.

## Detector and recognizer separation

Roboflow scene datasets train and evaluate card detection, cropping, and
rectification. They are incomplete as identity catalogs and must not determine
recognition coverage. Authoritative provider catalogs supply recognition
references.

This separation explains a recurring diagnostic rule: when a known card never
reaches the recognizer, adding more catalog rows cannot fix the problem. The
detector, quad, crop, glare, and blur evidence must be inspected first.

## Security and trust boundaries

- Training artwork and phone captures stay private.
- Public R2 contains only runtime assets, indexes, catalog metadata, and pack
  assets approved for client delivery.
- Every remotely installed file has an expected byte count and SHA-256 digest.
- Mutable manifests are published last and point only to immutable objects.
- Future third-party games may provide data and models, but not arbitrary
  remotely executable client code.
- Pack behavior should be represented through a validated declarative schema.
  A game requiring new executable behavior still needs an app release.

## Compatibility rules

Every scanner release should declare or transitively bind:

- game and format scope;
- catalog identity/fingerprint;
- prepared image-pack manifest SHA used to train or embed;
- encoder name, weights hash, input contract, dimension, and output norm;
- index count and vector header;
- threshold set and calibration evidence;
- minimum client/schema version.

The proposed game-package framework adds dependency edges between the catalog,
pack, and scanner manifests without replacing their content-addressed payloads.
