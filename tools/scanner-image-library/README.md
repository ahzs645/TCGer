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

The release contains every exact-print catalog row in deterministic
`manifest.jsonl`, but fetches blobs only for a bounded representative pack.
By default it selects one image for each training recognition family and up to
two for each held-out family. Coverage, incremental diffs, `library.json`, and
content-addressed tar shards describe that pack. The separate local blob cache
is disposable. Keep both the release and cache out of Git.

## TrainingSetPlan: selection before storage

`build_training_set_plan.py` is the small, platform-neutral authority for what
the encoder should actually consume. It reads normalized catalogs only; it
does not open or download card images. Its output contains:

- `training-set-plan.json`: policies, source hashes, per-game readiness, and
  counts;
- `families.jsonl`: one row per recognition family and its single deterministic
  train/validation/test partition;
- `samples.jsonl`: only the selected training/evaluation references, including
  immutable shard/blob locations when an existing validated library has them.

The catalog remains one row per exact printing. The plan normally selects one
training reference per family and up to two references per held-out family.
Consequently, a new printing can update the collection catalog without
silently enlarging the training run. `neededImages` is the exact bounded list
that still requires materialization; `trainingReady` is true only when every
selected reference resolves to validated bytes.

The planner has no hard-coded supported-game list. A future game participates
by supplying normalized `game`, `cardId`, an image reference, and preferably a
stable `recognitionFamilyId`; without the latter it safely falls back to one
family per visual identity. Game-specific catalog adapters remain responsible
for exclusions such as Pokémon Pocket and non-identifying MTG backs.

```bash
python3 tools/scanner-image-library/build_training_set_plan.py \
  --catalog /path/to/pokemon/CardsIndexMetadata.json \
  --catalog /path/to/magic/CardsIndexMetadata.json \
  --catalog /path/to/yugioh/CardsIndexMetadata.json \
  --validated-manifest pokemon=/path/to/pokemon/manifest.jsonl \
  --validated-manifest magic=/path/to/magic/manifest.jsonl \
  --output .artifacts/training-set-plans/universal-v1
```

Image-library sync/repack is a downstream materialization operation. GPU jobs
should consume a pinned TrainingSetPlan and fail if its file hashes, catalog
revisions, selected counts, or validated blob contracts do not match.

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

Representative selection happens before any network fetch. Override
`--training-samples-per-family` or `--evaluation-samples-per-family` only for a
reviewed experiment; production training requires exactly one training image
per family. Unselected reprints remain in the manifest and final scanner
catalog, but do not create image downloads or extra ArcFace training rows.

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

After reviewing the diff and provenance, the release may be uploaded as a
private recovery/archive copy:

```bash
uv run tools/scanner-image-library/sync_training_image_library.py upload \
  --root .artifacts/scanner-image-library/2026-09-03 \
  --repo ahzs645/tcger-scanner-images
```

Production training does not snapshot-download that dataset. Launch from the
operator machine with the audited local pack. The CLI finishes staging the
read-only volume before allocating the GPU:

```bash
uv run mobile-apps/ios/scripts/prepare_and_launch_two_stage_hf_job.py \
  --game yugioh \
  --bundle-revision 4ae187396e03383a7a9f33816acd1531a7f390dc \
  --prepared-image-library-root .artifacts/scanner-image-library/2026-09-03 \
  --artifact-variant bounded-family-v1
```

Full runs reject a missing mounted pack, a pack without the family-cap
contract, incomplete coverage, mutable upstream fetching, and more than 75,000
selected images by default. Hub dataset snapshot downloads require a separate
legacy diagnostic flag and cannot be used by the production launcher.

### Magic reprint and visual-family audit

Before publishing a Magic image library or accepting catalog-only evaluation,
join the compact runtime metadata back to the exact Scryfall bulk snapshot and
audit reprints, reused illustrations, partition leakage, and exported-vector
collisions:

```bash
uv run tools/scanner-image-library/audit_mtg_visual_families.py \
  --metadata /path/to/magic/CardsIndexMetadata.json \
  --scryfall-bulk /path/to/default-cards.jsonl.gz \
  --vectors /path/to/CardsIndexVectors-arcface.bin \
  --output .artifacts/mtg-visual-family-audit.json
```

Repeated Oracle or illustration identities are legitimate reprints, not rows
to delete blindly. The audit fails them into review when the same illustration
crosses training/evaluation partitions, a non-identifying face such as a shared
Art Series reverse enters the index, distinct Oracle identities quantize to the
same vector, or the runtime catalog no longer matches the reviewed source.

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
