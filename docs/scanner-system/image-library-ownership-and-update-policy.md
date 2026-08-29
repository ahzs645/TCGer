# Image-library ownership and update policy

**Decision date:** 2026-08-28

**Status:** normative for all new scanner training releases

TCGer owns the contents and update lifecycle of the private Hugging Face
dataset `ahzs645/tcger-scanner-images`. Hugging Face Jobs provide compute;
they are not responsible for discovering or downloading card artwork from
TCGdex, PokemonTCG.io, Scryfall, YGOPRODeck, or future catalog providers.

## Responsibility boundary

| Component | Responsibility |
|---|---|
| Local source planner | Check catalog revisions, set releases, provider timestamps, and expected card counts without downloading the complete image corpus. |
| Local image-library updater | Download only added, changed, missing, or explicitly refreshed images into the durable content-addressed cache. Apply provider fallbacks, physical/digital scope rules, licensing metadata, and review decisions. |
| Local release builder | Decode and validate every selected image, hash and deduplicate bytes, create deterministic tar shards, and emit the manifest, coverage, diff, distribution plan, and provenance. |
| Private Hugging Face dataset | Optional immutable recovery/archive copy of a locally prepared release. It is not the production job's image source. |
| Hugging Face Job | Read one pinned catalog revision and one bounded, read-only pack staged by the local CLI before GPU allocation; audit, train, evaluate, and export. It must not download an image dataset or contact public image URLs. |
| Model repository | Store checkpoints, evaluations, export artifacts, and the exact input revisions used by a run. |
| Cloudflare R2 | Distribute compact catalog, model, and ANN-index packages to iOS, Android, and web clients. Raw training images are not part of a scanner installation. |

The local cache is operational data and must not be committed to Git. Keep it
on durable local or synchronized storage, such as the TCG `Reference` folder,
and pass its configured path as `--blob-cache`. A working release directory
may remain under `.artifacts/`, which is also excluded from source control.

## Update triggers

Run the source planner on a schedule and before any proposed training run. A
new image-library release is needed when one or more of these conditions is
true:

- a provider publishes a new set or changes a catalog revision;
- card IDs, image URLs, or image bytes are added, removed, or changed;
- an unavailable provider image receives a reviewed fallback source;
- a scope rule changes, such as excluding Pokémon TCG Pocket from the physical
  scanner library;
- duplicate, reprint-family, orientation, corruption, or provenance review
  changes training eligibility;
- a periodic refresh discovers that a stable URL now serves different bytes.

A metadata-only check should stop without downloading images when the source
ledger and catalog diff show that nothing relevant changed. When a release is
required, reuse unchanged blobs from the durable cache or previous shards and
download only the delta.

## Operator workflow

1. Refresh the source ledger and release plan.
2. Normalize the affected game catalogs locally.
3. Run an incremental local sync using the prior manifest and durable cache.
4. Review `coverage.json`, `diff.json`, `distribution-plan.json`, provider
   fallbacks, licensing, and game-specific invariants.
5. Run the network-free audit. Production coverage must be 100%; do not use
   `--allow-incomplete` or trainer quarantine to publish around failures.
6. Optionally upload the reviewed release to the private dataset as recovery evidence.
7. Submit training from the operator machine with the audited local release
   mounted read-only and the matching immutable catalog SHA.
8. Preserve the previous image pack and model revisions for rollback.

Representative commands:

```bash
uv run tools/scanner-image-library/sync_training_image_library.py sync \
  --catalog /path/to/catalogs/pokemon/CardsIndexMetadata.json \
  --source-ledger .artifacts/scanner-source-plan/<date>/source-ledger.json \
  --source-plan .artifacts/scanner-source-plan/<date>/source-plan.json \
  --previous-manifest /path/to/previous/manifest.jsonl \
  --previous-root /path/to/previous/release \
  --blob-cache /path/to/durable/TCG/Reference/scanner-image-cache \
  --output .artifacts/scanner-image-library/<release-id>

uv run tools/scanner-image-library/sync_training_image_library.py audit \
  --root .artifacts/scanner-image-library/<release-id>

uv run tools/scanner-image-library/sync_training_image_library.py upload \
  --root .artifacts/scanner-image-library/<release-id> \
  --repo ahzs645/tcger-scanner-images \
  --path-in-repo releases/pokemon/<release-id>

uv run mobile-apps/ios/scripts/prepare_and_launch_two_stage_hf_job.py \
  --game pokemon \
  --bundle-revision <40-character-catalog-and-code-commit> \
  --prepared-image-library-root .artifacts/scanner-image-library/<release-id> \
  --artifact-variant bounded-family-v1
```

The local CLI synchronizes the prepared tar shards into a managed read-only
volume before creating the GPU job. The remote process does not run an image
acquisition stage or snapshot-download the private dataset.

## Release invariants

Every published image-library release must identify:

- the normalized catalog SHA and upstream provider revision;
- the manifest SHA and every content blob SHA;
- the game, physical/digital profile, and recognition-family contract;
- all provider fallbacks and why they were used;
- counts for input, valid, invalid, quarantined, and unique blobs;
- the exact private-dataset path and immutable commit SHA;
- the previous release used for the diff, when applicable.

Existing release paths and commits are immutable. Updating the library means
publishing a new versioned path and commit, reviewing its diff, and then
deliberately moving downstream training and distribution to that revision.
