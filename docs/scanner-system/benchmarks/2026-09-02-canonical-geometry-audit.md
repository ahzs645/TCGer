# Canonical geometry audit — 2026-09-02

The canonical card-segmentation corpus contains 6,278 records and 8,228 card
instances. Of those, 4,306 are source polygons and 3,922 are bbox-derived.
Bbox-derived annotations remain excluded from geometry v1.

COCO polygons frequently repeat the first point at the end. Normalizing that
closing point before the conservative four-corner gate affects 4,296 polygon
instances. After normalization, 2,882 polygons are exact, convex,
aspect-valid four-corner fits; 602 fail the aspect gate and 822 remain
non-four-vertex masks. Accepted corners are still tagged `maskFit` and are
therefore excluded from corner-error ground truth.

Annotation count provides only a candidate scene audit, not a semantic scene
label: 5,942 records contain one card, 304 contain multiple cards, and 32 are
unannotated. The 304 multi-card records remain
`multi_card_unclassified` until visual review distinguishes binder pages,
duel fields, and other layouts. They must not silently satisfy the frozen real
test-slice minimums.

The deterministic source/split breakdown is in
`2026-09-02-canonical-geometry-audit.json`. The audit can be regenerated with
`tools/card-geometry/audit_canonical_geometry.py`.
