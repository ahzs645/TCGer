# Corner-order follow-up diagnosis

The follow-up found useful later weights that automatic checkpoint selection missed. The final checkpoint improves tight outlines on the reviewed cards from **475 to 508**, but loses more cards on the separate human capture set. Four crop orientations recover recognition, with more wrong identifications. Keep the previous model for now; retain the final checkpoint for further investigation.

The automatically selected epoch-20 model has two distinct problems: it frequently chooses a different first corner, and some predicted outlines form a diamond through the card rather than following its border. Trying all four crop orientations recovers some recognition, but cannot repair displaced corners. The first three sections below diagnose that selected checkpoint; the final-checkpoint section measures the later weights separately.

## Separate corner identity from outline accuracy

On the **same 116 human-labeled cards matched by both models** in the original real benchmark, the previous model starts at the printed top-left on 114 cards; the candidate does so on 72. The candidate needs a quarter-turn permutation on 43 of these cards and a half-turn on one. These are comparisons on matched cards, not recall over all reference cards.

Median mean corner distance, normalized by mean card side length, changes from 6.98% to 23.25% when respecting the fixed printed corner identities. After allowing cyclic order, it still worsens from 6.98% to 8.54%. Thus the large corner-error increase contains both an orientation component and a real border component.

The handheld subset is especially affected: among 48 cards matched by both models, 32 candidate outlines need a quarter-turn permutation, versus none for the previous model. Border error after cyclic alignment rises from 9.16% to 14.75%. The candidate also finds fewer handheld references overall: 49/57 versus 55/57.

On the reviewed 561-card set, 63 previously tight matches are lost and 42 are gained, giving the net loss of 21. Three previously found cards become misses and eight previously missed cards are found. Most of these reviewed cards have unknown printed-top orientation; their geometric review is still useful, but their starting corner should not be treated as verified printed-top truth.

The eight reviewed sideways cards with known printed top all come from F230. Both models preserve their printed corner order; tight matches improve from 2/8 to 5/8. This is one photo, so it cannot establish general sideways-card performance. The original 98-photo human subset has no known sideways cards under the diagnostic's 45°–135° top-edge-angle definition.

## Four-orientation recognition diagnostic

The frozen evaluator rectifies the predicted corner sequence into a 720×1000 crop and tries only 0° and 180°. If the first corner shifts by one position, those crops stay sideways. This diagnostic additionally rewarps the source quad with a one-corner shift, then tries that crop and its 180° rotation. It preserves clockwise winding, thresholds, encoders, indexes and highest-top-score selection. Rotating the already distorted portrait crop 90° would not restore its aspect ratio.

Both models were replayed on all 57 cases locally. The historical two-orientation branch reproduced all **114 frozen decisions**, with maximum top-score difference **0.000001073**. Encoder/index/policy hashes were checked against the run's pinned recognition configuration.

For the 11 cases with a verified expected identity:

| Crop source and orientation choices | Correct | Wrong | Abstained |
|---|---:|---:|---:|
| Previous model, two | 4 | 1 | 6 |
| Previous model, four | 4 | 1 | 6 |
| New model, two | 0 | 0 | 11 |
| New model, four | 2 | 1 | 8 |
| Frozen human outline, two | 4 | 1 | 6 |
| Frozen human outline, four | 4 | 1 | 6 |

Four additional cases name a specific forbidden identity but do not supply a verified correct identity; 42 have unknown identity. They are retained in the JSON report and are not counted as identification successes. The full 57-case four-way candidate result is 2 correct, 1 wrong, 10 abstentions and 44 unknown outcomes.

The newly wrong four-way candidate result is the same wrong family returned by both the previous model and the frozen human-outline crop on that frame. Geometry alone therefore does not resolve that identity failure under the current replay contract. The human-outline result also shows that correcting every border would not make all 11 expected-identity cases pass this encoder/index policy.

## Visual inspection

The local gallery at `http://127.0.0.1:8771/` contains 12 selected examples with source overlays and rectified crops. A link switches to the same examples from the final checkpoint at `http://127.0.0.1:8771/final/`. The F/C references match the reference corner studio; E references identify records in the full 600-photo manifest. This is a diagnostic selection, not a random sample or a new labeling queue. The table below describes epoch 20.

| Example | Finding |
|---|---|
| E550, Giratina, photo ending `021546fdb85857d9` | Rewarping the corner order restores recognition: score 0.508 → 0.701. |
| E594, Cabaretti Charm, ending `47d7e26a958f2518` | Rewarping restores recognition: 0.558 → 0.756. |
| E554, Giratina, ending `21b0a8fc50528e8c` | New outline cuts diagonally through the card; orientation search cannot restore the missing border. |
| E556, Primeape, ending `5c280a4247042138` | Corner displacement remains after orientation correction; best score is still below acceptance. |
| F496 / C2 | A candidate outline spans both neighboring cards; the right card loses its one-to-one match. |
| F94 / C1 | Diamond-shaped outline falls below the matching threshold. |
| F341 / C1 | The sideways Yanmega card is reduced to an inner-artwork proposal. |
| F18, F487, F273 / C1 | Diamond-shaped outlines visibly cut across otherwise clear card borders. |
| F19, F8 / C1 | The new model recovers two upside-down cards that the previous model failed to outline. |

