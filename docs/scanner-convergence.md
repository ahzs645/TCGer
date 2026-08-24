# Scanner convergence: one recognition stack, two runtimes

**Direction (set 2026-08-23):** iOS and web are not two scanners — they are
one recognition stack with two runtimes. Same encoder, same index build,
same preprocessing contract, same evaluation methodology; only delivery
(Core ML on ANE vs ONNX Runtime Web) and operating points are
platform-specific.

This doc is the shared roadmap. iOS-side detail lives in
`mobile-apps/ios/TCGer/TCGer/CardScanner/README.md` ("Dual-encoder
recognition"); web-side detail in `docs/client-side-scanner-options.md`.

## Where we already converge (more than it looks)

The stacks share more upstream than either side's code suggests:

| Shared piece | Source of truth |
|---|---|
| Catalog images | tcgdex `high.webp`, one scan per card (21,828 Pokémon) |
| Index builder | `backend/src/scripts/build-embedding-index.ts` → web JSON artifact; `build-ios-index.ts` converts that same artifact to the iOS `CardsIndexMetadata.json` + `CardsIndexVectors.bin` |
| Vector format | 384-d, L2-normalized, int8 scale-127, cosine over packed bytes |
| Encoder family (until 2026-08-23) | `dinov2-small` on both — the web runs it today; iOS keeps it as the rollback variant |
| Rejection gate | DINOv2-trained logistic gate (`train-rejection-gate.ts`) — web `card-face-gate.json`, iOS `CardFaceGate.json` |
| Accept scale | 0.72 strong-accept on both (a DINOv2-score-scale constant) |
| Trained encoder + recipe | `mobile-apps/ios/scripts/train_arcface_encoder.py`; resume checkpoint `Drive:TCGer-encoder/arcface-checkpoint-epoch5.pt` |

**Consequence:** upstream fixes fan out to both platforms. A bad catalog
image (see SWSH204 below) fixed once and re-embedded repairs both indices.

## Where we diverge today (updated post-Phase-1)

| | iOS (post-98f228f9) | Web (post-Phase-1) |
|---|---|---|
| Default encoder | **ArcFace/FastViT-T8** (46/76, 0 wrong accepts) | **ArcFace/FastViT-T8** (same weights, fp16 ONNX; manifest-preferred) |
| Encoder switching | `ScannerEncoderVariant` atomic bundle; env > UserDefaults > default | Version-2 artifact bundles thresholds+modelUrl with the vectors; manifest `--prefer` picks the fleet's variant; DINOv2 artifact = rollback |
| Thresholds | 0.60/0.05 (swept + replay-validated) | 0.60/0.05 **provisional** (iOS-swept; own web sweep pending — Phase 2) |
| Regression gate | Replay suite (76 labeled frames), green, per-variant allowlists | **Still none automated** — but `eval-recognition.ts` now runs both encoders, so the corpus + CI gate is the remaining work |
| Rejection gate | none for arcface (DINOv2-trained gate rollback-only) | same: gate auto-disables on model mismatch |
| Runtime | Core ML on ANE | ONNX Runtime Web (WASM) for arcface; Transformers.js for dinov2/clip |

The critical coupling (now enforced in code): thresholds are an operating
point on one encoder's score scale — ArcFace's correct answers score below
the 0.72 DINOv2-scale accept and would all have been rejected had the
index been swapped alone. Phase 1 resolved this by making thresholds
travel inside the version-2 artifact, so an index and its operating point
can no longer be published separately.

## Convergence roadmap

### Phase 1 — ArcFace on the web (the port) — **SHIPPED 2026-08-23**

Landed the same day this doc was written. What shipped, and what the port
taught us:

- **ONNX export**: `mobile-apps/ios/scripts/export_arcface_onnx.py` — same
  `Deploy` wrapper as the Core ML export ([0,1] input, ImageNet norm baked
  into the graph). fp16 (7.9 MB) is bit-faithful (worst cos 0.99992 vs
  fp32, max sim shift 0.0011). **int8 dynamic quantization destroys the
  model** — FastViT's reparameterized convs collapse to noise (cos as low
  as −0.22, 1/12 self-retrieval). Ship fp16/fp32 only.
- **Index**: `backend/src/scripts/build-arcface-web-index.ts` converts the
  iOS bin + existing entry metadata into the version-2 web artifact —
  exact vector parity with iOS by construction. The export script's
  live-image self-retrieval check doubles as proof the bin's annIndex
  order equals the web artifact's entry order.
- **Thresholds travel**: version-2 artifacts carry `thresholds` +
  `modelUrl`; `parseEmbeddingIndex`/`matchEmbeddingTopK` default to the
  index's own operating point (explicit options still win for sweeps).
  The manifest's per-TCG entry picks the active variant
  (`update-scan-index-manifest.ts --prefer arcface|dinov2`) — fleet-wide
  encoder switch/rollback is one manifest republish. The DINOv2-trained
  gate auto-disables under arcface via the existing gate/model mismatch
  guard.
- **Eval harness speaks arcface** (Phase 2 start):
  `eval-recognition.ts` runs the ONNX via onnxruntime-node with the exact
  training preprocessing. Smoke run (10 catalog crops): 9/10 top-1 at
  sims 0.92–0.97; wrong twins peak at ~0.61 — the provisional 0.60
  accept line sits in the gap.
- **New shared-upstream defect class confirmed**: the one smoke miss
  (xy12-74) has self-sim 0.30 against its own index row — the row was
  embedded from a different image than tcgdex serves today. Same class as
  the iOS SWSH204 suspicion, second confirmed instance, affects BOTH
  platforms (same vectors). The trainer's 97.9% recall@1 implies ~2%
  (~460 cards) of rows may be stale/degraded → see polish item 2b below.

