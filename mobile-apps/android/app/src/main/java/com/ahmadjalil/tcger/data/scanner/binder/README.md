# Android crop and binder-page substrate

This package supplies the platform-independent geometry and Android bitmap
transformation required by crop correction and guided binder-page capture:

- `ScannerCropQuad` mirrors iOS normalized, top-left-origin corner ordering,
  minimum area, convexity, centered-card, and outward-expansion behavior.
- `PerspectiveCardCropper` maps a valid quadrilateral to the shared 720x1000
  card image contract with Android's four-point perspective matrix.
- `BinderPageGridExtractor` splits a user-confirmed page quad into reading-order
  3x3 pocket quads, including configurable gaps.

Android exposes these primitives through a four-corner editor with reset,
perspective-crop retry through the selected production handler, and an explicit
guided binder-page workflow. The page path aligns one page quad, extracts nine
pockets, recognizes them sequentially, allows per-pocket correction/skip, and
bulk-saves selected cards through the existing binder path.

`scanner.results.cropCorrection` is therefore implemented. Binder-page parity
remains partial because Android does not yet automatically detect the page or
individual pockets, and no repository/API contract exists for persisting and
replacing binder-page photos. Those controls stay disabled with an explanation
rather than inventing storage behavior.

The JVM tests cover geometry, invalid/crossed quads, expansion, and reading
order. The connected Android test draws a synthetic trapezoid with distinct
corner colors and verifies that the real bitmap perspective transform maps all
four corners into the requested card output.
