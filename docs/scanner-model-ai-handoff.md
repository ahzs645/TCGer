# Scanner Model AI Handoff

Last updated: 2026-08-09 (arbitrary-angle rotation experiments and binder regression)

## Session Results 2026-08-09 (21:29 correction/rotation export)

Archive: `TCGer-DevMode-All-20260809-212942.zip`. It adds two sessions:
16 single-card lighting/overlap captures at 21:09 and seven binder-page
captures plus manual correction events at 21:12.

### Single-card results

- The 21:09 session produced eight exact accepts and eight safe abstentions,
  with zero wrong accepts. Exact accepted IDs were `swshp-SWSH204` (2),
  `dp4-103`, `dp4-104`, `pl4-AR3`, `dpp-DP38`, and `dpp-DP30` (2).
- The abstentions are explainable from the pixels: severe glare/blur on
  Arceus V and Cresselia, two-card overlap on Giratina/Regigigas, and weak
  Arceus/Regigigas shots. This is the intended precision-first behavior.
- The known `ecard3-146` Charizard attractor appeared at 0.65 on an alternate
  Arceus-V attempt and 0.69 on the overlapping Giratina frame. Neither was
  accepted. This is fresh device evidence that the 0.72 plain-visual bar is
  blocking the earlier false-positive mode while clear attempts still pass.
- Current Simulator replay with all 15 single-card frames labeled produces
  10/15 exact, five abstentions, and zero wrong accepts. It recovers Arceus V
  frame 2, Arceus frame 9, and Regigigas frame 14, while the device-accepted
  Darkrai frame 7 is a documented Simulator Vision divergence. Net measured
  recall improves without a false accept.

### Binder corrections are now ground truth

Manual correction images are byte-identical to their originating
`frame-NNNN-attempt-N.jpg` crops. Hash matching recovered ten unique final
labels, and every corrected slot was originally `noCandidates`:

`dp4-41`, `xy3-56`, `pl3-83`, `ex13-18`, `pl2-49`, `pl1-28`, `pl2-28`,
`dp3-131`, `base4-45`, and `ecard1-33`.

Two crops contain correction history rather than separate cards. The final
event must win: Gardevoir ends at `dp3-131`; Alakazam was first labeled
`ecard1-1`, briefly marked no-match, then finalized as `ecard1-33`.

`ScannerCorrectionReplayTests` collapses identical crop bytes in event order
and replays the final labels through the full production coordinator. Current
Simulator result: 2/10 exact (`pl3-83` Skarmory FB and `ecard1-33` Alakazam),
8 safe abstentions, 0 wrong accepts. The Sharpedo crop is especially useful:
raw ANN top-1 is the correct `pl2-49` at 0.74, but the card-face gate is only
0.39-0.41 and footer OCR cannot read `49/111`, so production safely abstains.
Do not lower the gate; improve small/dark collector-number OCR.

The seven recorded binder pages contain 61 detections: 44 had a candidate,
14 were accepted, 30 were printing-ambiguous, and 17 were `noCandidates`.
Localization remains good; exact-print evidence and weak
vintage-card embeddings remain the limiting stages.

Unmodified current code replays those pages in Simulator at 43 candidates
and 17 matches. Pages `frame-0008.jpg` and `frame-0018.jpg` reproduce one
candidate below their device recordings, while `frame-0004.jpg` gains one;
this is another device/Simulator evidence divergence, not a production-code
regression. `BinderSessionReplayTests` now uses per-page Simulator floors for
those two pages and the recorded device count everywhere else.

### Rotation audit

- `CardCropper` perspective-corrects cards and rotates a landscape crop to
  portrait. Its quad/perspective path handles arbitrary in-plane angles, not
  only 90-degree turns, but geometry cannot determine whether printed content
  is upright or upside-down.
- `BinderPageScanner` still has a separate normalizer that can non-uniformly
  scale a landscape perspective result directly into 720x1000. Reusing
  `CardCropper` would remove that sideways-stretch mechanism at no extra
  embedding cost, but the full 19-page Simulator replay regressed from 107 to
  99 candidates across seven upright pages (matches changed 30 to 31). The
  production change was reverted. Existing archives contain no sideways binder
  cards, so first add physical sideways fixtures, then design a binder-specific
  normalizer that preserves the current upright crop pixels.
- Camera orientation remains a separate coordinate-space risk. Live video is
  fixed to 90 degrees, while preview and photo-output connections are not kept
  in an explicitly synchronized interface-orientation mapping. The guide crop
  assumes their pixel and preview spaces agree. Validate portrait, both
  landscapes, and iPad upside-down on a device before changing this path.
- Photos and shutter JPEGs apply EXIF through Image I/O thumbnail transforms.
  Replay/reference loaders use raw `CGImageSourceCreateImageAtIndex`; an image
  whose rotation exists only in EXIF can therefore diverge from Photos. Add a
  shared decoder and EXIF 1-8 asymmetric-corner fixtures.

### Rotation experiments: cardinal and arbitrary angles

`ScannerOrientationExperimentTests` now separates three questions: raw input
rotation, production portrait-geometry normalization, and a test-only
abstention-gated semantic 180-degree retry.

- On ten deduplicated final correction labels, upright raw and normalized
  results were both 3/10 exact top-1, 6/10 top-5, one strong exact, one strong
  wrong, and eight below the 0.72 strong threshold.
- Production normalization maps one sideways direction back to the upright
  baseline. The opposite direction and a 180-degree input remain semantically
  inverted: 1/10 exact, 2/10 top-5, zero strong exact, one strong wrong.
- The test-only 180-degree retry recovered the simulated inverted variants but
  did not improve the real upright baseline and retained its strong wrong.
  It required 34 extra embeddings and 76.7 seconds of Simulator embedding time
  in this diagnostic. Do not ship this retry from the current evidence.
- A representative strongly recognized real crop was placed in synthetic
  1200x1600 camera scenes at +/-15, 30, 45, 60, and 75 degrees, with mild
  perspective at +/-30 and 60. Card detection and normalized cropping both
  succeeded in all 28/28 scenes, all through direct quadrilaterals with no
  axis-aligned fallback. This confirms that the main path handles weird angles.
- Upright flat scenes were strong/exact at 8/10 angles and perspective scenes
  at 3/4, with zero strong wrongs. The failures were +60 and +75 (and +60 with
  perspective). Semantic-180 inputs showed the inverse success at those steep
  positive angles. The crop geometry succeeds, but Vision corner ordering plus
  the unconditional landscape `.right` turn can select the opposite portrait
  direction. This is the next focused geometry experiment; it is not evidence
  for accepting the maximum score across rotations.

The experimental harness supports one labeled frame by default,
`ORIENTATION_EXPERIMENT_FRAME` for a chosen crop, and
`ORIENTATION_EXPERIMENT_GEOMETRY_ALL_LABELS=1` for the slower all-label
arbitrary-angle matrix.

