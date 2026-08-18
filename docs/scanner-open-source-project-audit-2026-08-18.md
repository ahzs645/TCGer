# Open-source scanner project audit — August 18, 2026

## Executive summary

The four downloaded projects contain useful *ideas*, but none provides a
drop-in recognizer that should replace TCGer's current on-device pipeline.
The highest-value findings are:

1. use footer set code plus collector-number denominator as a hard
   exact-print constraint, especially for visually generic Basic Energy cards;
2. accumulate recognition evidence across a short sequence and retain the best
   stable frame instead of treating each capture independently;
3. use ANN top-K names and footer values as a constrained OCR vocabulary, not
   as a loose search across hundreds or thousands of candidates; and
4. retain synthetic OBB/grid generation only as a localization stress tool.

One new licensed dataset was worth preserving. `pokemon card outliner v1` has
347 unique images, 523 card boxes, and seven useful booster-pack negatives. It
has been added unchanged to the Google Drive detector dataset library under CC
BY 4.0. The 10k synthetic Pocket OBB dataset was already present and was not
duplicated.

## Project decisions

| Project | Useful idea | Decision | Why |
| --- | --- | --- | --- |
| ShreyShingala/Pokemon-Card-Scanning-Webapp | Fuse a visual shortlist with title OCR | Adapt narrowly | TCGer already does the safer version. The project's loose top-1000 word fallback can force an unrelated card and has no calibrated open-set rejection. Its CLIP/FAISS index and detector weights are Git LFS pointer files in the downloaded copy. No repository license was found, so its code and model artifacts should not be copied. |
| 1vcian/Pokemon-TCGP-Card-Scanner | Synthetic OBB scenes; cheap perceptual hash after alignment | Retain as an offline stress idea | It targets digital Pokémon Pocket screenshots, not physical cards under glare, sleeves, blur, and perspective. Its 10k synthetic dataset is already archived. No repository license was found, so code/model reuse is not approved. |
| celtechstarter/poke-scan-v2 | Explicit set-code whitelist, denominator consistency, numeric OCR corrections | Reimplement locally | These checks directly address exact-print false accepts. The app actually sends one full image to Gemini/NVIDIA; its “multi-zone” behavior is prompt structure rather than separate high-resolution crops. A cloud VLM should remain an opt-in debug/labeling tool because of privacy, latency, cost, and hallucination risk. The README says MIT but the downloaded and current repository do not include a license file, so code reuse remains unclear. |
| prateekt/pokemon-card-recognizer | Temporal runs and confidence-weighted best-frame selection | Reimplement independently | This is the strongest systems idea in the group. The OCR-only card-word matcher is not a strong replacement for TCGer's visual index. The project is GPL-3.0-or-later and its bundled references are Git LFS pointers in the downloaded copy, so source integration is unsuitable without a deliberate GPL decision. |

## Recommended TCGer experiments

### P0 — exact-print footer guard

For Basic Energy and other same-name or same-art families, do not auto-select a
visual match unless one of these is true:

- the set code plus collector numerator identify the same catalog row;
- the collector numerator/denominator pair leaves only that row; or
- a second independent full-card/local-feature signal clears a separately
  calibrated exact-print gate.

Normalize only narrow OCR confusions (`O↔0`, `I/l↔1`) and validate the result
against known set codes and official set denominators. If footer evidence is
missing or contradicts the visual candidate, keep the binder detection visible
but mark it **Review** and leave it unselected.

This is more important than changing the global cosine threshold. The current
real scans contain visually strong but wrong same-family candidates, and the
known correct/wrong similarity ranges overlap.

### P0 — temporal best-of evidence

Across a short live window or repeated binder capture:

1. keep the highest-quality rectified crop for each pocket;
2. union top-K candidates rather than overwriting the previous result;
3. require identity stability or footer agreement before auto-selection; and
4. retain a prior stronger accepted result when a later frame is blurrier or
   more reflective.

Implement this independently from the GPL project. Export per-frame candidate,
quality, orientation, OCR, and final arbitration details so the behavior can be
replayed.

