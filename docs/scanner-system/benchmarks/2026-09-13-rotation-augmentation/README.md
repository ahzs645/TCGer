# Two-seed rotation experiment and checkpoint-selection backtest

September 13, 9:39 p.m. PDT: the checkpoint backtest is complete and all three L4 jobs are submitted. The control is running; both rotation seeds are waiting for hardware at this check. This is a declared experiment, not a model promotion. The already completed September 10 split / fixed-order / seed 20260905 run supplies the first control.

## Frozen choices before new inference

All training uses YOLO11s-pose from the same pinned generic initialization, September 10 corpus `aceff85cccac00fc9420831df4a1c88c2360847a47c5f1a3f917462b20630162`, 50 epochs, 640 input, batch 16, deterministic training, and seeds 20260905 / 20260906. No pretrained card checkpoint is used to initialize these runs. Three L4x1 jobs, each with a four-hour timeout; at the current $0.80/hour rate the aggregate compute ceiling is $9.60. No automatic retry training or larger model is authorized by this batch.

The augmentation arm tests whole-photo quarter turns sampled uniformly from 0, 90, 180 and 270 degrees before the ordinary letterbox pipeline. This is an initial rotation-coverage experiment; it does not test arbitrary-angle rotation, perspective, scaling or translation. Pixel rotation is exact, no pixels or full outlines are clipped, and both horizontal and vertical flips remain zero. All other runtime augmentation settings remain zero. The environment must not install implicit Albumentations transforms. [Ultralytics augmentation behavior](https://docs.ultralytics.com/guides/yolo-data-augmentation/).

Known-top targets retain their printed corner indices under rotation. Fully supervised unknown-top targets are cyclically reindexed to the minimum pixel-space x+y corner, preserving clockwise winding and carrying visibility with each point. Box-only targets retain zero keypoint supervision. Six of 2,843 real training unknown outlines do not start at that geometric corner: their entire photos remain unrotated, preserving the original phase rather than silently relabeling them. Validation images and stored source labels never rotate. The no-rotation transform is tested against the standard dataset for equal image, keypoint, box and class tensors.

## Checkpoint selection

Policy `validation-real-weighted-guarded-v2` considers only epoch 10/20/30/40/50 snapshots. It retains the original selector's scene-level harmonic mean of detection F1 and tight-border recall, averaging scenes within real and synthetic separately, then weighting real:synthetic 2:1.

Before ranking, exclude checkpoints with real validation extras plus duplicates per photo above the shortlist median by more than 0.05, or synthetic validation score below the shortlist median by more than 0.02. A score tie within 1e-9 prefers the later epoch. Guard failure for every candidate stops selection; it does not silently relax the rule. Framework best and last files remain saved but are not candidates. This is a checkpoint rule, distinct from the experiment's primary endpoint.

Backtest the declared rule on the complete saved September 10 cyclic and September 13 fixed-order shortlists. Hash-check original validation metrics and weights. Write the validation choice before evaluating every shortlisted epoch on the 700-card benchmark. Report transfer, including failures to pick the best benchmark result; do not tune the rule to force agreement with that already inspected benchmark.

## Backtest outcome

The declared selector chose epoch 50 in both shortlists. It chose the highest real tight count in the cyclic run (550/700), but missed the fixed run's tight winner: epoch 30 had 559 tight / 675 found / 16 extras, versus epoch 50 with 544 / 676 / 26. Both fixed checkpoints had one duplicate. The later checkpoint finds one more card and loses 15 tight borders. The rule therefore remains a provisional experiment policy, not a proven promotion rule. Keep it unchanged for the pilot rather than tune it to this benchmark after inspection. [Pinned results](backtest-results/RESULTS.json) and [technical review](backtest-review.json).

The HF runtime smoke check trained a one-epoch fixture, confirmed the stock fixed-order loss and absence of implicit Albumentations, and reloaded a four-corner checkpoint successfully. Fixture training is separate from the three full training jobs.

## Experiment endpoints and limits

Average the selected-checkpoint endpoints across the two seeds per arm. Primary: real tight rate on the 700-card benchmark. Pilot success threshold: at least +3 percentage points, with no reduction in mean real found rate and no increase exceeding 0.02 extras-plus-duplicates per real photo. Report both seeds individually. These are practical pilot thresholds, not a statistical confidence bound inferred from one previous seed pair. Human-corner results on 139 cards, synthetic results, and the 74 checked-orientation validation photos remain separate secondary diagnostics. Validation diagnostics are reused for selection and are not independent evaluation. The frozen phone session stays qualitative.

The large audit did not establish a causal explanation for the phone regression. Near ties for one seed do not close the objective question. Fixed order is used here to keep this rotation experiment bounded; cyclic objectives can also support augmentation with an appropriate adapter. Two seeds remain a small experiment, and geometry benefit alone does not promote a production model.

The final four selected checkpoints will also receive a common CPU evaluation on Hugging Face. This avoids mixing historical Mac CPU scores with new GPU scores in the primary comparison. The two CPU evaluation jobs have separate two-hour caps at $0.03/hour each, adding at most $0.12 to the three GPU jobs' $9.60 compute ceiling. No model is promoted automatically.

## Recognition work

The existing replay has 57 frames, **11 verified identities**, four forbidden accepts and 42 unknown identities. It evaluates one highest-confidence detection per frame. Unchanged aggregate counts are not evidence of unchanged per-card recognition across a full scene. Earlier human-label crop replay already produced four correct, six abstentions and one wrong result on the 11 verified identities; improving geometry alone did not fix those cases. Encoder, index, identity truth and acceptance behavior require their own diagnostics.

The [per-card identity review](http://127.0.0.1:8776/) is ready for the 106 saved phone-session outlines, with source and corner hashes, catalog identity checks and durable append-only decisions. There are 23 optional unverified phone-recognition suggestions, associated only where a device outline unambiguously overlaps the reviewed outline; catalog images are shown for checking. No new identities have been claimed as verified. The queue and decisions save directly into the Reference folder under `TCGer-Labeling/recognition-reviews/phone-20260909-identity-v1`. Previous, Undo and refresh position are supported. The companion `replay_instance_identities.py` assigns detections across the whole photo before selecting verified identities and reports model-crop versus human-border-crop recognition separately. Model suggestions are not verified labels. Recognition truth remains a separate versioned release; the frozen geometry benchmark and training labels stay unchanged. This is a targeted identity review, not another border review.

Local work: `.artifacts/card-geometry/augmentation-20260913/`. Training progress and submitted job receipts will be recorded here and copied to the configured Drive folder. [Hugging Face Jobs](https://huggingface.co/docs/hub/jobs-overview) supplies the remote compute.

## Submitted jobs and continuation

| Run | Hugging Face job | Maximum GPU runtime |
|---|---|---|
| Control seed 20260906 | [6aa779b421047bf1b0386339](https://huggingface.co/jobs/ahzs645/6aa779b421047bf1b0386339) | 4 hours |
| Quarter turns seed 20260905 | [6aa779b421047bf1b038633b](https://huggingface.co/jobs/ahzs645/6aa779b421047bf1b038633b) | 4 hours |
| Quarter turns seed 20260906 | [6aa779b521047bf1b038633d](https://huggingface.co/jobs/ahzs645/6aa779b521047bf1b038633d) | 4 hours |

Training code is pinned at `56df86f9`, common CPU analysis code at `c93bb21e`. The [training publication](training-input-publication.json) binds all three configs and job specs. The separate [analysis protocol](analysis-protocol.json) allows one final two-hour CPU audit, with total compute capped at $9.72 including the completed backtest. Reported ceilings exclude any unrelated jobs or storage.

`tools/card-geometry/continue_rotation_experiment.py --workdir .artifacts/card-geometry/augmentation-20260913 --mirror-dir <Reference>/TCGer-Labeling/reports/2026-09-13-rotation-augmentation` is the finite local batch coordinator. It reuses job receipts, verifies the backtest gate and input hashes, collects completed training, submits one common CPU audit, then downloads verified results. It never automatically retries a failed training job or promotes a model. The coordinator needs this Mac awake for collection and the CPU handoff; already submitted training runs independently on Hugging Face. Restarting the coordinator reuses those jobs. It mirrors status and readable evidence into the Drive folder. Google Drive's remote synchronization status is not independently verified.

[Live local status](http://127.0.0.1:8773/rotation/) · [Identity review](http://127.0.0.1:8776/)
