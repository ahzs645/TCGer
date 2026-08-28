---
pretty_name: TCGer Scanner Training Image Library
tags:
  - computer-vision
  - image-retrieval
  - tcger
---

# Scanner training image library

This tool turns normalized `CardsIndexMetadata.json` catalogs into a durable,
auditable image-byte library. It is the CPU-only gate before scanner training:
no production training job should fetch mutable upstream image URLs directly.

The release contains a deterministic `manifest.jsonl`, coverage and incremental
diff reports, a small `library.json` contract, and content-addressed image bytes
inside deterministic tar shards. The separate local blob cache is disposable
and may contain many files; only the tar-sharded release belongs in the private
Hugging Face dataset. Keep both the release and cache out of Git.

## Source-release planning (no card images)

Run the provider planner before downloading a catalog or any artwork. It reads
only small release/version endpoints and writes two local artifacts:

- `source-ledger.json` is the durable snapshot to compare on the next run.
- `source-plan.json` says whether to reuse or download a card catalog, normalize
  and diff it, probe changed artwork, and finally materialize only missing or
  changed image bytes.

```bash
uv run tools/scanner-image-library/plan_source_releases.py \
  --output .artifacts/scanner-source-plan/2026-08-27

uv run tools/scanner-image-library/plan_source_releases.py \
  --previous-ledger .artifacts/scanner-source-plan/2026-08-27/source-ledger.json \
  --library-contract .artifacts/scanner-image-library/2026-08-27/library.json \
  --output .artifacts/scanner-source-plan/2026-09-03
```

The planner fails closed: a previous source ledger proves only that metadata was
checked. It permits `reuse-catalog` only when `--library-contract` points to an
audited release whose per-game `sourceRevisions` match the current providers.
Without that proof, it keeps `download-catalog` required.

The built-in provider map is deliberately signal-first:

| Game | Cheap signals | Catalog fetched only after a signal/cadence gate |
| --- | --- | --- |
| Pokémon | Official `pokemon-tcg-data` set IDs, release dates, and totals | Pokémon TCG API card JSON, with the data-repository archive as fallback |
| Magic | Scryfall set registry plus default-cards bulk `updated_at`, URL, and compressed size | Default-cards JSONL gzip |
| Yu-Gi-Oh | YGOPRODeck database version/last-update plus set codes, dates, and counts | Bulk `cardinfo.php` JSON |

If the Pokémon data repository is temporarily unavailable, the planner falls
back to the Pokémon TCG API and records that source in the ledger. The catalog
action carries the repository archive as its own fallback.

Set releases are strong scheduling hints, not proof that artwork bytes changed.
The catalog diff is the authority for added/changed artwork, and a rotating 2%
audit detects silent replacement at stable URLs. A provider revision can cause
a metadata-only catalog refresh without causing any image download.
Even when every signal is unchanged, the plan retains a weekly catalog-refresh
action; that cadence catches card-level corrections that a set feed omits.

`source-providers.json` owns provider URLs, release windows, refresh cadence,
and audit percentage. To add a future game, copy `futureGameTemplate`, map its
JSON fields to the normalized set contract, and add the entry to `games`. Use
the `generic-json` adapter when the provider exposes JSON release/set/catalog
endpoints; add a focused adapter only when pagination or response semantics are
provider-specific. The downstream action chain and release format remain the
same for every game.

## Catalog artwork sync

Authenticate once with `hf auth login`, but build and audit locally before any
upload:

```bash
uv run tools/scanner-image-library/sync_training_image_library.py sync \
  --catalog .artifacts/huggingface/universal-arcface/catalogs/pokemon/CardsIndexMetadata.json \
  --catalog .artifacts/huggingface/universal-arcface/catalogs/magic/CardsIndexMetadata.json \
  --catalog .artifacts/huggingface/universal-arcface/catalogs/yugioh/CardsIndexMetadata.json \
  --source-ledger .artifacts/scanner-source-plan/2026-08-27/source-ledger.json \
  --source-plan .artifacts/scanner-source-plan/2026-08-27/source-plan.json \
  --blob-cache .artifacts/scanner-image-cache \
  --output .artifacts/scanner-image-library/2026-08-27

uv run tools/scanner-image-library/sync_training_image_library.py audit \
  --root .artifacts/scanner-image-library/2026-08-27
```

For later catalogs, name a new output directory and point at the prior release.
Unchanged blobs are recovered from the cache or prior tar shards. Use `--refresh`
periodically to detect an upstream URL whose bytes changed without its URL
changing.

`--source-revision` accepts a game name, exact catalog path, or `*` for a
single universal snapshot. Prefer game names when separate catalogs happen to
share the same filename; every manifest row then retains the right revision.
Normally `--source-ledger` supplies those per-game revisions automatically;
an explicit conflicting revision is rejected.
When supplied, the source ledger and plan are canonicalized, copied into the
release, hashed in `library.json`, and checked by `audit`, so the exact reason
for downloading or reusing source data travels with the Hugging Face release.

