# Archive corner labeling session

Purpose: add human four-corner supervision to the box-only multi-card **training** frames (binder-like grids first), the one input no run so far has had. Labels go to an append-only journal and export as a `card-geometry-archive-corner-labels` v1 sidecar; nothing here touches the frozen evaluation, the published corpus or the canonical archives.

## Start

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/archive_corner_label_server.py \
  --queue .artifacts/card-geometry/successor-prep/archive-corner-label-queue-padding-fixed.json \
  --release .artifacts/card-geometry/releases/real-geometry-successor-padding-fixed-v1 \
  --journal .artifacts/card-geometry/archive-corner-labels/journal-padding-fixed.jsonl --port 8768
```

Open <http://127.0.0.1:8768>. The queue is bound to the padding-corrected successor candidate (corpus hash `d3e76131…`) and the original canonical corpus hash `aaf98c7f…`; the server verifies every displayed image hash and refuses a journal from a different queue. The `archive-corner-labeler` entry in `.claude/launch.json` starts the same server. The original release, queue and journal remain available as the pre-correction history.

## How to label

Frames are ordered grid first (90 frames), then scattered (108), then other (61). The corrected queue contains 2,038 targets across the same 259 frames, after removing 32 reflected-padding targets. Keep **Incomplete only** checked and the layout filter on **Grid** for the first session.

**Photos** defaults to **Color only**, so human review prioritizes the 214 color photos. Choose **Grayscale only** to inspect the 45 grayscale source photos or **Color + grayscale** for the full queue; this preference persists in the browser. Grayscale entries carry **B&W** in their names. The filter changes navigation only: it never deletes photos, renumbers frames, or approves labels. Next and Previous follow the selected photo type. Color classification reads decoded pixels with Pillow; if Pillow is unavailable, unknown photos stay visible in the color view.

Frame numbers are stable positions in that full queue: **F19 / C12** means frame 19, card 12. **Copy ref** copies those numbers plus the full record ID and original annotation index. Filtering and saving do not renumber frames. **Previous** can revisit completed frames even with Incomplete only checked; **Next** advances to the next incomplete frame. The selected frame and card are remembered on reload in this browser.

Card numbers in repaired frames also retain their original identities: a removed C1 leaves C2 as the first displayed card. Gaps are intentional, and the full reference still identifies the original annotation exactly.

Every queued card starts as a dashed amber outline seeded from its box, with handles you can grab directly. Moving corners, rotating, or changing visibility or orientation creates a draft. In manual mode, **C (Confirm & next)** makes an outline a completed human label, after you have checked all four corners and the rectified preview. Editing a confirmed card makes it a draft again.

For quick visual review, enable **Approve on Save / Next** in the navigation bar. **Save frame**, **Next**, **Save & next**, or **Enter** approve and save every unskipped outline on the current page, including boxes you did not adjust. **N** approves and saves just the selected card plus already confirmed labels, then selects the next pending card. Skipped targets remain skipped, and invalid or unfinished outlines prevent saving and advancing. This mode is remembered in this browser; enabling it alone does not approve anything. Turn it off to require individual **C** confirmation. With the mode off, **Save frame** stores confirmed labels, skips, and a separate copy of every pending draft.

1. **Drag any handle** onto the real card corner. Scroll to zoom around the cursor, drag empty space to pan, double-click or **0** to reset. Keys **1–4** pick a corner of the selected card, arrows nudge by one pixel (Shift for five).
2. Check all four corners and the rectified preview, then press **C (Confirm & next)**. A box that already fits can be confirmed without moving its handles.
3. Orientation matters: corner 1 must be the *printed* top-left. Set **Printed top points** once per page (up, right, down, left) and every untouched box is seeded in that order; press **R** to rotate one card's corner order a quarter turn. The strip of rectified thumbnails under the photo shows every card as the label would crop it, so a wrong direction shows up as a sideways or upside-down thumbnail. For a skewed card press **D** and click **TL → TR → BR → BL** of the printed card. **B** resets a card to its box. Untick **Orientation certain** if you cannot tell which corner is the printed top-left.
4. **O** marks the selected corner hidden by another card. Corners beyond the photo edge are marked outsideFrame automatically.
5. **S** opens the skip reasons for a card you cannot label honestly (mostly hidden, cut off, not a card, reflected padding, unsure). Use **Reflected padding** for artificial card fragments copied into an image border; do not infer missing corners for them. Skipped cards keep their box-only supervision: this excludes human corner labels, not the original detection targets.
6. With **Approve on Save / Next** off, **N** jumps to the next unconfirmed card; **Enter** or **Save & next** saves confirmed labels and skips. Unconfirmed edits are saved separately on the local server and also retained in this browser. A page with unconfirmed cards stays incomplete and shows again. With the mode on, Save or advancing approves the outlines as described above. A frame with drafts is excluded from the training export until confirmation. The server keeps its previous confirmed geometry underneath the draft and rejects requests that silently omit existing cards.

Green outlines with a ✓ are confirmed, amber ones are pending, grey ones are skipped, pink is selected. The **? Help** button in the header repeats the key list. Enter your name once as reviewer; it is stored with every save, together with the page's printed-top direction. Undo restores the corners, selected card and corner, and default direction together. Existing saved labels are retained; they require confirmation again if you edit them.

Bot-reviewed outlines display **confirmed · bot** and save with `cornerSource: detector`. They remain machine labels through export/import and are excluded from human corner metrics. Press **C** to confirm a bot outline as human after reviewing it; Approve on Save / Next also records your explicit approval. Saving with this mode off retains existing bot provenance.

Use **Help → Back up browser drafts** to copy locally retained drafts to `browser-draft-backups` beside the journal without changing labels. This is also available at `/draft-recovery.html`, including for drafts created by older labeler versions. Backups include the queue/image release pins and each original draft revision; recovery must preserve newer server reviews.

## Rules the server enforces

Every outline must be a convex, non-crossing quad in clockwise **printed TL → TR → BR → BL** order whose bounding box overlaps its seed box at IoU ≥ 0.5, so a click on the wrong card is rejected rather than silently stored. Reversed winding would mirror the crop and is rejected by the labeler, server, and sidecar importer. Quarter-turn rotations preserve winding; **R** cannot repair a reversed outline, so redraw it with **D**. A corner outside the image must be marked outsideFrame. Saves are revisions with reviewer, timestamp, queue, corpus and image hashes; a stale tab cannot overwrite a newer save.

## Reflected border examples in the original archive

The 16-target `pk-detect.v3i.coco` frame with record ID `coco-005ff234dd856fd0d5d2bfb099409f3b4e0100dcdaa0bd9cec566eacf205d9de` contains reflected image padding at the top and bottom. The reflection is present in the source JPEG, before preview rectification. Cards **2, 4, 9, and 13** (annotation indices **1, 3, 8, and 12**) are artificial border fragments and should be skipped as **Reflected padding**. The interior cards can still be reviewed normally. Removing artificial detection boxes from a future corpus is a separate dataset correction; the skip action does not perform it.

The 12-target **F19** (`coco-185501f255bbbc1beae666623117953c2f28e25df9528a874a61ddb09f5b4b4a`) has 80-pixel reflected strips at its left and right borders. **C1 and C12** (annotation indices **0 and 11**) are skipped as reflected padding; its ten interior labels remain intact.

The corrected release replaces these strips with constant gray padding and removes their false detection targets. All 48 `pk-detect.v3i.coco` images had two verified reflected borders; 32 false targets were removed. F28 (`coco-28de6c0fea09b78d7e6ea845ffb6f699a1d9166fe642d9b5d4faec44a169033c`) now has six real cards, C2–C7, after removing reflected C1. Image dimensions and interior decoded pixels are unchanged. Existing interior labels retain their exact coordinates. See [PADDING-REPAIR.md](PADDING-REPAIR.md) for the correction and migration commands.

## After labeling

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/archive_corner_label_server.py \
  --queue .artifacts/card-geometry/successor-prep/archive-corner-label-queue-padding-fixed.json \
  --release .artifacts/card-geometry/releases/real-geometry-successor-padding-fixed-v1 \
  --journal .artifacts/card-geometry/archive-corner-labels/journal-padding-fixed.jsonl \
  --export .artifacts/card-geometry/archive-corner-labels/archive-corner-labels.json
```