### P1 — constrained OCR fusion

Populate Apple Vision `customWords` from the top-K catalog names, plausible set
codes, and collector-number forms. Exact catalog agreement may rerank the
shortlist; partial word overlap must not search a broad candidate pool or turn
an abstention into an acceptance by itself.

### P2 — synthetic localization stress

The Pocket project demonstrates a useful generator pattern: varied grids,
rotation, perspective, crop, overlap, color changes, and image noise. If TCGer
uses this idea, rebuild it with physical-card references and realistic binder
geometry, glare, sleeves, hands, and card backs. Synthetic data can initialize
or stress a detector, but promotion must still use held-out real iPhone
sessions.

An RGB perceptual hash is worth testing only as a temporal sameness/cache key or
as a cheap aligned top-K diagnostic. It should not assign identity until it has
beaten the current method on foil, glare, and exact-print hard negatives.

## Dataset added to Reference

The raw archive is:

`TCGer-Scanner-Datasets/raw/pokemon-card-outliner.v1i.coco-yolo.zip`

- Source: <https://universe.roboflow.com/shrey-gw0qz/pokemon-card-outliner-st28n>
- Export date recorded in source metadata: October 25, 2025
- License recorded in source metadata: CC BY 4.0
- Content: 347 images, 523 annotations, 7 zero-annotation negatives
- Splits: train 267/407, validation 58/83, test 22/33
- SHA-256: `be41b56633b3c91e0b3432b2536684e6a4debe13da4f212ece01262dd22d76b6`
- Duplicate check: 347 unique image hashes; zero byte-identical overlap with
  the 2,336 images previously extracted from the five archived datasets
- Quality notes: three boxes exceed an image boundary by less than 0.31 pixels;
  the COCO category list has an unused `pokemon-cards` entry while annotations
  use `card`

The raw archive is intentionally unchanged. Any derived training export should
normalize the card category, clamp the three fractional boundary overhangs,
retain the seven negatives, attach the source dataset to every row, and split
by source/capture lineage rather than random adjacent images.

The detector library now contains six archives totaling 2,683 images and 3,952
annotations. This new set is appropriate for secondary localization and
negative stress tests; it is not an identity dataset and should not trigger a
detector retrain by itself. TCGer's newest real binder scan already localized
all 33 observed face-up cards, so recognition precision remains the binding
problem.

## What was not copied

- The Pocket 10k OBB dataset was not copied because it already exists in
  `TCGer-Scanner-References/Pokemon-TCGP-Card-Scanner-1vcian/dataset`.
- The four source repositories were not copied into production code. Two have
  no discoverable repository license, one has only a README license statement,
  and the fourth is GPL-3.0-or-later.
- The Shrey CLIP/FAISS index, YOLO weights, and the GPL recognizer's reference
  artifacts were not ingested because the downloaded files are Git LFS pointer
  stubs rather than model/data bytes.
- No cloud VLM endpoint or private third-party service was added to the iOS
  scan path.

## Validation limits

This audit establishes dataset integrity, implementation shape, and legal
reuse boundaries. It does not establish recognition accuracy for these
projects because the downloaded model assets are incomplete, their reported
metrics are not measured on TCGer's real iPhone holdout, and the Pocket system
solves a materially different screenshot domain. Any adopted idea still needs
paired testing on frozen real sessions with exact-print labels and open-set
negatives.

## Primary online sources checked

- [Pokemon Card Scanning Webapp](https://github.com/ShreyShingala/Pokemon-Card-Scanning-Webapp)
- [Pokemon TCGP Card Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner)
- [Poke-Scan V2](https://github.com/celtechstarter/poke-scan-v2)
- [pokemon-card-recognizer](https://github.com/prateekt/pokemon-card-recognizer)
- [Roboflow Universe search result for pokemon card outliner](https://universe.roboflow.com/search?q=like%3Apokemoncarddetect%2Fpokemon-card-obb-egjdh)

