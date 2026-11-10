# Next outline training run — what it needs

**November 10, 2026.** Requirements only. No job was submitted, no corpus was
built and no model was promoted. Licensing of Ultralytics-derived exports is
out of scope here and stays as recorded in
[the geometry plan](../../shared-card-geometry-plan-2026-09-02.md).

## What the run should target

The September 8 YOLO11s-pose checkpoint, replayed on the frozen September 9
phone session (75 photos, 106 hand-outlined cards), finds 96 cards but
outlines only 40 tightly (polygon IoU ≥ 0.90). Per-card overlaps are in
[`../2026-11-10-query-blend/replay-per-card.json`](../2026-11-10-query-blend/replay-per-card.json);
the slices are in [`outline-slices.json`](outline-slices.json).

| Slice | Cards | Found | Tight |
|---|---:|---:|---:|
| All four corners inside the photo | 66 | 59 | 33 |
| One or more corners cut off by the frame | 40 | 37 | 7 |
| Single card, more than 12° off flat (device measure) | 19 | 18 | 2 |
| Single card, 12° or flatter | 23 | 23 | 11 |
| Cards in multi-card photos | 43 | 37 | 23 |
| Cards in single-card photos | 63 | 59 | 17 |

Loose outlines concentrate on close-ups where the card runs off the edge of
the photo and on steeper angles. Crowded photos are not the main problem:
six of the ten missed cards are in multi-card photos, but those photos have
the higher tight rate.

Outline quality now limits recognition. With the query blend, hand-drawn
outlines give 93 correct answers and the September 8 outlines give 81
([evidence](../2026-11-10-query-blend/README.md)).

This is one session of 23 distinct cards that has been inspected repeatedly.
It motivates the experiment; it must not be the only thing that judges it.

## Proposed experiment

Two arms, YOLO11s-pose, 50 epochs, 640 input, batch 16, `fixed-v1` corner
order, the same pinned initialization as September 13.

- **Control:** the existing September 10 corpus
  `card-geometry-orientation-validation-v2` (`aceff85c…`). Two control seeds
  (20260905, 20260906) are already trained and evaluated; they can be reused
  and need no new GPU time.
- **Treatment:** a new corpus release that adds, from the already reviewed
  real photos, (a) re-framed copies in which one or two corners fall outside
  the image, keeping the true out-of-frame corner coordinates and their
  visibility flags, and (b) steeper perspective re-projections. Seeds
  20260905 and 20260906.

The variation has to be baked into the corpus. The trainer accepts only
`--runtime-augmentation none` or `quarter-turn-v1`, zeroes every Ultralytics
geometric and mosaic setting, and `CornerOrderDataset` refuses to build if
any of them is non-zero (`train_yolo_pose.py`, `yolo_corner_order.py`).
Adding a runtime augmentation would mean changing all three; a new release
needs no trainer change.

**Endpoints, declared before inference** (same form as September 13):
primary is the real tight rate on the 700-card benchmark averaged over two
seeds per arm, success at +3 percentage points with no drop in mean found
rate and at most +0.02 extras-plus-duplicates per real photo. Secondary:
tight rate on the cut-off and steep-angle slices, synthetic benchmark, and
recognition replay with the blend on the phone session.

**Cost ceiling:** two new L4 runs at the recorded $0.80/hour with a
four-hour timeout each is at most $6.40, plus one two-hour CPU audit
($0.06). Four runs (fresh controls) would be at most $12.80.

## What is needed

### From the repository owner

1. **A budget cap and a go-ahead** for the paid runs. Nothing is submitted
   without it; a failed training job is not retried automatically.
2. **Hugging Face access for whoever launches.** Submission uses
   `huggingface_hub` (`HfApi.run_job`) with the local token passed as the
   `HF_TOKEN` job secret. The token must be the `ahzs645` account with write
   access to both private repositories and permission to run Jobs. Either
   run the launch commands on the Mac where `hf auth whoami` already works,
   or grant the cloud session a credential for `huggingface.co`.
3. **Confirm the identity proposals** for the phone session
   ([file](../2026-11-10-query-blend/identity-proposals-phone-20260909.json),
   loaded with `card_identity_review.py --suggestions`). Without confirmed
   identities the recognition endpoint stays provisional.
4. **A new, independent capture session for evaluation** — strongly
   preferred, not strictly required. About 40–60 photos in Dev Mode aimed at
   the two weak slices: cards running off one or two edges of the frame, and
   cards held 15–40° off flat, across several sets and at least one other
   game, in more than one lighting condition. Export it, ingest it with
   `scripts/ingest_devmode_session.py`, and review the corners in the
   studio. It must stay out of training and checkpoint selection.
5. **A decision on German (foreign-language) cards:** correct when matched
   to the English row, or negatives that should abstain. It changes how the
   recognition endpoint is scored.

### Inputs that already exist

