# Camera corpus — what the Reference drive actually gives us (2026-08-29)

Follow-up to [Real-camera recognition findings](real-camera-recognition-findings-2026-08-29.md)
and the [visual-first policy record](mtg-visual-first-policy-2026-08-29.md).
Question answered here: can the synthetic libraries and Roboflow archives in
`Reference/` close the camera-domain gap, and what do they yield when run
through the shipped encoders with the app's own evidence rules?
Tooling: [`tools/camera-corpus/`](../../tools/camera-corpus/README.md).

## Inventory correction

The Magic "4,177 real photos" in `mtg-detection-light` are **not** photos.
De-duplicating Roboflow's five augmentation copies per image:

| Archive | What it really is | Unique real photos |
|---|---|---|
| `mtg-detection-light.v2` | 782 Scryfall renders in 11 languages (UUID-named), plus eBay/web photos | **67** |
| `mtg-6klau.v11` | 50 photos of Spanish card spreads (640×640, ~20 cards each, ~110 px per card) | 50 images → 501 card crops |
| `magic-classification.v3` | 3 identities, steep-angle phone photos | 16 |
| Dev Mode sessions 08-27 / 08-29 | frozen evaluation | 49 (eval only) |

Pokémon is the opposite story: the five `ios-replay/datasets` archives hold
**2,336 real photos with card boxes**, de-duplicating to 1,541 card crops.

The 10k `Pokemon-TCGP-Card-Scanner-1vcian` set is renders pasted on
backgrounds with no license; its own review says it does not reproduce phone
optics, sleeves, glare or foil. The Magic trainer already applies perspective,
brightness, colour, contrast, blur and noise to renders, so more of that kind of
synthetic data does not address the residual gap. Synthetic composition
(`Trading-Card-Scanner-lo-calvin`, MIT) remains useful for the **detector**.

## Pipeline