These examples support the geometric diagnosis but do not establish why training learned the distorted shapes. Mixed corner-phase assignments are a hypothesis to investigate, not a proven cause.

## The final checkpoint was better at borders, but not a replacement

The selected checkpoint's internal fitness peaked at epoch 20. The saved epoch-50 `last.pt` was downloaded from the immutable run output, SHA-256 `54af5ba715e3620cfd74cbb6e85f85aa1ad7162db9dad3a120a56cf91ea711df`, and evaluated locally using the frozen 600-photo real release, the same decoder and crop contract. This took about five minutes of local CPU work; no model was trained again. Four selected-checkpoint CPU/GPU spot checks had identical detection counts and minimum best-match IoU above 0.9993.

| Metric | Previous model | Selected epoch 20 | Final epoch 50 |
|---|---:|---:|---:|
| Reviewed cards found / 561 | 549 | 554 | 555 |
| Reviewed tight outlines / 561 | 475 | 454 | **508** |
| Reviewed extra detections | 29 | 27 | **13** |
| Full real cards found / 700 | **677** | 671 | 664 |
| Full real tight outlines / 700 | 521 | 499 | **562** |
| Separate human capture cards found / 139 | **128** | 117 | 109 |
| Separate human capture extra detections | **18** | 38 | 40 |
| Printed-top order correct among matched eligible cards | 126/128 | 73/117 | 48/109 |
| Recognition correct / wrong, two orientations | **4 / 1** | 0 / 0 | 0 / 1 |
| Recognition correct / wrong, four orientations | **4 / 1** | 2 / 1 | 4 / 2 |

The final checkpoint's four-orientation test ran on all 57 replay frames; the historical two-way decisions reproduced exactly. For the 11 expected-identity cases it gives 4 correct, 2 wrong and 5 abstentions. The 42 unknown-identity cases remain unknown, and the four forbidden-identity cases are handled separately as before.

This shows that the internal selection criterion missed later gains in reviewed border accuracy. It does **not** establish that simply selecting the last epoch is a sound general policy: the final checkpoint also loses 19 human capture targets compared with the previous model and worsens printed-top order. Its synthetic benchmark was not rerun because these real-capture regressions already rule out treating it as a replacement.

## What to change before another paid run

Keep the previous model as the current baseline. Preserve the final checkpoint as a candidate for diagnosis, rather than discarding the entire experiment. The next training preparation should make real-photo validation measure detection, tight borders and printed-top order separately; the current real validation labels lack known printed-top orientation, and cyclic OKS alone cannot select for the inference contract's ordered corners.

Use existing training-source images or new capture sessions to create that validation set, keeping whole related capture groups together. Do not move these 600 evaluation photos into training or choose successive hyperparameters against them indefinitely. Fresh sideways, upside-down, slanted and overlapping real captures would be particularly useful. The completed 561-card review does not need to be repeated.

Before another training change, test whether a stable per-card corner assignment or a short adaptation from the previous card-trained checkpoint avoids the observed orientation drift and diamond shapes. Those are proposed experiments, not demonstrated fixes. A four-orientation recognition fallback also needs a wrong-accept check; this replay does not justify enabling it globally in production.

## Evidence and reproducibility

Local root: `.artifacts/card-geometry/cyclic-yolo11s-20260909/diagnosis/`.

- `geometry.json`: paired comparisons for all 700 original targets and all 561 reviewed targets. Match and tight-outline totals were checked against the published benchmark.
- `recognition/recognition-diagnosis.json`: all phase scores, decisions, frozen parity and trusted-label controls.
- `gallery/index.html`, `gallery/examples.json`, `gallery/01.jpg` through `12.jpg`: inspected comparison examples.
- `gallery/final/`: the same selection evaluated with the final checkpoint; Giratina E554 and Primeape E556 visibly recover full outlines and recognition after reordering.
- `final-checkpoint/`: saved last-checkpoint provenance and local evaluation.
- `verification.json`: diagnostic input/output hashes and validation results.

Reusable tools: `tools/card-geometry/diagnose_corner_order_geometry.py` and `tools/card-geometry/diagnose_corner_order_recognition.py`. The latter takes `--run-root`, `--release`, `--models-root` and a new `--output` directory. Its crop regression test and three existing recognition manifest/label-crop tests pass.

No saved labels, frozen benchmark results, recognition thresholds or production model were changed. No new GPU training job was submitted.
