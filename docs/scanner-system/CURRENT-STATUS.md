# Card geometry: current status and next model choices

**Status checked September 11, 2026.** This is a dated snapshot, not a live job monitor.

Your reference and phone-session reviews are finished. The latest YOLO11s retraining and saved-session comparison are also finished, but the new model performed worse. **Keep the September 8 reviewed-data YOLO11s as our development baseline.** No replacement has been promoted to the apps, and no Hugging Face jobs were running when checked for this report.

The angle/position library is available now. The SAM 3.1 experiment is complete and promising for proposing outlines, but those proposals are **not yet integrated into the corner editor**. YOLO11m-pose and YOLO26s-pose are proposed future experiments; neither has been trained on our cards.

## What is complete, and what is still pending?

| Work | Current state |
|---|---|
| Reference review | Complete: **502 photos / 561 cards**. 551 starting outlines accepted and 10 adjusted. |
| September 9 phone-session review | Complete: **75 photos / 106 cards**. Saved as a frozen comparison set. |
| Four questionable reference outlines | Rechecked at full resolution. Outside-photo corner estimates retained, with separate adjudication; original benchmark scores preserved. |
| Corner-order training correction | Implemented: unknown printed-top labels can match any cyclic corner phase; known orientation retains fixed labels. Reversed winding is not permitted. |
| Training/validation preparation | Complete: grouped sources and an explicit orientation-aware validation release. |
| Latest single YOLO11s retraining | Complete: 50 epochs, saved checkpoints recovered, validation selection and phone comparison verified. |
| Angle and position library | Implemented: saved geometry, coverage filters, photo overlays, JSON export, and refresh from saved labels. |
| SAM 3.1 test | Complete: inference on 12 selected photos; masks and corner drafts available in a gallery. |
| SAM proposals inside the editor | **Pending:** deduplication, proposal acceptance/editing, and handling visible fragments. |
| YOLO11m / YOLO26s card experiments | **Pending:** pipeline integration, compatibility checks, and training. |
| Broader evaluation of the latest checkpoint | Archive/synthetic evaluation and recognition replay remain unfinished. No end-to-end recognition or phone-speed improvement has been established. |
| Automatic durable-state backup | Running, with a configurable Google Drive folder; see storage details below. |

You do **not** need to repeat the completed review. Remaining incomplete records elsewhere in the wider inventory are separate from those finished review sets.

## What did retraining actually achieve?

The latest run reserved real validation examples with checked orientation and selected checkpoints using **both detection and tight-border accuracy**, rather than accepting the training framework's default checkpoint choice.

Seven predeclared checkpoint files were evaluated. Selection chose `epoch49.pt`, the **50th training epoch**. The cloud job still displays an error because its post-training evaluation failed to start; training weights were already saved, and local recovery completed the comparison without another training run.

| Same frozen 75 photos / 106 cards | September 8 baseline | Latest selected YOLO11s |
|---|---:|---:|
| Found cards, polygon IoU ≥ 0.50 | **96** | 86 |
| Tight outlines, polygon IoU ≥ 0.90 | **40** | 33 |
| Missed cards | **10** | 20 |
| Unmatched predictions | **19** | 21 |
| Found in multi-card photos, out of 43 | **37** | 31 |

IoU measures how much the predicted outline and saved reference overlap. A card can count as found while still having a poor border. The new model lost 11 detections the baseline found and recovered one baseline miss. The regressions are in **F6, F7, F20, F21, F25, F42 and F71**.

**What we learned:** better validation selection did not translate into better results on this phone session. More capacity might help, but the result does not establish that model size is the cause. Coverage, domain differences, augmentation, and the training objective remain plausible contributors.

The session contains **95 upright, 11 upside-down, and zero sideways cards**. It remains excluded from training and checkpoint selection, but we have inspected it repeatedly: it is a useful diagnostic comparison, not a new blind test or evidence of sideways-card performance.

