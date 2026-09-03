# Crop parity experiment — 2026-09-02

**Status:** complete. All four current-platform rows, the normalized encoder
grid, the frozen contract, and the license-free crop fixtures are recorded.

## Frozen input

The case manifest contains all 57 metric-eligible manual Dev Mode frames from
`real-geometry-devmode-orientation-smoke-v3` plus ten deterministic
`single_handheld` frames from `synthetic-geometry-smoke-v1`. Each case records
the source hash, dimensions, scene slice, and printed-card TL/TR/BR/BL quad.
The real and synthetic corpus hashes travel in the manifest.

The portable private input bundle has SHA-256
`d50c661b70fd2821cdd8056f70b9f708402bc7d2173a0cdfd1b1ee7a6883c692`
and is pinned in `ahzs645/tcger-universal-arcface` at commit
`a6cec00d3e567278b4b397f4037f96d407960dcf`. It contains the source images,
current bench and web PNGs, and the released Magic encoder. It is private
because the real frames and catalog-derived assets are not redistributable.

## Reference grid

`tools/card-geometry/crop_parity.py` evaluates all 36 combinations:

- normalized source mapping: `x * (width - 1)` (`pixelCenter`) or
  `x * width` (`imageEdge`);
- interpolation: bilinear, bicubic, or Lanczos (OpenCV `INTER_LANCZOS4`, the
  available fixed-kernel approximation used for the `lanczos3` experiment
  label);
- bilinear card-space inset: 0%, 1%, or 2%;
- border: black or replicate;
- output: untagged sRGB 8-bit RGB, 720 × 1000, with destination pixel centers
  `(0,0)`, `(719,0)`, `(719,999)`, `(0,999)`.

The destination convention includes a subtle half pixel: under OpenCV's
sampling convention the represented output edges lie at -0.5 and 719.5 (and
-0.5 and 999.5). The fixture and scorer encode this rather than treating 720
and 1000 as destination pixel centers.

## Current pixel evidence

Both portable exporters produced all 67 PNGs. Their closest reference cells
are:

| Platform path | Closest reference cell | Mean absolute error | Mean PSNR |
|---|---|---:|---:|
| current bench (`cv2`, cubic, W/H destinations) | pixel-center, bicubic, 0% inset, black | 0.01006 | 37.27 dB |
| current web DLT/bilinear (W/H target geometry, emitted at 720 × 1000) | pixel-center, bilinear, 0% inset, black | 0.01565 | 32.79 dB |
| current Android `Matrix.setPolyToPoly`, 30 fully-in-frame crops | pixel-center, bilinear, 0% inset, either border | 0.01070 | 36.92 dB |
| current iOS Core Image, 43 dimension-compatible crops | pixel-center, bilinear, 0% inset, black | 0.02572 | 32.42 dB |

The best source mapping is `pixelCenter` even though both current exporters use
W/H source and destination coordinates: those two edge choices partly cancel.
Neither portable path meets the proposed mean-absolute-error tolerance of
`2/255 = 0.00784`, so the destination W/H mismatch is not ignorable.

The native rows also expose contract failures that a mean cannot hide.
Android's current `ScannerCropQuad.isValid` rejects all 37 cases with at least
one outside-frame corner, so its pixel row covers only the 30 fully-in-frame
cases. iOS accepts all 67 cases, but its Core Image resize emits 24 crops at
718 or 719 pixels wide and/or 999 pixels high. Those cases remain available
to the encoder comparison, whose own input resize can consume them, but are
excluded from pixel MAE because unlike-sized images are not pixel-comparable.

Pixel similarity describes the current implementations; it does not choose
the contract. The downstream grid below is the deciding evidence.

## Downstream grid

Hugging Face Job `6a98b5ae21c5aa7c8364f04a` is invalid evidence. It completed
the grid with raw Magic crops, omitting Magic's declared
`grey-world-autocontrast` query normalization, and then failed to persist its
report because the delegated Job token lacked private-repo write permission.

Corrected Job `6a98bcc20718b0f6d8912afb` reran the full 36-cell grid with
the released Pokémon `physical-v2-107fe33b` and Magic
`visual-style-v2-5c27e506-r2` encoders. Pokémon applies `none`; Magic applies
Pillow-equivalent grey-world balance followed by 1% per-channel autocontrast
before the encoder resize. It compares embedding cosine, top-1 family, and
accept/abstain decisions for every platform crop and reference cell, with
`outsideFrame` and `fullyInside` cohorts kept separate. The corrected worker
is pinned to tooling commit
`9cf3377fdbde3e7475d9e8e5c825043d69d221d8` and was intended to persist its
timestamp-free JSON report through an immutable Hub pull-request commit under
`geometry/crop-parity-reports/` in the private model repo. Its inference
completed, but the delegated Job token received a 403 during pre-upload and
the old worker had not emitted the report before persistence, so the result
is not evidence.

