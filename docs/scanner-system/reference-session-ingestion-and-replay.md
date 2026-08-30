# Reference-session ingestion and replay

**Status date:** 2026-08-29

This runbook explains how exported scanner sessions become durable reference
evidence without confusing a device prediction with ground truth or leaking
evaluation images into training.

## Canonical library

On the current operator workstation, the canonical session library is:

```text
/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference/TCGer-Session-Reference
```

Use a `TCGER_REFERENCE_LIBRARY` shell variable in commands on other machines;
the absolute Google Drive mount path is not part of the data contract.

```sh
TCGER_REFERENCE_LIBRARY="/path/to/Reference/TCGer-Session-Reference"
```

The structure is:

```text
TCGer-Session-Reference/
  README.md
  manifest.json
  provenance.csv
  checksums.sha256
  sessions/
    scan-session-YYYYMMDD-HHMMSS/
      results.json
      evidence.json
      frame-....jpg
      attempt-....jpg
  labeling/
    ... private labeling state and backups ...
```

- `sessions/` preserves complete app exports byte-for-byte.
- `manifest.json` is the machine-readable session inventory and provenance.
- `provenance.csv` is the same provenance in review-friendly form.
- `checksums.sha256` is the per-file integrity authority.
- aggregate v2 session digests hash sorted `relative-path`, line feed, file
  hash, line feed pairs. Old v1 aggregate values are historical; per-file
  hashes remain authoritative.

The session library is private evaluation/diagnostic data. It is not a client
asset and should not be committed to the public repository.

## What an export means

An export records:

- original captured frames;
- intermediate attempt crops where enabled;
- detector/evidence fields;
- the model and resolver outcome recorded on the device; and
- enough provenance to reproduce or diagnose the result.

The recorded result is a **before-baseline**, not automatically ground truth.
Ground truth is added only after human review using readable title, collector
number, a verified flat capture of the same physical card, or another explicit
source. Unsupported/no-card frames need an explicit negative label.

## Ingest procedure

The repository ingester accepts:

- one extracted `scan-session-*` directory;
- a directory containing several sessions; or
- an app `Export All` zip.

Always dry-run first:

```sh
python3 scripts/ingest_devmode_session.py \
  --dry-run \
  --library "$TCGER_REFERENCE_LIBRARY" \
  "/path/to/scan-session-or-export.zip"
```

Review the new, duplicate, and conflict counts. Then ingest:

```sh
python3 scripts/ingest_devmode_session.py \
  --library "$TCGER_REFERENCE_LIBRARY" \
  "/path/to/scan-session-or-export.zip"
```

The ingester:

1. discovers session directories;
2. ignores `.DS_Store` when hashing;
3. computes every source-file SHA-256;
4. compares same-ID sessions byte-for-byte;
5. records identical duplicates as additional sightings without duplicating
   stored files;
6. refuses a same-ID/different-content conflict;
7. copies new session bytes while preserving timestamps;
8. updates manifest, provenance, and checksum files; and
9. prints the replay and labeling next steps.

It never merges the contents of two conflicting session directories.

## Finder suffixes and stable session IDs

macOS may add a suffix such as ` 2` when a directory is downloaded twice. That
suffix is not part of the app session ID. Do not permanently ingest
`scan-session-YYYYMMDD-HHMMSS 2` as a new identity.

Use a temporary directory, copy the folder to its original canonical basename,
and ingest that canonical copy. The source bytes must remain unchanged; verify
with a recursive diff or per-file hashes. If a canonical session with that ID
already exists, let the ingester determine duplicate versus conflict.

Do not rename a directory already inside the canonical library by hand because
that would desynchronize manifest, provenance, and checksums.

## Recent ingestion record

The following source sessions were incorporated on 2026-08-29:

| Canonical session | Frames | Files | Allocated/source bytes noted at ingest |
|---|---:|---:|---:|
| `scan-session-20260829-155957` | 7 | 16 | 9,670,656 |
| `scan-session-20260829-200235` | 27 | 56 | 33,382,400 |

Together they contributed 34 frames and 72 files. The second source arrived as
`scan-session-20260829-200235 2`; it was normalized through a temporary
canonical copy before ingest. Dry-run reported two new sessions, zero
duplicates, and zero conflicts. Source-to-destination recursive comparisons
were clean after ingestion.

Ingestion updated `manifest.json`, `provenance.csv`, and `checksums.sha256`. The
ingestion operation itself did not add semantic ground-truth labels. The 27
Magic frames from `scan-session-20260829-200235` were subsequently reviewed and
added to `DevModeSessionReplayTests.expectedCards`; together with the August 27
session they now form the 49-frame Magic policy replay.

## Integrity verification

