# One YOLO11s follow-up: validation geometry and orientation coverage

**Completed September 11: retain the reviewed-data baseline.** The single model finished 50 epochs. All seven saved checkpoints were scored on validation data, epoch 50 was selected, and the frozen 75-photo comparison passed verification. The new checkpoint found 86/106 cards with 33 tight outlines; the baseline found 96/106 with 40 tight outlines. [Machine-readable results](RESULTS.json) preserve the scores and provenance. The original cloud job remains marked failed because evaluation startup failed after the weights had been saved; local recovery completed the selection and phone comparison without another training run.

The completed 75-photo September 9 phone session remains reserved comparison data. Its images and labels are not used for training, early stopping, checkpoint ranking or threshold tuning. We have already inspected this session during development, so repeat comparisons are diagnostic rather than a fresh blind test; later independently collected sessions are still valuable. The preceding model comparison still favors the reviewed-data baseline (96/106 found, 40 tight outlines) over cyclic epoch 50 (86 found, 26 tight).

## Experiment prepared September 10

The earlier training validation split had no real cards with checked printed-top orientation. The new release reserves the complete connected `pk-detect.v3i.coco` and `pokefolio.v1i.coco` source groups. Archive aliases, shared source assets, sessions, exact images and known physical-card IDs remain grouped. All existing record and image bytes are preserved; only manifest split assignments and the versioned readiness policy change. Nothing moves from validation into training.

The release has 13,135 training photos and 2,609 validation photos, including 1,609 real validation photos. Validation contains 304 cards with checked orientation across 74 real photos, including 18 sideways photos. These are archive images, not new independent phone captures. Three training scene floors were explicitly lowered to reserve whole groups: single-card 4,000→3,800, grid 700→500, scatter 1,000→950. The other gates remain unchanged. Preserve this limitation when interpreting gains.

The candidate remains one YOLO11s pose model, 50 epochs, the existing cyclic-unknown corner objective and pinned generic COCO pose initialization. Earlier card-trained checkpoints have seen the newly reserved archives and would contaminate this validation split. The checkpoint shortlist is declared before inference: epochs 10, 20, 30, 40, 50, framework best and last, deduplicated by checkpoint hash. Ranking uses only fully annotated validation images: harmonic mean of detection F1 at IoU 0.50 and tight recall at IoU 0.90, balanced first across scenes within each source kind, then equally across real and synthetic. Ties prefer the earlier declared shortlist member.

Training artifacts are uploaded before selection or frozen evaluation, so a later failure does not discard the trained weights. Selection writes a hash-bound protocol and result and leaves framework `best.pt` intact. Frozen evaluation explicitly loads the selected checkpoint. Recognition replay uses the existing four-way policy and must be compared against the matching four-way baseline replay. No automatic production promotion occurs.

## Pins and validation

- Release: `card-geometry-orientation-validation-v2`.
- Corpus SHA-256: `aceff85cccac00fc9420831df4a1c88c2360847a47c5f1a3f917462b20630162`.
- Policy: `training-known-orientation-v1`, SHA-256 `91078d80e3fcc057fded524de747adfb835bbb896110863f9a0b84c37eca7201`.
- Isolated training tooling commit: `633b348d332c51bf7718b33c2bb107a765c7f02f` (adds the explicitly named policy to the experiment schema).
- Executed full-preflight commit: `f50626305aae3424391ef75b71dc9611e93f948d`; only the experiment configuration schema changed afterward, verified by the freeze script. Corpus schemas, validation code, record bytes and release pins are identical.
- Published dataset revision: `f73c4103e4a8c81a45ecf0b188fcbdeed003ce78`.
- Local run evidence: `.artifacts/card-geometry/orientation-validation-20260910/`.

