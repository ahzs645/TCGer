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

## Where we diverge today

| | iOS (post-98f228f9) | Web |
|---|---|---|
| Default encoder | **ArcFace/FastViT-T8** (in-house, 46/76, 0 wrong accepts) | DINOv2-small (31/76 on the iOS corpus; unmeasured on web) |
| Encoder switching | `ScannerEncoderVariant`: model+index+thresholds+gate as one atomic bundle; env > UserDefaults > default | Index-driven only: the artifact header names the encoder; thresholds are hard-coded constants (`embedding-matcher.ts`) that do NOT travel with it |
| Thresholds | 0.60/0.05 (ArcFace-calibrated) | 0.72 top-1 cosine (DINOv2-scale) |
| Regression gate | Replay suite (76 labeled frames), green, per-variant allowlists | **None** — zero automated accuracy tests; manual Node harnesses (`eval-recognition.ts`, `eval-video-stream.ts`) against one labeled video |
| Runtime | Core ML on ANE | Transformers.js / ONNX Runtime Web (WASM default) |

One critical coupling to respect: because web encoder selection is
index-driven and web thresholds are hard-coded, **publishing an ArcFace
index to the web today would break recognition** — ArcFace's correct
answers score below the 0.72 DINOv2-scale accept and would all be
rejected. This is the same lesson iOS learned (its recalibration round);
it is why Phase 1 makes thresholds travel with the encoder *before* any
artifact swap.

## Convergence roadmap

### Phase 1 — ArcFace on the web (the port)

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
   card, all `noCandidates`; likely a catalog-image/index-row problem.
   If so, the fix is in the shared builder input and repairs both.
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