From the library root:

```sh
cd "$TCGER_REFERENCE_LIBRARY"
shasum -a 256 -c checksums.sha256
```

For a specific newly ingested session, also compare source and destination:

```sh
diff -qr \
  "/path/to/source/scan-session-YYYYMMDD-HHMMSS" \
  "$TCGER_REFERENCE_LIBRARY/sessions/scan-session-YYYYMMDD-HHMMSS"
```

No output means the trees are identical. Ignore only a known Finder metadata
file that the ingester itself excludes; do not ignore changed JSON or images.

## Ground-truth labeling

Single-card labels currently live in
`mobile-apps/ios/TCGer/TCGerTests/DevModeSessionReplayTests.swift`:

- `expectedCards` maps `session/frame.jpg` to an exact catalog printing ID.
- `expectedNoMatch` identifies true open-set negatives.
- known Simulator divergences document device Vision differences; they are not
  a place to hide a new model regression.
- known encoder losses and wrong accepts are explicit debts. The desired change
  is to remove them, not add new examples casually.

Labeling rules:

1. Inspect the original full-resolution frame, not only the app's crop.
2. Prefer exact printing evidence: collector number, set, language, treatment,
   and readable title.
3. If only the visual family is knowable, record family truth in the appropriate
   evaluation artifact rather than inventing an exact printing.
4. Treat an existing app prediction only as a candidate.
5. Have ambiguous, clipped, or occluded examples reviewed explicitly.
6. Record no-match only when the intended product behavior is rejection.
7. Preserve the rationale for corrections and exact-print decisions.

Binder pages also require pocket-level ground truth. A page-level device result
is not enough to score missed, duplicate, rotated, or incorrect individual
pockets.

## Replay current production

The ingester prints the authoritative command. At the time of this document:

```sh
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  TEST_RUNNER_DEVMODE_SESSIONS_DIR="$TCGER_REFERENCE_LIBRARY/sessions" \
  xcodebuild test \
  -project mobile-apps/ios/TCGer/TCGer.xcodeproj \
  -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/DevModeSessionReplayTests \
  -only-testing:TCGerTests/BinderSessionReplayTests
```

The replay runs the production coordinator, not just nearest-neighbor lookup.
It therefore exercises detection, rectification, encoder, index, OCR/evidence,
resolver, binder behavior, and rejection policy.

## Replay a candidate release

For a locally staged candidate, point the replay harness to a release directory
containing:

- `CardEmbeddings-arcface.mlmodelc`;
- `CardsIndexVectors-arcface.bin`; and
- `CardsIndexMetadata.json`.

Use `DEVMODE_SCANNER_RELEASE_DIR` through the test-runner environment supported
by the Xcode scheme. Keep the production run and candidate run on the same
session set and labels. Report paired changes:

- newly correct accepts;
- correct accepts lost to abstention;
- new wrong accepts;
- wrong accepts removed;
- unchanged abstentions;
- open-set negative outcomes; and
- known device/Simulator divergence separately.

Do not declare success from aggregate acceptance count. Accepting more is a
regression if the additional accepts are wrong.

## Device versus Simulator

Apple Vision detection/segmentation can choose different quads for identical
pixels on device and Simulator. When a recorded device result does not replay:

1. compare detector quads and attempt crops;
2. reproduce the same result on an unmodified/pinned control worktree;
3. classify it as a platform divergence only with that evidence; and
4. retain device-side replay or manual evidence for the release decision.

Never update an allowlist simply because the latest branch fails.

## Training/evaluation boundary

Reference sessions used to measure a candidate are frozen evaluation data.
They must not enter that candidate's training or hard-negative selection.

If real camera images are needed for training:

1. collect separate consented sessions;
2. assign physical-card and session group IDs;
3. create the camera-corpus manifest described in
   [Camera data and model hardening](camera-data-and-model-hardening.md);
4. deny evaluation session IDs and hashes during dataset preparation; and
5. evaluate on untouched sessions from different physical cards, sessions, and
   preferably devices.

An evaluation miss may inform a class of augmentation or the next collection
plan. Copying that exact frame into training and then reporting the same replay
as independent evidence is leakage.

## Session lifecycle

The durable workflow is:

1. Export from dev mode.
2. Preserve the source until canonical verification completes.
3. Dry-run the ingester.
4. Ingest or resolve conflicts.
5. Verify checksums and source parity.
6. Human-label new frames/pockets.
7. Replay production to establish a baseline.
8. Replay the candidate with identical inputs.
9. Diagnose misses by pipeline stage.
10. Keep the session frozen for future regressions.

This makes every scanner claim traceable to immutable pixels, explicit truth,
the exact model/index package, and a reproducible runtime path.
