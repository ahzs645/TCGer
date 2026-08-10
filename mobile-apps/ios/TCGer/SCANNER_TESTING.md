# iOS Scanner Testing

The scanner has three complementary test layers:

1. `TCGerTests` covers deterministic coordinator, matcher, gate, metadata,
   index, fixture, replay, and performance behavior.
2. Simulator test inputs run the production coordinator on a Photos image or
   the bundled Boss's Orders demo card without requiring a camera.
3. Live Scanner Debug records physical-device camera sessions and replays them
   against later model/index builds.

Camera scans first map the visible guide through the aspect-fill preview into
photo pixels. Vision rectangle detection and perspective correction then run
inside that guide crop. This applies to binder pages too: the guide says
"Fit the full binder page" and the capture is cropped to it, so the scanner
and the review screen see exactly what the user framed (the uncropped sensor
photo is still preserved in dev-mode recordings as `frame-NNNN-original.jpg`).
Imported Simulator fixtures intentionally skip the camera-guide crop because
the selected image is already the scanner input.

Imports are scanned as `ScanInvocationKind.importedPhoto` (photo-library
picks, Test Photo, Demo, and the fixture tests); only the camera shutter path
scans as `.photoCapture`. The distinction exists because an imported image may
already *be* the card with no background: the scene-trained detector then
fires on an interior panel, and no geometric test can separate that from a
real card lying in a scene. For `.importedPhoto` only, the embedding strategy
also embeds the whole frame and lets the card-face gate arbitrate — whichever
of {detected crop, whole frame} scores higher as a card face is used. Camera
captures never take that fallback, so live behavior is unchanged.

Fixture `minimumConfidence` floors assert the production strong-acceptance
threshold (0.72), not a stricter test-only bar: correct top-1 results at
0.80–0.88 were failing a legacy 0.90 floor that production would happily
accept, which hid real crop failures behind threshold noise.

The `two-cards` fixture expects `top5Any`: when the detector can isolate one
of the cards, correctly identifying it is the desired behavior. What must
never happen on a multi-card scene is a *confident mislabel* — with the
pre-2026-08-09 detector, the mixed-region crop retrieved a wrong card at
0.704 and only the ambiguity margin blocked it, and in that regime the right
outcome was abstention. If this fixture flips back to no-match after a
detector change, diagnose which card region the box covers before blessing
either answer. Its confidence floor is 0.55 (the OCR-verified evidence
floor), not 0.72: the partially occluded crop is accepted via collector
number confirmation, which production admits from `minimumEvidenceScore` up.

## Command-line setup

This Mac currently has Xcode installed while `xcode-select` points at Command
Line Tools. Select Xcode globally once:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

Or prefix an individual command without changing the global selection:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project mobile-apps/ios/TCGer/TCGer.xcodeproj \
  -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

Validate generated scanner assets before testing:

```bash
bash scripts/ios-assets.sh check
```

## Automated test coverage

- Coordinator priority, fallback, clean no-match behavior, local/server engine
  eligibility, live/photo eligibility, and focused-set filtering.
- Perceptual hash stability and Hamming distance.
- Artwork and HSV ranking.
- Card-face rejection scores and dimension mismatch behavior.
- Metadata decoding, game/set filtering, and card-detail mapping.
- ANN cosine ranking and allowed-index filtering.
- Labeled clean/distorted/negative fixture regressions with top-1, top-5,
  confidence-floor, and no-match assertions.
- Device-recording replay comparisons.
- Scanner payload size, artwork database load time/memory, ANN cold load, first
  scan latency, and sustained scan latency budgets.

The fixture manifest is
`TCGerTests/Fixtures/ScannerFixtures.json`. Its canonical card IDs intentionally
correct older asset filenames and labels:

| Asset name | Actual card | Canonical scanner ID |
| --- | --- | --- |
| `BossOrders` | Boss's Orders | `swsh9-132` |
| `Peonia` | Barry | `swsh9-167` |
| `Rayquaza` | Pikachu VMAX | `swsh4-188` |
| `PokeStop` | PokéStop | `swsh10.5-068` |
| `ProfessorsResearch` | Professor's Research | `swsh4.5-60` |

## Simulator workflow