The v2 corpus passed the complete training preflight. A real CPU predictor smoke test exercised the selection pipeline on one real sideways validation photo and one synthetic validation photo, using existing checkpoints only as fixtures. The production shortlist was unchanged. Unit tests cover leakage grouping, score behavior and selection tie handling. An initial v1 build incorrectly added a schema-forbidden split field to raw records; it failed preflight, was preserved as failed evidence, and is not a training input. The corrected v2 keeps split membership only in the manifest.

## Angles and later captures

The editor and comparison gallery calculate image-plane rotation from the printed top edge after scaling normalized coordinates into source pixels. Unknown printed orientation remains unknown; no physical orientation is invented from corner index alone. Four interior angles and their maximum deviation from 90° provide a perspective-skew measure. These measurements do not establish calibrated 3D camera/card tilt.

The frozen September 9 session has 106 valid outlines: 95 upright and 11 upside-down, with no sideways examples. `audit_quad_angles.cjs` writes a hash-bound coverage report and shares the same geometry implementation as the editor. More independent sessions can be added later, particularly sideways cards, varied backgrounds, lighting and overlaps. Keep each capture/physical-card group together and preserve existing final-evaluation membership when extending the data.

The four initial reference flags (F11, F28, F60, F73) were rechecked at full resolution. The questionable points lie outside the captured frame; their estimates and all model scores remain unchanged. See the separate versioned adjudication in the session comparison.

## Running and recovery

The one-shot continuation is `.artifacts/card-geometry/orientation-validation-20260910/continue_run.py`. Its status is available at `http://127.0.0.1:8773/follow-up/`. It waits for verified publication, resolves and publishes immutable inputs, submits exactly one four-hour L4 job, then downloads the validation-selected checkpoint and compares it with the baseline on the saved session. The separate report is written under `session-comparison/`. File and label checks run before and after comparison; there is no production promotion. The configured automatic backup service copies the resulting reports and receipts.

Training submission checks the experiment hash against existing jobs before submitting. The continuation uses a process lock and the saved job receipt. Resuming it reuses that job; errors require inspection and never trigger a replacement training run. Cloud training continues if the Mac sleeps; local comparison resumes while the one-shot process is running. After a reboot or stopped process, rerun the continuation to inspect the same receipt and finish the local steps. It does not establish a recurring scheduled task. Evaluation tooling is frozen separately before submission so later repository changes cannot silently alter the deferred session comparison.

## Submitted run

