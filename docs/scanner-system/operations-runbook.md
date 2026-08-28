# Operations runbook

This runbook covers routine source checks, catalog and image-library updates,
training, evaluation, export, R2 publication, verification, and rollback.
Commands run from the repository root unless stated otherwise.

## 1. Authentication preflight

Use persistent, least-privilege credentials. Do not launch temporary
device-code bootstrap jobs.

```bash
hf auth whoami
```

The active account should be `ahzs645` or another explicitly authorized
maintainer. The token needs only the repositories and Jobs actions required by
the operation. R2 publication uses separate Cloudflare credentials or a local
Wrangler login.

Before paid GPU work, perform a CPU-only Hub read/write test against the target
repository. Never discover missing write access after training.

## 2. Check source releases without downloading images

Create a new dated plan directory:

```bash
uv run tools/scanner-image-library/plan_source_releases.py \
  --previous-ledger .artifacts/scanner-source-plan/<previous>/source-ledger.json \
  --library-contract .artifacts/scanner-image-library/<previous>/library.json \
  --output .artifacts/scanner-source-plan/<date>
```

Review:

- provider revision changes;
- new/changed set IDs, release dates, and expected counts;
- catalog action for each game;
- cadence-triggered refreshes;
- planned unchanged-image audit.

An unchanged release feed is not proof that card-level metadata or artwork is
unchanged. The weekly catalog refresh and rotating 2% artwork audit remain in
the plan.

## 3. Rebuild product catalogs when required

Build and synchronize catalog packs:

```bash
npm run catalogs:build
npm run catalogs:build-sealed
```

For one supported game, use the builder's `--game` option. Preserve existing
manifest entries for games not rebuilt. Inspect generated counts, versions,
SHA-256 values, and content-addressed filenames under `data/catalog`.

Before publishing:

```bash
npm run assets:r2:publish-catalogs -- --dry-run
```

Then publish with the configured R2 credentials or Wrangler login:

```bash
npm run assets:r2:publish-catalogs
```

After publication, fetch the live manifest and compare version, counts, bytes,
and hash to the dry-run plan.

## 4. Normalize scanner metadata

Prepare game-specific trainer metadata from pinned raw sources:

```bash
uv run mobile-apps/ios/scripts/build_universal_trainer_metadata.py \
  --pokemon /path/to/pokemon.json \
  --mtg /path/to/scryfall-default-cards.json \
  --yugioh /path/to/yugioh.json \
  --output .artifacts/huggingface/universal-arcface/catalogs
```

Required invariants before the next Pokémon release:

- every row has an explicit physical/digital format;
- zero accepted physical rows have TCGdex series `tcgp`;
- zero accepted physical rows have `format: pocket`;
- zero accepted physical rows contain `/tcgp/` in the image path;
- physical Pokémon row count for source SHA
  `e1b4ed3a64f59b0a1970f5c0d8d29dffa746f7cf02959bdb39bdeae2b3718141`
  is 19,507, with 2,321 exclusions;
- set-code casing or prefixes are not used as the Pocket discriminator.

For every game, assert contiguous `annIndex`, unique expected visual identities,
non-empty image references, and complete source checksums.

## 5. Build and audit the durable image library

Run the incremental sync using the plan and previous release:

```bash
uv run tools/scanner-image-library/sync_training_image_library.py sync \
  --catalog .artifacts/huggingface/universal-arcface/catalogs/pokemon/CardsIndexMetadata.json \
  --catalog .artifacts/huggingface/universal-arcface/catalogs/magic/CardsIndexMetadata.json \
  --catalog .artifacts/huggingface/universal-arcface/catalogs/yugioh/CardsIndexMetadata.json \
  --source-ledger .artifacts/scanner-source-plan/<date>/source-ledger.json \
  --source-plan .artifacts/scanner-source-plan/<date>/source-plan.json \
  --previous-manifest .artifacts/scanner-image-library/<previous>/manifest.jsonl \
  --previous-root .artifacts/scanner-image-library/<previous> \
  --blob-cache .artifacts/scanner-image-cache \
  --output .artifacts/scanner-image-library/<date>
```

Review `diff.json`, `coverage.json`, `distribution-plan.json`, source
provenance, and licensing. Coverage must be `ready` and 100% for a production
release.

Audit without network access:

```bash
uv run tools/scanner-image-library/sync_training_image_library.py audit \
  --root .artifacts/scanner-image-library/<date>
```

Do not use `--allow-incomplete` or trainer quarantine for a production release.

## 6. Upload and pin the image release

```bash
uv run tools/scanner-image-library/sync_training_image_library.py upload \
  --root .artifacts/scanner-image-library/<date> \
  --repo ahzs645/tcger-scanner-images
```

Record the returned immutable `pinnedRevision`. Never pass `main` to a full
training job. Also pin the normalized catalog revision.

## 7. Run a cheap preflight

Before full training:

1. verify Hub model and image-dataset revisions exist;
2. dry-run/materialize a small image subset from the pinned release;
3. load the intended checkpoint, if any;
4. confirm catalog and image-library fingerprints match;
5. run a quick isolated job for the changed game;
6. verify checkpoint persistence, evaluation JSON, vector header, metadata row
   order, and platform export mechanics.

Quick jobs are plumbing tests and cannot be promoted as production models.