1. Run a Debug build on an iPhone Simulator.
2. Open the scanner. Simulator builds show `Test Photo` and `Demo` controls.
3. `Demo` scans the bundled Boss's Orders fixture.
4. `Test Photo` loads any Photos image and sends it through the same
   `CardScannerCoordinator` used by camera capture.
5. Open Settings → Scanner Tools → Live Scanner Debug to import a recorded run.

### Reference set browser

Scanner Debug → **Browse Reference Sets** steps through a folder of reference
images one at a time, runs the production coordinator on each, and judges the
result against that image's label. Use it when a replay report says the number
moved and you need to see *which* frame moved and why: the pane draws the
ground-truth box in green, the crop the cropper chose in orange, and shows the
crop that was actually sent to the encoder next to the top-5 candidates. A wrong
crop and a wrong match are indistinguishable from the result alone.

Sets are discovered in the app's Documents folder, and on Simulator also under
`~/Downloads/Reference` on the Mac (via `SIMULATOR_HOST_HOME`, so nothing has to
be copied into the container). Three folder shapes are recognized:

| Shape | Detected by | Ground truth |
| --- | --- | --- |
| Device recording | `results.json` + frames | `expectedCardId` / `expectedNoMatch` per frame |
| Replay corpus | `roboflow-ios-replay.json` + `datasets/` | COCO card boxes |
| Image folder | any images, or an `images/` subfolder | none |

Any of them can carry a `scanner-labels.json` keyed by filename stem (Roboflow's
`.rf.<hash>` suffix is stripped, so labels survive a re-export):

```json
{
  "schemaVersion": 1,
  "labels": {
    "Charizard-Ex-223-2_jpg": { "category": "singleCard", "cardId": "sv03-223", "name": "Charizard ex" },
    "IMG_0095_jpg": { "category": "cardBack" }
  }
}
```

`category` is one of `singleCard`, `cardBack`, `multiCard`, `foreignLanguage`,
`outsideIndex`, or `needsLabel`. Only `singleCard` counts toward recall;
`cardBack`, `multiCard`, `foreignLanguage`, and `outsideIndex` are cases the
single-card recognizer is *supposed* to decline, so the summary reports them as
a separate hard-negative rate. Folding them into one number hides both the real
recall and the real false-positive rate — a raw "15/50 accepted" is neither.

The canonical labels for the 50-image recognition sample live at
`TCGerTests/Fixtures/ReplaySampleLabels.json`; copy that file into a dataset
folder as `scanner-labels.json` to use it there.

### Dev mode recording

**Dev Mode Recording** persists every scan that goes through the production
coordinator — live frames, shutter captures, and photo imports — while the
toggle is on. The toggle (with the session list and exports) lives in two
places: Settings → the developer tools section, and inside Live Scanner
Debug. For testers on release builds, developer tools unlock by tapping the
About → Version row 7 times; debug builds always show them. While enabled,
the scan screen shows a persistent red "Recording scans for model testing"
badge, so recording is never a surprise. Each frame keeps:

- the raw input image exactly as the pipeline received it (post guide crop
  for camera frames, untouched for imports), and for shutter captures also
  the unprocessed sensor photo (`frame-NNNN-original.jpg`) so the
  guide-cropping stage itself stays inspectable;
- every crop attempt image (`frame-NNNN-attempt-K.jpg`) with its kind
  (detected crop / whole frame / raw fallback) and localization quad;
- the evidence behind the decision: gate score and threshold, top-5 ANN
  candidates with similarities, exact-title match, footer OCR readings, the
  verified collector number, and the attempt outcome (`accepted`,
  `rejectedInput`, `belowAcceptanceThreshold`, `printingAmbiguous`,
  `titlePrintingUnresolved`, `noCandidates`, `indexUnavailable`) — so an
  abstention is attributable to a stage, not just visible as "no match".

Sessions are written to `Documents/ScannerDevMode/scan-session-<timestamp>/`
in the device-recording shape (`results.json` + frames), which means they
show up in Browse Reference Sets, replay through **Replay Extracted
Recording** against future model builds, export via
`scripts/export_scanner_recording_labels.py` for labeling, and can be added
to the training corpus after review. The per-attempt evidence is a sidecar
`evidence.json` keyed by frame file, so the shared schema is unchanged.
Binder pages record the raw page image plus one evidence attempt per
detected card — its quad, crop image, candidate list, and match status —
whether the page came from the shutter or an import, and whether or not the
scan produced any result.

