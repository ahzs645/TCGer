# Training data and model pipeline

## Data responsibilities

The scanner pipeline uses three different data classes:

| Data | Purpose | Storage |
|---|---|---|
| Provider catalogs and normalized metadata | Recognition identity universe | Raw archives in Drive; normalized snapshots on private Hugging Face/model artifacts |
| Catalog artwork bytes | Training gallery and index generation | Private content-addressed Hugging Face image dataset |
| Real phone captures and scene datasets | Detector training and held-out camera evaluation | Private Drive/Hugging Face datasets with consent and provenance |

Catalog artwork is not a substitute for real camera evidence. Camera captures
start as evaluation-only samples; promotion to training requires a separate
reviewed decision.

## Current normalized catalog snapshot

The legacy full runs used the normalized snapshot created on 2026-08-24:

| Game | Visual rows | Source behavior |
|---|---:|---|
| Pokémon | 21,828 | TCGdex-derived metadata; later found to contain 2,321 Pocket-only rows |
| Magic | 111,131 | Scryfall paper cards, one row per visible face/image |
| Yu-Gi-Oh | 14,683 | YGOPRODeck artwork identities |
| Combined | 147,642 | Historical mixed-game training universe |

The corrected physical-only Pokémon count is 19,507. The existing catalog
product pack has a different count because product catalogs and scanner visual
identities have different inclusion and deduplication rules.

## Source-release planner

`tools/scanner-image-library/plan_source_releases.py` performs a cheap metadata
check before downloading full catalogs or images. It uses:

- Pokémon set IDs, dates, and totals;
- Scryfall set registry plus default-card bulk metadata (`updated_at`, URL,
  compressed size);
- YGOPRODeck database revision plus set codes, dates, and counts.

Signals are scheduling hints. They do not prove artwork bytes changed. Even
with unchanged signals, the planner retains a weekly catalog refresh and a
rotating 2% image audit to catch silent replacement at stable URLs.

Outputs:

- `source-ledger.json` — durable provider snapshot;
- `source-plan.json` — concrete actions: reuse/download catalog, normalize,
  diff, probe artwork, materialize changed bytes.

The planner is data-driven through
`tools/scanner-image-library/source-providers.json`. A generic JSON adapter and
future-game template define the minimum extension contract.

## Catalog normalization

`mobile-apps/ios/scripts/build_universal_trainer_metadata.py` maps provider
records into the compact `CardsIndexMetadata.json` schema:

```json
{
  "annIndex": 0,
  "cardId": "provider-stable-id",
  "name": "Card name",
  "game": "magic",
  "format": "paper",
  "setCode": "set-code",
  "setName": "Set name",
  "recognitionFamilyId": "magic:visual:oracle-id:illustration-id:style-hash",
  "exactPrintingId": "provider-printing-id",
  "releaseDate": "2026-08-28",
  "rarity": "rare",
  "imageURL": "https://provider/image",
  "price": null
}
```

Rows are assigned contiguous indices only after filtering. Physical Pokémon is
the default scanner profile and excludes `series=tcgp`, `format=pocket`, and
`/tcgp/` image paths; `--pokemon-profile all` is collection-catalog-only.
The normalized schema also carries `visualIdentityId`,
`recognitionFamilyId`, `exactPrintingId`, and game-specific verification
evidence described in [Two-stage recognition](two-stage-recognition.md).
Pokémon's reviewed overlay workflow is specified in
[Artwork-family matching](artwork-family-matching.md).
The physical Pokémon release is additionally bound by the repository-managed semantic
set registry and source/output lock described in
[Pokémon metadata reproducibility](pokemon-metadata-reproducibility.md). Its
normal build and verification commands are network-free and byte-for-byte
checked; only an explicit maintainer refresh contacts the pinned TCGdex source.

MTG family construction excludes set/collector/date/finish evidence and
includes the visible style fields documented in
[Two-stage recognition](two-stage-recognition.md). A current normalized
109,546-printing snapshot produces 67,849 visual families and a 70,113-sample
bounded training/evaluation plan, all materialized by the already-pinned image
library. Hugging Face training consumes that plan and its immutable shards; it
does not download upstream card images.

## Durable image library

`tools/scanner-image-library/sync_training_image_library.py` turns normalized
catalog rows into an auditable private release. It provides:

- stable `visualIdentityId` and `sampleId` values independent of row order;
- representative selection before network access;
- one training image per recognition family and a bounded held-out sample;
- parallel download and reuse on operator-owned storage;
- full image decode validation, dimensions, byte counts, and SHA-256;
- identity-keyed content-addressed cache;
- deterministic tar shards;
- deterministic `manifest.jsonl`, `coverage.json`, `diff.json`,
  `distribution-plan.json`, and `library.json`;
- fail-closed 100% coverage of selected representatives by default;
- network-free dry run and release audit;
- source ledger and plan preservation;
- private Hub upload returning an immutable commit SHA.

The durable cache key binds both visual identity and stable source URL. URL
query strings do not create new sample identities. All samples and print rows
for one recognition family receive the same deterministic
train/validation/test partition, which prevents same-art leakage after a
catalog reorder or incremental update.

Production image-library releases are private and pinned by immutable Hub
revision. New TrainingSetPlans may select a different subset of those validated
shards without rebuilding or redownloading the underlying image library.

## Phone captures

Phone captures are provided through a separate normalized catalog with:

- `sourceKind: capture`;
- local `imagePath`;
- reviewed `visualIdentityId`;
- consent and label-verification fields;
- private redistribution/training policy.

Approved captures remain `trainingEligible: false` initially. They should
first measure real-world glare, sleeve, crop, foil, blur, and lighting
performance. Training promotion requires compatible consent, deduplication,
identity-level split retention, and a new A/B evaluation.

## Multi-source card-localization corpus

Roboflow card-boundary archives are normalized by
`tools/card-segmentation-data/build_standardized_corpus.py` before they are
combined. Its reviewed source configuration maps whole cards, inner borders,
OCR regions, information regions, and slabs to distinct canonical categories.
It never silently treats every polygon as a card.

The compiler reads immutable ZIPs directly, verifies their inventory hashes,
deduplicates exact bytes, keeps one representative per Roboflow augmentation
family by default, links known forks into the same leakage group, and rebuilds
deterministic train/validation/test splits. It emits three COCO views:

- `coco-card-segmentation`: source whole-card masks only; canonical
  segmentation training and evaluation;
- `coco-card-detection`: whole-card polygons plus box-derived rectangles;
  detector pretraining and coarse localization;
- `coco`: every reviewed primary, auxiliary, and context label for explicit
  multi-task experiments.

Object-detection boxes are marked `bbox-derived` and cannot enter the
segmentation-quality denominator. See
[`tools/card-segmentation-data/README.md`](../../tools/card-segmentation-data/README.md)
for the reproducible archive-backed and materialized commands.

## Trainer hardening

`mobile-apps/ios/scripts/train_arcface_encoder.py` now enforces:

- identity-keyed validated caching;
- complete image coverage reports;
- fail-closed coverage by default;
- optional investigation-only quarantine with compacted, contiguous ANN rows;
- catalog fingerprint binding;
- image-library fingerprint and pinned-revision binding;
- checkpoint compatibility checks before resume;
- per-epoch checkpoint upload;
- deterministic evaluation sampling;
- one ArcFace class per recognition family instead of per printing row;
- family-vector replication across the complete exact-print export catalog;
- family-disjoint train/evaluation partitions from the durable library;
- separate family Recall@K and exact-row retrieval diagnostics;
- fail-closed rejection of Pokémon TCG Pocket rows;
- no zero-vector placeholders for missing images;
- offline extraction and verification of pinned deterministic tar shards.

Full-mode wrappers now require a 40-character immutable catalog revision and a
locally prepared, audited, family-capped pack mounted read-only at submission.
The GPU job cannot acquire upstream images or snapshot-download an image
dataset. The three completed 2026-08-27 full runs predate this hardening and are
usable release evidence but not the reproducibility standard for the next run.

## Training recipe

The completed isolated runs used:

- FastViT-T8 backbone;
- 384-dimensional embedding head;
- ArcFace classification objective;
- 12 epochs;
- three training views per identity per epoch;
- three augmented evaluation queries per sampled identity;
- batch size 256;
- per-epoch resumable checkpoints;
- one L4 GPU per game job.

The trainer exports a combined index when multiple games are trained together
and a per-game shard for every selected game. Isolated jobs use game-scoped Hub
paths so classification heads, checkpoints, and exports cannot overwrite or
resume from another game.

