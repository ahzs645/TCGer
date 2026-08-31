# Camera corpus tools

Real-camera training and evaluation data for the scanners, derived from photos
we already hold — "synthetic-from-real": real pixels, machine-derived labels,
human review only where the evidence disagrees.

| Script | Purpose |
|---|---|
| `build_camera_corpus.py` | Crop cards out of Roboflow COCO archives / folders / whole-card photos, embed them with the **released** encoder, OCR titles and footers with Apple Vision (production parity), and pseudo-label with the app's own evidence rules. Emits `corpus.jsonl`, `review.jsonl`, `negatives.jsonl`, `report.json`, `augmentation-bank.json`. |
| `ocr-titles.swift` | `VNRecognizeTextRequest` over a list of image paths → JSONL. Used by the builder; usable standalone. |
| `bench_localizers.py` | Card-localizer bake-off: Ultralytics seg/OBB/det weights, HF DETR, tmikonen contours, and Apple Vision stages (`vision-quads.swift`, optionally gated by the app's `CardDetector.mlmodelc`) against COCO polygons/boxes, plus end-to-end recognition of labeled Dev Mode frames through the released encoders. |
| `yugioh_acceptance.py` | Validate the three-slice Yu-Gi-Oh acceptance manifest and emit `bench_localizers.py` sessions. It preserves face-down/open-set rejection cases and optional per-frame deck galleries. |
| `vision-quads.swift` | Apple Vision document-segmentation / rectangle / Core ML detector quads per image → JSONL, for offline parity with `CardCropper`. |
| `index_hygiene.py` | Audit a packed index: attractor rows (different-name neighbours above 0.9) with clusters and suggested actions, same-name rows with identical vectors under different family keys (`familyMergeCandidates`), and `orientation-negatives.json` (back-face reject recipe; rotation was measured *not* to target the attractor). |

Multi-source Roboflow archives should first be compiled with
[`../card-segmentation-data/build_standardized_corpus.py`](../card-segmentation-data/README.md).
Its materialized `coco-card-segmentation/` splits are the canonical input for
cross-source localizer testing; its `coco-card-detection/` splits retain coarse
box-derived geometry for detector pretraining without mixing that geometry into
the segmentation-quality denominator.

Requirements: `~/.venvs/tcger-label` (onnxruntime, numpy, Pillow), Xcode CLT for `swift`.
Inputs never leave the machine; outputs go to `.artifacts/camera-corpus/<game>/`
(gitignored) and, once reviewed, to the Reference drive under
`TCGer-Scanner-Datasets/games/<game>/derived/query-crops/`.

## Label decisions (mirror of the app's policy)

| Decision | Rule | Use |
|---|---|---|
| `footer-verified` | an `NNN/NNN` footer reading matches a printing of the title's rows | training positive, exact printing |
| `title-agreement` | exact catalog title == encoder top-1 name, top-1 ≥ 0.55, no different-family rival within 0.05 | training positive, family |
| `unique-title` | exact title with one printing in the catalog, title-constrained top-1 ≥ 0.55 | training positive, family |
| `ground-truth` | folder-labeled source; measured, never pseudo-labeled | evaluation |
| `review:title-vs-visual` | title matched a catalog name the image did not rank first | human review |
| `review:visual-only` | top-1 ≥ 0.70 with margin but no title evidence (typically foreign-language cards — the art matches, the title cannot) | human review; likely positives |
| `review:weak` | some evidence, none decisive | human review |
| `hard-negative-candidate` | no title, top-1 < 0.55 | open-set negatives after review |

Roboflow `.rf.<hash>` augmentation copies are de-duplicated by base name; the
pipeline never trains on five rotations of one photo.

## Running

```sh
V=~/.venvs/tcger-label/bin/python
A=.artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2
$V tools/camera-corpus/build_camera_corpus.py --game magic \
  --runtime $A/runtime-test --onnx $A/android/card-embeddings-arcface-fp32.onnx \
  --coco mtg-6klau=<extracted>/train/_annotations.coco.json:<extracted>/train \
  --whole mtg-detection-light-photos=<dir of the non-render photos> \
  --folder-classes magic-classification=<extracted>/train \
  --out .artifacts/camera-corpus/magic
$V tools/camera-corpus/index_hygiene.py --runtime $A/runtime-test --out .artifacts/camera-corpus/magic
```

Pokémon uses the same command with the physical-v2 runtime and the five
`ios-replay/datasets/*/<split>` COCO archives as `--coco` sources.

Results and the data inventory behind them are recorded in
`docs/scanner-system/camera-corpus-2026-08-29.md`.

## Yu-Gi-Oh acceptance corpus

Keep captured images outside git and create a manifest matching
`yugioh-acceptance.schema.json`. Every corpus must contain all three slices:
`single_handheld`, `steep_playmat`, and `duel_field`. An identity label is an
8-digit passcode; face-down and open-set cases use `expected: "reject"` and no
label. Each card instance in a duel-field image is a separate manifest record
(the path may repeat) with a four-point `targetQuad` in source-image pixels,
top-left origin. Add `deckExternalIds` when the same instance should also be
measured as a restricted Deck Scan.

```sh
python3 tools/camera-corpus/yugioh_acceptance.py \
  --manifest <private-corpus>/manifest.json \
  --out .artifacts/camera-corpus/yugioh/sessions.json

~/.venvs/tcger-label/bin/python tools/camera-corpus/bench_localizers.py \
  --out .artifacts/camera-corpus/yugioh/acceptance \
  --sessions .artifacts/camera-corpus/yugioh/sessions.json \
  --runtime yugioh=.artifacts/scanner-release/exports/yugioh/full \
  --onnx yugioh=.artifacts/scanner-release/exports/yugioh/full/card-embeddings-arcface-fp32.onnx \
  --vision-swift tools/camera-corpus/vision-quads.swift \
  --detector-mlmodelc <compiled-CardDetector.mlmodelc> \
  --yolo-obb draw2=/path/to/ygo_yolo.pt \
  --deck-scoped
```

Use the actual compiled app-detector and external challenger paths. The report
separates `correctAccept`, `wrongAccept`, `abstain`, and
`correctReject`, plus the same outcomes by corpus slice. Deck-scoped output is
written separately and must not be presented as full-catalog accuracy.
