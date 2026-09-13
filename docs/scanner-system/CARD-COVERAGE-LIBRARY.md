# Card angle and position library

Implemented September 11, 2026. Open <http://127.0.0.1:8775/?sourceKind=real&quality=reviewed>.

The library measures existing outlines and shows the distribution of card appearances. It is read-only with respect to labels, benchmarks, training releases and production models. The **Refresh from saved labels** button rebuilds the inventory; it does not approve cards or change dataset splits.

## What it measures

- **Border-axis angle:** the direction of the longer projected pair of opposite edges, modulo 180°, in 15° bins. Every valid outline contributes, even when printed orientation is unknown. Source width and height are applied before measuring. Strong perspective can make the physically shorter pair appear longer; this is an image-shape measurement.
- **Printed orientation:** upright, clockwise sideways, upside-down or counterclockwise sideways, only when `orientationKnown` is explicitly true. The saved printed TL→TR edge supplies the signed clockwise angle. A rectangle by itself cannot distinguish upright from upside-down.
- **Perspective skew:** maximum deviation of any corner angle from 90°. This is not calibrated 3D camera tilt. Mild <10°, moderate <25°, strong <45°, extreme ≥45°.
- **Position:** projected card centre in a 3×3 photo grid, with a separate outside-centre category. This is image location, not geographic location.
- **Size:** full outlined area divided by image area: tiny <2%, small <10%, medium <35%, large ≥35%.
- **Photo edges:** outside the frame, within 5% of an edge, or interior. The card detail also reports the fraction of its outline inside the photo.
- **Overlap:** every pair of valid outlines is checked. Intersection must exceed 1% of the smaller outline's area. This neither infers stacking order nor calls an unmeasured card separate.

Click charts or use filters, then open a thumbnail for the original photo, its saved outline and measurements. The gold corner marks printed TL only when orientation is known. Filters survive reload. Export downloads the inventory as JSON. Source annotation IDs and original studio links are retained where available.

## September 11 inventory

| Scope | Photos with card instances | Card appearances | Valid outlines | Printed top known |
|---|---:|---:|---:|---:|
| All current sources | 17,419 | 48,609 | 45,978 | 41,733 |
| Real photos | 6,419 | 8,437 | 5,806 | 1,561 |
| Human-reviewed real outlines | 742 | 1,316 | 1,316 | 706 |
| Frozen September 9 phone session | 75 | 106 | 106 | 106 |

There are 17,954 exact-unique images including 535 session photos without saved card instances. Synthetic examples contribute 40,172 card appearances and are independently filterable. These are appearances, **not unique physical cards**.

Human-reviewed real outlines include 497 upright, 152 clockwise sideways, 39 counterclockwise sideways, 18 upside-down and 610 with unknown printed top. Their geometric border angles remain measurable. Of those 1,316 appearances, 788 are centred in the middle grid cell, 67 have strong/extreme perspective skew, and 76 have measured outline overlap.

The frozen 75-photo session has 95 upright and 11 upside-down cards, with no sideways examples. That session cannot establish sideways-card performance. Do not change its split or use it for checkpoint selection to remedy that gap.

## Sources and precedence

The default inventory combines:

1. `card-geometry-orientation-validation-v2`: current training/validation release.
2. `real-geometry-evaluation-v6-full-aliases-v2`: frozen real evaluation.
3. `synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2`: frozen synthetic evaluation.
4. Latest saved archive and reference journals, using their exact pinned queues. The padding-corrected archive queue is `successor-prep/archive-corner-label-queue-padding-fixed.json`, not the similarly named older first-build queue.
5. Native `tcger-sessions` FiftyOne backup export plus the current Drive session journal.

Exact source-image SHA-256 values collapse repeated release/export entries. Current manual geometry takes precedence while preserving original collection/split memberships and record aliases. Conflicting train/test memberships are exposed as `mixed`, never silently resolved. Colour/grayscale variants and similar photos remain separate; older releases and derived prediction crops are not counted as additional library photos.

Drafts, skipped targets, unknown coordinates and invalid quads remain unmeasured. Frozen original reference outlines are not overwritten by the reviewed overlay. Release record checksums, journal/queue/image bindings and end-of-build source checksums prevent a mixed or changed input snapshot from replacing the previous inventory. Thumbnails validate the indexed image hash before first rendering.

## Run and configure