### `/Volumes/Main/Scanner` ideas worth carrying forward

The local `METHODS_ANALYSIS.md` already catalogs 29 scanner repositories.
The most relevant patterns for this app are:

- OpenSorts compares upright and 180-degree embeddings. Spell Coven generates
  all four orientations, but that is four sequential encoder calls and no
  orientation tests were found. Once a quad is normalized to portrait, only
  0/180 remain distinct; keep four-way evaluation offline.
- CardReaderLibrary tries three OCR thresholds at both 0 and 180 degrees and
  chooses the OCR-confidence winner. TCGer can trial title/collector evidence
  as an orientation verifier after abstention, without letting it bypass the
  gate, ambiguity policy, or exact-print safeguards.
- Pokemon-Card-Scanner precomputes transformed reference hashes. Its supposed
  "four orientations" are actually identity, horizontal mirror, vertical
  flip, and mirror+vertical flip; only the last is a 180-degree rotation. The
  useful idea is an offline 180-degree reference index if on-device retry
  latency proves too high, not copying those transforms literally.
- Spell Coven and the MTG sorter use Laplacian sharpness/motion stability.
  A calibrated quality signal could ask the user to hold steady or retake a
  frame without altering embedding pixels.
- RiftBound uses YOLO OBB, full-resolution crops, and synthetic rotation,
  glare, shadow, JPEG, vignette, and distractor augmentation. TCGer already
  has the stronger detector path; the transferable idea is augmentation for
  reference/model training and always cropping from the highest-resolution
  source.
- The MTG sorter combines pHash, HSV, and geometric feature verification.
  For TCGer, a second visual verifier should rerank an ANN shortlist only;
  it must not bypass the gate/printing safeguards.

Primary-source cross-checks point to the same separation of concerns. Apple's
[Vision still-image guidance](https://developer.apple.com/documentation/vision/detecting-objects-in-still-images)
states that Vision assumes upright input and that `CGImage`, `CIImage`, and
`CVPixelBuffer` do not carry orientation, so callers must supply or bake it.
PaddleOCR ships a dedicated
[0/90/180/270 document-orientation classifier](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/doc_img_orientation_classification.en.md)
rather than expecting OCR to infer orientation implicitly. TCGer should not
add that model yet; it is evidence that semantic orientation is its own stage,
after arbitrary-angle localization and perspective correction.

Next measured work: test a short-edge/corner-ordering rule at steep positive
angles, then capture real arbitrary-angle, 90-degree, and upside-down single
cards and binder pages with glare. After that, calibrate collector OCR and blur
guidance and consider perspective/foil reference augmentation. Keep the 0.72
acceptance bar and 0.82 binder auto-match bar unchanged.

## Session Results 2026-08-09 (19:12 lighting/foil export)

The newest export contributed 29 labelable single-card shots and five binder
pages. Repeated shots plus visible titles/collector numbers establish exact
ground truth for every single-card frame; the replay harness now carries those
labels and excludes binder pages, which belong in `BinderSessionReplayTests`.

- At the old 0.70 plain-visual bar, current Simulator replay produced 13/29
  correct, 14 safe abstentions, and two wrong accepts: Primeape became
  `sm3-23` Simisear and Cresselia became the known junk attractor
  `ecard3-146` Charizard. At 0.72 it kept the same 13 correct and changed both
  wrong accepts to abstentions. Exact collector OCR remains eligible from the
  0.55 evidence floor.
- The completed canonical 50-image run at 0.70 was 18 accepted, 16/16 labeled
  accepts exact, and zero wrong printings. Its weakest plain correct accept was
  0.742; the only lower correct result (0.691) was OCR-confirmed. This supports
  0.72 without sacrificing any measured plain correct accept. A second full
  corpus run at 0.72 hit a Simulator/Xcode lifecycle hang and produced no
  report, so do not describe that run as passing.
- Crop-level lighting experiments rejected global preprocessing. Baseline was
  16/29 top-1 and 9 strong correct; exposure reduction fell to 13/29,
  highlight compression fell to 13/29 and introduced a strong wrong result,
  sharpening reached 17/29 but added no strong correct result, and the combined
  filter was 15/29 with a strong wrong result. Keep embedding pixels ungraded.
- New binder pages replay at 7-9 detections per page. Current Simulator replay
  moved candidates 24 -> 22 and matches 4 -> 5; the quads are visually sound.
  The dominant bottleneck is exact-printing evidence (20 recorded
  `printingAmbiguous` attempts), not localization or a global lighting filter.

Next levers: perspective/foil augmentation of reference embeddings, exact
collector OCR for binder crops, and cross-shot aggregation. Do not lower the
gate or acceptance bar to recover glare/blur frames.

## Session Results 2026-08-09 (the evidence-loop sessions)

One long working day, five pushed commits (`9dcfc8be`, `43017cbe`,
`cba75988`, `48ef8509`, `993cadf4`) plus in-flight work. The theme: build the
instrumentation to capture real device evidence, then let that evidence drive
every fix. Full analyses live in
`docs/scanner-import-path-and-detector-2026-08-09.md` (import path + detector
migration) and `mobile-apps/ios/TCGer/SCANNER_TESTING.md` (how to run
everything); this section is the map plus the decisions and their reasons.

### Architecture changes a new model must know

- **`ScanInvocationKind` has three cases.** `.photoCapture` = camera shutter
  (guide-cropped), `.importedPhoto` = photo library / Test Photo / fixtures,
  `.livePreview`. Only the shutter path is `.photoCapture`. The distinction
  exists because a borderless card image defeats every geometric test (an
  iPhone 3:4 photo is inside the card aspect band).
- **The embedding strategy is multi-hypothesis with retry-on-abstain**
  (`BoardCardEmbeddingScannerStrategy.makeCropAttempts`): best detected crop,
  the detector's plain axis-aligned box when corner refinement supplied the
  primary quad, and the normalized whole frame (non-live sources only) —
  ordered by card-face gate score, tried until one accepts. Retries are
  recall-only by construction: an accept returns immediately and every
  attempt faces the full gate/OCR/threshold policy. Non-baseline attempts
  need `strongAcceptanceScore + 0.02` (OCR-verified exempt) because a
  measured 0.707 wrong accept of an out-of-index card arrived via a retry
  attempt.
- **The detector is YOLO11s** (`CardDetector.mlpackage`, 18 MB, ultralytics
  8.4 → Core ML NMS export, trained on the tight-crop-augmented corpus on a
  Colab L4). Consumed unchanged by `CardObjectDetector` (Vision, "card"
  label, conf ≥ 0.50, scaleFit). Replay: 99.9% localized, 97.9% IoU≥0.50,
  95.3% IoU≥0.75 (Create ML predecessor: 90.3%/72.7%). Borderless fixtures
  get full-frame boxes at 0.97+; the two-card composite gets one box per
  card. Vision-level scoring of any candidate model without an app build:
  `mobile-apps/ios/scripts/evaluate-card-detector.swift MODEL split-dir...`.
- **Corner refinement second chance** (`CardCropper.refinedObservations`):
  full-frame Vision doc-seg/rectangles return nothing for steeply angled
  cards, and the axis-box fallback crop embeds ~0.1 below the accept bar
  (same physical cards measured 0.79–0.93 flat vs 0.55–0.64 angled). Corner
  detection re-runs inside the padded detector box; the plain box is KEPT as
  an alternate attempt because a wrong refinement once lost a card the box
  crop caught. `CardCropper.refinedQuad(in:around:)` is the per-box public
  entry used by the binder scanner.
- **Binder pages are detector-first** (`BinderPageScanner.detectCardQuads`):
  YOLO boxes + per-box corner refinement; the legacy rectangle harvest
  (which returned attack text boxes, card backs behind pockets, sleeve
  fabric — 52/77 dead detections on the first device binder session) remains
  only as fallback. Duplicate suppression is overlap-over-SMALLER-area with
  larger quads winning — pocketed cards cannot overlap, and a fragment
  nested in a full-card quad has near-total containment but tiny IoU, which
  the old IoU test never caught. Measured on recorded pages: candidates
  19→48, auto-matched 3→9.
- **Binder shutter captures are guide-cropped** (uncommitted at writing):
  they previously processed the raw sensor frame while the guide said "Fit
  the full binder page" — user-visible mismatch and ~half the pixel density
  per card. The uncropped photo is preserved in dev-mode recordings.
- **OCR upgrades**: letter-prefixed promo collector codes
  (`CollectorNumberOCR.extractPromoCodes`, "SWSH204"/"DP38" → normalized
  "swsh204"/"dp38") — the promo class was structurally unconfirmable before
  and this is verified working on device. Gate false negatives on intentional
  captures can also be overridden by exact-title match AND a
  threshold-clearing visual score (gate measured 0.29–0.47 on legitimate
  hand-held cards; do NOT lower the 0.45 gate threshold instead — carpet
  measures 0.42).

### Dev mode: the evidence loop

`ScannerDevModeStore` + `ScanDiagnostics` record every scan (live, shutter,
import, binder) while the Settings toggle is on: raw input, original sensor
photo for shutter captures, every crop-attempt image with quad, gate score,
top-5 ANN candidates, OCR readings, and a per-attempt outcome enum that makes
abstentions attributable to a stage. Sessions are written in the
device-recording schema (`results.json` + frames) with an `evidence.json`
sidecar, so they browse in Reference Sets, replay, and export for labeling
with zero new tooling. Tester flow: 7 taps on Settings→About→Version unlocks
developer tools; Export All Sessions ships one zip.

Replay harnesses (both env-gated via `TEST_RUNNER_DEVMODE_SESSIONS_DIR`
pointing at an unzipped export):

- `DevModeSessionReplayTests` — single-card frames vs recorded device
  decisions; fails on new false accepts or newly-lost accepts.
- `BinderSessionReplayTests` — binder pages vs recorded baseline; writes
  per-page quad overlays to `/tmp/binder-replay-overlays/`.

**Simulator Vision ≠ device Vision** for doc-seg/rectangles: some recorded
device outcomes do not reproduce in the Simulator on identical code (known
allowlist in the tests). Device-level conclusions need a device build; the
harnesses measure change-vs-baseline, not absolute device truth.

### Measured decisions (do not silently revert)

- Crop candidate ties break by shoelace quad area, not Vision confidence
  (everything ties at 1.00); measured neutral on the 2,336 scene corpus.
- Fixture `minimumConfidence` floors = 0.72 (production bar), two-cards =
  `top5Any` at 0.55 (OCR-verified route).
- Aspect-ratio guards on the detector's axis-aligned box are harmful (a
  rotated card is near-square in its box): one such guard cost 524
  localizations before being reverted.