Native-grid Job `6a98c21a21c5aa7c8364f1a3` used the configured local HF CLI
credential as an encrypted secret, evaluated bench, web, iOS, and Android,
and emitted the canonical report to Job logs before its Hub upload.
Its private 314 MB input bundle has SHA-256
`20a2d764438104dd381c9a15ca72382b9c238869dd216aa5bbe75306f4941ab9`
and is pinned at model-repo commit
`a185df053614153c22d6fd5e563b0fcdd7830a0b`. The worker is pinned to
`f0aa30712f9c2da0eda3bc45fb2672f0dcea1695`; the deterministic report is
pinned at model-repo commit
`d2760eebce256634dd5b63b6d3a2456fd4efab14`.

## Decision

The frozen cell is `imageEdge-bilinear-inset00-black`:

- normalized source mapping: `x × width`, `y × height`;
- destination: 720 × 1000 with pixel centers `(0,0)`, `(719,0)`,
  `(719,999)`, `(0,999)`;
- inset: 0%;
- interpolation: bilinear;
- outside-frame border: constant black; and
- color handed to the encoder: untagged sRGB 8-bit RGB.

Across the three product platforms and both released encoders, this cell has
mean accept/abstain agreement 0.962, top-1 agreement 0.885, and cosine 0.972
against the current platform crops. It Pareto-dominates the otherwise likely
pixel-center/zero-inset cell: accept agreement is identical while top-1 and
cosine are both higher. Bicubic and Lanczos gain at most 0.0005 cosine but
lose 1.2 points of top-1 agreement and are not the native common kernel.

The 1% inset cell raises agreement with today's accept/abstain decisions from
0.962 to 0.978, but lowers top-1 from 0.885 to 0.849 and cosine from 0.972 to
0.969. Agreement with a current abstention is not correctness and does not
justify discarding card-edge pixels, so zero inset wins. On the outside-frame
cohort, black and replicate have the same 0.959 accept agreement, while black
has top-1 0.845 versus 0.682 and cosine 0.964 versus 0.933. The border decision
is therefore downstream-driven and not inferred from pixel MAE.

Every encoder bucket in the report echoes its query normalization: Pokémon
uses `none` and Magic uses `grey-world-autocontrast`. Magic's measurements are
therefore policy-correct.

## Native exporters

The checked-in diagnostic tests consume the same staged cases:

```bash
uv run --python 3.13 \
  --with-requirements tools/card-geometry/crop-parity.requirements.txt \
  python tools/card-geometry/crop_parity.py stage-cases \
  --cases .artifacts/card-geometry/crop-parity-2026-09-02/cases.json \
  --output mobile-apps/ios/TCGer/TCGerTests/CropParityInputs.generated
```

Run `CropParityExportTests` on an already-booted simulator. Each current Core
Image crop is retained as a named XCTest PNG attachment. Stage the same output
under Android's `app/src/androidTest/assets/crop-parity.generated`, run
`CropParityExportInstrumentedTest` on an emulator, and pull the printed
`CROP_PARITY_OUTPUT` cache directory with `adb exec-out run-as`.

The iOS row ran on an iPhone 17 Pro simulator with iOS 26.5 and retained all
67 PNGs in its XCTest result bundle. The Android row ran on the available
arm64 API 34 emulator and exported 30 PNGs plus an explicit list of the 37
unsupported outside-frame cases. Both diagnostic tests passed. The emulator
device profile is immaterial to this row because the tested code is the pure
`Bitmap`/`Canvas` cropper; the API and graphics implementation are recorded.

## Completion gate

The gate is complete. The shared plan freezes the values above. Eight
license-free procedural cases under
`tools/card-geometry/fixtures/crop-parity.v1` cover perspective, steep angle,
and four outside-frame directions; the Python reference regenerates their
source and crop hashes in the test suite. Platform conformance keeps MAE
`<= 2/255` and encoder cosine `>= 0.995`; if a native implementation cannot
meet the pixel threshold after adopting the contract, cosine is binding and
its measured MAE is diagnostic rather than grounds to loosen `2/255`.

The geometry benchmark now marks `x × width`, `y × height` frozen. That is the
same mapping used by all three committed baseline sets, so their predictions
and reports are not rerun or rewritten.