Recording is unconditional while the toggle is on: no-match scans, gate
rejections, and binder pages with zero detections are all kept, because the
failures are exactly what retraining needs. Manifests rewrite atomically
after every scan (a crash loses nothing), a session keeps at most 400
frames (oldest dropped), and total dev-mode storage is capped at 1.5 GB
(oldest sessions pruned).

Sessions share individually (one zip per session) or via **Export All
Sessions**, which bundles the whole `ScannerDevMode` folder into a single
zip for AirDrop/Messages/Files — the hand-over path for testers sending
collected data back for labeling and retraining.

Replay an exported archive against the current pipeline with
`DevModeSessionReplayTests` (env-gated):

```bash
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  TEST_RUNNER_DEVMODE_SESSIONS_DIR=/path/to/unzipped/ScannerDevMode \
  xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/DevModeSessionReplayTests
```

The recorded device decisions are the baseline; the test prints each frame's
old → new outcome and fails on any new false accept or newly-lost accept.
`BinderSessionReplayTests` does the same for recorded binder pages (frames
whose evidence outcome starts with `binderPage`), asserting each page stays
at or above its recorded device count or an explicitly measured Simulator
floor for known platform divergences.
Caveat: Simulator Vision (doc-seg/rectangles) diverges from device Vision on
some frames, so device-confirmed conclusions need a device build — the test
keeps a documented allowlist of known Simulator divergences.

Large binder exports can exceed the Simulator test-process lifetime when run
as one replay. Split them into deterministic chunks with a comma-separated
frame list. Diagnostic-only mode prints device/floor differences without
blessing them as new regression floors:

```bash
TEST_RUNNER_DEVMODE_SESSIONS_DIR=/path/to/unzipped/export \
TEST_RUNNER_DEVMODE_BINDER_FRAME_FILES=frame-0000.jpg,frame-0001.jpg \
TEST_RUNNER_DEVMODE_BINDER_DIAGNOSTIC_ONLY=1 \
xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/BinderSessionReplayTests/testReplayBinderPages
```

Explicit corrections recorded in `results.json` are stronger evidence than
the original device decision. `ScannerCorrectionReplayTests` finds those
labels, collapses repeated edits of byte-identical crops so the final edit
wins, and fails if a corrected crop becomes a wrong accepted card:

```bash
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  TEST_RUNNER_DEVMODE_SESSIONS_DIR=/path/to/unzipped/ScannerDevMode \
  xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/ScannerCorrectionReplayTests
```

Use `TEST_RUNNER_DEVMODE_CORRECTION_FRAME=frame-NNNN.jpg` to isolate one
correction and print its gate, top candidates, title OCR, footer OCR, and
attempt outcomes. `ScannerOrientationExperimentTests` is a test-only rotation
lab. It measures raw and portrait-normalized 0/90/180/270 input, an
abstention-only 180 retry, and arbitrary-angle camera scenes at +/-15, 30, 45,
60, and 75 degrees (with mild perspective at +/-30 and 60):

```bash
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  TEST_RUNNER_ORIENTATION_EXPERIMENT_SESSION_DIR=/path/to/scan-session \
  xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/ScannerOrientationExperimentTests
```

Both are environment-gated and skip in the ordinary test suite.

For one manually verified binder slot, the perspective diagnostic compares
the archived crop, current perspective crop, short-edge ordering, 180-degree
variant, detector box, and full coordinator result:

```bash
TEST_RUNNER_BINDER_ORIENTATION_EXPERIMENT_SESSION_DIR=/path/to/scan-session \
TEST_RUNNER_BINDER_ORIENTATION_EXPERIMENT_FRAME=frame-0027.jpg \
TEST_RUNNER_BINDER_ORIENTATION_EXPERIMENT_ATTEMPT=7 \
TEST_RUNNER_BINDER_ORIENTATION_EXPERIMENT_EXPECTED=pl3-10 \
xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/ScannerOrientationExperimentTests/testLabeledBinderPerspectiveVariants
```

