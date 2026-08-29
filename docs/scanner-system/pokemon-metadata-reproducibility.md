# Reproducible Pokémon scanner metadata

## Contract

The physical Pokémon scanner catalog is maintained by these repository files
(they must be committed together before a release revision is pinned):

- `mobile-apps/ios/scripts/maintain_pokemon_metadata_release.py` — the only
  maintainer entrypoint;
- `mobile-apps/ios/scripts/metadata-locks/pokemon-set-release-dates.json` — a
  compact semantic snapshot generated from one immutable official TCGdex
  `cards-database` commit;
- `mobile-apps/ios/scripts/metadata-locks/pokemon-physical-v2.lock.json` — the
  reviewed source and output lock;
- `mobile-apps/ios/scripts/build_universal_trainer_metadata.py` — the normalized
  metadata builder bound by the lock.

The lock records SHA-256 values for the tracked Pokémon source catalog, compact
set registry, optional reviewed artwork-family overlay, and builder. It also
records the physical profile, fixed provenance timestamp, expected 19,507-row
catalog hash, universal-catalog hash, and provenance hash.

The set registry may contain digital sets because it is a faithful provider
snapshot. The physical builder still rejects `series=tcgp`, `format=pocket`,
and `/tcgp/` image paths and requires every retained row to have a set code,
collector number, release date, format, and recognition-family ID.

## Offline verification

This is the routine CI/reviewer command. It performs no network access, builds
in a temporary directory, and requires byte-identical hashes:

```bash
python3 mobile-apps/ios/scripts/maintain_pokemon_metadata_release.py verify
```

The repository alias is `npm run scanner:metadata:pokemon:verify`.

Build a release into the ignored artifact area with the same checks:

```bash
python3 mobile-apps/ios/scripts/maintain_pokemon_metadata_release.py build \
  --output .artifacts/pokemon-metadata-locked/catalogs
```

Changing a source, overlay, profile, or builder without refreshing and
reviewing the lock fails before release output is accepted. The builder writes
sorted compact JSON and inherits `createdAt` from the lock, so the wall clock
cannot perturb a locked rebuild. Unlocked diagnostic builds may instead set
`--created-at` or `SOURCE_DATE_EPOCH` explicitly.

## Refreshing after a reviewed source change

Refresh only when the tracked Pokémon source catalog, reviewed artwork-family
overlay, builder semantics, or TCGdex set data intentionally changes. Resolve
and review a full 40-character TCGdex commit SHA first; never use `main` or a
tag as release input.

```bash
python3 mobile-apps/ios/scripts/maintain_pokemon_metadata_release.py refresh \
  --tcgdex-revision <40-character-commit-sha> \
  --output .artifacts/pokemon-metadata-locked/catalogs

python3 mobile-apps/ios/scripts/maintain_pokemon_metadata_release.py verify
```

Then review:

1. the semantic set-registry diff and upstream revision;
2. the source-lock input and output hashes;
3. the physical row count and zero-Pocket invariant;
4. any artwork-family overlay additions;
5. downstream model/index evaluation before promotion.

`refresh` is the only networked command. It downloads the pinned TCGdex source
archive to a temporary directory, extracts only set IDs and release dates, and
does not retain or download card images.

## Hugging Face boundary

The CPU catalog preflight consumes the checked-in source lock and semantic set
registry. A full GPU job must find a valid source-locked catalog and provenance
at its immutable `--catalog-revision`; it fails instead of rebuilding from
mutable provider URLs. Quick diagnostic jobs may still refresh catalogs, but
their output cannot be promoted as a reproducible production release.

Never copy a rebuilt metadata file over a deployed scanner package by itself.
Metadata row order, packed vectors, encoder, thresholds, and evaluation are one
atomic release and must be published together.
