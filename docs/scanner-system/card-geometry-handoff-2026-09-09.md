# Card geometry: current handoff and lessons

**September 11 library and SAM update:** the [angle/position library](CARD-COVERAGE-LIBRARY.md) inventories current releases and saved reviews, including 1,316 human-reviewed real outlines. Border-axis angles are measurable without a printed-top flag; 610 reviewed outlines still have unknown printed orientation. A completed [SAM 3.1 inference pilot](benchmarks/2026-09-11-sam31-pilot/README.md) pooled two fixed prompts and matched 47/51 saved outlines on 12 selected photos. It is a labeling-assistance trial, not a production replacement or directly comparable YOLO benchmark. No additional supervised model was trained for this pilot.

**September 11 update:** the one-model orientation-validation follow-up is complete through checkpoint selection and the frozen 75-photo comparison. Epoch 50 was selected on validation, but the baseline still wins: 96/106 found and 40 tight outlines versus 86 found and 33 tight. Keep the baseline. The seven photos with newly missed cards are prepared in the comparison gallery. See the [completed results and recovery](benchmarks/2026-09-10-orientation-validation-yolo11s/README.md). Earlier prerequisite and next-run paragraphs below describe prior stages; no additional training job is currently pending.

Updated locally through September 11, 2026. The September 9 implementation and detailed experiment reports were pushed to `main` in `405d157a`, including the preceding experiment history. The subsequent session/editor work and comparison are recorded below; this statement does not claim those later local changes have been pushed. Older dated reports preserve what was known at the time.

## Current decision

Keep the **September 8 reviewed-data YOLO11s as the development baseline**. Retain the cyclic-loss run's epoch-50 checkpoint as the best border candidate, but do not replace the baseline: it misses more cards in real captures. “Baseline” here does not mean that this experimental detector has been deployed to the apps.

The user's reference review is **finished: 502 photos / 561 cards**, including all 22 multi-card photos. There were no remaining drafts or skips at the verified completion snapshot. Model-comparison flags are model failures to investigate, not unfinished annotations. Do not ask the user to repeat this review.

The separate September 9 phone session is also complete: **75 photos / 106 cards**, backed up and evaluated on September 10. With fixed settings, the baseline found 96 cards with 40 tight outlines; epoch 50 found 86 with 26 tight outlines. The four initial reference flags were subsequently checked at full resolution and retained as outside-frame estimates. Labels and scores are unchanged. Keep the baseline and preserve this session outside training/tuning. See the [session comparison and limitations](sessions/2026-09-09-231206-model-comparison.md); no full repeat review is needed.

## Work completed and what it established

