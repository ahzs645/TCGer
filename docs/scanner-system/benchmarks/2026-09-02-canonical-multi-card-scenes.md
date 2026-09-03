# Canonical multi-card scene heuristic — 2026-09-02

All 304 canonical records containing at least two card annotations were scored
with `grid-size-overlap-rotation-v1`. The checked-in assignment file records,
for every image, card count, grid alignment, card-size coefficient of
variation, rotation spread, pair-overlap rate, maximum overlap, the provisional
assignment, and the reason.

| Provisional assignment | Records |
|---|---:|
| `binder_page` | 99 |
| `duel_field` | 125 |
| `other` | 80 |

The binder rule requires at least four cards, strong row/column alignment,
near-uniform card size, low rotation spread, and low overlap. A non-binder
frame becomes duel-field when it has meaningful overlap or rotation spread;
the remainder is `other`.

These are review candidates, not truth labels. Bounding-box-only sources erase
card rotation and can make loose table layouts look grid-like. The report is
therefore marked `provisional-until-human-spot-check` and contains a
deterministic, stratified 24-record spot-check list. Run
`classify_canonical_scenes.py` with `--raw-dir` and `--spot-check-output` to
render those images locally. Human corrections should be stored as overrides,
not by changing the measured features or thresholds after viewing model
results.
