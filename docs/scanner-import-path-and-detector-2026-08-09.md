# Scanner: import-path fix and YOLO detector migration (2026-08-09)

This documents one working session that fixed the scanner's already-cropped-card
path, re-baselined the fixture suite honestly, and replaced the Create ML card
detector with a GPU-trained YOLO11s. Companion docs:
[SCANNER_TESTING.md](../mobile-apps/ios/TCGer/SCANNER_TESTING.md) (how to run
everything), [scanner-asset-packaging.md](scanner-asset-packaging.md) (what
ships in the bundle).

## The problem

The labeled fixture regression suite was red at HEAD — 9 of 15 assertions —
and had been for a while. The five fixture assets are 734×1024 images that
*are* a card, with no background. On those, every localization signal fails
the same way:

- Document segmentation is rejected by the `area <= 0.72` plausibility cap.
- The detector (trained exclusively on cards-in-scenes) fires on an interior
  panel of the card — for Boss's Orders, the top-right 22% of the frame.
- `VNDetectRectanglesRequest` returns several interior rectangles, all at
  confidence 1.00, and `bestCrop` picked among them arbitrarily
  (`max(by: confidence)`), so Pikachu VMAX was cropped to a 3% holo patch.

No geometric test can separate "the frame is the card" from "a card lies in
this scene": a standard 3:4 photo is *inside* the card aspect band. The same
failure hits every photo-library import and the Simulator Test Photo path,
because those images skip the camera guide crop.

## What changed

### 1. Deterministic crop tie-break (`CardCropper.preferredObservation`)

Confidence carries no ranking signal when Vision reports 1.00 for everything,
so ties now break by quadrilateral (shoelace) area — the largest card-shaped
candidate is the card; smaller ones are panels printed on it. Measured effect
on the 2,336-image scene replay: exactly zero (identical localization
numbers, identical accepted set) — on scenes the largest and the
highest-confidence candidate coincide. The fix only matters on interior-panel
ties, where it is strictly right.

An earlier draft also added a bounding-box aspect guard on the detector box.
The replay caught it costing 524 localizations (a rotated card has a
near-square axis-aligned box — exactly what the existing comment warns about)
and it was reverted. Measure before keeping.

### 2. `ScanInvocationKind.importedPhoto` + retry-on-abstain

Imports are now a first-class source. Only the camera shutter scans as
`.photoCapture`; photo-library picks, Test Photo, Demo, and fixtures scan as
`.importedPhoto` (the view-model default). For imports only,
`BoardCardEmbeddingScannerStrategy` builds *crop attempts* — the detected
crop plus the whole frame normalized like a crop — ordered by card-face gate
score, and tries the next attempt only when the previous one **abstains**.

Two properties make this safe:

- Recall-only by construction: an accepted result returns immediately, and
  every attempt faces the unchanged gate / OCR / threshold policy.
- The camera path never takes it, so live behavior is untouched.

Gate-score-only arbitration (the first design) was measured insufficient: a
3% holo patch of Pikachu VMAX scored 0.619 on the gate while the full rainbow
full-art card scored 0.434 — the gate's documented full-art false negative.
The retry design recovers that card because whole-frame retrieval hits 0.946
and footer OCR confirms the printing past the gate rejection.

### 3. Honest fixture baselines

- `minimumConfidence` floors dropped from a legacy test-only 0.90 to the
  then-production strong-accept 0.70. Correct top-1 results at 0.80–0.88 were
  failing a bar production doesn't use, which hid the real crop failures
  behind threshold noise.
- `two-cards` briefly became a `noMatch` fixture (with the old detector no
  crop isolated one card, and the mixed-region crop retrieved a *wrong* card
  at 0.704 — one ambiguity-margin check from a confident mislabel, so
  abstention was correct). With the new detector it isolates one card and
  identifies it via collector-number OCR, so it is `top5Any` again with a
  0.55 floor (the OCR-verified evidence floor, not the plain embedding floor,
  which later moved to 0.72 after device lighting/foil evidence).
- The perf suite's first-scan test scans the bundled fixture as
  `.importedPhoto` — it is a borderless crop, i.e. an import — which also
  puts the most expensive path (whole-frame retry) inside the latency budget.

### 4. Root cause: the detector never saw a borderless card

`scripts/prepare_createml_card_detector.py --tight-crops` synthesizes the
missing training regime: each train/valid scene donates a crop of its largest
card box with 0–12% random margins (30% perfectly borderless, deterministic
per image name, neighbors labeled only if ≥25% visible). Scene `test` stays
untouched for comparability; a separate `tight-test` split (135 images from
test scenes) measures the borderless regime explicitly.

