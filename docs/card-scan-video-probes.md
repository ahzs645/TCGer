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
2. Keep the new track-level aggregation and feed it better crops.
3. Revisit OCR narrowing after crop quality improves, not before.
