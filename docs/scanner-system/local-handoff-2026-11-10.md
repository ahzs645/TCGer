# Local handoff — what only the Mac can see or run

**November 10, 2026.** Written from a cloud session that had the repository,
the shared `Reference` Drive folder (read-only, through its public link) and
read-only listings of the two private Hugging Face repositories. It could
not see the Mac. Everything below marked *from docs* was read in the
repository's records and not checked against the machine.

## What exists only on the Mac

| What | Why it matters | State as far as the cloud session could tell |
|---|---|---|
| `.artifacts/` working tree (not in git): geometry releases, checkpoints, experiment state, run configs and job specs, camera corpus, release staging | Source of every experiment input | A verified snapshot from September 14 is on Drive (`Reference/TCGer-Geometry-Archive/2026-09-14`, 7.91 GB, 395,732 paths). **Anything created or changed after September 14 is only on the Mac.** |
| Durable label state after September 14 | Reviewed corners, queues, review history | The automatic backup on Drive lists 2,737 files in its last September 14 snapshot and **zero files in every snapshot from September 25 to October 7**; `latest.json` points at an empty one. Verified by reading the snapshot manifests. |
| FiftyOne databases and their exports | Label source of truth for the studios | *From docs.* The Drive journal was last modified September 10. |
| Dev Mode sessions not yet ingested | New evaluation data | The Drive session library ends at `scan-session-20260909-231206`. Any later session is on the phone or the Mac only. |
| Geometry release versions | Reproducing older experiments | *From docs:* only 14 of the 32 local release manifests match the Hub; all 32 are in the Drive archive. |
| `~/Library/Caches/TCGer/session-labeling` | Thumbnails, crops, alternate detector weights | *From docs.* Regenerable; not needed. |
| Xcode, simulators, a physical iPhone, Maestro | Building iOS and running XCTest, the replay gates and device suites | Not available in the cloud session. **The iOS changes on `main` have never been compiled.** |
| Hugging Face login (`hf auth whoami` = `ahzs645`) with repo write and Jobs | Submitting training jobs, downloading private checkpoints | The cloud session can list the private repos but cannot download their binaries or submit jobs. |
| Cloudflare R2 publishing credentials | Republishing manifests or packs | Not available in the cloud session. Nothing was republished. |
| Android release signing key | Signed APKs | Not needed for this work. |
| Studio servers on `127.0.0.1:8773`–`8776` | Review tools and the backup settings page | Local only. |

Not Mac-only, for reference: the training corpus
`card-geometry-orientation-validation-v2`, both benchmark releases and the
four selected checkpoints are on the Hub; the September 13 run configs and
job specs are in the Drive archive; the frozen phone session and the
identity-review queue are in `Reference`.

## What to run locally, in order

Pull `main` first (`f1ec3dc` or later).

### 1. Build iOS and run the unit tests — blocking

Four Swift files changed without ever being compiled:
`CardScanner/Embedding/QueryColorNormalization.swift`,
`CardScanner/Embedding/CardEmbeddingEncoder.swift`,
`CardScanner/ScannerGameAcceptancePolicy.swift`,
`CardScanner/ScannerCaptureQuality.swift`, plus tests in
`ScannerCoreAlgorithmTests.swift` and `ScannerCaptureQualityTests.swift`.

```sh
xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/ScannerCoreAlgorithmTests \
  -only-testing:TCGerTests/ScannerCaptureQualityTests
```

Then the full local suite: `npm run verify:ios:local`.

**Bring back:** any compile error with file and line, and the pass/fail
counts.

### 2. Replay gates with and without the blend — decides whether to turn it on

Run each gate twice from the same commit: once as is, once with
`TEST_RUNNER_SCANNER_QUERY_NORMALIZATION=blend` on the `xcodebuild`
invocation (the `TEST_RUNNER_` prefix is what passes it to the tests; see
`mobile-apps/ios/TCGer/SCANNER_TESTING.md` for the other variables).

- `TCGerTests/DevModeSessionReplayTests` and
  `TCGerTests/BinderSessionReplayTests` with
  `TEST_RUNNER_DEVMODE_SESSIONS_DIR=<Reference>/TCGer-Session-Reference/sessions`