- The 2,336-image replay is the precision gate: it caught both the harmful
  shape guard and the retry-attempt wrong accept. Run it for any change
  touching crops, thresholds, or the strategy
  (`TEST_RUNNER_ROBOFLOW_REPLAY_DIR`, env vars must be ON xcodebuild, not
  trailing args — trailing args become build settings and the test silently
  skips).
- Latest replay state: 18/50 accepted, 16/24 exact printings, 0 wrong,
  including the long-abstaining same-art Dark Weezing base5-14.

### Where everything lives

- Datasets/replay: `~/Downloads/Reference/TCGer-Scanner-Datasets/` (docx
  paths without `Reference/` are stale). Device dev-mode sessions staged at
  `~/Downloads/Reference/TCGer-DevSessions/`. YOLO training pipeline:
  `scripts/prepare_createml_card_detector.py --tight-crops` →
  `scripts/createml_to_yolo.py` → ultralytics on GPU → Core ML NMS export
  (Colab notebook `Untitled2.ipynb` + artifacts in Drive
  `TCGer-detector/`). Legacy on-Mac Create ML trainer leaks ~30 MB per
  iteration into `$TMPDIR/CreateMLModels` — clear it and keep ≥25 GB free.

### Open items / monitoring

1. `ecard3-146 Charizard` is a junk attractor: cluttered whole-frame crops
   repeatedly retrieve it top-1 at 0.56–0.65. Never accepted so far; watch
   it in future session exports.
2. Binder vintage commons cluster at 0.71–0.82 against the 0.82 auto-match
   bar (`BinderPageScanner.Configuration.matchedScore`); revisit with
   post-guide-crop device data before touching the bar.
3. Steep-angle residuals (0.55–0.69 on extreme foreshortening) are an
   index-side problem — perspective augmentation of reference embeddings is
   the lever, not thresholds.
4. Cross-shot aggregation for repeated binder-page captures (same card
   swings 0.73–0.85 across shots of the same page).
5. Physical-device acceptance items from the scanner report remain (ANE
   latency for YOLO11s measured healthy: 74–780 ms warm scans on iPhone).

## Session Results 2026-08-08 (iOS "scanning doesn't work" diagnosis)

Context: the shared Drive folder (`pokemon/`) holds the generated iOS scanner
assets — `CardsIndexVectors.bin` + `CardsIndexMetadata.json` (built Aug 4),
the older Apr-4 perceptual-hash `index.json`, and `images/` = the card catalog
webp images per set. These were verified and benchmarked offline (Linux, no
device) by reproducing the pipeline in Node with `onnx-community/dinov2-small`
via transformers.js — the exact encoder + processor the index was built with.

Verification results (18 catalog images across A1/base1/bw1 vs the Drive
21,828 × 384 int8 index):

