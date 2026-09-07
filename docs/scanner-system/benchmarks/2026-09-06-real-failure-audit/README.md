# Real-image failure audit — 2026-09-06

Purpose: distinguish post-framework detection misses, bad corner geometry, shared decoder rejection, crop quality and recognition labeling limits before choosing further training. This is a post-benchmark diagnostic; the original reports and thresholds remain frozen.

The input manifest pins the original repaired YOLOX epoch-50 checkpoint and original round-two YOLO11s best checkpoint. The diagnostic captures native boxes and raw quads before shared quad filtering, then records accepted quads and rejection reasons. Native boxes are already after each framework's score filtering and NMS; their absence does not prove the network produced no earlier proposals.

Selection was recorded before execution: all 600 real evaluation images receive the frozen inference path only; 88 training-corpus validation records are selected deterministically, taking up to eight per source-kind/archive/scene/known-corner group. Only those validation records receive the YOLO11s RGB-array versus BGR-array intervention. The intervention must also reproduce PIL-input predictions. No training or held-out parameter sweep is performed.

The declaration and exact commands are in `input-publication.json` and the candidate command files. Both bounded inference jobs completed; the completed automated and visual findings are in [ANALYSIS.md](ANALYSIS.md).

## Human comparison interface

The two diagnostic jobs completed. Each model's accepted output is **exactly equal** to its existing frozen predictions on all 600 evaluation records (`result-verification.json`). These are traces of the original results, not new benchmark scores. The YOLO11s validation color intervention is recorded in the raw report but is deliberately not mixed into the baseline comparison interface.

Start locally from the repository root:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/failure_review_server.py
```

Open <http://127.0.0.1:8767>. The viewer includes 600 real evaluation images, 88 fixed validation images and 24 deterministic real training-label examples. Binder pages appear first, followed by duel fields, handheld and steep scenes. The training examples have existing labels but no model inference. Enable **Show existing labels** to inspect their masks, boxes and trusted corners.

Compare YOLOX and YOLO11s side by side. Select final outlines, raw outlines or native detection boxes. Select a detection to inspect its crop; **Edit this outline** copies that outline into the correction editor. Alternatively, **Draw four corners** takes TL → TR → BR → BL clicks. Drag or nudge the selected corner, inspect the zoom and perspective preview, and use Undo if needed. Choose the better result (or neither / uncertain), flag problems, enter your reviewer name and save. Four-corner corrections are optional and may cover only the cards being discussed; an empty correction list is not a negative image label.

Reviews are stored in `.artifacts/card-geometry/human-failure-review/reviews.jsonl`. Each save appends a revision containing the reviewer, timestamp, record/image hashes and pinned report/checkpoint hashes. Export downloads the latest revisions. Conflicting edits in another tab fail instead of overwriting a review. Unsaved drafts are kept in this browser and can be discarded explicitly. The server verifies image bytes before serving the review set and binds only to localhost.

These are proposed review annotations, not direct release edits. In particular, evaluation/Dev Mode records retain their evaluation scope and cannot become training data through this interface. The assistant completed the automated comparison and visual audit in [ANALYSIS.md](ANALYSIS.md). Only specific unresolved labels need further review before a successor corpus is frozen; no new training has been launched.

Recognition text is the saved **frame** result, not a new run on the selected crop. Only 11 of the 57 replay frames have verified identities: YOLOX identified 2, abstained on 9; YOLO11s identified 4, abstained on 6 and misidentified 1. Forty-two frames have unknown identities; the other four test specific forbidden accepts. The aggregate 44 “unknown” outcomes must not be counted as 44 recognition failures.

Coverage clarification: 537 real training images contain multiple annotations, not necessarily multiple physical cards. The visual sample includes genuine multi-card photos with box-only labels as well as nested slab/card or partial-card annotations requiring review. Of 7,030 real training instances, 2,402 have trusted corner supervision (34.2%). Scene metadata alone does not establish visual scene coverage.

Validation: five Python tests cover durable append-only saves, hash/scope retention, stale updates, malformed corners and HTTP origin checks. Seven existing corner-math tests pass. Browser smoke testing on a separate test journal verified model-outline copying, keyboard nudging, four-click drawing, saving and reload persistence. Human review counts remain untouched by these tests.