| Work | Finding or lesson | Detailed record |
|---|---|---|
| Shared geometry, crop contract, corpus, initial models and trainer repairs | Detection, corners, crop pixels and downstream identification need separate, pinned measurements. A successful training job alone does not establish usable crops. | [Earlier experiment history and handoff](card-geometry-agent-handoff-2026-09-06.md) |
| Whole-card category repair and successor bake-off | Some original targets represented slabs or card subregions. Correcting target semantics improved results; changing models alone could not repair mislabeled targets. | [Category repair](benchmarks/2026-09-06-category-repair/README.md), [successor results](benchmarks/2026-09-07-successor-bakeoff/RESULTS.md) |
| Point-drawing/rectification studio and assisted outline review | Movable starting outlines, explicit confirmation, approve-on-save navigation, saved drafts, undo, stable F/C references, orientation controls and filters made review practical. Bot labels retain detector provenance until explicitly reviewed by a person. A cheap-model proposal is not automatically human ground truth. | [Labeling workflow and provenance](benchmarks/2026-09-06-successor-corpus-prep/LABELING.md) |
| Mirrored archive edges | The reported reflections were already in `pk-detect.v3i.coco` source pixels. All 48 affected images had two reflected strips; the derived release replaces them with constant padding and removes 32 false targets while preserving interior pixels and coordinates. Reversed corner winding is a separate possible cause of mirrored crops and is rejected. | [Padding repair and journal migration](benchmarks/2026-09-06-successor-corpus-prep/PADDING-REPAIR.md) |
| Color/grayscale handling | Color-only and multi-card filters reduce review effort without deleting records or renumbering references. Similar-looking color and grayscale images must be checked for shared source identity; a filter does not deduplicate data or establish split independence. | [Labeling workflow](benchmarks/2026-09-06-successor-corpus-prep/LABELING.md), `audit_archive_label_variants.py` |
| Card ordering and overlapping previews | Check every intersecting pair and combine all known covering cards. Explicit above/below relationships and their transitive consequences control clipping; unknown order stays unknown. Full outlines remain editable. Layer previews do not reconstruct hidden artwork or train a depth/segmentation model. | [Card layers](benchmarks/2026-09-06-successor-corpus-prep/LABELING.md#card-layers) |
| September 8 reviewed-data retraining | One YOLO11s run improved full real-evaluation recall at IoU .50 from 92.3% to 96.7%, and reduced extras from 177 to 47. Recognition did not improve correspondingly. The initial queued job later failed for write authorization, so the unchanged experiment was resubmitted with verified access. | [Training, receipts and results](benchmarks/2026-09-08-reviewed-corners-yolo11s/README.md) |
| Review against existing reference corners | The completed review accepted 551 starting outlines and adjusted 10; it is reviewed reference geometry, not independent blind annotation. Only nine cards have explicitly checked printed-top orientation; 552 remain unknown. Accepting a border must not silently assert printed orientation. | [Completed reference review](benchmarks/2026-09-08-reviewed-corners-yolo11s/REFERENCE-REVIEW-COMPLETED.md) |
| Training corner-order investigation | Image-relative fitted corners and printed-card synthetic corners had different starting-point conventions. The adapter discarded orientation uncertainty. Unknown-orientation targets now use cyclic loss/validation matching; known orientations retain fixed identities, visibility follows the phase, and reversed winding is never equivalent. | [Audit](benchmarks/2026-09-08-reviewed-corners-yolo11s/CORNER-ORDER-AUDIT.md), [implementation and run](benchmarks/2026-09-09-corner-order-yolo11s/README.md) |
| Saved checkpoint diagnosis | Framework `best.pt` selected epoch 20. Epoch 50 has better borders, yet worse real-capture recall and raw printed order. Neither internal fitness nor aggregate archive accuracy is a sufficient replacement rule. The job's final reporting error did not invalidate its saved training outputs; the report was recovered without retraining. | [Run and recovery](benchmarks/2026-09-09-corner-order-yolo11s/RUN.md), [diagnosis](benchmarks/2026-09-09-corner-order-yolo11s/DIAGNOSIS.md) |
| Four-orientation recognition and guarded checkpoint selection | Rewarp sideways cards from source quads before portrait resizing. Require the winning identity family to beat rivals across all four orientations, using the existing margin. Evaluate scene-level detection and recognition regressions separately from border gains. | [Implementation, verification and limitations](benchmarks/2026-09-09-corner-order-yolo11s/SELECTION-ROTATION.md) |

## Earlier September 9 comparison

These are different populations and must not be combined into one accuracy claim. Recognition counts below use only the **11 identity-labeled cases**, although all 57 replay frames were run for each model. The 600-photo real geometry benchmark contains 502 archive photos and 98 human-capture photos.

| Measurement | Reviewed-data baseline | Cyclic epoch 20 | Cyclic epoch 50 |
|---|---:|---:|---:|
| Found cards in human captures, out of 139 | **128** | 117 | 109 |
| Tight outlines on the 561 reviewed reference cards | 475 | 454 | **508** |
| Correct / wrong / abstain, new four-orientation policy, out of 11 | **4 / 1 / 6** | 2 / 1 / 8 | **4 / 1 / 6** |

Epoch 50's naive four-orientation search had four correct and two wrong identifications. The cross-orientation family margin reduces that to four correct and one wrong. Its remaining error also occurred with baseline and human-label crops in the earlier diagnosis: improving corners alone does not solve every encoder/index ambiguity. The additional rotations also cost more encoder work; mobile latency has not been measured for this policy.

Checkpoint SHA-256 identities:

- Reviewed-data baseline: `0f5bc3e2509c98837b4c57745af55b75f5acac5739a76d68122c46f0b9995327`.
- Cyclic epoch 20: `7e66c9e6734c86fea217831217785fd78cad1eaaea7434f29546d20f123f112e`.
- Cyclic epoch 50: `54af5ba715e3620cfd74cbb6e85f85aa1ad7162db9dad3a120a56cf91ea711df`.

The final policy work passed 33 focused tests and replayed 171 frame/model combinations. Its historical 0/180 decisions and families agreed in all 171 cases. See the linked report for pixel, checkpoint-loading, hash, loss and parity checks.

## What remains unfinished

1. **Prepare suitable validation data before another run.** The current training release contains 1,279 real validation photos and zero with known printed-top orientation. The coverage audit and guarded selector are implemented; the replacement split is **not yet prepared**. Define it under an explicit versioned policy, respecting archive/fork aliases, sessions, source assets, physical cards and duplicate-image groups. If the existing whole-archive policy cannot supply the needed coverage, document the gap or a justified policy change rather than silently splitting an archive.
2. **Fill the remaining evaluation gaps.** The completed 75-photo session supplies a new, frozen geometry check, with no exact-image overlap in the reviewed training or earlier evaluation releases. It has repeated physical cards, no targets in the defined sideways slice, and no independently verified recognition identities. Add those missing conditions in future sessions and keep them out of training and selection; exact-image exclusion alone does not establish physical-card independence. The repeatedly inspected 600-photo benchmark is development evidence, not a fresh holdout.
3. **Measure remaining recognition failures and runtime cost.** Preserve the wrong-identification examples; do not tune a threshold merely to remove one known failure. More diverse labeled images can improve coverage, but more unverified duplicates do not establish better generalization.
4. **Only then consider another declared training experiment and release decision.** No further job, production model replacement, production four-way policy rollout or export change was performed by the final selection/rotation work. Existing license and release gates remain applicable.

## Where the evidence lives

**In Git/main:** source code, tests, schemas, launch configuration, dated narrative reports, selected machine-readable benchmark results and publication receipts. Start with this handoff and the linked experiment reports rather than old “next step” paragraphs.

**Private Hugging Face storage:** published training inputs, model checkpoints and prior evaluation/diagnosis outputs in `ahzs645/tcger-universal-arcface`; immutable revisions and paths are in the corresponding run/publication receipts. A filename such as `best.pt` is not sufficient to identify a model.

**Local, ignored artifacts:** `.artifacts/card-geometry/` contains the live review journals, source images, frozen releases, downloaded weights, galleries and additional reports. The latest policy replay, selection JSON, validation coverage, source snapshots and checksum manifest are under `selection-rotation-20260909/`. These final policy artifacts were **not published to Hugging Face** in that follow-up. Pushing Git is not a backup of all local images, journals or weights; retain the local artifacts and the earlier verified completion snapshots.

Local studio routes, while their servers are running:

- `8768`: training-label studio and model comparison.
- `8770`: completed reference-corner review.
- `8771/final/`: saved epoch-50 border diagnosis.
- `8771/policy/`: final rotation/selection comparison, a read-only report rather than another labeling queue.

The documented findings are durable in Git. Reopening a studio on a different machine also requires its pinned local data and journal; the launch configuration alone does not contain those assets.

## September 10 — automatic backups and next run

Automatic, configurable studio backups now run at login on this Mac. Changed durable artifact files, archive/reference browser drafts, source code, reports and native FiftyOne exports are copied to `Reference/TCGer-Labeling/automatic`. Backups links are visible in the studios; settings are at `http://127.0.0.1:8774/`. Native export recovery matched 712 samples, 13 views and all manual fields. Both automatic version-retention cycles passed. The five older datasets retain their verified September 10 export while that database is offline. Copies are checksum verified locally; Google Drive upload completion is not measured. See [backup configuration and recovery](STUDIO-BACKUPS.md).

The grouped orientation-validation follow-up is prepared and published, with one-shot continuation status at `http://127.0.0.1:8773/follow-up/`. See [experiment protocol](benchmarks/2026-09-10-orientation-validation-yolo11s/README.md). It uses one 50-epoch YOLO11s run and validation-only checkpoint ranking, followed by a separate diagnostic comparison on the already-inspected 75-photo session. The current baseline and reviewed labels remain unchanged. Job and completion state live in `.artifacts/card-geometry/orientation-validation-20260910/pipeline-status.json`; do not infer completion from this preparation note.
