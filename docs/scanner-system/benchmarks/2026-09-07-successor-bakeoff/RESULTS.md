# Successor bake-off results — 2026-09-07

All four resubmitted jobs completed. Every report was downloaded from the private model repo at revision `d12848068f590ad2c3d42b4eabd89b317103c2f4` (first three at `309a4fe1…`), and `result-verification.json` confirms for each candidate: the resolved config re-hashes to the frozen experiment hash, both benchmarks carry the pinned evaluation corpus hashes with 600 and 1,000 records, the in-job preflight passed, the reports carry tooling `63fcb55f`, and evaluation contract version 2 was applied. YOLOX passed its all-train self-evaluation (35,228 matched targets; a fitting sanity check, not a quality gate). Copied reports live under `results/<candidate>/`; predictions and checkpoints stay on the Hub under the pinned prefixes.

This is a measurement of the category-repaired corpus against round two on the unchanged frozen evaluations. It is not a promotion decision. Single seed, so small slices (3 binder images, 18 duel images) carry large variance.

## Real evaluation, 600 images / 700 cards (round two → successor)

| Candidate | Recall .50 | Recall .75 | Recall .90 | Extras | Duplicates | Mean matched IoU | Corner p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| YOLO11s | .959 → .923 | .777 → .769 | .459 → **.554** | 288 → **177** | 26 → 16 | .852 → .869 | .162 → .142 |
| YOLO11n | .910 → .913 | .709 → .714 | .410 → **.476** | 403 → **222** | 5 → 8 | .840 → .852 | .200 → .188 |
| YOLOX (loss repair) | .601 → **.646** | .583 → **.623** | .539 → .560 | 7 → 9 | 0 → 0 | — | .074 → .083 |
| FastViT-T8 | .789 → .799 | .493 → .499 | .133 → .013 | 316 → 462 | 3 → 12 | .767 → .758 | .198 → .196 |

Round-two YOLOX is the completed loss-repair run, the only previous YOLOX with accepted quads.

Per scene slice, recall .50 / .75 and extras (round two → successor):

| Slice (cards) | YOLO11s | YOLO11n | YOLOX |
|---|---|---|---|
| single_card_archive (561) | .99/.89/161 → .97/.88/84 | .96/.83/170 → .95/.83/116 | .67/.67/5 → .70/.70/7 |
| single_handheld (57) | .84/.46/26 → .93/.54/13 | .91/.44/16 → .96/.39/17 | .54/.42/1 → .61/.51/1 |
| steep_playmat (22) | .77/.18/10 → .73/.23/8 | .68/.14/15 → .91/.18/2 | .36/.27/0 → .50/.41/0 |
| duel_field (33) | .76/.27/57 → .61/.21/21 | .48/.12/105 → .70/.21/32 | .18/.12/1 → .33/.24/1 |
| binder_page (27) | 1.00/.19/34 → .56/.04/51 | .48/.00/97 → .22/.00/55 | .00/.00/0 → .00/.00/0 |

Synthetic multigame (1,000 images / 3,651 cards), recall .50: YOLO11s .910 → .902, YOLO11n .829 → .869, YOLOX .925 → .927, FastViT .412 → .406.

Recognition replay on the 11 verified-identity frames (correct / abstain / wrong): YOLO11s 4/8/1 → 4/8/1, YOLO11n 3/9/1 → 4/7/1, YOLOX 2/9/0 → 3/8/0, FastViT 0/11/0 → 2/9/0. The label-crop ceiling on these frames remains 4/6/1.

## Reading

- **The category defect was a real driver of stray outlines.** With slabs and card subregions no longer trained as cards, YOLO11s extras fell from 288 to 177 and YOLO11n from 403 to 222 on the same 600 images, and tight-match recall at IoU .90 rose for both. Mean matched IoU and corner error improved for the YOLO detectors. YOLOX gained across every slice at .50 and .75 while keeping near-zero extras. Single-card archive extras roughly halved for the YOLO detectors.
- **Binder pages did not improve and the loose numbers got worse.** YOLO11s dropped from 27 to 15 loose matches on the three binder pages, and its quad bounding boxes now match only 20 of 27 truth boxes at IoU .50, so the loss is not only corner regression. `results/binder-yolo11s-roundtwo-vs-successor.jpg` shows both models producing square-ish, often rotated quads over portrait cards; round two happened to land more of them loosely. YOLOX still emits no binder detections. Real binder and tabletop supervision is boxes only in both corpora, so this slice measures seed variance on 3 images plus an unchanged gap, exactly the human-label follow-up queued in the [successor record](../2026-09-06-successor-corpus-prep/README.md).
- **FastViT is a checkpoint-selection story, not a corpus story.** Both FastViT runs overfit severely (train loss near 0.01 while validation loss climbs to 1.4 and 3.1 respectively), and evaluation uses the best-validation-loss checkpoint, which lands in the first epochs. The successor validation set carries four times as many real corner targets (194 → 793), which moved the selected epoch. Its held-out .90 recall collapsed while .50 recall stayed flat; its extras rose. FastViT-T8 in this form is not competitive on either corpus.
- **Recognition is unchanged in ceiling.** No candidate exceeds the label-crop replay outcome, consistent with the encoder and index findings in the [category repair record](../2026-09-06-category-repair/README.md).

## What this does and does not authorize

It supports building future corpora with the category-aware importer and the v2 fit adapter. It does not select a candidate, change a threshold, or authorize export or deployment; YOLO11 stays evaluation-only. The next controlled step for binder scenes is human corner labels on the 2,070 queued train targets, then a declared follow-up experiment. An ablation of the v2 fit adapter (corpus with and without it, same seed) would separate its effect from the category repair if that attribution matters.

## Files

`result-verification.json` (revision, checkpoint hashes, per-file SHA-256, verification flags), `comparison.json` (deterministic round-two versus successor numbers from `compare-successor-results.py`), `results/<candidate>/` (evaluation summary, both benchmarks, recognition replay, run and trainer summaries, cross-release leakage, resolved config, in-job preflight, and YOLOX train self-evaluation), and the binder panel.
