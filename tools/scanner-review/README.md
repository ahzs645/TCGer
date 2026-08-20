# TCGer scanner review with FiftyOne OSS

This local workbench loads the 2,336-image iOS replay corpus, its 50 reviewed
scanner labels, COCO boxes and filled polygons, ordered card corners, and every
historical JSON report that contains `recognitionSamples`. Each report becomes a
FiftyOne evaluation run so models can be compared with confusion matrices and
individual failure views.

FiftyOne keeps only media paths and metadata in its local database. It does not
copy the images from Google Drive. The database lives in the ignored
`tools/scanner-review/.fiftyone/` directory; do not move it into `Reference` or
sync it through Google Drive.

## Install

The Mac's default Python 3.14 is newer than FiftyOne supports. Use the installed
Python 3.13 explicitly:

```sh
uv sync --project tools/scanner-review --python 3.13
```

Video review additionally requires FFmpeg, but the image replay corpus does not.

## Open the review workbench

From the TCGer repository root:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py load
```

The default reference root is:

```text
~/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference
```

Override it when needed:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py load \
  --reference-root "/path/to/Reference"
```

The command opens `http://localhost:5151` and stays running until interrupted.
Subsequent launches reuse the persistent dataset and attach any newly discovered
report files. Pass `--rebuild` only when the replay manifest itself changes.

## What to inspect

Useful fields in the App sidebar:

- `ground_truth_boxes`: source COCO card locations;
- `ground_truth_polygons`: source COCO card segmentation rendered as a filled
  overlay;
- `reference_corners`: four ordered points used for perspective rectification;
- `geometry_source`: `source_polygon`, `bbox_fallback`, or `unavailable`;
- `perspective_distortion`: ranks the most perspective-skewed reference cards;
- `label_category`, `label_card_id`, `label_card_name`, `label_notes`: editable
  human truth;
- `pred_<run>`: the accepted identity for a historical model run;
- `identified_card_name_<run>`: the Pokémon/card name returned by that run;
- `identified_card_id_<run>`: the exact printing ID returned by that run;
- `identified_confidence_<run>`: the recorded match confidence;
- `name_verdict_<run>`: name-level correctness, independently of exact printing;
- `decision_<run>`: accepted identity or `__declined__`, used by the Model
  Evaluation panel;
- `outcome_<run>`: `matched`, rejection reason, or `not_run`;
- `verdict_<run>`: `correct`, `wrong`, `missed`, `declined`,
  `false_positive`, `unscored`, or `not_run`.

Open the **Model Evaluation** panel to compare the `identity_<run>` evaluations.
The loader also creates saved views for manual labels, likely label issues,
perspective stress cases, filled segmentation, failures from every run, and
`Name right, printing wrong` cases where the Pokémon is recognized but the
specific set/printing is not.

Start with filters for:

1. `verdict_<run> = wrong` or `false_positive`;
2. two `pred_*` fields whose labels disagree;
3. `label_category = needsLabel`;
4. `verdict_<run> = missed` on `singleCard` samples.

Only 50 samples currently have recognition labels/model results. The other
2,286 images are still useful for inspecting detector boxes and selecting new
labeling candidates.

## Provenance and evaluation separation

The replay dataset records `provenance_kind`, `media_role`, `source_group_key`,
`augmentation_policy`, `augmentation_status`, `is_synthetic`, `is_derived`, and
`evaluation_role`. Roboflow archives that document augmentation are marked as
augmented **datasets**, but individual files remain
`unknown_member_of_augmented_export`: the exported filenames group siblings but
do not prove which member was the untouched original.

`source_group_split_leakage` identifies source families that cross train/valid/test
boundaries. Rectification comparisons are marked `derived_rectification` and
`visualization_only`, so they cannot be confused with independent test evidence.

Useful saved views include augmented versus unaugmented Roboflow sources,
geometry holdout samples, and source groups that cross splits.

## Performance graphs

