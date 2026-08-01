# iOS scanner resources

The CoreML model and embedding index bundled by the iOS scanner are large,
reproducible build outputs and are **gitignored**:

- `CardEmbeddings.mlpackage` — DINOv2-small image encoder (`image` 224→`embedding` 384-d).
- `CardsIndexVectors.bin` — packed int8 index (header `[Int32 count, Int32 dim]` + int8 rows, scale 127).
- `CardsIndexMetadata.json` — `annIndex → {cardId, name, game, setCode, …}`.

`CardFaceGate.json` is the small rejection-gate artifact. Unlike the generated
model/index, it is tracked so clean clones always bundle the gate; its canonical
fixture is `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json`.

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
```

**Parity note:** the model bakes ImageNet normalization. `CardEmbeddingEncoder`
matches the web HF processor's geometry before inference (resize shortest edge
to 256 → center-crop 224). Validate web↔iOS top-K agreement on real crops when
refreshing either model or index artifact.
