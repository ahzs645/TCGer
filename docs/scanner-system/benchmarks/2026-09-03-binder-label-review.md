# Saved binder-label review — 2026-09-03

Read-only review of the local FiftyOne `tcger-sessions` saved view
`geometry: binder first batch`, after the user's corner corrections and page
saves. No annotations, pinned releases, or recognition baselines were changed.

| Frame (session `scan-session-20260809-223944`) | Finalized cards | Invalid quads | Outside-frame corners | Visibility/containment mismatches |
|---|---:|---:|---:|---:|
| `frame-0000.jpg` | 9 | 0 | 6 | 0 |
| `frame-0010.jpg` | 9 | 0 | 0 | 0 |
| `frame-0018.jpg` | 9 | 0 | 0 | 0 |

All 27 current quads match their durable saved payloads. The local binder
instance count is 27 against the policy minimum of 20; this is not a full
training-readiness result and does not create a new corpus release.

Visual inspection of all 27 perspective-corrected crops found no gross corner
ordering errors or obvious artwork-box/pocket-box substitutions. The crops
appear consistently aligned. Rounded physical corners and uncaptured portions
still require judgment; a rectangular preview alone cannot establish exact
corner accuracy.

## Metadata follow-up (not changed automatically)

- `frame-0010.jpg`, card 7 (bottom-left): the visible standard Pokémon back is
  saved as `faceUp`; it should be reviewed as `faceDown` and saved again.
- Card 5 (centre) in `frame-0010.jpg` and `frame-0018.jpg`: the World
  Championships designs appear to be card backs, but are saved as `faceUp`.
  Confirm the side classification during review.

## Editor changes

Only the active card has corner handles; other cards retain their outlines.
Card tabs or previous/next buttons select cards. While editing, Tab/Shift+Tab
cycle cards, 1–4 select a corner, and Escape exits the editing keyboard scope.
The magnifier and inverse-homography rectified preview update while dragging.
Preview proportions are selectable and do not modify the saved quad or frozen
scanner crop contract. Checkerboard marks uncaptured source pixels.

Validation: 87 Python tests, 7 JavaScript geometry/selection tests, Ruff, and
Chrome checks for Tab/reverse/wrap/Escape, proportion selection, and drag
preview updates. Drag/save verification used an in-memory store with no
database or journal writes.