- Index is HEALTHY. Exact web-parity preprocessing → 18/18 top-1 self
  retrieval at mean sim 0.9935. Bin header, metadata alignment, and set
  coverage (all 50 Drive image sets present) all check out.
- fp32 vs q8 encoder weights: mean top-1 sim 0.9836 vs 0.9935 — the CoreML
  (fp) vs web (q8) weight difference is NOT a problem.
- Squash-resize to 224×224 (no shortest-edge-256 + center-crop): mean sim
  collapses to 0.862 with wrong top-1s ON CLEAN CATALOG IMAGES. The
  256→center-crop-224 geometry in `CardEmbeddingEncoder` is load-bearing;
  never regress it.
- Simulated camera conditions (2° rotation, 360px, mild blur, JPEG68,
  brightness lift): 12/18 top-1, and wrong cards DO score above the 0.70
  accept line (0.72–0.77). The OCR tiebreak + ambiguity margin + 2-frame
  consensus are what stand between this and wrong labels — they matter.
- The iOS crop color grade (CIExposureAdjust +0.1EV + CIColorControls
  sat 1.05 / contrast 1.1 / brightness −0.02 in `CardCropper` and
  `BinderPageScanner`) cost a further 2/18 top-1 under camera conditions and
  flipped several results to wrong cards. Both indexes (embedding + artwork
  fingerprint) are built from UNGRADED catalog images. REMOVED this session —
  contrast-style ops stay OCR-only, consistent with the 2026-07-02 finding.
- Artwork fingerprint strategy (5% art + 95% HSV, min 0.90): 18/18 on clean
  catalog images (its own training distribution) but 10/18 under camera
  conditions with almost every score UNDER its 0.90 floor — on a real phone
  it mostly abstains. It previously ran at priority 0 for Pokémon and
  short-circuited the embedding pipeline on clean frames while carrying no
  OCR verification or ambiguity guard. Priority swapped this session:
  Pokémon now runs `.mlDetector` (embedding) first, fingerprint as fallback.

Root-cause candidates for "scanning does nothing" on device, in order:

1. MISSING GENERATED ASSETS. `CardEmbeddings.mlpackage`, the index bin, and
   metadata are gitignored build outputs; when absent the embedding strategy
   sets `supports() == false` and disappears SILENTLY, leaving only the
   fingerprint matcher (which abstains on most camera frames) and server
   strategies (absent in phone-only mode). Note the Drive folder contains the
   two index files but NO CoreML model — if the .mlpackage is also absent
   from the local build, this alone explains a scanner that never matches.
   NEW this session: `ScannerAssetDiagnostics` + a "Scanner Assets" pane in
   ScannerDebugView show exactly what the installed bundle contains, and the
   capture-photo error now names the missing files instead of the generic
   "not available yet".
2. Crop color grade breaking parity (fixed, above).
3. Fingerprint short-circuit hiding the verified pipeline (fixed, above).

Packaging decision 2026-08-09: all scanner assets stay bundled in the app for
now; R2 delivery is planned later with the artwork fingerprint database as
the first asset to move (then the index; the CoreML model stays bundled).
Rationale and migration order: `docs/scanner-asset-packaging.md`.

Per-game fingerprints 2026-08-09: the artwork fingerprint database is now per
game — `artwork-fingerprints-<TCGGame.rawValue>-uint8.json` (Pokémon's file
renamed accordingly), bundle first then Documents, legacy filename still
honored via its own `tcg` field. Loading is lazy per game on first scan
(previously the ~53 MB JSON parsed eagerly at scanner init for every game).
To add a game: run backend `build-artwork-fingerprints.ts` for it and drop
the output in `CardScanner/Resources/` under the per-game name — no code
changes needed.

OPEN ITEM — gate fallthrough: when `CardFaceRejectionGate` rejects a crop as
non-card, the embedding strategy returns nil and the coordinator falls
through to the artwork-fingerprint strategy, which has NO card-face check —
so a rejected pack/hand/card-back can still be named by the HSV matcher if
it clears 0.90. Proposed fix: a distinct "non-card detected" signal (e.g.
`CardScannerError.nonCardDetected`) that stops local matchers for that frame
while plain no-match keeps falling through. Not yet implemented (awaiting
go-ahead).