The sync also emits and hashes `distribution-plan.json`. Its per-game result
distinguishes a card-catalog update from changed artwork and turns either into
the concrete scanner-index rebuild and iOS/Android/web publish actions. The
approved trained games default to Pokémon, Magic, and Yu-Gi-Oh. Repeat
`--trained-game <key>` when a future game's model graduates; until then, a
changed future-game catalog stops at `train-and-evaluate-scanner-model` rather
than claiming app assets are ready to publish.

```bash
uv run tools/scanner-image-library/sync_training_image_library.py sync \
  --catalog /path/to/new/CardsIndexMetadata.json \
  --previous-manifest .artifacts/scanner-image-library/2026-08-27/manifest.jsonl \
  --previous-root .artifacts/scanner-image-library/2026-08-27 \
  --blob-cache .artifacts/scanner-image-cache \
  --output .artifacts/scanner-image-library/2026-09-03 \
  --refresh
```

The normal sync exits nonzero when any image is absent, corrupt, unsupported,
or too small. `coverage.json` identifies every failure. `--allow-incomplete` is
only for investigation, and the upload command refuses such a release. A
network-free `--dry-run` shows what is already recoverable locally. `audit`
reopens every tar member, decodes every image, and verifies manifest hashes.

After reviewing the diff and provenance, upload explicitly. The command uses
the current `hf` login, forces a private dataset, audits again, and prints the
immutable Hub commit SHA used to pin downstream jobs:

```bash
uv run tools/scanner-image-library/sync_training_image_library.py upload \
  --root .artifacts/scanner-image-library/2026-09-03 \
  --repo ahzs645/tcger-scanner-images
```

The release is uploaded under `release/` by default, matching the training-job
consumer. Use `--path-in-repo` only when deliberately versioning that contract.

Do not launch training with `main`. Pass the returned `pinnedRevision` to every
training/evaluation job and record it in the model's run provenance.

The full-run wrapper enforces that pin and downloads `release/` without falling
back to upstream URLs:

```bash
uv run mobile-apps/ios/scripts/run_universal_arcface_hf_job.py \
  --mode full \
  --games yugioh \
  --catalog-revision 4ae187396e03383a7a9f33816acd1531a7f390dc \
  --image-library-repo ahzs645/tcger-scanner-images \
  --image-library-revision <pinnedRevision>
```

Full runs reject a branch name or a missing image-library revision. The
`--allow-unpinned-image-sources` switch exists only to reproduce a clearly
identified legacy run.

## Identities, additions, and split leakage

`visualIdentityId` is derived from game plus stable card/artwork identity, not
the row number. Provide `artworkId` or `visualIdentityId` when the catalog has a
stronger artwork key. MTG front/back URLs get a face discriminator when the
normalized catalog lacks one. URL query strings are excluded from `sampleId`,
so CDN tokens do not manufacture new samples. Capture `imagePath` values should
be relative to their catalog; an explicit `sampleId` may be supplied when a
capture system already owns a durable identifier.

All samples sharing a visual identity must stay in one train/validation/test
partition. The tool assigns that partition by hashing `visualIdentityId`, so
catalog reorder and incremental sync cannot leak near-identical images across
splits. New official card or artwork rows enter as catalog samples; once 100%
validated they may be embedded immediately with the current encoder. Retrain
only after a meaningful catalog/domain expansion or a measured regression.

## Real phone captures

Phone photographs enter through a separate normalized catalog with
`"sourceKind":"capture"` and a local `imagePath`; never mix an unlabeled upload
folder into the upstream-art catalog. Every capture begins quarantined. It is
eligible for the held-out camera evaluation partition only when the row carries:

```json
{
  "game": "yugioh",
  "cardId": "46986414",
  "visualIdentityId": "the-reviewed-artwork-identity",
  "imagePath": "captures/46986414/device-photo-001.jpg",
  "sourceKind": "capture",
  "captureReview": {
    "consent": true,
    "labelVerified": true,
    "reviewer": "reviewer-id"
  },
  "provenance": {
    "provider": "consented-app-capture",
    "license": "internal-evaluation-only",
    "redistributionStatus": "private-only"
  }
}
```

Approved captures remain `trainingEligible: false` by design: they first measure
real-camera performance. Promotion to training requires a separate reviewed
policy/change, deduplication, consent compatible with training, and a new model
A/B evaluation. Because every capture supplies the reviewed visual identity,
any eventual promotion must retain the identity-level split rather than assign
individual photos randomly.

## Routine operating cadence

1. Snapshot and normalize each upstream catalog; record its immutable revision.
2. Run incremental sync and inspect `diff.json` for added, removed, metadata-
   changed, and byte-changed samples.
3. Require `coverage.json` status `ready` and run the network-free audit.
4. Review provenance/licensing; keep the Hub dataset private.
5. Upload and pin the returned dataset commit in index-building and training.
6. Embed new catalog art with the approved encoder; separately run camera evals.
7. Retrain only when evaluation evidence justifies it, then publish mobile packs
   only after model/index parity, cross-game rejection, and device tests pass.