[Detailed training and recovery report](benchmarks/2026-09-10-orientation-validation-yolo11s/README.md) · [Comparison gallery](http://127.0.0.1:8773/follow-up/session-comparison/gallery/)

## What data do we have, and what do the corners tell us?

The latest training release contains **13,135 training photos and 2,609 validation photos**. Source aliases, shared images, sessions and known physical-card identities are grouped to reduce leakage. Validation includes 304 cards with checked printed orientation across 74 real photos, including 18 sideways photos.

The larger library combines current releases and saved review/session records. These counts overlap; do not add the rows together.

| September 11 library snapshot | Photos with card records | Card appearances | Valid outlines | Printed top known |
|---|---:|---:|---:|---:|
| All current sources | 17,419 | 48,609 | 45,978 | 41,733 |
| Real photos | 6,419 | 8,437 | 5,806 | 1,561 |
| Human-reviewed real subset | 742 | 1,316 | 1,316 | 706 |
| Frozen phone session | 75 | 106 | 106 | 106 |

“Card appearances” means occurrences in photos, not unique physical cards. Synthetic sources supply 40,172 appearances. Exact duplicate image files are collapsed; color/grayscale variants and similar photos remain distinct.

Among the 1,316 reviewed real outlines, **610 still have unknown printed-top orientation**. This includes 552 of the 561 reference-review cards. Their outlines remain useful: confirming a border did not automatically establish which edge is the printed top.

The library measures geometric border angle, position, size, proximity to photo edges, perspective skew, and overlap with every other outlined card. It distinguishes upright/sideways/upside-down only when printed top was explicitly recorded. **A rectangle alone cannot distinguish upright from upside-down**, and its corner angles do not provide calibrated 3D camera tilt.

Coverage is uneven: 788 reviewed appearances are centered in the middle grid cell, only 67 have strong/extreme measured skew, and 76 have measured outline overlap. New independent sessions with sideways cards, steep views, partial cards, overlaps and varied lighting would address useful gaps. Another large batch of similar centered photos is a lower priority.

[Open the reviewed-real library](http://127.0.0.1:8775/?sourceKind=real&quality=reviewed) · [Definitions, sources and configuration](CARD-COVERAGE-LIBRARY.md)

## Why YOLO11m-pose first, and why consider YOLO26s-pose?

**This is an experiment-order recommendation, not a claim that either model will beat our baseline.** “Pose” means predicting named points; here those points are the four card corners instead of human joints. Four independent corners can describe perspective distortion that a simple rectangular box cannot. [Ultralytics pose documentation](https://docs.ultralytics.com/tasks/pose/)

I checked the installed Ultralytics 8.4.138 configurations by constructing one-class, four-corner models locally. This used random initial weights: **no training or performance measurement**.

| Candidate | Parameters in our constructed model | Reason to consider it | Main tradeoff |
|---|---:|---|---|
| Existing YOLO11s-pose | 9.72 million | Established baseline and working pipeline | Current misses and loose borders |
| **YOLO11m-pose** | **20.90 million** | Test increased capacity while retaining the YOLO11 pose-head family | More memory/compute and potential overfitting |
| **YOLO26s-pose** | **10.58 million** | Test a newer pose architecture at approximately the small-model scale | More adaptation and validation work |

These are full, unfused model counts with four keypoints, not published human-pose benchmark sizes. Parameter counts are not measured latency or training cost. [Local construction evidence](benchmarks/2026-09-11-model-candidates/CONSTRUCTION.json)

### YOLO11m: the cleaner capacity experiment

YOLO11m shares the pose-head family used by our working YOLO11s pipeline. That makes it the most direct way to ask whether more capacity improves card detection and borders while retaining the data format and corner-order objective. The official family supports pose training and export. [YOLO11 documentation](https://docs.ultralytics.com/models/yolo11/)

It is **not ready to submit unchanged**: our candidate registry and experiment schemas currently allow only YOLO11n/s pose variants. We still need to register the medium model, pin its initialization, and check custom-loss training, decoding and export. Its approximately 2.15× parameter count does not imply a proportional accuracy improvement—or establish acceptable phone speed.

The earlier YOLOX and FastViT experiments had substantial detection or border problems, so revisiting those custom paths currently has less supporting evidence. Those experiments used an older corpus and are not a fair head-to-head test on today's data. [Earlier bakeoff](benchmarks/2026-09-07-successor-bakeoff/RESULTS.md)

### YOLO26s: a worthwhile architecture experiment, with a real compatibility gap

YOLO26 introduces a changed pose head, residual log-likelihood estimation for keypoint localization, and end-to-end detection options. Those are reasons to investigate it, not proof of better trading-card results. [YOLO26 documentation](https://docs.ultralytics.com/models/yolo26/)

Our installed configuration constructs a `Pose26` head with end-to-end mode enabled. Our current custom corner loss subclasses the older pose loss and **explicitly rejects end-to-end models**. Therefore, “requiring adaptation” is concrete: we must preserve cyclic matching for unknown printed top, visibility handling and correct winding through the new loss/head, then verify decoding, duplicate suppression and exports. Simply changing the model filename is insufficient. [Current loss adapter](../../tools/card-geometry/yolo_corner_order.py)

If phone latency is the overriding constraint, YOLO26s—or retaining YOLO11s—could deserve priority over YOLO11m. We have no measured phone comparison for either candidate. Published results on human-pose datasets cannot settle our card-specific choice.

## What did SAM 3.1 tell us?

The inference-only pilot tested **12 deliberately selected photos with 51 saved outlines**. Pooling the two fixed prompts, `trading card` and `playing card`, produced matching masks for **47/51** outlines, but also **96 total masks** before deduplication. Both prompts missed four sideways cards in plastic bags. On F7, one prompt found none of the five cards while the other found all five.

This supports using SAM as a **drafting assistant**. It also exposes prompt sensitivity, duplicate/background detections, and the difference between a visible mask and an occluded card's full outline. Its mask-to-reference measurement and selected photos differ from the YOLO comparison; **47/51 cannot be compared directly with 96/106**.

[Pilot results and limitations](benchmarks/2026-09-11-sam31-pilot/README.md) · [Masks and corner-draft gallery](http://127.0.0.1:8773/follow-up/sam31-pilot/?photo=P06) · [Official SAM 3.1 model](https://huggingface.co/facebook/sam3.1)

## Recommended next steps — not yet completed

1. **Connect SAM proposals to the editor.** Run both prompts, deduplicate, show complete-card drafts separately from fragments, and allow acceptance or correction. Preserve existing reviewed corners and leave printed top unknown until established.
2. **Add a small, targeted independent capture set.** Prioritize the coverage gaps above. Reserve unseen sessions for evaluation and keep related captures/card identities grouped. No repeat full review is needed.
3. **If proceeding with one supervised experiment, prepare YOLO11m-pose.** To isolate model size, reuse the September 10 release and recipe and compare with that run's YOLO11s, as well as the winning September 8 baseline. Changing data or augmentation simultaneously would prevent attributing improvement specifically to model size.
4. **Promote only on measured benefit.** Check found cards, tight borders, rotated/multi-card/overlap slices, then recognition and exported phone performance. Keep the baseline until the evidence supports replacement.

Our current corner-order adapter disables runtime geometric augmentation to preserve its label handling. Safely adding rotation augmentation is another concrete experiment; a bigger model does not substitute for missing coverage. None of these future training experiments has been launched by writing this report.

## Where the work is saved

Repository: `/Users/ahmadjalil/github/TCGer`. Detailed reports are linked above; generated inventories, receipts and checkpoints live under `.artifacts/card-geometry/`.

The automatic backup service watches card-geometry state, source tools and scanner documentation. It copies changed durable files approximately every 10 seconds and exports active FiftyOne datasets approximately every two minutes. Generated caches and live database files are excluded; if FiftyOne is stopped, its last verified native export remains available.

The configurable destination is currently:

`/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference/TCGer-Labeling/automatic`

A readable copy of this report is also saved beside that folder under `TCGer-Labeling/reports/card-geometry-current-status.md`. File-copy verification confirms the local Drive-folder bytes, not Google's remote synchronization. [Backup settings](http://127.0.0.1:8774/) · [Backup and restore documentation](STUDIO-BACKUPS.md)

Studio links require the local servers on this Mac. This report documents local work; it does not commit, push, deploy, or change a production model.