Generate the model table, chart-ready JSON/CSV, five individual charts, and a
combined dashboard preview:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py report
```

The outputs are written to `tools/scanner-review/.fiftyone/previews/` by
default. The dashboard compares precision/recall/F1, Pokémon-name versus exact
printing recall (with 95% Wilson intervals), speed versus quality, scored
outcome composition, and the positive-card recognition stages for the best-F1
run. Every panel shows its denominator or cohort caveat.

After generating the report, open **Browse operations** in FiftyOne and run
**TCGer: show analysis dashboard**. Its dropdown contains the performance,
decision-quality, geometry, robustness, OCR/reference, and real-session
stability dashboards.

Additional outputs include `decision-quality-dashboard.png`,
`geometry-dashboard.png`, `robustness-dashboard.png`,
`ocr-reference-dashboard.png`, `session-stability-dashboard.png`, and the
chart-ready `diagnostic-data.json`. Missing geometry/OCR/capture-condition
instrumentation is rendered as an explicit availability panel rather than as a
misleading zero.

The recognition-stage panel deliberately stops short of showing segmentation,
corner, or rectification success. Those values become meaningful only after a
model exports geometry through `import-geometry`; canonical reference images,
synthetic/augmented images, and real-camera captures must be reported as
separate cohorts.

## Real camera sessions

Device recordings are loaded into a separate dataset rather than mixed with
Roboflow media:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  sessions --no-launch
```

Remove `--no-launch` to open the session dataset at `http://localhost:5153`.
Each frame family shares a `source_group_key`, while media is separated into:

- `real_camera_original` — benchmark candidate requiring human truth;
- `selected_scanner_crop` — derived scanner output;
- `scanner_attempt_crop` — derived per-attempt diagnostic crop.

Recorded `identified_card_name`, `identified_card_id`, confidence, alternatives,
strategy, scanner quad, and archived capture-quality measurements are visible.
Quality fields include sharpness, luma, clipped highlights, glare, card fill,
angle deviation, and the same prioritized guidance issue shown by the iOS app.
For already rectified attempt crops, the condition tag intentionally uses only
blur/lighting/glare; framing and angle are meaningful only on the framed capture.
Saved views isolate quality failures and glare/foil-risk captures. They are
predictions and diagnostic conditions, not truth. Label the real-camera
originals before enabling benchmark scoring. Re-running the command preserves
App edits; pass `--rebuild` only when intentionally replacing the local session
dataset.

## Shutter benchmark: accuracy and efficiency together

Build the dedicated one-row-per-shutter-capture dataset:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  shutter --no-launch
```

Remove `--no-launch` to open it at `http://localhost:5154`. The importer keeps
the untouched full-resolution photo as the sample media when it was archived,
then links the guide/scanner input and accepted perspective-normalized attempt
through `scanner_input_filepath` and `rectified_filepath`. Derived attempts are
evidence for the shutter event, not extra benchmark rows.

The dataset includes:

- scanner polygon, predicted card name/printing, confidence, top candidates,
  title/footer OCR evidence, and the accepted rectified-card path;
- assisted suggestions kept separate from human truth: exact-printing prefills,
  Pokémon-name-only hints, candidate-only rows that require content confirmation,
  and conservative likely-no-card hints;
- imported iOS manual-correction truth plus editable `label_*` fields;
- end-to-end `elapsed_ms`, latency bucket, attempt count, candidate margin,
  capture quality, and separate single-card versus binder-page shutter tags;
- saved queues for missing labels, wrong/missed decisions, 1-second and
  2-second latency breaches, OCR use, rectified previews, and many-attempt
  hotspots.

The importer freezes an outcome-independent queue of 200 full-resolution
originals using a deterministic SHA-256 ordering. Use **Benchmark 200 — needs
labels** as the manual-labelling queue. The 28 truth records already present in
the archive were created specifically when a user corrected a failure, so they
remain a separate correction-only hard-case cohort and are excluded from the
headline accuracy denominator.

After installing the local plugin, use **TCGer: shutter accuracy and speed** to
see label coverage, exact decision accuracy, p50/p90/p95 latency, and how many
correct results meet a chosen responsiveness target. Select one capture and run
**TCGer: show selected shutter evidence** to display the original and rectified
card together with candidates, OCR, and timing. Use **TCGer: label/correct
shutter capture** to confirm the prefilled suggestion or change it to a different
printing, Pokémon card with unknown printing, non-Pokémon card, card back,
multiple cards, or no card. Suggestions never count as benchmark truth until a
person confirms them. App edits remain in the local FiftyOne database until
explicitly exported.