One L4x1 job was submitted September 10 at 17:16 UTC: [6aa2e5e85527934177ec1db1](https://huggingface.co/jobs/ahzs645/6aa2e5e85527934177ec1db1), with a four-hour timeout. Experiment hash: `c4a461d2a4baccd394a65b49b18649d3189d93a8c4ecbbad60fe4d824545cec3`. Private model-input revision: `418905e20f03238d1f73571e3a140c0b9bf4a438`. The configuration dry run and 23 job-wrapper tests passed. Live stage and final comparison are on the progress page; submission is not a completed result.

## September 10 post-training failure and recovery

The job completed all 50 training epochs and uploaded the saved weights, then exited with an error at approximately 19:53 UTC. The post-training entry point imported `FOUR_WAY_POLICY` from `recognition_orientation`, which exports the constant as `POLICY`. This was a reporting/evaluation startup error after training, not failed training or missing checkpoints. The entry point now imports `POLICY as FOUR_WAY_POLICY`. A regression test imports the actual entry point, exercises selection followed by evaluation, and rejects a checkpoint changed after selection.

The uploaded training outputs are pinned to model repository revision `a6327926f1d23c8a0155565efae3cd3a652c6c2c`. All seven predeclared checkpoint files were recovered and verified against the uploaded checkpoint inventory; the training CSV contains 50 epoch rows. No replacement training run was submitted.

`recover_run.py` in the local run evidence directory runs the frozen selector on CPU with four threads, then runs the separately frozen 75-photo comparison and gallery renderer. Selection covers 1,844 validation photos; 765 validation photos containing incomplete box-only target geometry are excluded according to the original protocol. The shortlist, data membership, ranking, decoder and thresholds are unchanged. Moving selection from planned cloud CUDA execution to local CPU is recorded in `recovery-protocol.json`.

Recovery is in progress as of 20:04 UTC. Check `pipeline-status.json` and `recovery-verification.json` for actual completion. The original Hugging Face job will retain its error status even if local recovery succeeds. Do not rerun `continue_run.py` to recover this failure: it intentionally stops on the failed job. Use `recover_run.py`; it verifies the saved outputs and refuses to overwrite partial evaluations. The four reference checks and grouped dataset preparation are complete; checkpoint selection and the new phone comparison were not complete when recovery began. Broader archive/synthetic evaluation and recognition replay are separate from this phone-comparison recovery and must not be inferred from its completion.

On September 11, the local process was no longer running. Five candidates had complete predictions and metrics; `best.pt` had interrupted predictions and `last.pt` had not started. `resume_selection.py` verifies the frozen evaluator hashes, original selection protocol, runtime, all record hashes, eligible image hashes, and completed predictions against the previously recorded SHA-256 values. It recomputes the five cached metrics and requires exact agreement before reusing them. The interrupted output is retained in a dated subdirectory, and only the remaining two candidates are inferred again. The original shortlist, validation membership and ranking stay unchanged. `selection-resume-receipt.json` records this recovery. The 75-photo comparison starts only once all seven candidates have complete validated results.

## Completed selection and 75-photo comparison

Validation selected `epoch49.pt` (the 50th training epoch), SHA-256 `13c2eb19b41a03ef1a68a6d2dacb4f480f57c9d25ffdf54046f24f3b6f62c7de`. Its balanced score was 0.805458, tied with the final `last.pt`; the predeclared tie rule selected the earlier shortlist entry. Framework `best.pt` scored 0.723161. Validation score is a ranking measure, not an accuracy percentage. The seven candidates and original protocol remain available in the results record.

| Frozen session measurement | Baseline | New validation-selected YOLO11s |
|---|---:|---:|
| Found cards / 106 | **96** | 86 |
| Tight outlines, IoU ≥ 0.90 | **40** | 33 |
| Missed cards | **10** | 20 |
| Unmatched predictions | **19** | 21 |
| Found cards in multi-card photos / 43 | **37** | 31 |

The candidate loses 11 detections that the baseline finds and recovers one baseline miss. It gains four tight outlines but loses eleven. Seven of the newly missed cards are in multi-card photos. These regressions occur in seven photos: F6, F7, F20, F21, F25, F42 and F71. The gallery's **Cards missed only by the new model** filter opens this focused set; its filter and photo persist in the URL. No further full-session labeling pass is required.

The baseline predictions reproduced the earlier 96-found/40-tight result. Both models were run against the identical 75 source photos and the frozen 106-card snapshot; prediction schema validation and before/after image, label, source-code and checkpoint checks passed. The four retained outside-frame reference estimates were transferred only after confirming the same label snapshot. All labels and original benchmark outputs remain unchanged. The contact sheets now label the evaluated checkpoint generically as the candidate, avoiding an incorrect hardcoded epoch name in future comparisons.

The next diagnostic target is the seven regression photos, followed by a small independent capture set with sideways cards, steep angles, partial cards, overlaps and different lighting. This session has **no sideways targets**, repeats physical cards, and has already been inspected during development. It cannot establish sideways generalization or recognition accuracy. Better archive validation scores did not translate to better performance on this phone session. Keep the baseline; another large review of similar images or automatic retraining is not justified by this result. Broader archive/synthetic evaluation and recognition replay for this new checkpoint remain uncompleted and are not prerequisites for rejecting it as the baseline replacement on the present evidence.

Results gallery: `http://127.0.0.1:8773/follow-up/session-comparison/gallery/`. Local verification is in `session-comparison/verification.json` and `recovery-verification.json`; no model was promoted.