The export contains only complete frames and only labeled targets. `plan_real_archive_release.py --archive-corner-labels <export>` (or the importer directly) attaches them to the exact annotation index, preserving `cornerSource` (human or detector), orientation and visibility. Legacy labels without provenance default to human. Bot counts are reported separately. A successor corpus then follows the usual assignment, near-duplicate, combine, preflight and freeze steps under a declared follow-up experiment. `test_archive_corner_label_server.py` proves human and bot journal → export → importer round trips.

For a repaired image, export uses its original canonical image hash because the normalized coordinate system is unchanged; the journal remains pinned to the corrected displayed image hash. Apply the padding repair to any newly rebuilt release before using it for training, so removed reflected targets and pixels cannot reappear from the raw archive.


## Card layers

In **Card layers**, select the current card, choose **Above** or **Below**, choose another card, and press **Set layer**. Cards do not need to overlap to record an order. The original F/C identifiers and full four-corner outlines are preserved. Only explicitly entered relationships and their transitive consequences are known; other pairs remain unspecified. Contradictory cycles are rejected. Restore a skipped card before including it in a layer relationship.

Layer changes participate in Undo, browser drafts, server saves, and the existing revision checks. Press **Save frame** or **Save & next** to save them. Each relationship has a remove button; skipping a related card removes its direct relationships, and Undo restores both. Older clients that omit the new metadata retain the saved layers instead of erasing them.

**Rectified card · all overlaps** checks every pair of unskipped card outlines in the photo. The selected card has one combined preview and a list of every card whose outline intersects it. Each row shows a rectified thumbnail, the known order (including transitive relationships), and **Above ↑ / Below ↓** buttons that place the selected card relative to that row's card. Unknown orders stay flagged and unmasked until assigned. The whole-photo count and **Next unknown overlap →** help find remaining relationships, including overlaps elsewhere in the photo. Checks update as outlines change; merely touching edges do not count as overlap.

**Compare any card** retains the optional pair comparison, including cards that do not overlap. Choose another card and use **Bring forward ↑** or **Send backward ↓** to change their relative order. Every preview combines all assigned covering cards regardless of which comparison is selected. These controls never infer depth from card numbers or move the card through an arbitrary global stack.

Choose **Masked** to replace covered areas with checkerboard, **Layer colors** to tint covered areas pink and visible areas above another card green, or **Original** to see the original crop. The view preference is remembered without changing annotations. Previews use all known layer relationships, including transitive ones, while keeping the original four corners. Nonintersecting cards produce no clipping, and hidden artwork is never reconstructed. **Mark covered corners hidden** offers an explicit visibility correction for corners inside known covering outlines; layer edits alone do not overwrite manually recorded visibility.

The export's optional frame-level `occlusionRelations` contains `{above, below}` annotation-index pairs. The importer validates those references and cycles, then retains explicit relationships as instance-level `cardsAbove` IDs. Legacy `occlusionOrder` is made consistent using a stable topological order; ties between unrelated cards are bookkeeping, not reviewed order. Preview clipping is a labeling aid, not an assertion of a complete visible segmentation mask. The current pose-training path continues to use confirmed corners and visibility; adding layers does not by itself train a depth or segmentation model.