Treat this manual expected ID as an experiment label, not archive metadata;
the current binder export format does not persist per-slot corrections.

To regression-test an alternate warp against every strongly accepted binder
attempt, use the accepted device candidate as a pseudo-label. This does not
replace human per-slot labels; it rejects hypotheses that damage already-good
manual-shutter captures and reports the Hough CPU cost separately:

```bash
TEST_RUNNER_BINDER_WARP_EXPERIMENT_SESSION_DIR=/path/to/scan-session \
TEST_RUNNER_BINDER_WARP_EXPERIMENT_LIMIT=100 \
xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/ScannerOrientationExperimentTests/testAcceptedBinderWarpVariants
```

The test compares the recorded/refined quad, the detector box, and a test-only
multi-threshold outer-border Hough policy. Do not promote maximum-score
selection: the 2026-08-10 67-attempt run changed identity ten times, split
evenly between corrections and regressions. The only production candidate is
an uncertain-result-only, same-card-ID agreement retry after manual shutter.

For policy comparisons, prefer the evidence-dump variant, which records the
full ANN top-10, Laplacian sharpness, and a PNG for every crop variant so
that agreement, margin, hysteresis, sharpness, and reference-image policies
can all be scored offline from one Simulator run:

```bash
TEST_RUNNER_BINDER_WARP_EXPERIMENT_SESSION_DIR=/path/to/scan-session \
TEST_RUNNER_BINDER_WARP_EXPERIMENT_LIMIT=100 \
TEST_RUNNER_BINDER_POLICY_EVIDENCE_OUT=/path/to/policy-evidence.jsonl \
TEST_RUNNER_BINDER_POLICY_EVIDENCE_CROPS_DIR=/path/to/crops \
xcodebuild test -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:TCGerTests/ScannerOrientationExperimentTests/testAcceptedBinderPolicyEvidence
```

The 2026-08-10 offline evaluation of that dump found: top-2 ANN margin
separates wrong review candidates (max 0.047) from correct ones (median
0.095); Laplacian sharpness does not separate them at all; identity change
requires at least two agreeing alternate crops to stay regression-free; and
grayscale NCC against reference art recovered 13 of the 14 wrong top-1s whose
true card appeared in any variant's top-5. Details and the combined
zero-regression policy are in `docs/scanner-model-ai-handoff.md`.

Later that day the underlying crop bug was fixed and shipped:
`CardCropper.isCardShaped` now measures normalized quads in pixel space (the
normalized band discarded 58/67 correct binder refinements), and
`BinderPageScanner` gates uncertain review suggestions on an ANN top-2
margin of 0.05 (`reviewPreselectionMargin`). The evidence dump gained a
`productionRefined` variant so the shipped refinement can be scored against
the recorded device quads; on the 67-attempt session it scores 61/67 top-1
versus 48. Binder replay: candidates 313 -> 366, matched 100 -> 166 across
68 pages; the 2,336-image scene replay is unchanged at its floors. Eleven
binder pages and fifteen single-card frames that do not reproduce their
device baselines in the Simulator on either codebase (verified with a
pre-fix worktree control) are allowlisted in `BinderSessionReplayTests` /
`DevModeSessionReplayTests`. The stacked-cards frame `210958/frame-0011` is
now ground-truth `dpp-DP38` (front card) by user decision. Validation
details: `docs/scanner-model-ai-handoff.md`.

### Manual-match catalog search regressions

Image-less catalog variants must remain selectable even though they cannot be
part of the embedding index. `CatalogSearchTests` uses Lucario Trainer Kit
`tk-dp-l-3` as the regression case and verifies all of these queries:
`Lucario 3/11`, `3/11`, `DPBP#506`, `DPBP506`, and the seller typo `Lucaio`.
It also verifies ordinary name-prefix order, wrong-denominator rejection,
exact-result precedence over typo expansion, and unchanged Magic/Yu-Gi-Oh
collector formatting.

The result cell must expose set name, set code, and the display collector
fraction even when artwork is unavailable. Keep the canonical catalog number
unchanged for identity/image keys; the Pokemon-only display fraction belongs
in `attributes["collector_number_display"]`.

