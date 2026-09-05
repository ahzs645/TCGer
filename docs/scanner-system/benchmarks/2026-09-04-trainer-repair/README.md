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

## Repaired FastViT runtime smoke

The actual trainer completed three epochs at 640 pixels on a generated fixture
with four train and four validation images. Each split contains five instances,
including a wholly box-only image and a mixed image. Fixture files are generated
by `validate_yolox_runtime.generate_fixture`; their `real` source kind exercises
the real-record code path but does not imply they are camera data. The diagnostic
margin fraction is 0.125; it is not the round-two experiment's selected value.

`fastvit-runtime/history.json` records finite train loss decreasing from 36.5654
to 35.9216 and validation loss from 36.1200 to 35.6211. The run used CPU, batch 4,
and the trainer's unchanged FastViT LR of 0.0003. Its purpose is to exercise
initialization, real materialization, loss, optimizer, validation, checkpoint
writing and per-epoch history. It does not measure model quality or satisfy a
round-two training budget. Checkpoint and history hashes are in its summary.

YOLOX Linux validation and historical train self-evaluation were submitted as
HF Job `6a9baed4259f8e97255e1c12` (one L4, 45-minute timeout), using commit
`af8c429b42d8ae39f720f3e16086707c70b0a9da`. Its private diagnostic inputs are
staged at model repository revision `4a9720ac550a78be5d20940882484a77616c7ef2`.
The job was queued when this evidence update was written; its outcome is not
assumed to pass.

The source adapter also now preserves `bbox-derived` annotations as boxes with
unknown corners and no fabricated visible mask. If any source annotation lacks
a usable box, its whole image is excluded. This closes the earlier omission
before trainer materialization. Existing immutable releases are untouched.

The L4 job remained in hardware scheduling for about eight minutes and was
canceled before execution. The same pinned Linux diagnostic was resubmitted to
`cpu-performance` as Job `6a9bb0b6259f8e97255e1c6d`, with historical inference
explicitly set to CPU. These runs are diagnostic and do not consume or redefine
a candidate's round-two training budget.
