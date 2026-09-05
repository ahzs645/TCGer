# Trainer repair and self-validation — 2026-09-04

Trainer repair and diagnostic self-validation are complete. The seven incumbent
evaluations on the v6-full successor are the next stage. No round-two corpus
or training result was produced by these diagnostics.

## Repairs

FastViT's original loader passed a classification checkpoint directly to timm's
flattened feature model with `strict=False`. The two state dictionaries have
zero matching keys (`stem.0...` becomes `stem_0...`). The repaired loader strictly
loads all 462 classification keys before retaining 444 feature keys. Missing
weights fail. Historical trained checkpoints retain compatible keys and shapes.
`fastvit-checkpoint-load.json` records the exact pinned checkpoint and key lists.

FastViT now writes history atomically after every epoch, logs learning rate and
losses, and rejects non-finite losses. The original 50-epoch history is committed
as `fastvit-original-history.json`; its immutable Hub source is in `input-pins.json`.

YOLOX validates every epoch starting at epoch one. Its AdamW LR is explicitly
0.004 × batch / 256: **0.00025 at batch 16 on one worker**, with a second automatic
scaling disabled. The inherited random-resize batch transform is disabled;
`LoadImageFromFile(to_float32=True)` preserves the needed BGR float conversion.
The pinned pose head receives a digest-guarded repair for its local `cfg` and
its zero-visible-keypoint denominator. Original and repaired source hashes are
recorded in `yolox-runtime-validation.json`.

All adapters accept real records only with a declared, hash-covered
`fairness.realContextMarginPolicy`: `fraction-of-long-side`, fraction, `ceil`,
`each-side`. The job wrapper clears inherited policy values and passes only the
resolved config's policy. No production fraction is selected by this repair.
Synthetic records retain their declared per-side margins.

Unknown-corner cards retain explicit boxes or boxes derived from preserved
polygon masks. Rejected aspect/residual fits retain box supervision. YOLO/COCO
labels carry visibility-zero keypoints. FastViT zeros only the negative focal
term over their transformed boxes, preserving positive and corner targets in
overlapping regions. An unknown instance without a usable box drops the whole
image. The archive adapter also preserves bbox-derived annotations as boxes,
without fabricating visible masks or corner truth. RLE-only instances need an
explicit usable box. Existing immutable release records remain unchanged.

## Runtime evidence

The actual FastViT trainer completed three epochs at 640 pixels on a generated
fixture with four train and four validation images. Each split contains five
instances, including wholly box-only and mixed images. The fixture exercises
the `real` ingestion branch but is generated data, not camera evidence. CPU,
batch 4, LR 0.0003 and margin fraction 0.125 are diagnostic settings. Train loss
fell from 36.5654 to 35.9216; validation loss fell from 36.1200 to 35.6211. Its
history and artifact hashes are under `fastvit-runtime/`.

YOLOX completed its actual training/validation loop under the pinned Linux
framework, retained instance counts [1,1,2,1], and produced finite losses for a
separate wholly box-only batch using the training loader's collator. Validation
ran at epoch one. The pinned OKS formulation reports a constant loss of 30 for
all-zero keypoint weights; that scalar is not coordinate supervision. The
successful job is `6a9bb574259f8e97255e1d3c` on `cpu-performance`, tooling commit
`5bc2de81edea11ce32e0c31badbe063b4cb19c52`, private tooling/input revision
`292ee04179daa3f07ce6f8c5df818f975f158b37`.

`yolox-validation-jobs.json` retains the attempt statuses: an L4 reservation was
canceled while queued, and CPU smoke attempts exposed the input dtype dependency
and harness import-order, bytecode-check and collator defects before the final
successful run. These are generated-fixture diagnostics, not candidate budget
runs. CPU validation does not establish CUDA/AMP or physical-device performance.

## Historical train-split self-evaluation

Both historical checkpoints were evaluated on the **same 160 training images**:
32 per scene, ordered by SHA-256 of record ID, containing 540 instances. Sample
hash: `6725017a2cdb78666bbe4c14aec0954d1772679751766a2d26c08daeb45d76e0`.
Record/image bytes and checkpoint hashes were verified. The diagnostic reproduces
training context margins and JPEG materialization and uses the existing shared
decoder and scoring functions. It is not a release benchmark or authorization
to train on the historical corpus. Benchmark preflight remains enforced.

| Historical checkpoint | Recall @0.5 | Recall @0.75 | Matches |
|---|---:|---:|---:|
| FastViT | 0.2685 | 0.0204 | 145/540, all binder |
| YOLOX | 0.0185 | 0.0000 | 10/540 |

Full reports and per-record input hashes are in `*-train-self-evaluation.json`.
Neither result supports treating the original failures as camera-domain shift
alone. The repaired models have not undergone a new full training run.

Local verification: 203 top-level tests and 13 compositor tests pass, plus Ruff
0.15.8 and diff whitespace checks. Tests include actual Ultralytics coordinate
loss gradients, FastViT negative/positive gradients and checkpoint transfer,
real ingestion, transformed ignore boxes, missing boxes, rejected polygon fits,
margin hash sensitivity and deterministic train-only sampling.