Two retrains were compared, scored at the Vision level with
`mobile-apps/ios/scripts/evaluate-card-detector.swift` (mirrors
`CardObjectDetector` exactly: `scaleFit`, "card" label, confidence ≥ 0.50):

| IoU ≥ 0.75 | old Create ML | tight-crop Create ML | **YOLO11s** |
|---|---|---|---|
| scene test (136) | 75.0% | 86.0% | **100%** |
| tight-test (135) | 25.9% | 41.5% | **100%** |

The tight-crop Create ML retrain (600 iterations) helped but still produced
zero or partial boxes on truly borderless fixtures. The shipped model is
**YOLO11s** (ultralytics 8.4, 60 epochs, imgsz 640, batch 32), trained on a
Colab L4 in 45 minutes from the same corpus converted by
`scripts/createml_to_yolo.py`, exported with
`model.export(format='coreml', nms=True, imgsz=640)`. Final Colab validation:
P 0.992 / R 0.979 / mAP50 0.991 / mAP50-95 0.974. The export is a Vision
pipeline model, so `CardObjectDetector` consumes it unchanged;
`CardDetector.mlpackage` (18 MB, was 30 MB) replaces the `.mlmodel` with no
project-file edits (synchronized folder groups).

## Full-replay evidence (2,336 images, production pipeline, simulator)

| | old Create ML | tight-crop Create ML | **YOLO11s (shipped)** |
|---|---|---|---|
| Localized | 2,214 | 2,229 | **2,334 (99.9%)** |
| Mean IoU | 0.827 | 0.845 | **0.931** |
| IoU ≥ 0.50 | 90.3% | 91.8% | **97.9%** |
| IoU ≥ 0.75 | 72.7% | 78.7% | **95.3%** |
| Mean detection (sim CPU) | 97 ms | 96 ms | 133 ms |
| Accepted / recognition run | 15/50 | 14/50 | 15/50 |
| Accepted wrong printings | 0 | 0 | **0** |

Recognition churn under YOLO: **gained** Piplup me02-027 (previously
unmatchable — the sloppy crop made the embedding prefer a 2007 printing;
the precise crop resolves the correct modern one) and a Zacian V-UNION
quadrant from a four-card photo (plausibly correct-for-the-crop; quadrant
not yet visually verified — see the note in
`TCGerTests/Fixtures/ReplaySampleLabels.json`). **Lost** two marginal
accepts (webcam Dugtrio sv03-104, vintage Erika's Exeggcute gym1-77) —
retrieval-layer questions now, not cropping failures.

Fixture diagnostics with YOLO: every borderless asset gets a full-frame box
at 0.97–0.98 confidence, and the two-card composite gets **one box per
card**. All 71 tests pass, including performance budgets.

## Reproduction

See the "Regenerate" section of
[Resources/ScanIndex/README.md](../mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/README.md)
for the full dataset → train → export → score pipeline, and
SCANNER_TESTING.md for the replay commands. Two gotchas learned the hard way:

- `ROBOFLOW_*` variables must reach xcodebuild as **environment** variables
  with the `TEST_RUNNER_` prefix (`env TEST_RUNNER_ROBOFLOW_REPLAY_DIR=…
  xcodebuild test …`); passed as trailing `KEY=value` arguments they become
  build settings and the diagnostic silently skips.
- The legacy on-Mac Create ML trainer leaks a ~30 MB compiled checkpoint
  per iteration into `$TMPDIR/CreateMLModels` and never cleans up; it killed
  two training runs by filling the disk at model-save time (with the metrics
  printout lost to `swift -interpret` output buffering). Clear that
  directory and keep ≥25 GB free, or train off-Mac.

## Open items

1. **Physical-device acceptance run** (unchanged from the scanner report —
   still the top item): ANE latency for YOLO11s, thermal behavior, shutter
   latency. The 133 ms simulator number is CPU-bound and not representative.
2. **Independent holdout**: the replay shares provenance with the training
   archives, so its absolute numbers are optimistic; the three-model deltas
   are the trustworthy signal. A cleanly captured holdout remains the next
   measurement investment.
3. The two lost marginal accepts (sv03-104, gym1-77) are candidates for
   retrieval/threshold review per the decision guide — do not fix them by
   loosening the detector.
4. Verify the Zacian V-UNION quadrant label; multi-card scenes can now
   legitimately resolve to one correct card instead of declining, and the
   hard-negative taxonomy should distinguish those outcomes going forward.