| Input | Where | Pin |
|---|---|---|
| Control training corpus | Hub dataset `ahzs645/tcger-scanner-images`, `geometry/releases/card-geometry-orientation-validation-v2` | corpus `aceff85c…0630162`, dataset revision `f73c4103…` |
| Real benchmark (600 photos / 700 cards) | same repo, `real-geometry-evaluation-v6-full-aliases-v2` | corpus `631cc7f9…` |
| Synthetic benchmark (1,000 photos / 3,651 cards) | same repo, `synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2` | corpus `fb3eca1a…` |
| Initialization checkpoint | Ultralytics release asset `yolo11s-pose.pt`, downloaded and hash-checked inside the job | SHA `1060bda4…c2ba` |
| September 13 run configs and job specs | Drive archive `Reference/TCGer-Geometry-Archive/2026-09-14`, under `.artifacts/card-geometry/augmentation-20260913/<run>/{config,job-spec}.json` | archive manifest |
| Trained control checkpoints | Hub model repo, paths in `../2026-09-14-reference-preservation/hf-current-models.json`; also in the Drive archive | SHA-256 per file |
| Frozen phone session and queue | `Reference/TCGer-Session-Reference/sessions/scan-session-20260909-231206`, `Reference/TCGer-Labeling/recognition-reviews/phone-20260909-identity-v1/queue.json` | queue `f92d584d…` |
| Live recognition pack | `assets.tcger.ahmadjalil.com/android/scan-assets/pokemon` | ONNX `cf29f497…`, index `bafded05…`, metadata `6d7e2721…` |

The reviewed real photos and labels the treatment corpus is derived from are
inside the control release, so no data that exists only on the Mac is
required to build it. FiftyOne label state is only needed if labels change.

### Work to do before submitting

1. **Write the corpus derivation** (new script under `tools/card-geometry/`):
   re-frame and re-project reviewed real training photos, carry corners,
   visibility and printed-top order through the transform, keep source
   grouping so derived images never cross the train/validation split, and
   emit a release with a manifest. Tests must cover corner order, visibility
   and the no-op transform equalling the source record.
2. **Preflight and publish the release:** `preflight.py --release-root …
   --report …`, then `publish_geometry_releases.py --release
   LOCAL=REMOTE --staging DIR`, which returns the dataset revision to pin.
3. **Write one config and job spec per run** from the archived September 13
   ones, changing only the corpus pin, run id and seed. The generic
   `launch_geometry_bakeoff.py` appears to hard-code a policy id
   (`training-minimums-v2`) that the v2 config schema does not list, which
   would explain why September 13 was submitted from hand-written job specs.
   This was read from the code, not exercised; confirm it with
   `run_card_geometry_hf_job.py --config <cfg> --action train --dry-run`
   before relying on either path.
4. **Freeze the protocol** (arms, seeds, endpoints, thresholds, cost
   ceiling) in a `training-protocol.json` beside this file and commit it, so
   the tooling tarball is cut from a clean tree at a pinned revision.
5. **Smoke test on CPU:** `hf_preflight_smoke.py --hub-repo
   ahzs645/tcger-universal-arcface --summary …` with the new release pins.
6. **Submit and collect** with the finite coordinator pattern of
   `continue_rotation_experiment.py` (asserts `l4x1`, a four-hour timeout,
   and no duplicate job labels), then run the common CPU audit. Its
   environment must install SciPy explicitly; the September 14 audit failed
   without it.
7. **Evaluate:** `select_geometry_checkpoint.py`, the 700-card and synthetic
   benchmarks through `evaluate_geometry_candidate.py`,
   `evaluate_reviewed_session.py` on the phone session, and
   `replay_instance_identities.py` with a `policy.json` whose
   `queryNormalization` is `grey-world-autocontrast-blend`.

### Guard rails that will stop a launch

- Config schema validation, and a candidate registry limited to
  `yolo11n-pose` and `yolo11s-pose` for this trainer.
- `--select-on-validation` requires exactly 50 epochs and an
  orientation-ready validation split.
- The preflight must report `readyFor: training` and match the pinned
  report; the cross-release leakage gate must pass.
- `tools/card-geometry` and `docs/scanner-system` must be committed and
  clean; container images must be digest-pinned; every job input is
  SHA-checked in the bootstrap.
- Both Hub repositories must be private.

## Reusable pieces from this session

Under [`../2026-11-10-query-blend/source/`](../2026-11-10-query-blend/source/):
`run_replay.py` (several checkpoints over the phone session, geometry plus
recognition), `e2e_avg.py` (model outlines with and without the blend),
`experiments.py` (query modes on hand-drawn outlines) and `old_sessions.py`
(the older labelled frames). They take a scratch directory and write nothing
into the repository.

## Limits of this document

The launch sequence, pins and guard rails were read from the code and the
earlier experiment records; none of the launch commands was run. The slice
table comes from one session and unverified identity proposals do not affect
it (it uses outlines only).
