# Two-seed rotation experiment and checkpoint-selection backtest

Preparation started September 13, 2026. This is a declared experiment, not a model promotion. The user authorized three Hugging Face jobs: one additional fixed-order control seed and two augmented seeds. The already completed September 10 split / fixed-order / seed 20260905 run supplies the first control.

## Frozen choices before new inference

All training uses YOLO11s-pose from the same pinned generic initialization, September 10 corpus `aceff85cccac00fc9420831df4a1c88c2360847a47c5f1a3f917462b20630162`, 50 epochs, 640 input, batch 16, deterministic training, and seeds 20260905 / 20260906. No pretrained card checkpoint is used to initialize these runs. Three L4x1 jobs, each with a four-hour timeout; at the current $0.80/hour rate the aggregate compute ceiling is $9.60. No automatic retry training or larger model is authorized by this batch.

The augmentation arm tests whole-photo quarter turns sampled uniformly from 0, 90, 180 and 270 degrees before the ordinary letterbox pipeline. This is an initial rotation-coverage experiment; it does not test arbitrary-angle rotation, perspective, scaling or translation. Pixel rotation is exact, no pixels or full outlines are clipped, and both horizontal and vertical flips remain zero. All other runtime augmentation settings remain zero. The environment must not install implicit Albumentations transforms. [Ultralytics augmentation behavior](https://docs.ultralytics.com/guides/yolo-data-augmentation/).

Known-top targets retain their printed corner indices under rotation. Fully supervised unknown-top targets are cyclically reindexed to the minimum pixel-space x+y corner, preserving clockwise winding and carrying visibility with each point. Box-only targets retain zero keypoint supervision. Six of 2,843 real training unknown outlines do not start at that geometric corner: their entire photos remain unrotated, preserving the original phase rather than silently relabeling them. Validation images and stored source labels never rotate. The no-rotation transform is tested against the standard dataset for equal image, keypoint, box and class tensors.

## Checkpoint selection

Policy `validation-real-weighted-guarded-v2` considers only epoch 10/20/30/40/50 snapshots. It retains the original selector's scene-level harmonic mean of detection F1 and tight-border recall, averaging scenes within real and synthetic separately, then weighting real:synthetic 2:1.

Before ranking, exclude checkpoints with real validation extras plus duplicates per photo above the shortlist median by more than 0.05, or synthetic validation score below the shortlist median by more than 0.02. A score tie within 1e-9 prefers the later epoch. Guard failure for every candidate stops selection; it does not silently relax the rule. Framework best and last files remain saved but are not candidates. This is a checkpoint rule, distinct from the experiment's primary endpoint.

Backtest the declared rule on the complete saved September 10 cyclic and September 13 fixed-order shortlists. Hash-check original validation metrics and weights. Write the validation choice before evaluating every shortlisted epoch on the 700-card benchmark. Report transfer, including failures to pick the best benchmark result; do not tune the rule to force agreement with that already inspected benchmark.

## Experiment endpoints and limits

Average the selected-checkpoint endpoints across the two seeds per arm. Primary: real tight rate on the 700-card benchmark. Pilot success threshold: at least +3 percentage points, with no reduction in mean real found rate and no increase exceeding 0.02 extras-plus-duplicates per real photo. Report both seeds individually. These are practical pilot thresholds, not a statistical confidence bound inferred from one previous seed pair. Human-corner results on 139 cards, synthetic results, and the 74 checked-orientation validation photos remain separate secondary diagnostics. Validation diagnostics are reused for selection and are not independent evaluation. The frozen phone session stays qualitative.

The large audit did not establish a causal explanation for the phone regression. Near ties for one seed do not close the objective question. Fixed order is used here to keep this rotation experiment bounded; cyclic objectives can also support augmentation with an appropriate adapter. Two seeds remain a small experiment, and geometry benefit alone does not promote a production model.

## Recognition work

The existing replay has 57 frames, **11 verified identities**, four forbidden accepts and 42 unknown identities. It evaluates one highest-confidence detection per frame. Unchanged aggregate counts are not evidence of unchanged per-card recognition across a full scene. Earlier human-label crop replay already produced four correct, six abstentions and one wrong result on the 11 verified identities; improving geometry alone did not fix those cases. Encoder, index, identity truth and acceptance behavior require their own diagnostics.

Prepare an independent per-card identity review set from the 106 saved phone-session outlines, with source and corner hashes, catalog identity checks and durable append-only decisions. Model suggestions are not verified labels. Recognition truth remains a separate versioned release; the frozen geometry benchmark and training labels stay unchanged. This is a targeted identity review, not another border review.

Local work: `.artifacts/card-geometry/augmentation-20260913/`. Training progress and submitted job receipts will be recorded here and copied to the configured Drive folder. [Hugging Face Jobs](https://huggingface.co/docs/hub/jobs-overview) supplies the remote compute.
