# Raw + normalized query embedding blend — offline evidence

**November 10, 2026.** Offline Python replay only. No game declares the new
mode, no manifest was republished and no model was promoted.

## What was added

`queryNormalization: grey-world-autocontrast-blend` embeds each query crop
twice — raw, and after the existing grey-world white balance + 1 %
autocontrast — L2-normalizes both embeddings, averages them and L2-normalizes
the mean. Only the query side changes: no retraining, no new index, one extra
encoder pass per crop.

It is implemented in the iOS and Android clients and in
`tools/card-geometry/crop_parity.py` (`EncoderRuntime`), and accepted by the
publisher validation in `tools/r2/lib.mjs`. The web scanner previously applied
no query normalization at all; it now applies the same arithmetic to the
canvas crop (`frontend/src/lib/scan/query-color-normalization.ts`, checked
against a Pillow reference hash) using the built-in per-game default, so web
Magic queries are normalized as they are on iOS and Android. All three
clients are tracked under the parity feature
`scanner.model.queryNormalization`.

## Why

The live Pokémon pack (`physical-v2`, ONNX `cf29f497…`, index `bafded05…`,
metadata `6d7e2721…`, threshold 0.65, family margin 0.05) abstains on about a
third of clearly readable cards in the September 9 phone session, and never
ranks two cards first (Gladion's Final Battle `me05-077`, Primeape `me05-043`)
even from sharp, hand-outlined crops. Their index rows are healthy: each
catalog image matches its own row at 0.999. Plain normalization fixes those
cards but loses on the older Pokémon frames, which is why Pokémon ships with
`none`. The blend keeps both.

## Results

Would-be accepts: visual top-1 ≥ 0.65 with ≥ 0.05 margin over the best other
family, best of four orientations. "No answer" includes cards the outline
model did not find.

### New session — 75 photos, 106 outlined cards

Identity truth is `identity-proposals-phone-20260909.json`: **unverified
proposals** read from the photos (74 with collector number and name legible,
25 name only, 7 artwork only; 18 German printings mapped to the English row
with the same collector number; one German energy card with no catalog row,
where any accept counts as wrong).

| Outline | Mode | Correct | No answer | Wrong |
|---|---|---:|---:|---:|
| Hand-drawn | `none` | 67 | 37 | 2 |
| Hand-drawn | `grey-world-autocontrast` | 86 | 19 | 1 |
| Hand-drawn | blend | 93 | 13 | 0 |
| September 8 YOLO11s-pose | `none` | 61 | 44 | 1 |
| September 8 YOLO11s-pose | blend | 81 | 25 | 0 |
| Control seed 20260906 | `none` | 57 | 48 | 1 |
| Control seed 20260906 | blend | 73 | 33 | 0 |
| Rotation seed 20260906 | `none` | 54 | 51 | 1 |
| Rotation seed 20260906 | blend | 76 | 30 | 0 |

With hand-drawn outlines the true card is ranked first for 80 of the 105
catalogued cards raw and 97 with the blend (top five: 88 → 99).

On the 63 photos that contain one card, the phone recorded 28 correct, 34 no
answer and 1 wrong on the night. The September 8 outline gives 32 / 30 / 1
with `none` and 49 / 14 / 0 with the blend.

The September 8 checkpoint reproduced its saved September 10 predictions
exactly here (96 found, 40 tight, 10 missed, 19 extra detections).

### Older sessions — 51 hand-labelled Pokémon frames

Labels are `DevModeSessionReplayTests.expectedCards` entries present in the
live catalog (52; one frame has no recorded device outline). Crops use the
device outline stored in each session's `results.json`.

| Mode | Correct | No answer | Wrong |
|---|---:|---:|---:|
| `none` | 33 | 17 | 1 |
| `grey-world-autocontrast` | 32 | 18 | 1 |
| blend | 33 | 18 | 0 |

## Limits

- This is the Python replay path, not the app. It has no OCR evidence, title
  rescue or hub rejection, so absolute counts differ from device behaviour.
- The blend was chosen on the new session it is reported on. The older frames
  are the only independent check, and they show no gain, only no loss.
- New-session identities are unverified, and the session is 23 distinct
  cards from one set under one lighting condition.
- The iOS code has not been compiled or run; Xcode is not available where
  this was written. See the change's test notes for what did run.

## Before declaring it for a game

1. Confirm the identity proposals in the identity review tool.
2. Run the iOS replay gates with `SCANNER_QUERY_NORMALIZATION=blend`
   (session, binder and the 2,336-image precision replay) and compare with
   the unset baseline: no new wrong accept, no lost accept.
3. Set `queryNormalization` for the game in
   `tools/scanner-acceptance-policies.json` and the built-in client profiles
   together, and publish manifests only for client builds that know the value.

## Files

- `RESULTS.json` — the counts above with the runtime hashes.
- `replay-summary.json`, `replay-per-card.json` — the six-checkpoint replay
  with `none`: geometry counts and, per card, outline overlap and the
  recognition decision for the model outline and the hand-drawn outline.
- `query-mode-per-card.json` — per card and query mode on hand-drawn
  outlines: top family, score, margin, and the rank and score of the true card.
- `sept8-baseline.predictions.jsonl` — the September 8 checkpoint's outlines
  for the 75 photos, as produced here (matches the saved September 10 file).
- `identity-proposals-phone-20260909.json` — per-card proposals in the shape
  `card_identity_review.py --suggestions` loads (bound to the frozen queue hash).
- `source/` — the scripts as run. They take a scratch directory holding the
  frozen queue, the session photos and the downloaded pack, plus the path to
  `tools/card-geometry`, and write nothing into the repository.
