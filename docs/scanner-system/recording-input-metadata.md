# Recording one source image per camera capture

Camera captures now keep the upright, decoded source JPEG and a versioned recipe
for the recognition input. The guide/viewport rectangle is passed from the
capture path into the recorder instead of being discarded. Recognition still
uses the same in-memory input as before; this changes its saved representation.

`imageFile` remains the logical input key used by results, attempts, and labels.
For a derivable input, the corresponding JPEG is normally absent. Both
`results.json` and `evidence.json` carry `inputImageTransform`, for example:

```json
{
  "imageFile": "frame-0010.jpg",
  "inputImageTransform": {
    "version": 1,
    "sourceImageFile": "frame-0010-original.jpg",
    "coordinateSpace": "uprightPixelsTopLeft",
    "sourcePixelWidth": 1536,
    "sourcePixelHeight": 2048,
    "cropRectPixels": [362, 313, 812, 1138]
  }
}
```

Version 1 is an integer rectangle crop of already-upright source pixels. Its
width/height are the output dimensions. It applies no resize or rotation.
Existing `imageMetadata` describes the recognition input, while
`originalImageMetadata` describes the physical source. Vision-normalized card
corners, binder page-fit rectangles, inner coordinator quads, and orientation
attempts retain their existing coordinate spaces, relative to the reconstructed
input. A new version is needed before introducing other image operations.

Imports/live frames already have one input image and continue to save it.
Manual perspective rescues and callers without a validated rectangle retain
both images: their transformation is not a v1 integer crop. An invalid rectangle
or failed original write cannot cause the recorder to omit its input JPEG.
**Save Scanner Input Images** in developer settings restores the second JPEG;
`SCANNER_DEVMODE_INPUT_IMAGES=1` overrides the setting for diagnostic runs.
Attempt-crop images remain independently opt-in.

The iOS importer, replay runner, reference browser, single-card and binder replay
harnesses, desktop session labeler, scanner review datasets, Label Studio/COCO
exporter, camera-corpus reader, and relevant geometry adapters understand virtual
inputs. Desktop tools use `scripts/scanner_recording_images.py`; viewer PNGs go
into disposable caches outside source recordings. Cache identity includes source
bytes and the recipe. Existing JPEGs take precedence, preserving old recordings
and explicitly saved diagnostic inputs. Unsupported recipes and missing sources
are errors rather than silently replaying a full original or dropping a virtual
frame. Older app versions that do not understand this field require the optional
input JPEGs.

## Validation on the September 9 recording

The original 152-file Downloads recording was kept intact. The audit recovered
75 historical crop rectangles using full-resolution pixel registration, requiring
correlation of at least 0.99. The minimum observed correlation was 0.998689.
These recovered recipes are test fixtures with explicit inferred provenance;
new captures record the actual rectangle directly.

The isolated original-only fixture occupies 63,561,446 bytes versus 87,869,968
bytes for the original export, saving 24,308,522 bytes (27.7%) after adding the
metadata. Every reconstructed image matched its recipe's dimensions and decoded
source crop. Versus the independently JPEG-encoded historical inputs, mean
absolute channel difference averaged 1.485/255 across frames; the largest frame
mean was 1.942/255. JPEG reconstruction is not a byte-exact snapshot of the
original in-memory recognition pixels. Source-file hashes were checked before
and after the audit and all remained equal.

Run the audit into a new directory:

```sh
/Users/ahmadjalil/.venvs/tcger-label/bin/python scripts/audit_scanner_recording_images.py \
  /Users/ahmadjalil/Downloads/scan-session-20260909-231206 \
  --output .artifacts/scanner-recording-metadata/scan-session-20260909-231206
```

The output directory must not exist. This command does not update the reference
library, labels, dataset splits, or any training release. Local receipts and
logs are under `.artifacts/scanner-recording-metadata/`.

Small regression checks:

```sh
/Users/ahmadjalil/.venvs/tcger-label/bin/python -m unittest discover \
  -s scripts -p test_scanner_recording_images.py -v
/Users/ahmadjalil/.venvs/tcger-label/bin/python -m unittest discover \
  -s tools/scanner-review -p test_review.py
xcodebuild -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer \
  -testPlan TCGer-CI \
  -destination 'platform=iOS Simulator,id=66211E5C-5DCB-4892-939C-95CAC8812FAA' \
  -parallel-testing-enabled NO \
  -only-testing:TCGerTests/ScannerDevModeStoreTests \
  -only-testing:TCGerTests/ScannerReplayRunnerTests \
  -only-testing:TCGerTests/ScannerGuideCropperTests \
  CODE_SIGNING_ALLOWED=NO test
```

The external import test accepts `TEST_RUNNER_SCANNER_RECORDING_FIXTURE_DIR`.
The optional recognition comparison also accepts
`TEST_RUNNER_SCANNER_RECORDING_ORIGINAL_DIR` and
`TEST_RUNNER_SCANNER_RECORDING_COMPARISON_REPORT`. It compares historical input,
reconstructed input, and full source using one fixed bundled ArcFace runtime.
That runtime is not claimed to be identical to the recording phone's downloaded
assets. The comparison reports outcome drift; unreviewed recorded identities
are not ground truth.

### Completed checks and framing limitation

The initial iOS run passed 22 tests covering recording, replay, reference-image
loading, guide-coordinate mapping, unsupported/missing sources, and the optional
input-image setting. The Python suites passed 79 tests: six recording-image
checks, 25 review checks, 46 geometry-adapter checks, and two background-adapter
checks. An additional native macOS executable compiled the unchanged production
Swift transform/reader declarations and forced pixel decoding for all 75 virtual
inputs; all passed. `verification.json` records the reader source hash.

Additional end-to-end simulator runs stalled before launching the test app.
A process sample showed CoreSimulator blocked in `launchApplicationWithID`;
restarting the test simulator did not resolve that attempt. Consequently there
is no completed recognition-outcome or wider-frame accuracy comparison to report.
The opt-in harness remains available for a working simulator/device run.

Live recognition framing is unchanged. Frame 10 proves that the guide can remove
a visible card edge, but replacing it with the full source also changes target
selection. Its actual input rectangle is `[362, 313, 812, 1138]`; inferring a
centred crop from dimensions would incorrectly choose y=455, shifting the input
by 142 pixels. A subsequent framing fix should preserve the guide's target region
when permitting card borders outside the guide, then test intended-card identity
and false accepts. Saving the source and actual crop recipe now preserves the
information needed to make that comparison. No model or threshold was changed.
