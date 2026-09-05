# Trainer repair and diagnostic evidence — 2026-09-04

The historical FastViT loader passed a classification checkpoint directly to
`timm`'s flattened feature model with `strict=False`. Classification keys such
as `stem.0.conv_kxk.0.conv.weight` become `stem_0.conv_kxk.0.conv.weight` in the
feature model. The two models have zero matching state-dictionary keys. The
repaired loader strictly loads all 462 classification keys before extracting
the 444 feature keys; missing weights now fail instead of silently falling
back to random initialization. The feature model's final state keys and shapes
remain compatible with historical trained checkpoints.

The original 50-epoch `history.json` is preserved here with its immutable Hub
revision in `input-pins.json`. New runs write history atomically after every
epoch, log learning rate and losses, reject non-finite losses, and retain the
complete matched/missing/unexpected checkpoint-key report.

The historical FastViT checkpoint was evaluated on a deterministic sample of
160 original training images, 32 per scene ordered by SHA-256 of record ID.
All sampled record and image bytes were verified against the original manifest.
Its 540 instances yield recall@0.5 of 0.2685 and recall@0.75 of 0.0204; all
145 matches occur on binder pages. This is a historical train-split diagnostic,
not a release benchmark, a new corpus, or a round-two result. The diagnostic
uses the trainers' declared synthetic margins and JPEG materialization, then
the unchanged shared decoder and scorer. It does not bypass benchmark preflight
or authorize a training release. The same sample is reserved for YOLOX diagnosis.

The YOLOX config now enables validation every epoch starting at epoch one,
explicitly sets AdamW LR to 0.004 × batch / 256 (0.00025 at batch 16, one GPU),
disables a second automatic scaling, and disables the inherited random resize
batch transform. A digest-guarded two-line repair binds the pinned pose head's
local `cfg` and clamps its visibility denominator for wholly box-only batches.
The exact original and repaired source hashes are recorded at execution.
Linux runtime validation is pending; no incumbent evaluations or round-two
training have been launched in this change.

All three adapters accept real records only with a declared
`fairness.realContextMarginPolicy` (`fraction-of-long-side`, fraction, `ceil`,
`each-side`). The wrapper passes only the hash-covered policy to the trainer;
it clears an inherited environment value. No real margin fraction is defaulted
or selected by these repairs; the corpus experiment must declare it before use.
Synthetic records retain their own per-side margins.

Unknown-corner instances retain explicit normalized boxes, or boxes derived
from preserved polygon masks. Aspect/residual-rejected fits therefore remain
box supervision. YOLO/COCO labels carry visibility-zero keypoints. FastViT
zeros only the negative focal term over the transformed box, retaining positive
heatmap and corner targets even where boxes overlap. Any unknown instance
without a usable box drops the whole image. The schema accepts an optional
normalized `box`; this additive field leaves historical record bytes untouched.
RLE-only instances need an explicit usable box before training.

Local regression coverage includes actual Ultralytics coordinate-loss gradients,
FastViT negative/positive gradients, transformed ignore regions, real ingestion,
wholly unknown and mixed images, missing boxes, rejected polygon fits, margin
hash sensitivity, and strict checkpoint loading with the pinned timm model.