## Query normalization, colour-cast augmentation and fine-tuning (2026-08-30)

Measured on the labeled Dev Mode frames with the released encoders, the
band of hand-held failures previously filed as "camera-domain model
failure" is a query/gallery **colour and contrast** gap: the Magic encoder
ranks the correct family first on 79 of 108 labeled crops raw and on 104
after a grey-world white balance plus Pillow's 1 % per-channel autocontrast
(`docs/scanner-system/mtg-visual-first-policy-2026-08-29.md`). Three trainer
changes follow from it:

- `--query-normalization {none,grey-world-autocontrast}` applies the
  runtime's `QueryColorNormalization` (pixel-exact on iOS and Android) to
  every training view, gallery render and evaluation query, so a model is
  trained on the distribution it is queried with. It is recorded in the
  checkpoint config and provenance and must match the game's
  `queryNormalization` in `tools/scanner-acceptance-policies.json`
  (Magic on; Pokémon measured off — its `physical-v2` encoder was trained
  toward camera captures and loses under it).
- `apply_colour_cast`: warm ↔ cool channel gains up to 1.25× (log-uniform,
  red and blue opposed, small green wobble) with gamma up to 1.25, applied
  to half of the training views. The previous recipe had brightness,
  saturation, contrast, blur and noise but no cast.
- `--finetune-from <checkpoint>`: encoder and head weights only, with a
  fresh optimizer and cosine schedule over `--epochs` at `--lr`. Hub resume
  is not a fine-tune: it restores the finished schedule and learns nothing.

Both job wrappers forward `--lr`, `--query-normalization` and
`--finetune-from-hub-path`. `mobile-apps/ios/scripts/submit_magic_colour_finetune.sh`
uploads the trainer and wrappers under `jobs/visual-style-v2-colour/`, pins
the resulting model revision and launches the plan wrapper on an L4
(3 epochs from `exports/magic/full/visual-style-v2-5c27e506-r2/arcface-checkpoint.pt`,
lr 5e-5, ≈1 h). A fine-tuned export must be evaluated with the same
normalization the runtime applies, and its gallery re-embedded through it.

## Evaluation layers

Evaluation must be reported in separate layers:

1. **Synthetic/catalog retrieval:** deterministic augmented queries against
   the catalog gallery. Useful for training comparisons and export checks.
2. **Export parity:** PyTorch versus ONNX/Core ML embeddings, dimensions,
   normalization, and self-retrieval.
3. **Real crop replay:** recognizer behavior on correctly cropped phone cards.
4. **End-to-end camera replay:** detector, crop, recognizer, verification, and
   rejection together.
5. **Cross-game routing:** automatic-mode game selection separated from
   within-game identity accuracy.

The Pokémon paired evaluator runs the student and shipped production baseline
on the same augmented RGB pixels through each model's correct preprocessing
contract and searches the same gallery. Fixed-batch-size-one ONNX models are
evaluated sample by sample.

The current Pokémon full metric is contaminated by Pocket identities: seed 22
selected 263 Pocket identities among 2,500 evaluation identities, producing
789 of 7,500 augmented queries. It must not be described as a physical-only
acceptance result.

## Export contract

Each game release produces:

```text
arcface-checkpoint.pt
arcface-eval.json
CardsIndexMetadata.json
CardsIndexVectors-arcface.bin
CardEmbeddings-arcface.mlpackage.zip
card-embeddings-arcface-fp32.onnx
android-onnx-eval.json
provenance.json
```

The vector binary begins with little-endian int32 `count` and `dimension`,
followed by `count × dimension` signed int8 values. Metadata must contain
exactly `count` rows with `annIndex` equal to its array position.

The Android ONNX contract is fixed batch one, float32 `[1,3,224,224]` input in
RGB `[0,1]`, baked ImageNet normalization, and float32 `[1,384]` L2-normalized
output. Dynamic int8 quantization must not be used for this FastViT model; it
destroyed embedding fidelity in earlier experiments.

## Promotion policy

New catalog rows can be embedded with an accepted existing encoder after image
coverage and self-retrieval validation. Retraining is not required for every
set. Retrain when there is meaningful domain expansion, measured model
regression, new capture evidence, or a changed recognition objective.

No artifact reaches clients until model/index parity, game/format eligibility,
evaluation provenance, and platform loading tests pass.
