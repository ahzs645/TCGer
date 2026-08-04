# Purplemana scanner takeaways for TCGer

The full reverse-engineering report is in
[`purplemana-0.3.65-decompiled/SCAN_ANALYSIS.md`](../purplemana-0.3.65-decompiled/SCAN_ANALYSIS.md).
The canonical factorized comparison with Collectr, ManaBox, and TCGer is in
[`scanner-app-comparison-and-experiment-plan.md`](scanner-app-comparison-and-experiment-plan.md).

## The useful progression

Purplemana ships both generations of its geometry system:

```text
older: threshold/edges/contours -> corners -> perspective warp -> pHash
newer: ONNX keypoints          -> corners -> perspective warp -> pHash
```

That is strong evidence that corner quality, not the homography itself, is the
hard part in uncontrolled scanner scenes. The learned detector can use card
semantics when borders are obscured by fingers, sleeves, foil glare, or a busy
background.

## Recommended decisions

| Purplemana observation                                                          | TCGer decision                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Learned keypoints replaced global contour localization                          | Train and benchmark a small TCGer-owned corner model as a rescue refiner inside YOLO crops.                          |
| Perspective warp is part of its pHash contract                                  | Keep query/reference preprocessing paired; do not infer that blanket DINO warping is beneficial.                     |
| 1,024-bit pHash is cheap enough every 200 ms                                    | Benchmark pHash for temporal sameness and cache reuse, not primary identification.                                   |
| Lookup begins after multiple stable hashes                                      | Retain temporal confirmation and explicit new-card reset logic.                                                      |
| Only the hash goes to the backend                                               | If a server assist remains, prefer compact features with authentication, quotas, versioning, and open-set rejection. |
| A local `.pmxc` catalog implementation exists but is not wired into the scanner | Keep TCGer's local int8 DINO index rather than waiting on a remote lookup or dormant product feature.                |
| Model assets are downloaded separately                                          | Keep model/index manifests atomic and version-compatible; support progress, retry, validation, and rollback.         |

## Geometry experiment

Do not add a customer setting. Extend the internal replay matrix from
`none/rescue/always` to compare geometry sources:

- current contour rescue;
- TCGer-owned learned-keypoint rescue;
- learned-keypoint always as a negative control.

The learned model should be trained on true corners from real TCGer captures
plus synthetic projective transforms. Include borderless cards, foil, sleeves,
fingers, clutter, cropped edges, glare, and all supported games. Promote it
only on recognition results and corner error—not because the warped image looks
cleaner.

## Endpoint and asset boundary

The Android ONNX model is hosted as a public object and was downloadable
without app credentials during this review. That does not make it a supported
or safely licensed dependency for TCGer.

The actual matcher is `seller.scanItemFromImageHash` over Purplemana's tRPC
service. The client attaches a bearer token when available; anonymous access
was not tested. Treat it as private and reproduce the architecture with
TCGer-owned models, indexes, and catalog data.
