# Card Scan Video Probes

Last updated: 2026-04-04

## Goal

Document reproducible video-frame debugging work for the card scan pipeline, with a focus on hard social-video inputs like `/Users/ahmadjalil/Downloads/Untitled design.mp4`.

## Current probe harness

The backend now includes:

- `npm run probe:video-frame -- --frame /path/to/frame.jpg --tcg pokemon --output-dir /tmp/dir`

Entry point:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/probe-video-frame.ts`

This script:

- builds the same source variants as the runtime video scan path
- scans each source variant with the normal card matcher
- saves source crops and normalized runtime variants
- runs OCR sweeps on title/footer ROIs for the best normalized card crop
- writes a JSON report with all scores and OCR outputs

The video source-variant builder is exposed for debugging from:

- `/Users/ahmadjalil/github/TCGer/backend/src/modules/card-scan/video-scan.service.ts`

The video CLI now also includes a lightweight track manager in:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/scan-video.ts`

The current tracking model is intentionally simple:

- build crop proposals for each sampled frame
- associate proposals to an existing track by overlap and motion
- accumulate candidate scores on the track
- emit once when the same card stays on top long enough
- finalize when the track disappears or the video ends

## Kirlia frame probe

Frame used:

- `/tmp/tcger-video-retest/frame-75.jpg`

Command used:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
NODE_ENV=test \
BACKEND_MODE=convex \
CARD_SCAN_STORE=file \
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npm run probe:video-frame -- \
  --frame /tmp/tcger-video-retest/frame-75.jpg \
  --tcg pokemon \
  --output-dir /tmp/tcger-video-probe-frame75
```

Artifacts:

- report: `/tmp/tcger-video-probe-frame75/report.json`
- source crops: `/tmp/tcger-video-probe-frame75/source`
- normalized runtime crops: `/tmp/tcger-video-probe-frame75/runtime`
- OCR ROIs: `/tmp/tcger-video-probe-frame75/ocr`

Observed results:

- best source variant: `trim-white-12-portrait-center-90`
- best source result: `bestMatch: null`
- best source shortlist size: `0`
- best normalized variant: `corrected-upright`
- perspective correction: applied
- contour area ratio: about `0.998`
- OCR: no usable card name recovered from the best corrected crop

Top OCR outputs from this frame were low-confidence garbage strings such as:

- `NF G c`
- `EEE EET ee`
- `l csm- i i Es j`
- `ey Ne JN`

The important point is not that OCR is broken globally. It is that on this specific frame, after the current crop+rectify pipeline, the title/footer bands are still too degraded for useful narrowing.

## Other things tried

### Current video scan CLI

Command:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
NODE_ENV=test \
BACKEND_MODE=convex \
CARD_SCAN_STORE=file \
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npx tsx src/scripts/scan-video.ts \
  --video '/Users/ahmadjalil/Downloads/Untitled design.mp4' \
  --tcg pokemon \
  --offset 75 \
  --duration 1 \
  --fps 1 \
  --max-windows 24
```

Result:

- `framesScanned: 1`
- `matchedFrames: 0`

### Tracking control test

Synthetic clean clip:

- `/tmp/tcger-track-test/exact-card.mp4`

Source image:

- `/tmp/tcger-server-pokemon/images/sv07/sv07-119.webp`

Command:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
NODE_ENV=test \
BACKEND_MODE=convex \
CARD_SCAN_STORE=file \
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npm run scan:video -- \
  --video /tmp/tcger-track-test/exact-card.mp4 \
  --tcg pokemon \
  --fps 1 \
  --offset 0 \
  --duration 2 \
  --max-frames 2 \
  --max-windows 1 \
  --max-proposals 1 \
  --track-ttl 2 \
  --min-stable 2
```

Result:

- `framesScanned: 2`
- `matchedFrames: 2`
- one emitted detection, not duplicates
- emitted card: `sv07-119 Bouffalant`

This confirms the track manager behaves correctly when the underlying matcher is healthy.

### Tracking on the Kirlia second

Command:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
NODE_ENV=test \
BACKEND_MODE=convex \
CARD_SCAN_STORE=file \
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npm run scan:video -- \
  --video '/Users/ahmadjalil/Downloads/Untitled design.mp4' \
  --tcg pokemon \
  --fps 1 \
  --offset 75 \
  --duration 1 \
  --max-frames 1 \
  --max-windows 24 \
  --max-proposals 2 \
  --track-ttl 2 \
  --min-stable 2
```

Result:

- `framesScanned: 1`
- `matchedFrames: 0`
- one unknown track created
- no emitted card

This is the expected outcome for the current Kirlia failure case: tracking now suppresses duplicate adds and gives a stable place to accumulate evidence, but it does not manufacture identity when the crop pipeline still cannot produce a shortlist.

### Scanic reference spike

Repo:

- `/Users/ahmadjalil/Downloads/Scanner/scanic-main`

What was tried:

- installed npm dependencies
- installed `wasm-pack`
- attempted local WASM build
- attempted repo Docker build path

What blocked execution:

- checked-out repo is missing `wasm_blur/pkg`
- local Rust toolchain does not have `wasm32-unknown-unknown`
- Docker build path did not complete quickly enough for a clean spike

Conclusion:

- `scanic` is still a good design reference for quad warp
- it is not a drop-in runnable baseline in this checkout yet

### Cardcaptor-v3 packaged detector spike

Model:

- `AlecKarfonta/cardcaptor-v3`
- local download used for testing:
  - `/tmp/tcger-models/onnx/cardcaptor_v3_best.onnx`

Local runtime used:

- `python3`
- `ultralytics`
- `onnxruntime`
- `huggingface_hub`

Useful command shape:

```bash
python3 - <<'PY'
from ultralytics import YOLO
model = YOLO('/tmp/tcger-models/onnx/cardcaptor_v3_best.onnx', task='obb')
results = model.predict(source='/tmp/tcger-video-retest/frame-75.jpg', imgsz=1088, conf=0.05, verbose=False)
print(results[0].obb.conf.cpu().numpy().tolist())
print(results[0].obb.xyxyxyxy.cpu().numpy().tolist())
PY
```

Important detail:

- the ONNX model expects `1088x1088` inference, not `640x640`

Observed detector results:

- on `/tmp/tcger-video-retest/frame-75.jpg`
  - detected `2` OBB boxes
  - top confidence about `0.679`
- on `/tmp/tcger-track-test/frame.png`
  - detected `1` OBB box
  - confidence about `0.613`

Detector crops saved here:

- `/tmp/tcger-cardcaptor-probe/frame-75-cardcaptor-warp.jpg`
- `/tmp/tcger-cardcaptor-probe/frame-75-cardcaptor-aabb.jpg`
- `/tmp/tcger-cardcaptor-probe/frame-cardcaptor-warp.jpg`
- `/tmp/tcger-cardcaptor-probe/frame-cardcaptor-aabb.jpg`
- `/tmp/tcger-cardcaptor-probe/frame-cardcaptor-aabb-pad.jpg`

What happened when those crops were fed back into TCGer:

- detector crops did **not** match successfully yet, even on the clean control frame
- the detector clearly localizes the card better than heuristic windows
- the unsolved part is the handoff from detector output to a matcher-friendly canonical crop

### Cardcaptor-v3 on a larger video span

Frames extracted from the first `180s` of the test video:

- video: `/Users/ahmadjalil/Downloads/Untitled design.mp4`
- extracted frames: `/tmp/tcger-cardcaptor-video/frames`
- sample rate: `0.25 fps` (`45` frames total)

Detector sweep output:

- `/tmp/tcger-cardcaptor-video/cardcaptor-summary.json`

Detector coverage:

- `45` frames sampled
- `38` frames with at least one OBB detection
- `7` frames with no detections
- `21` frames with multiple detections

By minute:

- `0-60s`: `9/15` frames detected, top confidence `0.947`
- `60-120s`: `15/15` frames detected, top confidence `0.811`
- `120-180s`: `14/15` frames detected, top confidence `0.944`

Top-confidence frames included:

- `frame-0012.jpg` (`44s`): `7` detections, top confidence `0.947`
- `frame-0035.jpg` (`136s`): `5` detections, top confidence `0.944`
- `frame-0013.jpg` (`48s`): `10` detections, top confidence `0.935`

Matcher follow-up:

- top detector crop from each detected frame was converted to a padded axis-aligned crop
- crops were scanned with the normal Pokemon matcher
- output: `/tmp/tcger-cardcaptor-video/matcher-summary.json`

Matcher results on detector-guided crops:

- `38` detector crops evaluated
- `4` returned any match at all
- `0` were strong matches (`confidence >= 0.6`)
- `18` used perspective correction during scan

The four returned matches were all weak one-offs:

- `84s`: `dp3-112 Squirtle`, confidence `0.315`, distance `164`
- `96s`: `dp3-108 Shroomish`, confidence `0.463`, distance `129`
- `116s`: `dp3-39 Unown S`, confidence `0.254`, distance `179`
- `164s`: `pl1-85 Piplup`, confidence `0.429`, distance `137`

Those do **not** look trustworthy. They are low-confidence, inconsistent across time, and do not form a stable repeated candidate on the track.

Kirlia-specific check inside this larger sweep:

- `72s` (`frame-0019.jpg`): detector confidence `0.757`, matcher shortlist `0`
- `76s` (`frame-0020.jpg`): detector confidence `0.711`, matcher shortlist `0`
- `80s` (`frame-0021.jpg`): detector confidence `0.525`, matcher shortlist `0`

So the larger-video result is:

- detector coverage is good enough to keep pursuing detector-first
- but detector `->` padded crop `->` current matcher is still not enough
- the next problem is still building a matcher-friendly canonical crop from detector output

### Detector handoff probe

New utilities added:

- detector crop helpers:
  - `/Users/ahmadjalil/github/TCGer/backend/src/modules/card-scan/detector-crop.ts`
- repeatable probe:
  - `/Users/ahmadjalil/github/TCGer/backend/src/scripts/probe-detector-handoff.ts`

The new probe takes the saved detector summary and tries multiple detector-to-crop handoffs per frame:

- `bbox-pad-8`
- `rotate-pad-8`
- `rotate-pad-14`
- `warp-pad-8`
- `warp-pad-14`

The rotated variants are the direct Riftbound-style experiment:

- derive card center / width / height / angle from the OBB polygon
- rotate the source frame around the detection center
- crop the de-rotated card rectangle

The warp variants use the OBB polygon directly as a quadrilateral and apply a perspective warp with padding.

Command used:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
NODE_ENV=test \
BACKEND_MODE=convex \
CARD_SCAN_STORE=file \
CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon \
npm run probe:detector-handoff -- \
  --summary /tmp/tcger-cardcaptor-video/cardcaptor-summary.json \
  --frames-dir /tmp/tcger-cardcaptor-video/frames \
  --tcg pokemon \
  --seconds-per-frame 4 \
  --output-dir /tmp/tcger-detector-handoff-full2
```

Artifacts:

- report: `/tmp/tcger-detector-handoff-full2/report.json`
- crops: `/tmp/tcger-detector-handoff-full2/crops`

Observed results:

- `38` detected frames evaluated
- `3` frames returned any match at all
- `0` strong matches

Best-per-frame crop winners:

- `bbox-pad-8`: `29`
- `rotate-pad-8`: `3`
- `rotate-pad-14`: `2`
- `warp-pad-8`: `1`
- `warp-pad-14`: `3`

But only `bbox-pad-8` produced any matches:

- `bbox-pad-8`: `4` weak matches
- `rotate-pad-8`: `0`
- `rotate-pad-14`: `0`
- `warp-pad-8`: `0`
- `warp-pad-14`: `0`

Top matches were still the same weak one-offs seen earlier:

- `96s`: `dp3-108 Shroomish`, confidence `0.463`
- `164s`: `pl1-85 Piplup`, confidence `0.429`
- `84s`: `dp3-112 Squirtle`, confidence `0.315`

Kirlia-specific result after the new handoff probe:

- `72s` (`frame-0019.jpg`): no shortlist from any variant
- `76s` (`frame-0020.jpg`): no shortlist from any variant
- `80s` (`frame-0021.jpg`): no shortlist from any variant

Interpretation:

- the Riftbound-style rotated crop is worth knowing about, but it did not improve this Pokemon video case
- the direct OBB perspective warp also did not improve this case
- the main blocker is now more specific:
  - detector geometry exists
  - simple rotate/crop and simple quad warp are both insufficient
  - the next improvement likely needs a stronger post-detect refinement stage or an artwork-first retrieval path

### Useful things from Riftbound

Repo:

- `/Users/ahmadjalil/Downloads/riftbound-scanner-main`

Useful ideas confirmed from that codebase:

1. Crop from original full-resolution pixels, not the detection-scale image.
   - This is called out in `CHANGELOG.md` and `README.md`.
   - We are already effectively doing this in the local video probes because crops come from the extracted full frame, not from detector-resized tensors.

2. `cropRotated` as a detector handoff.
   - Implemented locally as the `rotate-pad-*` variants.
   - It did not beat the padded bbox baseline on this dataset, but it was worth testing.

3. Artwork-first identification.
   - Riftbound matches on the artwork region only, with histogram equalization and a color-grid fingerprint.
   - This is still the most useful unported idea from that repo.
   - It fits the current diagnosis because whole-card hashing is too sensitive to residual frame/text/border noise after imperfect detector crops.

Interpretation:

- this is still promising
- it means detector-first is likely the right next direction
- but the next implementation task is not “swap in detector and done”
- it is:
  - detector OBB -> better crop refinement / padding / corner ordering -> matcher

## Current conclusion

The blocker is still before matching:

- better card isolation for social-video frames
- or a stronger narrowing signal from a cleaner crop

The current pipeline can already:

- find a plausible portrait window
- perspective-correct it
- hash it against the full Pokemon corpus

But for this Kirlia frame it still cannot produce a shortlist, and OCR on the resulting crop is not good enough to rescue it.

## Next likely steps

1. Replace heuristic crop windows with a detector or rotated-box isolator.
2. Use the detector as a proposal source for the tracker, not as the final crop by itself.
3. Build a better detector-to-canonical-crop handoff.
4. Revisit OCR narrowing after crop quality improves, not before.