`build_camera_corpus.py` crops every box, embeds it with the released ONNX
encoder using the training preprocessing (shortest edge 256 → centre 224),
OCRs it with Apple Vision (the app's engine), and labels it with the same
rules the scanner uses: footer `NNN/NNN` pins a printing; an exact title that
agrees with the encoder's own top-1 (no different-family rival within 0.05)
confirms the family; a catalog-unique title confirms from the 0.55 floor.
Everything else goes to review or the hard-negative pool. Renders for the
accepted crops are fetched to measure camera-vs-render statistics.

## Results

### Pokémon (physical-v2 runtime, 1,541 crops)

| Decision | Count |
|---|---:|
| footer-verified (exact printing) | 149 |
| title-agreement (family) | 210 |
| review: title vs visual disagree | 189 |
| review: visual only (≥0.70, no title) | 159 |
| review: weak | 253 |
| hard-negative candidates (<0.55, no title) | 581 |

**359 accepted real-camera positives across 310 printings**, top-1 similarity
p10/p50/p90 = 0.61 / 0.80 / 0.93. `tcgx-annotations-v7` contributes 256 of
them. The 189 title-vs-visual rows are the interesting failures: OCR read the
title correctly (e.g. `Flareon`, `Garchomp ex`) while the encoder ranked the
correct card at 0.18–0.51 — camera-domain misses that the footer or title
rescued. Those, plus the visual-only rows (mostly correct-looking but
unverifiable), are the review queue.

Index audit: 23 rows with a >0.9 different-name neighbour (mean nearest
neighbour 0.57). Pokémon's index is clean.

### Magic (visual-family v2 runtime, 584 crops)

| Decision | Count |
|---|---:|
| title-agreement | 5 |
| review: title vs visual | 5 |
| review: visual only | 26 |
| review: weak | 303 |
| hard-negative candidates | 229 |
| ground truth (magic-classification) | 16 |

Only **5 accepted positives** — the 67 eBay/web photos are largely
foreign-language and foil, and the 501 spread crops are Spanish and ~110 px.
Two measurements matter more than the yield:

- **Steep-angle phone photos**: of 16 ground-truth `magic-classification`
  photos, the correct family is top-1 in **1**, top-5 in **2**, and absent
  from the top-10 in 14. Correct-family similarity ≈ 0.57 when it appears.
- **Foreign-language photos**: the `review:visual-only` rows are French cards
  where the encoder's top-1 is the right English family at 0.73–0.97
  (Ugin's Binding, Strike It Rich, Terramorphic Expanse, Atraxa, Hansk…). The
  art embedding transfers across languages; only the title cannot confirm it.
  These are likely-correct positives after a quick review.

Index audit (`index-hygiene.json`): **880 rows** with a >0.9 different-name
neighbour; mean nearest neighbour 0.66. Actions: 556 `exclude:non-gallery-set`
(Collectors' Edition, World Championship, 30A, `unk` playtest…), 17
`exclude:back-face`, 307 `review:attractor-member` (retro-frame lands, LTR /
RVR showcase rows). These are *descriptive*; see "What this means" for why
excluding them is not the fix.

### Camera-domain augmentation bank (Pokémon, 200 pairs)

Ratios of real crop to its catalog render, p10 / p50 / p90:

| Statistic | p10 | p50 | p90 |
|---|---:|---:|---:|
| contrast | 0.71 | 0.97 | 1.28 |
| sharpness (edge variance) | 0.06 | 0.64 | 1.67 |
| saturation | 0.56 | 0.90 | 1.24 |
| mean RGB | — | 0.89 / 0.85 / 0.85 | — |
| noise σ delta | −1.5 | +1.5 | +7.6 |

Reading: real photos are darker and desaturated, and half of them are much
*softer* than a render (sharpness p10 = 0.06 — a 16× loss) while a tail is
sharper (camera sharpening). The trainer's current blur/sharpen range should
be set from these percentiles rather than hand-picked; that is the cheapest
domain step available. The Magic bank has only 7 pairs — too few to use.

## What this means

1. **Pokémon can start a real-camera fine-tune now**: 359 verified crops plus
   whatever the review queue yields, with hard negatives from the 581 pool
   after a pass to drop mis-crops. Hold out by *source archive*, keep every
   Dev Mode session as evaluation.
2. **Magic cannot yet.** Five positives is nothing, and the one measurement we
   have (1/16 top-1 on steep phone photos) says the gap is large. The
   augmentation bank cannot even be estimated from what exists. Magic needs
   captured data: a few hundred phone crops across frames, foils, sleeves,
   and angles, labeled by title + collector number. Every Dev Mode session is
   that data; the labeling loop already exists.
3. **Index hygiene — corrected after an independent check.** Dropping the
   573 `exclude:*` rows does *not* stop the 0.99-to-garbage failure: the
   degenerate Stone Quarry crops re-ranked without those rows land on the
   same LTR showcase rows, and with all 880 flagged rows removed still score
   0.82–0.87 on unflagged retro-frame rows. Clean 180° rotations are not the
   attractor either (p50 0.55, 1/40 on a flagged row), so a rotation reject
   class targets the wrong thing. What the check found instead: a blank or
   glare-saturated crop scores **0.93 with a 0.07 margin against
   "Double-Faced Substitute Card"** — an accept under the current policy —
   and 318 such non-card rows (substitute, bio, emblem, punchcard,
   checklist, blank) sit in the gallery. Two changes followed:
   `tools/scanner-gallery-exclusions.json` (dropped by the browser index
   builder and by both native clients' metadata eligibility) and a
   **hub-rejection** rule in the acceptance policy (≥3 distinct names ≥0.90
   in the top 5 → abstain): 0 hits on 364 verified real crops, 8/12 on the
   degenerate Stone Quarry attempts, the rest caught by the ambiguity
   margin. 115 same-name rows with identical vectors under different family
   keys are listed as `familyMergeCandidates` (mostly dungeons/tokens).

## Localizer bake-off (2026-08-30)

`tools/camera-corpus/bench_localizers.py` ran every card localizer with
downloadable weights against the same ground truth and, more importantly,
through the same released encoders on the 101 labeled Dev Mode frames
(49 Magic, 52 Pokémon). Candidates: the app's own Apple Vision path
(`vision-app` = document segmentation → rectangles → YOLO11s box, via
`vision-quads.swift`), its individual stages, the quad the phone actually
recorded (`device`), `Trading-Card-Scanner-lo-calvin` YOLO11n-seg (MIT),
HichTala `draw2` YOLO11-OBB and `draw` YOLOv8 (AGPL, Yu-Gi-Oh! synthetic),
`JakeTurner616` MTG region-seg (MIT), `Matthieu68857` DETR-ResNet50
Pokémon boxes (Apache-2.0), and tmikonen's OpenCV contour pipeline.
1vcian's TF.js OBB model was not run (no TF.js runtime here).

### Localization vs ground truth

| Localizer | TCGX 149 Pokémon photos (polygons): mean IoU / R@0.5 / R@0.9 | 6klau 50 Magic spreads (~20 cards each): IoU / R@0.5 | ms/img (CPU) |
|---|---|---|---|
| DETR Pokémon boxes | **0.884 / 0.99 / 0.62** | 0.43 / 0.47 | 231 |
| app YOLO11s box | 0.801 / 0.84 / **0.78** | 0.04 / 0.04 | — |
| `vision-app` (current pipeline) | 0.795 / 0.82 / 0.74 | 0.04 / 0.04 | — |
| `draw2` YOLO11-OBB (YGO) | 0.635 / 0.75 / 0.12 | **0.47 / 0.54** | 71 |
| lo-calvin YOLO11n-seg | 0.224 / 0.27 / 0.06 | 0.25 / 0.22 | 55 |
| MTG region-seg | 0.458 / 0.29 / 0.02 (finds regions, not cards) | 0.10 / 0.06 | 40 |
| `draw` YOLOv8 (YGO) | 0.03 / 0.02 | 0.37 / 0.39 | 42 |
| tmikonen contour | produced no candidates in this harness | — | 21 |

Restricting TCGX to its 139 one-card images (the app pipeline's actual job)
changes the picture: app YOLO11s box **0.954 / 1.00 / 0.94**, `vision-app`
0.946 / 1.00 / 0.90, DETR 0.899 / 1.00 / 0.64, `draw2` OBB 0.705 / 0.86 /
0.13, lo-calvin 0.26. The earlier 0.80 was the ten multi-card images
dragging the single-card detector down; on one card per frame the app's own
detector is the most precise localizer tested. All 101 labeled Dev Mode frames
are single-card captures (no binder pages), so the recognition table below is
already single-card only.

The app pipeline is single-card by design, so the spread result is expected;
it is the binder path's job. Nothing third-party beats the app's own detector
on single-card precision (R@0.9 0.78 vs DETR's 0.62): DETR finds more cards
loosely, YOLO11s finds fewer cards tightly.

### Recognition on the labeled frames (the number that matters)

Each localizer's largest quad → 720×1000 warp (both orientations) → released
encoder → rank of the correct family. "acceptable" = correct top-1 at the
game's strong-accept point with margin.

| Localizer | Magic 49: top-1 / top-5 / acceptable / correct-sim p50 | Pokémon 52: top-1 / top-5 / acceptable / correct-sim p50 |
|---|---|---|
| `device` (what the phone used) | 34 / 38 / 28 / 0.749 | 36 / 38 / 30 / 0.702 |
| `vision-app` (offline replay of the pipeline) | 37 / 41 / 28 / 0.748 | **40 / 43 / 32 / 0.730** |
| app YOLO11s box only | 38 / **43** / 29 / 0.764 | 36 / 39 / 25 / 0.628 |
| `draw2` YOLO11-OBB | 38 / 40 / **30** / 0.771 | 36 / 37 / 22 / 0.633 |
| DETR boxes | **39** / 42 / 27 / 0.768 | 36 / 39 / 27 / 0.687 |
| `vision-rect` only | 27 / 30 / 24 / **0.774** | 27 / 30 / 24 / 0.737 |
| lo-calvin seg | 28 / 30 / 22 / 0.763 | 26 / 27 / 15 / 0.554 |
| MTG region-seg | 1 / 2 / 0 | 10 / 13 / 5 |
| `draw` YOLOv8 | 0 / 0 / 0 | 0 / 0 / 0 |

Reading: every competent localizer lands in the same band — Magic top-1
34–39 of 49 and 27–30 policy-acceptable, correct-family similarity
p50 ≈ 0.75 regardless of who drew the quad. Swapping the localizer buys at
most +2 acceptable frames; the crop is **not** the bottleneck on these
sessions, the embedding band is. The one localizer that meaningfully
changes similarity (`vision-rect`, +0.025 p50) does so by finding fewer
cards. A seg/OBB head still earns its place for what the current pipeline
cannot do at all — multi-card spreads, steep angles (the 16-photo
`magic-classification` set is not in this test) — not for single-card
similarity. Note that `device` trails the offline `vision-app` replay on
Pokémon (36 vs 40 top-1): the phone's guide crop and Simulator/device Vision
divergence cost more than any third-party model would add.

## Licensing

Roboflow archives are CC BY 4.0 (attribution required; card artwork remains
the publisher's). Crops derived here are for internal model research only and
must not be redistributed. Nothing from the unlicensed 1vcian set was used.

## Outputs

Local: `.artifacts/camera-corpus/{magic,pokemon}/` (gitignored).
Reference drive: `TCGer-Scanner-Datasets/games/<game>/derived/query-crops/camera-corpus-2026-08-29/`
(crops, `corpus.jsonl`, `review.jsonl`, `negatives.jsonl`, `report.json`,
`augmentation-bank.json`, `index-hygiene.json`, `orientation-negatives.json`).