Latency is the recorded iOS end-to-end photo-capture/coordinator time. This is
the user-visible efficiency measure and should lead model-only milliseconds.
Per-stage detector, rectification, embedding, ANN, and OCR timings are not
present in historical recordings; adding them to future iOS evidence remains a
separate instrumentation improvement.

The session-stability dashboard includes scanner outcomes by capture condition.
To validate a revised session schema without replacing a labeled local dataset,
load it under a new name and select that dataset when producing the report:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  sessions --dataset-name tcger-scanner-real-sessions-quality-v2 --no-launch
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  report --session-dataset-name tcger-scanner-real-sessions-quality-v2
```

## Rectified-card previews

Build a second 50-sample dataset that displays the filled source polygon and
corner order beside the perspective-corrected card:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  preview --no-launch
```

Remove `--no-launch` to open it at `http://localhost:5152`. Preview images and
the PNG/CSV/JSON performance summaries are written below the ignored local
`.fiftyone/previews` directory. The preview captions deliberately say
**oracle geometry**: current historical reports did not save their own masks,
corners, or rectified images, so these previews use source COCO polygons (or an
explicitly marked box fallback).

## Brain: duplicates and unusual images

This computes compact, deterministic image embeddings without downloading a
model, then registers a FiftyOne similarity index and uniqueness field. It also
adds SHA-256 exact-duplicate groups:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py brain
```

The compact embedding is intended for near-duplicate and visual-outlier review,
not semantic card recognition. In the App, the official `@voxel51/brain` plugin
can sort by similarity and open the most unusual samples.

## Import a detector/segmenter geometry run

Historical recognition reports cannot be given mask/corner scores because they
do not contain geometry outputs. New models can export the schema shown in
`geometry-run.example.json`, using either normalized or pixel coordinates:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  import-geometry --input /path/to/model-geometry.json
```

The importer creates filled `geometry_pred_<model>` polygons,
`corners_pred_<model>` keypoints, per-sample mask IoU, normalized corner error,
a geometry verdict, a saved failure view, and a `geometry_<model>` FiftyOne
evaluation run. The default pass threshold is mask IoU >= 0.80 and normalized
corner error <= 0.03.

## Installed plugins and TCGer operators

The setup uses the official `@voxel51/evaluation`, `@voxel51/brain`,
`@voxel51/dashboard`, `@voxel51/io`, `@voxel51/annotation`, and `@voxel51/runs`
plugins. Install the repository-local operators with:

```sh
uv run --project tools/scanner-review fiftyone plugins create \
  @tcger/scanner-review --overwrite --from-files \
  tools/scanner-review/plugin/fiftyone.yml \
  tools/scanner-review/plugin/__init__.py
```

In the App, press the backtick key or open **Browse operations**, then search
for `TCGer`. The custom operators compare any two runs, open geometry/data-quality
queues, and apply review decisions to selected samples.

## Edit and export labels

In an expanded sample, open **Annotate** and create an Annotation Schema that
includes these primitive fields:

- `label_category`: dropdown with `singleCard`, `cardBack`, `multiCard`,
  `foreignLanguage`, `outsideIndex`, `nonPokemon`, `noCard`, `needsLabel`, and
  `unlabeled`;
- `label_card_id`: text;
- `label_card_name`: text;
- `label_notes`: text.

FiftyOne auto-saves edits into its local database. It does **not** update the
checked-in/source `scanner-labels.json` automatically. Export an explicit review
candidate instead:

```sh
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  export-labels \
  --output "/path/to/Reference/TCGer-Scanner-Evaluation/labels/replay-labels.review.json"
```

The exporter refuses to overwrite an existing file unless `--overwrite` is
passed. Review the diff against the canonical `scanner-labels.json` before
promoting it.

## Non-interactive verification

```sh
python3.13 -m unittest tools/scanner-review/test_review.py
uv run --project tools/scanner-review python tools/scanner-review/review.py \
  load --no-launch
```