The original port plan, kept for reference:

1. **Export ONNX** from `Drive:TCGer-encoder/arcface-checkpoint-epoch5.pt`
   (FastViT-T8, standard export; fp16 or q8 — the model is 6.9 MB as Core
   ML, far lighter than the 44 MB DINOv2 the web downloads today).
2. **Add `"arcface"` to `EncoderKind`** in
   `frontend/src/lib/scan/embedding-matcher.ts` with the training
   preprocessing contract: shortest-edge-256 bicubic → center-crop 224 →
   ImageNet norm. Parity strategy is the one the stack already uses:
   `build-embedding-index.ts` and the browser matcher share the same
   embed code path, so query/index parity holds **by construction** —
   extend both sides through the same branch. (Canvas resampling ≠ PIL
   bicubic; parity-by-construction sidesteps the drift, but validate
   against a few known frames anyway.)
3. **Make thresholds travel with the encoder** — the web equivalent of
   `ScannerEncoderVariant`. Either embed the operating point in the index
   artifact (version 2 field) or key a variant map off
   `artifact.encoder`. Never-mix rule, same as iOS: an index, its
   encoder, and its thresholds are one calibrated unit.
4. **Build + publish the web ArcFace index** with the extended builder;
   ship both artifacts and keep DINOv2 one manifest-entry away as the
   rollback (mirror of the iOS picker).
5. **Recalibrate web thresholds with the sweep method** (below). Do NOT
   copy iOS's 0.60/0.05 — the web accept logic differs (top-K shortlist
   of 20, margin-gated OCR tiebreaker at 0.1, track-level embedding
   averaging), so the operating point is its own sweep on web evidence.

### Phase 2 — shared evaluation (the web's missing replay suite)

The iOS replay corpus (76 labeled frames) is what made the encoder swap
safe; the web has no equivalent gate. Port the methodology, not the code:

- Stand up a labeled web corpus (the Sinnoh ground-truth v2 video +
  dev-session crops) run through `eval-recognition.ts` /
  `eval-video-stream.ts` in CI or a pre-publish script, with per-encoder
  baselines and allowlisted known losses — the same "any NEW regression
  fails loudly" contract as `knownArcFaceEncoderLosses`.
- Reuse the recalibration method verbatim (it is encoder-agnostic):
  evidence dump → `threshold_sweep.py`-style offline grid → find the
  precision knee → one notch of safety → validate with a real run.

### Phase 3 — shared polish (fix once, ship twice)

The iOS polish plan (CardScanner README) is mostly *upstream* work, so
each item pays out on both platforms once Phase 1 lands:

1. **Real-crop fine-tune** from the epoch-5 checkpoint (~1.5 h L4) → new
   checkpoint → re-export Core ML *and* ONNX → rebuild both indices.
2. **SWSH204 promo investigation** — 4 of iOS's 9 losses are this one
   card, all `noCandidates`. UPDATE 2026-08-24: labeling-session evidence
   now points at DETECTION/CROP failure, not the index — re-cropping the
   recorded SWSH204 frame with a correct quad (webobb+sam in the labeling
   tool) retrieves swshp-SWSH204 at 0.747, well above the 0.60 accept.
   The encoder and index row are fine; investigate the iOS
   rectangle-detection path on those frames instead.
   2b. **Stale-row audit** (elevated by the Phase-1 find): sweep all
   21,828 catalog images through the encoder and flag rows whose
   self-sim is below ~0.8 (xy12-74 measured 0.30 — its row predates the
   image tcgdex now serves). Re-embed the flagged rows, regenerate bin +
   web artifact, and both platforms heal at once.
3. **Gate retrain on ArcFace embeddings**
   (`backend/src/scripts/train-rejection-gate.ts`) — produces both the
   web `card-face-gate.json` and iOS `CardFaceGate.json` replacements.
4. **Remaining DINOv2-scale constants** — iOS: title-printing guard,
   `minimumEvidenceScore`; web: `minVerifiedSimilarity` 0.65 /
   `minMargin` 0.08 (currently dead — `allowVerifiedMarginAcceptance`
   defaults false and is never set) and the gate threshold.

### Known hygiene gaps (found during the 2026-08-23 audit)

- `frontend/public/scan-index/` has no `manifest.json` and no
  `card-face-gate.json` on a fresh checkout (artifacts are gitignored):
  the loader's manifest fetch fails and the gate silently resolves null
  (ungated). Publish or generate both alongside the index, and consider
  making the missing-gate case loud in dev.
- `browser-video-matcher.ts` / `rank-matches.ts` are the legacy
  hash-matching path only; don't extend them for embedding work.

## The contract going forward

When touching recognition on either platform, preserve these single
sources of truth:

- **Trainer + recipe:** `mobile-apps/ios/scripts/train_arcface_encoder.py`
  (convergence lessons in the CardScanner README — s=16 not s=30 under
  AdamW, 300+ margin-free steps, 3× head LR, probe-first debugging).
- **Checkpoint:** `Drive:TCGer-encoder/arcface-checkpoint-epoch5.pt` —
  every future fine-tune resumes here; pull checkpoints off the VM every
  epoch.
- **Index builder:** `build-embedding-index.ts` (web artifact) →
  `build-ios-index.ts` (iOS conversion). New encoders extend the builder;
  they do not fork it.
- **Preprocessing contract:** shortest-edge-256 bicubic → center-crop 224
  → ImageNet norm, identical across trainer, Core ML conversion, index
  builder, and browser matcher.
- **Recalibration method:** evidence dump → offline sweep → real-run
  validation, per platform, whenever the encoder or accept logic changes.
