# One YOLO11s follow-up: validation geometry and orientation coverage

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
