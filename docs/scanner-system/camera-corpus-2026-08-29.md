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
RVR showcase rows). `orientation-negatives.json` is the trainer recipe for
rotate-180 and back-face reject samples.

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
3. **Index hygiene is independent of any of this** and should ship first:
   drop the 573 exclude rows from the Magic gallery, keep them as extra
   positives for their same-art family, and add the orientation reject class
   to the next training run.

## Licensing

Roboflow archives are CC BY 4.0 (attribution required; card artwork remains
the publisher's). Crops derived here are for internal model research only and
must not be redistributed. Nothing from the unlicensed 1vcian set was used.

## Outputs

Local: `.artifacts/camera-corpus/{magic,pokemon}/` (gitignored).
Reference drive: `TCGer-Scanner-Datasets/games/<game>/derived/query-crops/camera-corpus-2026-08-29/`
(crops, `corpus.jsonl`, `review.jsonl`, `negatives.jsonl`, `report.json`,
`augmentation-bank.json`, `index-hygiene.json`, `orientation-negatives.json`).
