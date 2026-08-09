# iOS scanner resources

Packaging policy: all scanner assets ship bundled in the app for now; R2
delivery is planned later (fingerprint DB first, then the index — see
`docs/scanner-asset-packaging.md`).

The CoreML model and embedding index bundled by the iOS scanner are generated
build outputs that are **tracked in git** — the app is built by Xcode Cloud
from a fresh clone, so anything not committed simply never ships (which is
exactly how the scanner silently broke before these were tracked):

- `CardEmbeddings.mlpackage` — DINOv2-small image encoder (`image` 224→`embedding` 384-d).
- `CardDetector.mlmodel` — one-class Create ML detector used to locate a card before Vision corner refinement.
- `CardsIndexVectors.bin` — packed int8 index (header `[Int32 count, Int32 dim]` + int8 rows, scale 127).
- `CardsIndexMetadata.json` — `annIndex → {cardId, name, game, setCode, …}`.

Refreshing the index (new sets) therefore means regenerating and committing
these files. `CardFaceGate.json` is the small rejection-gate artifact; its
canonical fixture is
`backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json`.

Xcode (synchronized folder groups) auto-includes them once present; the
`.mlpackage` is compiled to `CardEmbeddings.mlmodelc` in the app bundle.

## Regenerate

From the repository root, use the complete iOS asset pipeline:

```bash
bash scripts/ios-assets.sh build
bash scripts/ios-assets.sh check
```

The lower-level model and index commands used by that pipeline are:

```bash
# 1. CoreML model (needs the py3.11 venv — coremltools lacks a 3.14 BlobWriter).
python3.11 -m venv mobile-apps/ios/scripts/.venv-coreml
mobile-apps/ios/scripts/.venv-coreml/bin/pip install coremltools torch transformers pillow
mobile-apps/ios/scripts/.venv-coreml/bin/python mobile-apps/ios/scripts/convert-dinov2-coreml.py

# 2. Index files (from the web index artifact).
cd backend && npx tsx src/scripts/build-ios-index.ts \
  --index ../frontend/public/scan-index/pokemon-embeddings.json

# 3. Card detector (after preparing the downloaded Roboflow archives).
python3 scripts/prepare_createml_card_detector.py \
  /path/to/ios-replay/datasets /path/to/createml-card-detector
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swift \
  mobile-apps/ios/scripts/train-card-detector.swift \
  /path/to/createml-card-detector \
  mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/CardDetector.mlmodel 300
```

**Parity note:** the model bakes ImageNet normalization. `CardEmbeddingEncoder`
matches the web HF processor's geometry before inference (resize shortest edge
to 256 → center-crop 224). Validate web↔iOS top-K agreement on real crops when
refreshing either model or index artifact.
