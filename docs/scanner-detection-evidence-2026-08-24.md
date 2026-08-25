# Detection is the bottleneck: evidence from the hand-labeled sessions

**2026-08-24, from the FiftyOne labeling round** (33 verdicts across the two
2026-08-09 sessions; tooling in `mobile-apps/ios/scripts/session-labeling/`).

## The numbers

- 19 of 33 labeled frames are device failures — and **all 19 are
  abstentions** (`noMatch`), not wrong accepts. 16/19 needed a crop fix.
- **Re-cropped correctly, the shipped ArcFace encoder recovers 19/19 at
  rank 0** (sims 0.56–0.86; 15 clear the 0.60 accept, 4 sit in the
  0.56–0.60 band). On this evidence the encoder and index are blameless;
  the loss is entirely in the iOS detection/crop stage.
- The automated `webobb+sam` combo (the labeling tool's web-YOLO11n-OBB →
  MobileSAM detector) recovers **16/19 with zero human input**. Its three
  misses: one extreme tilt where the OBB fires at 0.107 (truth still
  rank 1), and two me04-051 frames where the SAM mask goes wrong.

## The pattern: full-art and foil promos

The corrections cluster hard: swshp-SWSH204 (**Arceus V, full-art**) ×7,
DP-era holo promos (Regigigas DP30 ×3, Giratina DP38 ×2, Darkrai dp4-104
×2, dp4-103, pl4-AR3 Arceus), me04-051 Crobat ×2, me05-016. Full-art cards
have no clean border — artwork bleeds to the edge — and foil kills edge
contrast. `VNDetectRectangles` (and the classical OpenCV detection that
ManaBox/Collectr also use, per the decompile takeaways) depends on exactly
that contrast. The learned OBB detector finds the same cards at 0.9+
confidence in most frames.

This CLOSES the SWSH204 investigation (scanner-convergence polish item 2):
not an index-image problem, not an encoder problem — a border-contrast
detection failure on the device.

## What to do about it (researched 2026-08-24)

1. **Ship a learned detector on-device.** Options, in order of leverage:
   - **YOLO11n-OBB → Core ML**: ultralytics supports `format="coreml"` for
     OBB, but there is a known export bug producing missing/out-of-bounds
     boxes (ultralytics#22309) — validate against the TFLite export, which
     is reported correct. Our own trained OBB weights are the starting
     point; the TF.js graph in `frontend/public/models/yolo-card-detector`
     came from the same training run, but the original .pt lives only
     where it was trained (Colab) — retrain/re-export if not recoverable.
   - **LDRNet-style corner regression** (arXiv 2206.02136, code
     github.com/niuwagege/LDRNet): lightweight backbone + 4-corner
     quad regression + line-borders auxiliary loss, up to 790 FPS on
     mobile. Predicts true perspective quads (what OBB cannot express).
     The labeling tool's fixedQuad ground truth is exactly the
     fine-tuning data this needs; the synthetic-augmentation recipe from
     the encoder training covers the rest.
   - **MobileSAM refinement on-device** is feasible (Tiny-ViT encoder,
     ~10M params total) but likely unnecessary if a corner regressor
     lands; treat as an offline/labeling-tool tool.
2. **Retrain the OBB detector with session frames.** It fires at 0.107 on
   the hardest tilt (below the web pipeline's 0.25 floor). The labeled
   quads accumulating in the labeling tool are the retraining set.
3. **Accept-threshold note:** 4/19 recovered crops score 0.56–0.60 —
   just under the accept. The planned real-crop fine-tune (polish item 1)
   should lift these; do not lower the threshold for them (the sweep
   showed wrong accepts appear below 0.59).

No public pretrained model replaces any of this: the 2026-08-24 survey
(HF + Roboflow + GitHub) found only tiny-dataset axis-aligned card
detectors, one non-generalizing MTG segmentation model, and
document-corner models that fail on card scenes. Our own OBB detector is,
as far as found, the only rotated-box card detector in existence.