ROOT CAUSE CONFIRMED 2026-08-09: the app is built by Xcode Cloud on push,
from a fresh clone — and the ScanIndex model/index were gitignored, so no
cloud build ever contained them; the pre-build guard only warns by default.
Every TestFlight install shipped a scanner with no embedding model/index.
Fixed by tracking `CardEmbeddings.mlpackage` (rebuilt this session on Linux,
verified 18/18 top-1 @ 0.970 mean sim against the index), the index bin, and
metadata in git. Do not move them to LFS (Xcode Cloud can't resolve it).

Still to do on a real device: run the Scanner Assets pane, confirm all green;
if the model is missing, `bash scripts/ios-assets.sh build` (needs the
py3.11 coremltools venv) and rebuild. Then re-test live scanning — and feed a
few real phone captures back into the replay tooling so camera-condition
numbers replace the synthetic ones above.

Offline repro scripts (scratchpad, not committed): embed Drive catalog images
with transformers.js, query the int8 index, compare exact/fp32/graded/squashed
variants, and a JS port of the fingerprint+HSV matcher. Rebuild them from this
description if needed — or just re-run `eval-recognition.ts` paths.

## Session Results 2026-07-01

Headline: the recognition pipeline is far better than the old benchmark said.
The v1 ground-truth fixture was systematically misaligned; 16/16 sampled
"wrong" labels were verified frame-by-frame to be CORRECT scanner output,
usually down to the exact collector number.

Benchmark (Sinnoh video, 10s sampling, scored against ground truth v2 with
`--tolerance-seconds 5`, jumbo excluded):

| run | crops | gate | coverage | top-1 name | committed-label precision |
|---|---|---|---|---|---|
| baseline | 640px frames | off | 73.7% | 27.6% | 22/26 = 85% |
| gated | 640px frames | 0.45 | 73.7% | 27.6% | 22/26 = 85% |
| gated + full-res | 1080p frames | 0.45 | 85.5% | 35.5% | **31/31 = 100%** |

Key takeaways:

- Crop resolution was the dominant error source. Cropping from the full-res
  frame (detect on 640, crop from source) removed every misidentification
  (Morpeko V -> Pikachu ex/Pachirisu ex, Furfrou -> Shiftry were 640px-crop
  confusions).
- The rejection gate (logistic head on the existing DINOv2 embedding) rejects
  ~66% of junk crops at 98.7% card-face recall on held-out video time. It did
  not change top-1 on this video (all above-threshold errors were real card
  faces), but it kills junk before retrieval and is the open-set safety net.
- Low top-1-per-window is now mostly a sampling artifact: most reveal windows
  are ~4s, so 10s sampling misses them entirely. Per-observation precision is
  the honest runtime metric.
- ffmpeg `fps=1/N` sampling has a phase offset of up to ~4s between different
  N. Ground-truth windows are padded and the evaluator has
  `--tolerance-seconds` for this. Do not compare runs at different sample
  rates without tolerance.

New artifacts and scripts (all in this repo):

- `backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.v2.json`
  — rebuilt evidence-based ground truth: 79 windows (76 scored, 3 jumbo),
  each tagged `verified-frame` (human/agent eyeballed the frame) or
  `proposal` (pipeline-confident, sim >= 0.75). v1 kept for history; USE V2.
- `backend/src/scripts/build-video-crop-dataset.ts` — auto-labeled crop
  dataset from a video + ground truth (card-face / negative / uncertain by
  window membership; ~650 crops from the Sinnoh video at 2s sampling).
- `backend/src/scripts/train-rejection-gate.ts` — trains the card-face gate:
  class-balanced logistic regression on the L2-normalized DINOv2 embedding,
  time-based train/val split, threshold table + recommendation.
- `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json` — trained
  gate artifact (384-d weights + bias + recommendedThreshold 0.45). Runtime
  cost: one dot product. Portable to web and iOS as-is.
- `backend/src/scripts/propose-video-ground-truth.ts` — dense full-res gated
  pipeline pass that groups confident identifications into draft ground-truth
  windows with per-window evidence frames (labeling tool, uses tfjs-node).
- `live-video-stream-scan.ts` new flags: `--gate <artifact>`,
  `--gate-threshold <x>`, `--full-res-crops`.
- `eval-video-stream.ts` new flag: `--tolerance-seconds <n>`.
- `docs/benchmarks/2026-07-01-sinnoh/` — the three eval reports above.

Reproduce the best run:

```bash
cd /Users/ahmadjalil/github/TCGer
# serve the YOLO model (any static server on 3003 works)
(cd frontend/public && python3 -m http.server 3003 &)

npm --prefix backend run scan:video-live-stream -- \
  --video "/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4" \
  --sample-seconds 10 \
  --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
  --full-res-crops \
  --out-dir /tmp/tcger-live-fullres

npm --prefix backend run eval:video-stream -- \
  --ground-truth /Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.v2.json \
  --results /tmp/tcger-live-fullres/live-stream-results.json \
  --exclude-tags jumbo --tolerance-seconds 5 \
  --out /tmp/tcger-live-fullres/eval-report.json
```

Gotchas found this session:

- npm scripts run with `backend/` as cwd; relative `--ground-truth` paths in
  the older examples below resolve wrong. Pass absolute paths.
- `@tensorflow/tfjs-node` breaks on Node >= 23 (`util.isNullOrUndefined`
  removed); offline tools shim it (see build-video-crop-dataset.ts). Never
  needed for runtime code.
- tcgdex names differ from card wording in places ("Castform Rain Form" vs
  "Castform Rainy Form") — ground truth uses `acceptedNames` for aliases.

Highest-leverage next steps — ALL SHIPPED later the same day (session 2):

1. DONE — full-res cropping in the browser scanner. `extractCardCrop` takes a
   `sourceScale`; `processYoloWithEmbedding` captures a 1920px copy of each
   frame at the same instant as the 640px detection frame and crops
   embedding/OCR inputs from it (`CROP_FRAME_SIZE`). The sharpness gate
   downsamples to 96px internally, so its calibration is unaffected.
2. DONE — rejection gate wired into web AND iOS.
   - Web: artifact served as `/scan-index/card-face-gate.json` (service worker
     already caches that path). `embedding-matcher.ts` exports
     `ensureCardFaceGate` (null on missing artifact or encoder/dimension
     mismatch → gating disabled, never rejects) + `scoreCardFaceGate`;
     enforced in `matchDetectionEmbedding` before top-K (skip label
     `yolo-nonface`, outline still shown).
   - iOS: `CardScanner/Embedding/CardFaceRejectionGate.swift` loads bundled
     `Resources/ScanIndex/CardFaceGate.json`; `BoardCardEmbeddingScannerStrategy`
     returns nil for gated crops. Simulator build green, artifact verified in
     the .app bundle.
   - NOTE: the web runtime copy remains gitignored. The iOS
     `Resources/ScanIndex/CardFaceGate.json` copy is now tracked and bundled so
     clean clones retain rejection gating. The canonical fixture remains
     `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json`; the iOS
     asset pipeline verifies that the bundled JSON matches it.
3. DONE — dense-sampling benchmark. `live-video-stream-scan.ts` gained
   `--native-backend` (tfjs-node, accuracy runs only). 3s sampling + full-res
   + gate on the Sinnoh video: coverage 85.5% → **98.7%** (75/76 windows),
   top-1 name 53.9%, per-observation precision 87.9% (91 committed). The new
   wrong labels are one-frame transition misreads; simulating the doc's
   temporal rule (same name ≥2 observations within 9s) on the same results
   gives **100% precision (50/50)**. At browser frame rates (~2-5 fps
   effective vs 0.33 here) the 2-frame rule costs almost no coverage — the
   offline 17% coverage under the vote is purely a sparse-sampling artifact.
   Report: `docs/benchmarks/2026-07-01-sinnoh/gated-fullres-3s.eval-v2-tol5.json`.
4. DONE — twin-print OCR: slash-less digit-run recovery. Real-video finding:
   Tesseract reads the Morpeko V footer as "0079202" (= 079/202 with the
   slash dropped), so the strict NNN/NNN pair rule abstained on every frame.
   New conservative fallback in `collector-ocr.ts` (`runs` on OcrReading +
   fusion), `eval-recognition.ts`, and iOS `CollectorNumberOCR.swift`
   (`readFooter`, `extractDigitRuns`, `runsConfirm`): a 5-8 digit run counts
   only if it is exactly `0-padded collector number + 2-3 digit denominator`
   for EXACTLY ONE distinct shortlist number (ambiguity → abstain). Validated
   on full-res Morpeko V crops: 4/6 frames resolve to the verified-correct
   swsh1-79, zero false promotions, noisy reads abstain
   (`eval-recognition.ts` metrics: ocrMatchedRate 0 → 0.5, exact-print top-1
   2/9 → 4/9 on that set).

Sampling-rate finding (user-driven, 2026-07-01 late): cards in this video are
on screen ~1.5-2.5s each during pack flips. At 2s sampling a card can land
entirely on its transition frames (Sinistea at ~203s was missed this way; a
0.5s rescan identifies it at 0.83 plus three more pack-1 cards every slower
pass missed: Fire Energy, Dubwool, Lucky Egg — all now in GT v2). Rule of
thumb: offline benchmarks of pack-opening content need >= 1 fps sampling; the
live browser scanner is busy-loop paced (~2-5 fps effective) and is not
affected. `--start-seconds/--end-seconds` on live-video-stream-scan.ts make
segment rescans cheap.

Miss taxonomy (from the scan-review sessions, 2026-07-01 late — every missed
card in the Sinnoh video falls into one of three classes):

1. Threshold-line misses — correct card IS top-1 but sits just under 0.72
   (Chinchou 0.715, energies/trainers 0.63-0.68). Recoverable: more frames,
   or the verified path (>=0.65 + OCR agreement).
2. Single-frame policy suppression — model right, smoothing hid it (Yamper,
   Sinistea, Metal Energy). Fixed by print-consensus confirmation (top-2
   candidates same name = self-confirming single frame); note an
   evolution-line neighbor as #2 (Swirlix/Slurpuff) defeats consensus.
3. Hard embedding failures — correct card not even in the top-20 shortlist,
   so OCR fusion cannot rescue it (Galarian Yamask swsh6-82: dark art +
   glare band → rank 46 @ 0.597 on a clean manual crop; index entry itself
   verified healthy). Only fixes: a glare-free frame, glare/dark
   augmentation at index build time, or a title-band OCR recognition path
   independent of the embedding.

Perspective rectification (2026-07-02, "what people do online" applied):

- The benchmark harness now exposes `--rectify-mode none|rescue|always`;
  `--rectify` remains an alias for `rescue`. See
  `docs/manabox-inspired-geometry-experiment.md` for the decision, test matrix,
  metrics, and promotion gates.

- `backend/src/scripts/card-rectify.ts` — pure-TS quad refinement + homography
  warp: Sobel edge scan per side -> RANSAC line fit (median rejection is NOT
  enough; fingers create contiguous outlier blocks) with 30-degree orientation
  constraint -> per-side detector-box fallback (max 1 side) -> DLT homography
  -> bilinear warp to a flat 480px card.
- Measured on the full Sinnoh video (1s sampling, GT v2 = 94 windows, tol 5):
  - plain full-res crops:        275 committed, 93.8% precision, 85/91 windows
  - BLANKET rectification:       252 committed, 91.7%, 81/91 — NET NEGATIVE
    (warping already-good crops shifts sims; a holo Slowking started misreading)
  - RESCUE CASCADE (`--rectify`): 287 committed, 93.0%, **87/91 windows,
    zero windows lost** — plain crop first, warp only when top-1 fails the
    threshold, keep whichever scores higher (65 rescues fired).
- Contrast standardization measured HARMFUL for the embedding path
  (normalise/CLAHE moved a hard case from rank 46 to rank 278-313; catalog
  ranks unchanged on good crops). Keep contrast ops OCR-only.
- Title-band OCR feasibility PROVEN for the dark-art class: Tesseract reads
  "Basic, Galarian Yamask w60" verbatim off the rectified crop's title band.
  The embedding-independent title fallback is the remaining rescue to build.
- Still missed at 1 fps after cascade (4/91): Chinchou (0.70-0.72 line),
  Energy Retrieval (0.69), Galarian Yamask (dark+glare, rank ~1 after rectify
  but ~0.61), Slowking-recap (fast flipping). All are title-OCR-rescuable.

Technique survey round 2 (2026-07-02, user-driven):

- Statistical acceptance (Magic Card Detector's 4-sigma rule) — TESTED, does
  NOT transfer to DINOv2 cosine distributions: z-scores of junk (2.5-2.8) and
  wrong matches (2.75) interleave with good matches (2.6-3.5). Fixed
  threshold + gate stays. (z/margin could still be gate-v2 features.)
- Track-level embedding averaging — TESTED offline, strong WHEN fused with
  rectification and track purity: Energy Retrieval rank 23 -> 1, Morpeko V
  rank 239 -> 2 (twin print), Spheal +0.055. Does not fix all-frames-glared
  (Yamask) or mixed-card windows. PORTED TO BROWSER: `EmbeddingTrackAverager`
  in use-video-scan-processor.ts (spatial-bucket tracks like the OCR voters,
  sliding window 5, mean-normalized query once >=2 frames) + the rescue
  cascade via `frontend/src/lib/scan/card-rectify.ts` (copy of the backend
  module — keep in sync). Production build passes. The offline harness
  remains per-frame (no tracker), so browser recall should now EXCEED the
  benchmark numbers.
- Still on the shelf, in rough priority: art-crop fallback index (occluded
  cards; Magic detector future-work + our old artwork pipeline), ArcFace-style
  fine-tuned embedding (Ximilar's approach — GT v2 + crop dataset now provide
  the training data), rotation TTA in the cascade (for upside-down cards in
  live use), alpha-QE query expansion (margin-gate it: blurs twins).

Title-band OCR fallback (2026-07-02) — **100% window coverage reached**:

- `backend/src/scripts/title-ocr.ts` + `--title-ocr` on the harness: when the
  cascade still fails on a gate-approved card face, OCR the title band
  (top 2-12% of the rectified/plain crop, 3x upscale), match the longest
  index card name contained verbatim in the collapsed text, then let the
  embedding pick the PRINT within that name's entries (restricted re-rank —
  reliable even when the global rank is not; sanity floor 0.45).
- Full Sinnoh video (1s, GT v2 = 94 windows): **91/91 scored windows
  identified (100%)**, up from 87/91 with the cascade alone; the 4 gains are
  exactly the prior misses (Chinchou, Energy Retrieval, Galarian Yamask,
  Slowking-recap), 14 title-OCR observations, zero windows lost. Report:
  `docs/benchmarks/2026-07-02-sinnoh-rectify/full-1s-titleocr.eval-v2-tol5.json`.
- PITFALL FIXED: Stage-1/2 cards print "Evolves from <pre-evolution>" under
  the title; when OCR reads that line but misses the stylized title, the
  pre-evolution matches (observed: Slurpuff -> "Swirlix" x3). matchTitleText
  strips `evolvesfrom<name>` before matching.
- GOTCHA: terminate the Tesseract worker (`terminateTitleWorker`) or the
  Node process never exits.
- NOT yet in the browser: title-OCR port needs a letters-whitelist Tesseract
  worker beside the digits one in collector-ocr.ts, plus the name index
  (entries are already client-side). Basic-energy cards have no collector
  number AND single-word names shorter than the 6-char floor ("Fire Energy"
  passes; bare "Potion" would not) — keep the floor, it is the false-positive
  guard.

Remaining follow-ups:

- Real-camera validation on a physical iPhone (still never done — no device).
- Web/iOS preprocessing parity (resize-256+crop vs resize-224) is still the
  known top-1 gap on iOS; see earlier session notes.
- Grow the crop dataset + retrain the gate on new eval videos (one command
  each: build-video-crop-dataset.ts → train-rejection-gate.ts). If the
  embedding model ever changes, the gate MUST be retrained (loaders check
  model/dimension and disable gating on mismatch).
- Browser track layer already accumulates per-track evidence; consider making
  the 2-frame same-name agreement an explicit surfacing rule in
  `video-scan-tracks.ts` to match the measured 100%-precision policy.

## Purpose

This document is for an AI agent or engineer building, replacing, or testing
TCGer card-scanning models. It explains the current scanner shape, where card
metadata comes from, how to run video/live-scan evaluations, and the constraints
that matter for web and iOS.

The goal is not just to identify one clean card image. The goal is live scanning:
detect card-like objects in video frames, reject non-card crops, recognize real
card faces conservatively, and only surface a card label after enough temporal
evidence.

## Current Diagnosis

The embedding model is not the main runtime bottleneck. The main risks are:

- YOLO runtime selection on web. A CPU fallback is too slow for live scanning.
- Open-set recognition. Packs, backs, tins, hands, backgrounds, and bad crops
  must not be forced to the nearest card.
- Confidence calibration. Margin-only acceptance causes false labels.
- Temporal instability. One-frame guesses should not be shown as final labels.
- iOS parity. The iOS scanner should stay native SwiftUI/CoreML/Vision, not a
  WebView wrapper.

The desired behavior is:

- high-confidence cards get names
- weak detections show "card detected"
- bad/non-card crops are rejected
- labels require repeated agreement across frames

## Key Repositories And Services

Main app repository:

- `/Users/ahmadjalil/github/TCGer`

Infrastructure/GitOps repository:

- `/Users/ahmadjalil/github/personalprox`

The production-like cluster card library is defined in personalprox:

- `/Users/ahmadjalil/github/personalprox/k8s/tcger/caches.yaml`
- `/Users/ahmadjalil/github/personalprox/k8s/tcger/backend.yaml`
- service: `tcger-tcgdex`
- namespace: `tcger`
- internal service URL: `http://tcger-tcgdex:4040`

The backend is configured to use that library:

```text
POKEMON_API_BASE_URL=http://tcger-tcgdex:4040
TCGDEX_API_BASE_URL=http://tcger-tcgdex:4040
```

External/backend route from the LAN:

```bash
curl 'http://tcger.k8s.home/api/cards/search?query=Pikachu&tcg=pokemon'
```

Direct cache debug route with port-forward:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  port-forward -n tcger svc/tcger-tcgdex 14040:4040

curl 'http://127.0.0.1:14040/health'
curl 'http://127.0.0.1:14040/cards?q=turtwig&page=1&pageSize=3'
```

Known cache state from the last check:

- `tcger-tcgdex` was healthy
- it had `23,315` Pokemon cards
- backend `/api/cards/search` worked with a normal timeout

Important caveat: backend search responses may contain image URLs like
`http://tcger-tcgdex:4040/images/...`. That hostname is valid inside the
cluster, not in a normal browser outside the cluster. Browser-facing image URLs
need a proxy or rewrite.

## Scanner Architecture

The intended scanner pipeline is:

1. Detect card candidates.
2. Crop and rectify each card candidate.
3. Reject non-card/card-back/bad crops before recognition.
4. Embed or fingerprint the crop and retrieve a top-K shortlist.
5. OCR title/footer regions as verification and reranking signals.
6. Track detections over time.
7. Surface a final card label only after stable evidence.

Relevant web files:

- `/Users/ahmadjalil/github/TCGer/frontend/src/lib/scan/yolo-detector.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/lib/scan/embedding-matcher.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/use-video-scan-processor.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/video-scan-tracks.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/video-scan-lab.tsx`

Relevant backend/eval files:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/live-video-stream-scan.ts`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/eval-video-stream.ts`
- `/Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json`

Relevant iOS files:

- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/CardScanner/Embedding/CardEmbeddingEncoder.swift`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/README.md`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/scripts/convert-dinov2-coreml.py`

## Current Model Assets

### Reproducible iOS asset pipeline

From the repository root:

```bash
bash scripts/ios-assets.sh build
bash scripts/ios-assets.sh check
```

The build command generates/synchronizes the offline catalogs, builds the iOS
binary/metadata index from the web DINOv2 embedding index, runs Core ML
conversion when its Python dependencies are installed, and refreshes the
tracked rejection-gate copy. It prints exact setup commands for unavailable
optional generators; its final check still exits nonzero while any required
shipping asset is missing or invalid. The check validates JSON, catalog
manifest counts/byte sizes/SHA-256 hashes, and scanner-index binary headers.

The TCGer app target has a pre-build guard that invokes the same check. Missing
or invalid assets are warning-only in Debug, but hard-fail Release builds. This
keeps simulator work possible on a clean clone while preventing an incomplete
scanner/catalog bundle from shipping.

Web YOLO model:

- `/Users/ahmadjalil/github/TCGer/frontend/public/models/yolo-card-detector/model.json`
- shard files in the same directory

Web Pokemon embedding index:

- `/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/pokemon-embeddings.json`
- manifest: `/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/manifest.json`

iOS model/index resources:

- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/`

Backend embedding/export scripts:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/build-embedding-index.ts`
- `/Users/ahmadjalil/github/TCGer/backend/scripts/export-external-embedding-assets.py`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/benchmark-embeddings.ts`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/build-ios-index.ts`

## Recognition Policy

Use conservative open-set behavior. Do not force every crop to a card.

Recommended defaults:

- raw embedding label requires similarity around `0.70-0.72`
- similarity around `0.65` should only be used with OCR or temporal
  confirmation
- do not accept a card because margin alone is high
- use top-K internally, usually `20` or more
- show "card detected" when below recognition threshold
- require the same card/name across `2-3` good frames before showing a final
  label

Non-card examples that must not receive card names:

- sealed packs
- card backs
- tins
- hands
- playmats
- transition frames
- heavily blurred crops
- partial crops with no readable face

## Web Runtime Rules

For browser live scanning, backend choice matters more than embedding math.

Preferred TF.js backend order:

```text
WebGPU -> WebGL -> WASM -> CPU
```

Rules:

- log the selected backend
- treat CPU as dev-only/non-live
- avoid synchronous tensor reads such as `dataSync()`
- prefer async `data()`
- run heavy scanning on a fixed detector cadence, not every animation frame
- use `requestVideoFrameCallback` where practical
- move expensive work to a Worker with OffscreenCanvas/ImageBitmap when the UI
  starts janking

If a benchmark says YOLO is several seconds per frame, first check whether it is
using a CPU backend. A Node script using plain `@tensorflow/tfjs` is not a fair
browser WebGPU/WebGL benchmark.

## iOS Runtime Rules

iOS should remain native:

- SwiftUI UI
- CoreML embedding encoder
- Vision rectangle/document detection and OCR
- Accelerate/vectorized lookup where needed

Do not wrap the web scanner in a production WebView.

Critical parity rule:

- the model preprocessing used to build the index must match runtime
  preprocessing exactly
- for DINOv2-style models, the current expectation is shortest-edge resize to
  `256`, then center crop to the model input size

Use Vision rectangle/document detection first. Only export YOLO to CoreML if
real phone captures show Vision crop recall is bad.

## Evaluation Video

Primary test video:

```text
/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4
```

Ground truth:

```text
/Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json
```

This video includes non-card objects and transition states. That is useful. The
scanner should not score well by guessing card names for everything.

## Live-Stream Benchmark

Run from the repo root or backend directory.

Example full live-stream scan:

```bash
cd /Users/ahmadjalil/github/TCGer

npm --prefix backend run scan:video-live-stream -- \
  --video "/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4" \
  --sample-seconds 10 \
  --out-dir /tmp/tcger-live-video-full-10s
```

Then evaluate:

```bash
npm --prefix backend run eval:video-stream -- \
  --ground-truth backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json \
  --results /tmp/tcger-live-video-full-10s/live-stream-results.json \
  --exclude-tags jumbo \
  --out /tmp/tcger-live-video-full-10s/eval-report.json
```

Useful evaluator options:

```bash
npm --prefix backend run eval:video-stream -- --help
```

Use `--include-proposals` only when intentionally scoring every proposal. The
default is best-observation scoring, which better matches what the UI should
surface per frame.

## What To Measure

Do not optimize only top-1 accuracy. A useful scanner needs these metrics:

- top-1 name hit rate
- top-1 externalId hit rate
- top-K candidate recall
- false-positive observation count
- covered ground-truth windows
- confident-frame rate
- latency per detector frame
- latency per embedding crop
- selected web runtime backend
- number of frames skipped due to processing backpressure

For model development, prioritize:

- false positive reduction first
- top-K recall second
- top-1 reranking third
- raw FPS only after the pipeline is conservative

## Model Development Contract

A new recognition model should provide:

- deterministic image preprocessing
- documented input size and normalization
- an encoder usable on web and iOS
- an index builder using the exact same preprocessing
- top-K retrieval output with scores
- calibration data for thresholds
- a failure mode report, especially for packs/backs/bad crops

Minimum artifact set:

```text
model metadata
web model artifact
iOS/CoreML model artifact if applicable
reference vector/index file
metadata mapping vector row -> card externalId/name/set/collector number
benchmark report against the Sinnoh video
threshold recommendation
```

If preprocessing changes, rebuild the entire reference index. Do not compare
new runtime embeddings against an old index.

## OCR And Reranking

Embedding should produce a shortlist, not final truth.

Use OCR as verification:

- title band for visible names
- footer/collector number for exact print identity
- denominator/set code where readable
- temporal OCR votes per tracked card, not one global OCR vote bucket

Expected behavior:

- OCR agreement can allow lower embedding similarity
- OCR disagreement should down-rank a candidate
- absence of OCR should not force rejection if embedding is strong and stable
- OCR from one detection should not influence a different spatial track

## Card-Face Rejection

Add or improve a card-face rejection stage before embedding. It can be a small
classifier, heuristic gate, or both.

Signals to consider:

- visible title/text band
- border/card aspect sanity
- artwork/text layout consistency
- card-back color/layout detection
- pack/sealed-product rejection
- blur/sharpness threshold
- crop coverage and occlusion estimate

YOLO confidence alone is not enough because non-card or non-face objects can
still be detected with high confidence.

## Existing Local/Cluster Commands

Check cluster TCGer resources:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  get pods,svc,ingress -n tcger -o wide
```

Check backend health:

```bash
curl http://tcger.k8s.home/api/health
```

Check Pokemon search through backend:

```bash
curl 'http://tcger.k8s.home/api/cards/search?query=Pikachu&tcg=pokemon'
```

Check TCGdex cache directly:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  port-forward -n tcger svc/tcger-tcgdex 14040:4040

curl http://127.0.0.1:14040/health
```

Local frontend:

```bash
cd /Users/ahmadjalil/github/TCGer
npm run dev:frontend
```

Default local frontend URL:

```text
http://localhost:3003/scan
```

## Verification Commands

Frontend typecheck:

```bash
cd /Users/ahmadjalil/github/TCGer/frontend
npx tsc --noEmit --pretty false --incremental false
```

Backend focused script typecheck:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
npx tsc --noEmit \
  --target ES2021 \
  --module commonjs \
  --moduleResolution node \
  --esModuleInterop \
  --strict \
  --skipLibCheck \
  --types node \
  src/scripts/live-video-stream-scan.ts \
  src/scripts/eval-video-stream.ts
```

iOS static parse for edited scanner files:

```bash
cd /Users/ahmadjalil/github/TCGer
xcrun swiftc -parse \
  mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift \
  mobile-apps/ios/TCGer/TCGer/CardScanner/Embedding/CardEmbeddingEncoder.swift
```

Python conversion script syntax:

```bash
cd /Users/ahmadjalil/github/TCGer
python3 -m py_compile mobile-apps/ios/scripts/convert-dinov2-coreml.py
```

Whitespace check:

```bash
cd /Users/ahmadjalil/github/TCGer
git diff --check
```

## Known Pitfalls

- Do not trust Node TF.js CPU timings as browser live-scan timings.
- Do not accept labels from margin-only nearest-neighbor matching.
- Do not globally share OCR votes across unrelated detections.
- Do not evaluate only frames that contain clean front-facing cards.
- Do not compare embeddings built with one preprocessing pipeline against
  runtime embeddings from another.
- Do not use WebView-wrapped web scanning as the production iOS answer.
- Do not treat card search metadata as the same thing as scanner ground truth.
- Do not forget non-card negatives; open-set rejection is part of recognition.

## Immediate Useful Work

Best next tasks for a model/scanner AI:

1. Add a card-face/non-card rejection model or heuristic gate.
2. Run the Sinnoh live-stream benchmark after each threshold/model change.
3. Add more ground-truth windows and explicit negative windows.
4. Generate a crop dataset from the video with labels:
   - card face
   - card back
   - pack/sealed product
   - hand/background
   - blurry/transition
5. Benchmark DINOv2/CLIP or any new embedding model on top-K recall and false
   positives, not only top-1.
6. Improve OCR reranking with collector-number/footer verification.
7. Validate iOS preprocessing parity against web/index-builder outputs.

## Success Criteria

A change is genuinely useful when it improves live-scan behavior:

- fewer false card names on non-card objects
- fewer one-frame bad labels
- similar or better top-K recall on true visible cards
- no CPU-only web runtime regression
- no iOS/web preprocessing divergence
- evaluation report is saved and reproducible

Always leave behind the command, output directory, and threshold/model version
used for the benchmark.
