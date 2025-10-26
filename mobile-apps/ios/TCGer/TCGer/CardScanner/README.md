# On-device Embedding Scanner (Experimental)

This directory now contains the scaffolding for a third card recognition strategy that mirrors the "instance retrieval" pipeline outlined in the BG Snapshot article. The goal is to remove the dependency on server-powered OCR search by running three steps locally:

1. **Rectangle isolation** – `CardCropper` shares a Vision-powered rectangle detector plus a Core Image perspective normalizer so that every downstream strategy works with frames that look like the training distribution.
2. **Embedding inference** – `CardEmbeddingEncoder` is a thin wrapper around a Core ML encoder (for example a SimCLR/Barlow Twins tuned MobileNet). It expects a compiled model named `CardEmbeddings.mlmodelc` in the app bundle and returns the raw float vector produced by the model's `embedding` output.
3. **Approximate nearest-neighbor lookup** – `AnnoyIndexStore` (placeholder) and `CardIndexMetadataStore` represent the offline ANN index and the metadata table that maps ANN rows to `CardDetails`. Today the store reads JSON, but it is structured so you can drop in a SwiftAnnoy-backed memory-mapped `.ann` file without touching call sites.

The `BoardCardEmbeddingScannerStrategy` wires the three pieces together, exposes the `.mlDetector` `ScanStrategyKind`, and is registered in `CardScannerCoordinator.makeDefault()`. At runtime the flow is:

```
video frame -> CardCropper -> CardEmbeddingEncoder -> ANN lookup -> CardScanResult
```

## How to finish the pipeline

- **Train a model**: fine-tune a lightweight encoder (e.g., MobileNetV3, EfficientNet-Lite) with SimCLR/Barlow Twins/BOYL on your card catalog. Export the encoder head alone and compile it as `CardEmbeddings.mlmodelc` with an `image` input and `embedding` output.
- **Bake the index**: generate embeddings for every catalog item and build an Annoy (or Faiss/HNSW) index. Ship the `.ann` binary plus a compact metadata JSON (`CardsIndexMetadata.json`). Update `AnnoyIndexStore` to memory-map the ANN file and to return ids via `AnnoyIndex.getNNsForVector` instead of brute-force cosine distance.
- **Update metadata**: include enough context in each metadata entry (tcg, rarity, pricing seed) to build `CardDetails` without hitting the API, then optionally hydrate prices by calling the backend after a match is confirmed.
- **Tune heuristics**: `BoardCardEmbeddingScannerStrategy` currently transforms distances into confidence scores with a simple clamp. Feed device measurements back into this function and add multi-frame voting (store the top candidate for the last N frames and require agreement) before surfacing a result.

The scaffolding compiles on-device today even without the real assets, allowing you to iterate on the ML/index artifacts independently from the app code. Once the artifacts are ready, drop them into the app bundle (or download/cached them via `CacheManager`) and the scanner strategy will start returning results without blocking on network latency.
