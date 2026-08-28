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
  "recognitionFamilyId": "magic:illustration:provider-id",
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

## Durable image library

`tools/scanner-image-library/sync_training_image_library.py` turns normalized
catalog rows into an auditable private release. It provides:

- stable `visualIdentityId` and `sampleId` values independent of row order;
- parallel download and reuse;
- full image decode validation, dimensions, byte counts, and SHA-256;
- identity-keyed content-addressed cache;
- deterministic tar shards;
- deterministic `manifest.jsonl`, `coverage.json`, `diff.json`,
  `distribution-plan.json`, and `library.json`;
- fail-closed 100% coverage by default;
- network-free dry run and release audit;
- source ledger and plan preservation;
- private Hub upload returning an immutable commit SHA.

The durable cache key binds both visual identity and stable source URL. URL
query strings do not create new sample identities. All samples and print rows
for one recognition family receive the same deterministic
train/validation/test partition, which prevents same-art leakage after a
catalog reorder or incremental update.

No production image-library dataset was uploaded during this work. The tooling
and tests are complete locally; the first full sync, provenance review, upload,
and pin remain operational work.

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
- family-disjoint train/evaluation partitions from the durable library;
- separate family Recall@K and exact-row retrieval diagnostics;
- fail-closed rejection of Pokémon TCG Pocket rows;
- no zero-vector placeholders for missing images;
- offline extraction and verification of pinned deterministic tar shards.

Full-mode wrappers now require a 40-character immutable catalog revision and a
pinned image-library dataset revision unless the explicit legacy escape hatch
is used. The three completed 2026-08-27 full runs predate this hardening and
downloaded mutable upstream image URLs; they are usable release evidence but
not the reproducibility standard for the next run.

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