- `TCGerTests/RoboflowArchiveDiagnosticTests` with
  `TEST_RUNNER_ROBOFLOW_REPLAY_DIR=<Reference>/TCGer-Scanner-Datasets/ios-replay`
  and `TEST_RUNNER_ROBOFLOW_REPORT_PATH=<file>` (the 2,336-image precision
  gate; current floors are in the `Reference` README).

The override forces the blend for every game, including Magic, which today
uses plain normalization. Report Pokémon and Magic separately.

**Bring back:** for each gate and each mode, the counts of correct accepts,
wrong accepts and abstentions, and the names of any frame that was accepted
before and is not accepted with the blend, or is newly accepted wrongly.

### 3. Confirm the identity proposals

The proposals were checked against the **live** Pokémon metadata (SHA-256
`6d7e2721c94b55e7d32f49ad2a5299c4c515f1398febbe246bdab58c8a054629`). The
replay tool requires each confirmed identity's catalog hash to equal the
recognition index it is replayed against, so serve the review from a models
folder that holds that file as `pokemon/CardsIndexMetadata.json` (it is the
`metadata` object named in
`https://assets.tcger.ahmadjalil.com/android/scan-assets/pokemon/manifest.json`),
alongside the Magic and Yu-Gi-Oh! catalogs.

```sh
python3 tools/card-geometry/card_identity_review.py serve \
  --queue <Reference>/TCGer-Labeling/recognition-reviews/phone-20260909-identity-v1/queue.json \
  --models-root <models folder> \
  --storage <Reference>/TCGer-Labeling/recognition-reviews/phone-20260909-identity-v1 \
  --suggestions docs/scanner-system/benchmarks/2026-11-10-query-blend/identity-proposals-phone-20260909.json
```

105 of the 106 cards load a suggestion. `F54-C1` is a German basic Fire
Energy with no catalog row; mark it unreadable or leave it pending. Eighteen
cards are German printings proposed as the English row with the same
collector number: decide whether that counts as correct before confirming
them.

**Bring back:** that `verified-identities.json` now exists in that Drive
folder, how many were confirmed, and the German-card decision.

### 4. Check the automatic backup

Open `http://127.0.0.1:8774/`, and look at
`~/.config/tcger/studio-backup.json` and
`~/Library/LaunchAgents/app.tcger.studio-backup.plist`. The service has been
writing empty snapshots since September 25, which usually means its source
paths no longer resolve (repository moved, `.artifacts` relocated) rather
than that nothing changed.

**Bring back:** the configured source and destination paths, whether they
exist, and whether a fresh snapshot lists files again.

### 5. Inventory what is newer than the September 14 archive

```sh
find .artifacts -type f -newermt '2026-09-14 08:00' | head -200
find .artifacts -type f -newermt '2026-09-14 08:00' | wc -l
```

and list any Dev Mode session folders or zips not yet ingested with
`scripts/ingest_devmode_session.py`.

**Bring back:** the count, the top-level folders involved, and any new
session ids.

### 6. Check that a training launch would be accepted — no cost

```sh
hf auth whoami
python3 tools/card-geometry/run_card_geometry_hf_job.py \
  --config .artifacts/card-geometry/augmentation-20260913/control-seed-20260906/config.json \
  --action train --dry-run
```

This confirms the account and whether the archived September 13 config
still validates against the current tooling. It submits nothing.

**Bring back:** the `whoami` account name and the dry-run output.

### 7. Optional: a new capture session for evaluation

About 40–60 Dev Mode photos of the two weak outline cases — cards running
off one or two edges of the frame, and cards held 15–40° off flat — across
several sets, at least one other game and more than one lighting condition.
Ingest it and review the corners in the studio. Keep it out of training.

### 8. Optional: open the web scanner once

Scan one Magic card and one Pokémon card in a desktop browser against the
live index and check the console for errors. Web Magic queries are now
colour-normalized; that path has only been unit-tested.

## Decisions to bring back

- A budget cap for the outline training runs (two new runs are at most
  $6.40; four are at most $12.80), or a decision not to run them.
- Who launches: the Mac, or a Hugging Face credential granted to the cloud
  session.
- Whether German cards matched to the English row count as correct.

The full requirements for the training run are in
[`benchmarks/2026-11-10-outline-training-requirements/README.md`](benchmarks/2026-11-10-outline-training-requirements/README.md).
