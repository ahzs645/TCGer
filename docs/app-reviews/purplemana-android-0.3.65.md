# Purplemana Android 0.3.65 scanner review

Purplemana's current scanner uses a downloaded 384 x 384 int8 ONNX keypoint
model to locate four card corners. Native OpenCV then perspective-corrects the
card and computes a 1,024-bit perceptual hash. The image remains local, while
the hash is sent to Purplemana's tRPC backend for Hamming/catalog lookup.

The full evidence-backed analysis is in
[`purplemana-0.3.65-decompiled/SCAN_ANALYSIS.md`](../../purplemana-0.3.65-decompiled/SCAN_ANALYSIS.md).

## Recovered pipeline

```text
VisionCamera
  -> 384 x 384 centered RGB crop
  -> int8/QDQ ONNX keypoint model
  -> 4 card corners at 96 x 96 output resolution
  -> native perspective warp
  -> native 1,024-bit pHash
  -> temporal stability (normally 2+ observations)
  -> seller.scanItemFromImageHash
  -> Hamming-ranked catalog/printing candidates
```

The model has input `[1,3,384,384]` and output `[1,35,96,96]`. Hash generation
is throttled to 200 ms. The server receives the hash, not the camera image.

## What is distinctive

- Purplemana has both a legacy classical contour detector and a current
  learned corner detector in the same build.
- It kept perspective correction after changing how corners are found.
- Its cheap hash doubles as a temporal same-card signal.
- The active matcher remains remote, although dormant `.pmxc` local catalog
  infrastructure exists in the native module.
- The Android model object is publicly downloadable, but the recognition
  mutation is a private product API and was not probed.

## Recommendation for TCGer

Test a TCGer-owned learned corner refiner against the existing Sobel/RANSAC
refiner, both as rescue-only geometry sources behind YOLO. Do not use
Purplemana's model directly and do not replace DINO retrieval with pHash.

A small pHash may be worth benchmarking for temporal sameness and result-cache
reuse. Learned corners should be promoted only if they improve cross-game
recognition and true-corner accuracy without increasing accepted false
positives or exceeding the device latency/thermal budget.
