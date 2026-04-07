# Browser Video Scan Handoff

## Purpose

This file is a handoff for the next AI or engineer working on the browser-side
video scan prototype in TCGer.

The current goal is:

- let a user import a local video into the web UI
- run frame sampling and matching in the browser
- draw a live outline for the active card(s)
- show the current best card guess without sending every frame back to the server

This is an experimental browser-side fallback, not the final detector-backed
production pipeline.

## Current Product State

The scan page has two tabs:

- `Video Mode` (default)
- `Image Mode`

The video mode is the current focus because it is where the experimental browser
pipeline lives.

Relevant page and UI files:

- `frontend/app/scan/page.tsx`
- `frontend/src/components/scan/video-scan-lab.tsx`

## Architecture Summary

The browser-side matcher was split out of the old monolithic
`browser-video-matcher.ts` into smaller modules under `frontend/src/lib/scan/`.

Current module layout:

- `frontend/src/lib/scan/browser-video-matcher.ts`
  Thin export layer for compatibility.
- `frontend/src/lib/scan/scan-frame.ts`
  Main `scanVideoFrameCanvasInBrowser()` flow. Supports `detectionOnly` mode.
- `frontend/src/lib/scan/proposal-windows.ts`
  Portrait proposal generation, padded crop extraction, quad offset helpers.
- `frontend/src/lib/scan/quad-refinement.ts`
  Gradient sampling, border fitting, quad inference, clipped-card detection.
- `frontend/src/lib/scan/quad-warp.ts`
  Perspective warp helpers.
- `frontend/src/lib/scan/artwork-fingerprint.ts`
  Histogram-equalised 8x8 color grid fingerprints, cosine similarity matching.
  Ported from backend `artwork-matcher.ts`.
- `frontend/src/lib/scan/rgb-hash.ts`
  Browser RGB perceptual hash generation and Hamming distance.
- `frontend/src/lib/scan/feature-hashes.ts`
  Title/footer feature region hashing.
- `frontend/src/lib/scan/rank-matches.ts`
  Candidate shortlist, feature-weighted score, public match confidence.
- `frontend/src/lib/scan/scan-types.ts`
  Shared types.

## How It Works Today

Per sampled frame:

1. Generate a set of portrait window proposals.
2. Rank the raw crop from each proposal against the browser-loaded hash corpus.
3. Extract a padded refinement crop around the proposal.
4. Try to recover a card quad from visible borders inside that crop.
5. Warp the quad into a rectified card crop.
6. Re-rank the warped crop.
7. Prefer the refined crop when it is materially better.
8. Keep several distinct proposal matches and track them across frames.
9. Render the chosen quad as an SVG polygon overlay on top of the video.

Important detail:

- The browser path is still heuristic. It does **not** use the real ONNX card
  detector yet.

## Clipped / Rotated / Tilted Cards

The latest browser refinement pass is more tolerant than before:

- padded refinement crops are used before line fitting
- tilted card borders are allowed with looser slope limits
- inferred quads can extend beyond the visible card when a side is hidden
- `isClipped` is now tracked when the inferred quad is touching or depending on
  frame edges
- clipped quads are penalized when selecting between raw and refined results

This means:

- rotated and perspective-skewed cards are better supported than before
- partially hidden cards can still work
- truly clipped cards are still heuristic and should not be treated as clean
  detector output

Current limitation:

- if a frame edge becomes the strongest “border,” the browser path can still
  infer a bad side. We now mark this as clipped rather than pretending it is
  fully observed.

## What The UI Shows

The video lab now:

- renders polygon overlays instead of plain rectangles
- keeps lightweight per-track state
- hides weak one-frame guesses
- shows if a visible track came from `clipped inference`

Relevant file:

- `frontend/src/components/scan/video-scan-lab.tsx`

## Server Setup

There is a live server already running and accessible on the local network.

Primary URL:

- `http://192.168.1.50:31451/scan`

This endpoint currently returns `200 OK`.

The cluster/live app already includes:

- single-user no-auth mode
- the browser video scan UI
- the experimental scan page

## Local Development Setup

There is also a local frontend instance intended for “local production-style”
development against the live backend.

Local URL:

- `http://localhost:3003/scan`

This also currently returns `200 OK`.

### Why This Local Setup Exists

The local frontend lets you iterate on the scan UI and browser pipeline without
rebuilding or redeploying the cluster on every change.

Because single-user mode is enabled, local frontend work can connect directly to
the shared live backend stack without going through the normal sign-in flow.

### How To Run It

From repo root:

```bash
npm --prefix frontend run dev:host
```

That starts Next.js on port `3003`.

## Local Frontend Environment

The current local setup uses `frontend/.env.local` with the local frontend
proxying REST traffic back to the live backend.

Important local env values:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3003
NEXT_PUBLIC_API_BASE_URL=http://localhost:3003/api-proxy
BACKEND_API_ORIGIN=http://192.168.1.50:31451/api
LOCAL_BACKEND_PROXY_PATH=/api-proxy

NEXT_PUBLIC_CONVEX_URL=http://192.168.1.50:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://192.168.1.50:3211
CONVEX_URL_INTERNAL=http://192.168.1.50:3210
CONVEX_SITE_URL_INTERNAL=http://192.168.1.50:3211

NEXT_PUBLIC_COLLECTIONS_BACKEND=rest

SINGLE_USER_MODE=true
SINGLE_USER_ID=single-user
SINGLE_USER_EMAIL=local@tcger.test
SINGLE_USER_USERNAME=tcger-local
```

## Local Proxy Behavior

The local Next app uses a rewrite-based proxy defined in:

- `frontend/next.config.mjs`

Key behavior:

- browser requests go to `http://localhost:3003/api-proxy/...`
- Next rewrites them to `http://192.168.1.50:31451/api/...`

This avoids browser-side CORS problems during local UI development.

## Access Summary

### Live App

- URL: `http://192.168.1.50:31451/scan`
- Uses live deployed frontend
- Good for checking real deployed behavior

### Local Frontend Against Live Backend

- Start command: `npm --prefix frontend run dev:host`
- URL: `http://localhost:3003/scan`
- Uses local Next.js frontend
- Proxies REST traffic to the live backend
- Uses single-user mode for easier testing

## Known Good Checks

These URLs were confirmed reachable during handoff:

- `http://localhost:3003/scan`
- `http://192.168.1.50:31451/scan`

## Current Screenshot-Based Validation

Two useful outputs were generated while validating the quad inference on the
`10.09.14 AM` screenshot.

Proposal-based overlay:

- `/tmp/tcger_screenshot_100914_proposal_overlay.png`

Proposal-based rectified crop:

- `/tmp/tcger_screenshot_100914_proposal_warp.png`

These show the best current browser-side proposal refinement, not the weaker
full-frame heuristic result.

## Recommended Next Steps

1. Replace proposal-window detection with a real detector path in browser or
   via streamed backend detections.
2. Improve track association by using quad geometry, not just proposal-box IoU.
3. Downweight or suppress tracks whose best result is clipped unless reinforced
   across multiple frames.
4. Add a debug mode in the UI that shows:
   - proposal window
   - refined quad
   - refinement method
   - `isClipped`
5. Keep local frontend work pointed at the live backend unless backend contract
   changes require a full local stack.

## Practical Guidance For The Next AI

If you are continuing this work:

- use `http://localhost:3003/scan` for fast frontend iteration
- use `http://192.168.1.50:31451/scan` to confirm deployed behavior
- do not assume the browser quad is detector-grade truth
- treat `isClipped` as a reliability signal
- keep changes inside the split scan modules rather than rebuilding another
  monolith in `browser-video-matcher.ts`
