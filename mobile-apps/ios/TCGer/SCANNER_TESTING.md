# iOS Scanner Testing

The scanner has three complementary test layers:

1. `TCGerTests` covers deterministic coordinator, matcher, gate, metadata,
   index, fixture, replay, and performance behavior.
2. Simulator test inputs run the production coordinator on a Photos image or
   the bundled Boss's Orders demo card without requiring a camera.
3. Live Scanner Debug records physical-device camera sessions and replays them
   against later model/index builds.

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
