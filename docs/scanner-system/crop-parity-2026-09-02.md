# Crop parity experiment — 2026-09-02

**Status:** in progress. The 67-frame input is frozen and the Python, bench,
and web rows are reproducible. The contract is not frozen until the iOS and
Android exporters run and the pinned encoder-grid Job completes.

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

The best source mapping is `pixelCenter` even though both current exporters use
W/H source and destination coordinates: those two edge choices partly cancel.
Neither current path meets the proposed mean-absolute-error tolerance of
`2/255 = 0.00784`, so the destination W/H mismatch is not ignorable.

These two rows do not choose the contract. The likely portable cell is
pixel-center, bilinear, zero inset, black border, sRGB8, but it remains a
hypothesis until the native rows and downstream agreement are present.

## Downstream grid

Hugging Face Job `6a98b5ae21c5aa7c8364f04a` is invalid evidence. It completed
the grid with raw Magic crops, omitting Magic's declared
`grey-world-autocontrast` query normalization, and then failed to persist its
report because the Job OAuth token could only create a Hub pull request.

Corrected Job `6a98bcc20718b0f6d8912afb` reruns the full 36-cell grid with
the released Pokémon `physical-v2-107fe33b` and Magic
`visual-style-v2-5c27e506-r2` encoders. Pokémon applies `none`; Magic applies
Pillow-equivalent grey-world balance followed by 1% per-channel autocontrast
before the encoder resize. It compares embedding cosine, top-1 family, and
accept/abstain decisions for every platform crop and reference cell, with
`outsideFrame` and `fullyInside` cohorts kept separate. The corrected worker
is pinned to tooling commit
`9cf3377fdbde3e7475d9e8e5c825043d69d221d8` and persists its timestamp-free
JSON report through an immutable Hub pull-request commit under
`geometry/crop-parity-reports/` in the private model repo.

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

At capture time all installed iOS simulators were shut down and `adb devices`
listed no emulator, so inventing native measurements would violate the
experiment. The Android exporter compiles successfully; the iOS exporter is
awaiting a simulator build/run.

## Completion gate

Once the two native rows and the Hub report exist:

1. choose the cell with the highest cross-platform encoder agreement that all
   three product platforms can implement;
2. freeze all five crop values in the shared plan;
3. commit six to eight source/crop fixtures with MAE `<= 2/255` and encoder
   cosine `>= 0.995` tolerances;
4. set the geometry benchmark's `coordinateConvention` to the chosen mapping
   and rerun the three baseline report sets only if it changes from `x * W`.

Until those steps complete, benchmark reports correctly keep their coordinate
mapping marked provisional.
