# TCGer scanner review with FiftyOne OSS

This local workbench loads the 2,336-image iOS replay corpus, its 50 reviewed
scanner labels, COCO card boxes, and every historical JSON report that contains
`recognitionSamples`. Each report becomes its own `pred_*` field so runs can be
filtered and compared on the same images.

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
- `label_category`, `label_card_id`, `label_card_name`, `label_notes`: editable
  human truth;
- `pred_<run>`: the accepted identity for a historical model run;
- `outcome_<run>`: `matched`, rejection reason, or `not_run`;
- `verdict_<run>`: `correct`, `wrong`, `missed`, `declined`,
  `false_positive`, `unscored`, or `not_run`.

Start with filters for:

1. `verdict_<run> = wrong` or `false_positive`;
2. two `pred_*` fields whose labels disagree;
3. `label_category = needsLabel`;
4. `verdict_<run> = missed` on `singleCard` samples.

Only 50 samples currently have recognition labels/model results. The other
2,286 images are still useful for inspecting detector boxes and selecting new
labeling candidates.

## Edit and export labels

In an expanded sample, open **Annotate** and create an Annotation Schema that
includes these primitive fields:

- `label_category`: dropdown with `singleCard`, `cardBack`, `multiCard`,
  `foreignLanguage`, `outsideIndex`, `needsLabel`, and `unlabeled`;
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