## 8. Submit a full isolated training job

Example for one game:

```bash
hf jobs uv run mobile-apps/ios/scripts/run_universal_arcface_hf_job.py \
  --flavor l4x1 \
  --timeout 24h \
  --secrets HF_TOKEN \
  -- \
  --hub-repo ahzs645/tcger-universal-arcface \
  --mode full \
  --games pokemon \
  --catalog-revision <40-character-catalog-commit> \
  --image-library-repo ahzs645/tcger-scanner-images \
  --image-library-revision <40-character-image-library-commit>
```

Confirm current hardware pricing immediately before submission. The earlier
US$45–60 figure was a planning ceiling, not a standing authorization or an
actual-cost record.

Monitor without repeatedly polling:

```bash
hf jobs inspect <job-id> --format json
hf jobs logs <job-id> --tail 200
```

Checkpoints persist after every epoch. A resumed job must refuse changed
catalog fingerprints, image-library fingerprints, revisions, or training-view
configuration.

## 9. Evaluate before export approval

Required evaluation artifacts:

- synthetic Recall@1 and Recall@5 for the changed game;
- paired Pokémon baseline comparison when Pokémon changes;
- PyTorch/export parity;
- correct input/output contract and L2 norm;
- metadata/vector header and row-order validation;
- self-retrieval and zero-row scan;
- held-out real crop replay;
- end-to-end real phone replay;
- false-accept and cross-game routing analysis;
- per-game threshold/ambiguity calibration.

Do not promote from synthetic retrieval alone. Preserve zero wrong accepts as
a primary constraint, not only top-1 recovery.

## 10. Export platform runtimes

The full training output includes Core ML. Android/web use the checked fp32
ONNX export path. Validate its `android-onnx-eval.json` against the checkpoint
and exact ONNX bytes.

Expected ONNX contract:

```text
input:  pixel_values float32 [1,3,224,224], RGB [0,1]
graph:  ImageNet normalization baked in
output: embedding float32 [1,384], L2 normalized
```

Do not dynamically quantize FastViT to int8. The reference index is int8;
that does not imply the encoder weights may be quantized the same way.

## 11. Build the browser index

```bash
cd backend
npx --no-install tsx src/scripts/build-arcface-web-index.ts \
  --bin <export>/CardsIndexVectors-arcface.bin \
  --metadata <export>/CardsIndexMetadata.json \
  --tcg <game> \
  --model-url <game>-card-embeddings-arcface.onnx \
  --version <next-version> \
  --out ../frontend/public/scan-index/<game>-embeddings-arcface.json
```

Update the local scan-index manifest, run frontend type checking/tests, and run
scanner asset diagnostics. The web publisher gzip-transfers index JSON while
hashing and reporting its decoded representation.

## 12. Dry-run all platform publications

Browser:

```bash
npm run assets:r2:publish-scan-index -- --dry-run
```

iOS:

```bash
npm run assets:r2:publish-ios-scan-pack -- \
  --game <game> \
  --version <version> \
  --model-package <extracted-mlpackage> \
  --vectors <export>/CardsIndexVectors-arcface.bin \
  --metadata <export>/CardsIndexMetadata.json \
  --evaluation <export>/arcface-eval.json \
  --provenance <export>/provenance.json \
  --dry-run
```

Android:

```bash
npm run assets:r2:publish-android-scan-pack -- \
  --game <game> \
  --version <version> \
  --model <export>/card-embeddings-arcface-fp32.onnx \
  --vectors <export>/CardsIndexVectors-arcface.bin \
  --metadata <export>/CardsIndexMetadata.json \
  --onnx-eval <export>/android-onnx-eval.json \
  --dry-run
```

Compare counts, dimensions, hashes, bytes, thresholds, evaluation, and
provenance across all three plans before any write.

## 13. Publish and verify

Repeat each approved command with the configured R2 publication mode, such as
`--wrangler`. Publish immutable objects first and manifests last; the tools
enforce this order.

Then verify:

- live manifest version and object path;
- object availability and content encoding;
- decoded hash/bytes in browser diagnostics;
- iOS install, compile, activate, scan, update, and removal;
- Android install, activate, scan, failed-update retention, and removal;
- browser cold load, IndexedDB reuse, offline reload, and automatic/explicit
  modes;
- catalog IDs resolve every returned scanner candidate.

## 14. Routine updates without retraining

For a small new set:

1. refresh and normalize the catalog;
2. sync and audit new image bytes;
3. embed added/changed visual identities with the accepted encoder;
4. rebuild a complete contiguous index and metadata file;
5. run self-retrieval, real-camera regression, and threshold checks;
6. publish new indexes while retaining the model if the evidence passes.

Retrain only when the domain or evidence justifies it.

## 15. Rollback and incident handling

For a bad release:

1. stop further publication;
2. identify whether the defect is manifest, bytes, model, index, metadata,
   threshold, catalog identity, or client code;
3. repoint the mutable manifest to the last accepted immutable release;
4. preserve the failed manifest, hashes, logs, and evaluation for analysis;
5. never overwrite a content-addressed object;
6. increment the corrected release version even if model weights are reused.

If a source or training revision is uncertain, do not resume or patch the
artifact in place. Rebuild from pinned inputs.
