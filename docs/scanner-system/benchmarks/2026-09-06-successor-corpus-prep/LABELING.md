# Archive corner labeling session

Purpose: add human four-corner supervision to the box-only multi-card **training** frames (binder-like grids first), the one input no run so far has had. Labels go to an append-only journal and export as a `card-geometry-archive-corner-labels` v1 sidecar; nothing here touches the frozen evaluation, the published corpus or the canonical archives.

## Start

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/archive_corner_label_server.py \
  --queue .artifacts/card-geometry/successor-prep/archive-corner-label-queue.json \
  --release .artifacts/card-geometry/releases/real-geometry-successor-candidate-v1 \
  --journal .artifacts/card-geometry/archive-corner-labels/journal.jsonl --port 8768
```

Open <http://127.0.0.1:8768>. The queue is bound to the successor real candidate (corpus hash `8c709255…`) and the canonical corpus hash `aaf98c7f…`; the server verifies every image hash before serving and refuses a journal from a different queue. The `archive-corner-labeler` entry in `.claude/launch.json` starts the same server.

## How to label

Frames are ordered grid first (90 frames, 778 cards), then scattered (108 / 1,061), then other (61 / 231). Keep **Incomplete only** checked and the layout filter on **Grid** for the first session.

1. Select a card: click inside its amber box, use the card list on the right, or press **N** for the next unlabeled one.
2. Give it corners either way:
   - **D**, then click **TL → TR → BR → BL** of the *printed* card, so a rotated or upside-down card starts at its printed top-left; or
   - **B** to seed the box, then drag the handles onto the real corners. Axis-aligned binder pockets are usually one B plus four small drags.
3. Keys **1–4** select a corner, arrows nudge by one pixel (Shift for five), **O** marks the selected corner hidden by another card. Corners beyond the photo edge are marked outsideFrame automatically.
4. **S** skips a card you cannot label honestly (mostly hidden, cut off, not a card, unsure). Skipped cards keep their box-only supervision.
5. **Enter** or **Save & next** when every card on the page is labeled or skipped. A page saved with pending cards is kept as incomplete and shows again.

Enter your name once as reviewer; it is stored with every save. Unsaved edits are kept as a browser draft per frame.

## Rules the server enforces

Every outline must be a convex, non-crossing quad whose bounding box overlaps its seed box at IoU ≥ 0.5, so a click on the wrong card is rejected rather than silently stored. A corner outside the image must be marked outsideFrame. Saves are revisions with reviewer, timestamp, queue, corpus and image hashes; a stale tab cannot overwrite a newer save.

## After labeling

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/archive_corner_label_server.py \
  --queue .artifacts/card-geometry/successor-prep/archive-corner-label-queue.json \
  --release .artifacts/card-geometry/releases/real-geometry-successor-candidate-v1 \
  --journal .artifacts/card-geometry/archive-corner-labels/journal.jsonl \
  --export .artifacts/card-geometry/archive-corner-labels/archive-corner-labels.json
```

The export contains only complete frames and only labeled targets. `plan_real_archive_release.py --archive-corner-labels <export>` (or the importer directly) attaches them as `cornerSource: human` to the exact annotation index, keeping the labeler's orientation flag and per-corner visibility; a successor corpus then follows the usual assignment, near-duplicate, combine, preflight and freeze steps under a declared follow-up experiment. `test_archive_corner_label_server.py` proves the journal → export → importer round trip.