The arbitrary-angle test uses one positive label by default so it remains a
focused diagnostic. Set
`TEST_RUNNER_ORIENTATION_EXPERIMENT_FRAME=frame-NNNN.jpg` to select it, or set
`TEST_RUNNER_ORIENTATION_EXPERIMENT_GEOMETRY_ALL_LABELS=1` for the much slower
all-label matrix. Read detector/crop/fallback totals separately from ANN
accuracy: successful quad rectification proves the geometry worked, while an
inverted title/footer after rectification is a semantic 0/180 failure.

Do not reduce this to a single "rotation" fixture. Device capture coverage
must include arbitrary angles on both sides of upright, both sideways
directions, upside-down, perspective, and combined glare/blur. Include card
backs and non-card scenes at the same rotations so a recall improvement cannot
hide new strong wrong accepts.

A binder experiment that replaced its cropper with the single-card normalizer
was deliberately reverted. On the full 19-page archive replay it changed
candidates from 107 to 99 and matches from 30 to 31, with seven upright pages
below their established candidate floors. Do not bless new floors for that
experiment. A future binder rotation change needs real sideways pages and must
also preserve every current upright-page floor.

The 2026-08-09 device sessions produced the difficult-scene angled-card
diagnosis: the detector localized the card, but full-frame Vision corner
detection sometimes returned nothing at steep angles, and the axis-aligned
fallback crop embedded ~0.1 below the acceptance bar. Clean synthetic scenes
now localize and crop successfully through +/-75 degrees, so angle alone is
not the failure; background, glare, blur, and partial edges need to be varied
with it. Fixes shipped from the device analysis: sub-image corner refinement
(with the plain box kept as an alternate crop attempt), whole-frame retry for
shutter captures, letter-prefixed promo collector OCR ("SWSH204"), and a
title+strong-similarity override for gate false negatives on intentional
captures.

### Recording replay

For replay, extract the exported recording zip in Files, then choose the
extracted folder. You can also select `results.json` and its frame images
together. The report shows top-1 accuracy, top-5 recall, changed labels, new
false positives, new misses, strategy changes, mean latency, and p95 latency.
Older recordings use their original predictions as regression labels. For a
true accuracy run, add `expectedCardId` or `expectedNoMatch` to each frame in
`results.json`; those human labels take precedence over the recorded result.

## Physical-device workflow

1. Install a Debug build on the phone.
2. Open Settings → Scanner Tools → Live Scanner Debug.
3. Test `On-device embedding only` and the full local-first pipeline separately.
4. Turn on recording, exercise one condition, stop, and export the run.
5. Keep one condition per recording and name the exported zip accordingly.

Minimum capture matrix:

| Area | Cases |
| --- | --- |
| Games | Pokémon local, MTG pHash, Yu-Gi-Oh/server hash |
| Positives | common, full-art, foil, dark artwork, trainer/energy |
| Geometry | portrait, landscape, rotated, perspective, partial frame |
| Image quality | blur, glare, low light, motion, finger occlusion |
| Open set | card back, pack, hand, playmat, empty background |
| Scene | one card, multiple cards, card entering/leaving frame |

Also verify the sealed-inventory barcode button with UPC-A, EAN-13, a code that
is not in the product catalog, and a denied-camera-permission run. Barcode
detection stays on-device; only the decoded digits are sent for product lookup.

Record at least one clean control and one negative control in every device test
session. Preserve the app build, model/index revision, selected pipeline, and
expected card IDs with the exported recording.

## Updating fixtures and budgets

- Add new fixture labels to `ScannerFixtures.json`; do not infer expected IDs
  from old image filenames.
- A changed prediction is not automatically a failure to bless. Review the
  frame and update the baseline only when the new result is correct.
- Change a performance budget only with measurements from both Simulator and a
  supported physical device. Keep CI budgets loose enough for normal machine
  variance while retaining tighter device observations in exported reports.
- Set an Xcode performance baseline for `testArtworkDatabasePeakMemoryMetric`
  on the CI reference Simulator so XCTMemoryMetric regressions become a gate;
  the explicit payload, resident-memory growth, and latency limits already fail
  directly when their budgets are exceeded.