From the repository root:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/card_library.py --build
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/card_library.py --port 8775
```

Python needs Pillow; Node runs the existing editor's geometry measurements. The source implementation is `tools/card-geometry/card_library.py`, `card_library_geometry.cjs` and `card-library.html`.

Configuration and generated inventory live in `.artifacts/card-geometry/coverage-library/`:

- `config.json`: configurable release folders, archive/reference queues and journals, native session export folder and current session journal path.
- `library.json`: measured cards, image provenance and input hashes.
- `summary.json`: full inventory counts.
- `verification.json`: verified build receipt and reviewed-real coverage.
- `cache/`: disposable thumbnails.

Use `--config` and `--state` for a different configuration or output folder. Adding a reviewed session requires its native session export and saved journal; then press Refresh. If the FiftyOne database is stopped, the inventory uses its last verified export plus current journal entries for those exported photos. It does not scan unrelated photo folders and assume they are labeled.

The existing automatic backup service watches this artifact directory, studio source and scanner documentation. Inventory/configuration JSON and code therefore copy into the configured Google Drive Reference backup folder; thumbnail caches are excluded. A successful copy verifies the local Drive-folder file, not the provider's remote upload completion. Change the backup destination at <http://127.0.0.1:8774/>.

## Other models to compare

Keep the current reviewed YOLO11s baseline: it found 96/106 session cards with 40 tight borders; the newer validation-selected run found 86 with 33 tight borders. See the September 10 orientation-validation benchmark report.

| Candidate | Role and rationale | What still needs verification |
|---|---|---|
| YOLO11m-pose | The most direct larger-capacity comparison with the existing four-corner pipeline | Same data, corner-loss semantics, validation selection and frozen evaluation; more capacity does not guarantee improvement |
| YOLO26s-pose | A newer pose architecture for a controlled second comparison | Adapt and smoke-test the custom four-corner loss/head and exports before paying for training |
| SAM 3.1 | Prompted segmentation to propose masks and potentially reduce labeling effort | Real card detection, sleeve/border precision, occlusion behavior and usable quad proposals; not printed orientation or hidden full corners |

The older YOLOX custom pose and FastViT-T8 bakeoff runs had significant detection/border deficiencies. They were trained on an earlier corpus, so their results are not a comparison against today's reviewed dataset. A larger YOLO comparison is the lower-integration-cost next training experiment; the current SAM pilot is inference only.

Official references checked September 11: [YOLO11 models](https://docs.ultralytics.com/models/yolo11/), [YOLO26 models](https://docs.ultralytics.com/models/yolo26/), [SAM 3.1 model card](https://huggingface.co/facebook/sam3.1), [SAM 3.1 release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md). The ranking above is an engineering recommendation, not an established card benchmark result.

## SAM 3.1 exploratory pilot

The user granted access through their existing Hugging Face account. The pilot uses 12 photos with 51 saved full outlines: seven recent regression photos plus sideways, upside-down, strong-skew, overlapping and cut-off examples selected from reviewed real geometry. Two fixed prompts, `trading card` and `playing card`, use a 0.50 confidence threshold. Images are resized proportionally to at most 1600 pixels on the longest side for this pilot.

Inputs and results are under the existing private `ahzs645/tcger-universal-arcface` repository. Local receipts are in `.artifacts/card-geometry/sam31-trial/`. The checkpoint revision, checkpoint SHA, official source commit, container digest, input image hashes and output hashes are pinned. The image detector weights must load strictly; missing parameters cause failure.

This tests the detector component from the SAM 3.1 checkpoint, not video tracking. SAM 3.1's main advertised improvements concern multi-object video tracking. No model is trained, no reviewed corner is overwritten, and the pilot cannot promote a scanner model. Masks are saved with overlays; four-corner drafts are emitted only for contours that simplify naturally to a convex quadrilateral, always with unknown printed orientation.

Agreement metrics compare visible predictions with the saved full-outline polygons. For occluded cards those polygons are **not visible-mask ground truth**, so that number must not be presented as segmentation accuracy. Unmatched masks may include genuine, unreviewed background cards and are not automatically false positives. This deliberately selected, mixed-split pilot is exploratory, not a representative benchmark.

Two launch-only failures occurred before model loading: the CLI consumed `-lc` as a CLI option, then the official PyTorch 2.10 container required explicit permission to install dependencies into its externally managed Python. Structured command arguments and `PIP_BREAK_SYSTEM_PACKAGES=1` inside the disposable job container resolved these issues. No system-package override was applied on the Mac. The active receipt is `job.json`; failed receipts/logs are retained. The first model-loading attempt then correctly rejected the ordinary SAM 3 image architecture: SAM 3.1 needs the official TriHead detector construction. The adapter now uses that construction and loads every detector weight strictly. The final L4 timeout was reduced to 25 minutes after those setup attempts, keeping the combined trial near a US$0.40 maximum compute allowance at the observed US$0.80/hour rate. Results and final status are recorded separately after completion.

The pilot is complete: 47/51 saved outlines have a matching mask across both fixed prompts; the four bagged sideways cards remain missed. [Full results and limitations](benchmarks/2026-09-11-sam31-pilot/README.md) include the strict weight-loading verification and per-photo counts. [Open the completed gallery](http://127.0.0.1:8773/follow-up/sam31-pilot/?photo=P06).
