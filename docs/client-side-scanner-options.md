# Client-Side Card Scanner — Options Review & Recommendation

**Date:** June 20, 2026
**Status:** Recommendation (no implementation decision committed yet)
**Goal:** A card scanner that runs **fully client-side** — embeddable as a website widget **and** on the iOS app — with **no server in the recognition path**.

> This document reviews the realistic options for getting TCGer's scanner to a true
> no-server, browser + iOS architecture, and recommends a direction. It builds on
> [`video-scan-implementation.md`](./video-scan-implementation.md) and
> [`browser-video-scan-session-2026-04-07.md`](./browser-video-scan-session-2026-04-07.md),
> whose empirical findings constrain everything below.

---

## TL;DR

Commit to **one shared self-supervised embedding model — DINOv2-small (ViT-S/14, 384-dim, Apache-2.0)** —
exported once to **ONNX (web)** and **CoreML (iOS)**, feeding a **single quantized vector index**.
Use the embedding only as a **top-K shortlist**, and break ties on near-identical cards with an
**in-set collector-number OCR tiebreaker** (Apple Vision on iOS, PP-OCRv5-mobile-ONNX in the browser).
Keep the YOLO11n-OBB detector, **drop DCT pHash** from the matching path, and add a cheap
**blur/stillness gate** before embedding (crop quality is the real ceiling).

The single most important finding: **no embedding model — generic or fine-tuned — separates true
twins (Houndour vs Houndoom, same-art reprints) by vision alone.** Every scanner that solved this
reached 90%+ only *after* adding card-number OCR. So the architecture is **"good-enough embedding
shortlist + OCR the exact print number,"** not "find a better model."

---

## Goal & Constraints

**Targets**
- **Browser:** an embeddable widget. Model must run via ONNX Runtime Web / Transformers.js (WASM, WebGPU when available). The reference index must download once and cache (IndexedDB / Cache API), ideally behind a service worker for offline-first.
- **iOS:** CoreML model + index bundled or downloaded-and-cached. Apple Neural Engine (ANE) available.

**Hard constraints (from prior empirical work — these bind every option)**
- The color-grid + HSV fingerprint **hit its ceiling**: ~77% of video frames are ambiguous (top-2 cosine gap < 0.01) at *all* grid sizes (8×8/12×12/16×16). Bigger grids did not help.
- **DCT pHash fails** on compressed/handheld crops (distances effectively random).
- **"Both sides must match"**: any preprocessing change requires rebuilding the entire reference DB. One-sided CLAHE/equalization *hurt*. This rule applies to embeddings exactly as it did to fingerprints.
- **Crop quality is the real bottleneck**: finger occlusion, background bleed through sleeves, motion blur, JPEG compression. Hardest case: near-identical cards (same artist/palette).
- YOLO11n-OBB detection is excellent (~98.7% recall) — **not** the bottleneck.
- OCR is orthogonal and valuable but only ~40% of frames yield readable text.

**Scale**
- Pokémon: ~21,900 cards (current scanner DB).
- MTG: ~90–100k printings (only 1,639 pHash entries exist today — large gap).
- Yu-Gi-Oh: ~13k+ (API integrated, no DB built yet).
- Any client-side index must plan for **125–135k total** vectors across all three games.

---

## Where We Actually Are (the gap to "no server")

| Target | Today | Server still required? |
|---|---|---|
| **Browser** | YOLO (TF.js, bundled in `frontend/public/models/yolo-card-detector/`) + artwork-grid 5% / HSV 95% match, all computed locally; IndexedDB caching | **Yes** — still fetches the 51 MB DB from `GET /cards/scan/artwork-fingerprints` on first load, then caches |
| **iOS** | `ArtworkFingerprintScannerStrategy` fully on-device (Pokémon, 51 MB `artwork-fingerprints-uint8.json` bundled, Accelerate vDSP cosine, 85% art / 15% HSV). Vision OCR name-search + MTG pHash also on-device | The **embedding** strategy is **scaffolding only** |

**iOS embedding path is 0% functional today:** `BoardCardEmbeddingScannerStrategy` is registered, but
`CardEmbeddings.mlmodelc` (CoreML model), `CardsIndexVectors.json` (vectors), and `CardsIndexMetadata.json`
are all **absent from the bundle**. `CardEmbeddingEncoder.makeModel()` throws `.modelUnavailable`, the
strategy catches it and returns `nil`, and the scan loop falls through to the next strategy. `AnnoyIndexStore`
is a brute-force JSON placeholder (no Annoy/ANN library, no `.ann` file).

**Backend embedding service** (`embedding-scan.service.ts`) is server-only: generic **ResNet18** (ImageNet,
final FC stripped → 512-dim), 224×224, ImageNet normalization, brute-force cosine over a float32 index,
Pokémon-only (`SUPPORTED_TCG = 'pokemon'`). **No accuracy benchmark for the embedding approach exists in the repo.**

---

## Options, Ranked

### 1. ⭐ DINOv2-small shared model + OCR tiebreaker — **recommended**
- **What:** DINOv2-small (ViT-S/14, **384-dim**, **Apache-2.0**) as the single shared encoder → export to ONNX (web) + CoreML (iOS) → one quantized index. Embedding = top-K shortlist; OCR collector number disambiguates.
- **Why it fits client-side:** one set of weights → one ONNX file (~14–24 MB at q4/int8, verified on `onnx-community/dinov2-small`) for the browser **and** one CoreML conversion for iOS, both emitting the **same 384-dim vector** so a **single reference index serves both targets**. 384-dim is the **smallest index** of any candidate (~1.5 KB/card fp32, ~0.4 KB int8) — friendliest to mobile-Safari memory and to scaling. Verified: DINOv2 leads CLIP on instance/fine-grained retrieval (the #1 failure mode) and is cleanly Apache-2.0 for commercial shipping.
- **Tradeoffs:** you must **own the CoreML conversion + ANE op-coverage validation** (no Apple-official export). DINOv2's edge is benchmarked on Oxford/Paris landmarks, **not** TCG art on bad crops — the transfer is **unproven and must be benchmarked** on your own twin pairs. Generic embeddings still won't split true twins by vision alone → OCR is mandatory.

### 2. CLIP ViT-B/32 (Xenova ONNX) — turnkey browser baseline to beat
- Zero-training, known-good Transformers.js path, exact ONNX sizes verified (fp16 176 MB, int8 88.6 MB, q4f16 53.3 MB). Fastest way to stand up a real client-side embedding pipeline and A/B it against DINOv2.
- **Tradeoffs:** CLIP-family is documented (original CLIP paper + 2024–25 follow-ups) to be **biased toward category-level concepts and weak at fine-grained discrimination** — exactly TCGer's hard case. Larger index (512 vs 384). Best used as the **baseline**, not the destination.

### 3. Fine-tuned small encoder (MobileNetV3-L / EfficientNet-Lite0 + sub-center ArcFace)
- Smallest/fastest backbone; **open-set** (add new cards/sets by embedding + appending, no retrain); compact custom-dim index shared across targets. Directly targets the color/HSV ceiling and top-K recall on real (sleeved/blurred) crops.
- **Tradeoffs:** a **second-stage optimization, not day-one.** Needs a training pipeline and — critically — **labeled real photos TCGer does not have yet** (catalog-only + augmentation is an unproven sim-to-real gap). ANE acceleration of a custom GeM/ArcFace-stripped head is **not guaranteed** (documented CoreML CPU fallback). Still doesn't solve twins without OCR.

### 4. ❌ MobileCLIP / MobileCLIP2 — **down-weighted to near-disqualified**
- On paper the cleanest dual-target story: Apple ships official CoreML image encoders **and** community ONNX exports producing 512-dim vectors; proven in two independent Pokémon scanners; tiny/fast (S0 = 11.4M params, 1.5 ms).
- **Blocker:** MobileCLIP and MobileCLIP2 weights — **including the timm/OpenCLIP redistributions** — are under **`apple-amlr` (Apple ML Research Model License), which explicitly restricts use to research and prohibits commercial product use.** For a shippable commercial app this is a **hard licensing blocker, not a footnote.** It also inherits CLIP's fine-grained weakness. *Do not build the roadmap on it.*

### 5. Keep color-grid (8×8) + HSV histogram; DCT pHash fallback
- Already ~95% client-side, pure Canvas/Accelerate, bundled on iOS.
- **Dead-end for accuracy:** capped at the measured ~68% confident frames; ~77% ambiguous at all grid sizes; pHash random on handheld crops. **Retain only as an offline fallback** before the embedding index is cached.

---

## Recommended Architecture (end-to-end)

Identical logical stages on browser and iOS; only the runtime differs.

1. **Detect.** Keep YOLO11n-OBB (~98.7% recall). Browser: existing TF.js model (defer the TF.js→ONNX-web migration — WebGPU is only default on iOS 26+, and WASM threads need COOP/COEP, which is friction for an embeddable widget). iOS: replace the legacy CPU `VNDetectRectanglesRequest` in `CardCropper.swift` with `VNDetectDocumentSegmentationRequest` (ANE-real-time, iOS 15+, corner-compatible). **Validate on foils/full-art** that it doesn't crop inside the card edge.
2. **Crop + rectify.** Rotated/perspective crop from the 4 corners. Crop the **full card** (not art-only): art-only forces a full index rebuild ("both sides must match") and strips the name/HP/collector-number text the OCR stage needs.
3. **Quality gate (NEW — cheap, high-leverage).** Laplacian variance (<2 ms on a small crop) + frame-difference stillness; skip embedding on blurred/moving frames. **This is net-new code** — today every frame is embedded with no sharpness check, and the existing EMA is only a quad-jitter smoother, not a stillness gate. Calibrate the threshold on labeled sharp/blurry samples (not a magic constant).
4. **Embed.** DINOv2-small on the rectified crop, with **byte-identical preprocessing on both targets** (mismatched resize/pad/normalize silently breaks the shared index). Browser: ONNX Runtime Web (WASM default, WebGPU when available — benchmark per device; WebGPU is often 3–10× faster than WASM even at batch=1, so don't assume parity). iOS: CoreML via the existing `CardEmbeddingEncoder.swift`, which already loads a generic `image`→`embedding` model — dropping in `CardEmbeddings.mlmodelc` wires it up with ~no code change. Output: one L2-normalized 384-dim vector.
5. **Search (top-K prefilter).** Cosine over the quantized index → top-20. Today (21.9k cards): **brute-force int8 cosine** — exact, ~8–11 MB, zero-dependency, identical on both targets (iOS already has the brute-force store; swap JSON → packed int8 binary + Accelerate vDSP). **Always float32-rescore the top-N** to recover quantization recall.
6. **Disambiguate (beats the 77%).** Within the shortlist, OCR the in-set collector number and match against each candidate's known `(setCode, collectorNumber)` — exactly how TCGer keys identity (`externalId` = `SET-NUM`). iOS: **Apple Vision** `VNRecognizeTextRequest` (free, on-device, ~0 MB) on a tight perspective-corrected **footer crop**, upscaled, with `minimumTextHeight` lowered and a per-game regex (Pokémon `NNN/NNN`; MTG `NNN/NNN SET R`; YGO 8-digit passcode). **Net-new work** — the shipped `PokemonTextScannerStrategy` OCRs the full frame for a *name* search with no footer crop/upscale/whitelist, so tiny digits sit at/below Vision's ~1/32 floor today. Browser: PP-OCRv5-mobile-ONNX (prefer over Tesseract.js — documented mobile-Safari OOM/hangs); gate the choice on an in-Safari latency+memory benchmark.
7. **Fuse + track.** Combine embedding cosine with OCR set-number agreement; reuse the existing multi-frame EMA/track voting. Surface "confident" only when embedding top-1 and OCR agree, or embedding margin is large; otherwise keep accumulating frames (OCR reads ~40% of frames, so vote over time).

**Drop from the matching path:** DCT pHash. **Keep as offline fallback only:** color-grid + HSV.

---

## Shared Browser/iOS Model Strategy

Pick **one** backbone whose license permits commercial shipping and whose preprocessing you fully control:
**DINOv2-small (Apache-2.0).** Export the *same* checkpoint twice — (a) ONNX (q4f16/int8) for ONNX Runtime
Web, (b) CoreML via `coremltools` for iOS — both emitting the **same 384-dim L2-normalized vector**, so **one
reference index** (one int8/HNSW binary + one `meta.json` mapping index → `externalId`) is generated once and
shipped to both targets.

**Non-negotiable discipline:** preprocessing parity (resize, pad, color order, normalization) must be
**byte-identical** between the ONNX and CoreML paths, and the index must be built from the **same encoder that
runs on-device**. Validate ANE op-coverage on the converted model (CoreML can silently fall back to CPU/FP16).

The iOS scaffolding is already shaped for this plug-in: `CardEmbeddingEncoder.swift` loads a generic
`image`→`embedding` `MLModel`, and `AnnoyIndexStore.swift` does cosine over a vector list — so a correctly
exported `CardEmbeddings.mlmodelc` + packed vectors binary + `CardsIndexMetadata.json` light up the existing
strategy with minimal Swift changes.

---

## Index & Scale Strategy

**Sizing (384-dim, verified arithmetic)**

| Catalog | fp32 (~1.5 KB/card) | int8 (~0.4 KB/card) | binary (48 B/card) |
|---|---|---|---|
| Pokémon (21.9k) | ~33 MB | ~8.4 MB | ~1 MB |
| 3-TCG (~125–135k) | ~200 MB | ~52 MB | ~6.5 MB |

Always pair quantized vectors with a **float32 top-N rescore** (recovers ~94–98% int8 / ~87–98% binary
retrieval quality — but those are *text* benchmarks, so **benchmark on TCGer's own near-twin pairs**, because
even 2–5% recall loss can pick the wrong evolution).

**Search by scale**
- **Now (21.9k):** brute-force int8 cosine. Exact, tiny, zero-dependency, identical code on both targets. iOS → Accelerate vDSP; browser → typed-array loop (or WebGPU compute).
- **Scaling to 100k+ (MTG/YGO):** ship a **prebuilt HNSW** binary — **never build HNSW in the mobile browser** (MeMemo: ~94 min to build 1M vectors; a ~256 MB/tab RAM floor caps ~83k fp32 384-dim vectors resident, which int8/binary + on-disk mmap relieves). Candidate: **`usearch`** (WASM/npm + Swift package, i8/b1 quantization, mmap) — but **round-trip-test one index across the WASM and Swift builds** before relying on a single shared format. Treat its "100M on iPhone" as unverified marketing; measure live-camera query latency at your scale. EdgeVec is a desktop-only watch-item, not a pick.

**DB delivery (closes the "still fetches 51 MB from backend" gap)**
Replace the runtime `GET /cards/scan/artwork-fingerprints` dependency with a **static, versioned, CDN-hosted
index artifact**: download-once into IndexedDB/Cache API in the browser (service worker for offline-first),
bundle-or-download-and-cache on iOS. **Split per TCG** (and optionally per chunk) so users pay only for games
they scan; version it so an encoder/index rebuild invalidates cleanly. The int8/binary 384-dim index makes even
the full 3-TCG catalog small enough (~6.5–52 MB) to ship as a cached static asset — finally server-free.

---

## Disambiguation Strategy (beating the 77% ambiguity)

The embedding **never decides near-identical cards alone** — it produces a top-K shortlist, and the **in-set
collector number** decides among them. This is the only approach that directly attacks the verified ceiling
**and** is catalog-size-independent (scales to 100k+/MTG/YGO unchanged), because identity is keyed on
`(setCode, collectorNumber)` which the codebase already parses from `externalId`.

1. Embedding returns top-20.
2. Compute a tight perspective-corrected **footer crop**; **upscale** it (counter Vision's ~1/32 `minimumTextHeight` floor and tiny stylized digits).
3. OCR with a **per-game format/regex** and digit-biased whitelist (Pokémon `NNN/NNN`; MTG `NNN/NNN SET rarity`; YGO 8-digit passcode + set code).
4. Intersect the OCR'd number/denominator with the shortlist's known collector numbers; pick the match.

Engine split: **Apple Vision** on iOS (free, on-device, ANE, 0 MB); **PP-OCRv5-mobile-ONNX** in the browser
(gated on an in-Safari benchmark; avoid Tesseract.js as the primary mobile engine). Budget this as **net-new
work on both platforms** — there is no reusable footer-OCR crop today (the existing "footer" artifact is a
color-histogram band, and the backend OCR doesn't even apply a digit whitelist). Only ~40% of frames yield
readable footer text, so use **multi-frame voting**: accumulate OCR reads and require embedding-top-1 + OCR
agreement (or a large embedding margin when OCR is absent) before declaring confidence.

If, after benchmarking, generic DINOv2 still can't get true twins into the top-K, **then** fine-tune
(Apache-2.0 base, legal to ship) on mined real frames and keep OCR as the final arbiter.

---

## Quick Wins (worth doing regardless of the migration)

- **Add a Laplacian-variance blur + frame-difference stillness gate** before matching/embedding (<2 ms, biggest cheap accuracy lever; today every frame is embedded with no sharpness check).
- **Drop DCT pHash** from the matching path now (random distances on handheld/compressed crops); keep color-grid + HSV as the offline fallback.
- **Swap iOS** `VNDetectRectanglesRequest` → `VNDetectDocumentSegmentationRequest` (ANE-real-time, iOS-15+, corner-compatible, zero model to ship — validate on foils/full-art).
- **Fix the iOS OCR** to crop + upscale a tight footer and lower `minimumTextHeight` so collector-number digits clear Vision's ~1/32 floor — turns already-on-device Apple Vision into a real disambiguator.
- **Move the artwork DB off the runtime backend endpoint** to a static, versioned, CDN-hosted file cached in IndexedDB/Cache API behind a service worker — closes the "not yet server-free" gap for the *current* pipeline immediately.
- **Re-quantize the shipped index to int8** (with float32 top-N rescore): ~4× smaller, shrinks download + mobile-Safari memory pressure.
- **Stand up the CLIP-ViT-B/32 (Xenova ONNX) browser baseline** as a 1–2 day spike to de-risk the whole client-side embedding path before investing in DINOv2 conversion.

---

## Migration Path

0. **Build an eval harness first.** Assemble a labeled set of real handheld frames including the hard twin pairs (Houndour/Houndoom, same-art reprints); define metrics (top-1, top-K recall, twin-pair accuracy, confident-frame rate). Mine real frames from existing scan sessions — TCGer has **zero labeled real photos today**, and this gates every later decision.
1. **Turnkey browser baseline:** integrate CLIP ViT-B/32 (Xenova ONNX, int8/q4f16) via ONNX Runtime Web behind the existing YOLO crop; build the prefilter + brute-force-cosine path. The baseline to beat.
2. **Export DINOv2-small to ONNX** (q4f16/int8) and benchmark **head-to-head** against CLIP on the harness, focused on near-identical pairs and bad crops. If DINOv2 wins as expected, lock it as the shared backbone.
3. **Convert the same DINOv2-small weights to CoreML** via `coremltools`; validate ANE op-coverage and that CoreML/ONNX outputs match (byte-verify preprocessing parity). Drop `CardEmbeddings.mlmodelc` into the bundle.
4. **Generate one reference index** from the on-device encoder: int8 384-dim vectors + `meta.json`. Replace `AnnoyIndexStore`'s JSON load with a packed int8 binary + Accelerate vDSP cosine + float32 top-N rescore; ship the same binary to the browser.
5. **Add the quality gate** (Laplacian blur + stillness), threshold calibrated on labeled samples.
6. **Build the collector-number OCR tiebreaker:** iOS footer crop + upscale + lowered `minimumTextHeight` + per-game regex via Apple Vision; browser PP-OCRv5-mobile-ONNX (gated on an in-Safari benchmark). Fuse via `(setCode, collectorNumber)`; add multi-frame OCR voting.
7. **Swap the iOS detector** to `VNDetectDocumentSegmentationRequest` (validate on foils/full-art) and **drop DCT pHash** from the matching path.
8. **Cut over DB delivery** to a static, versioned, CDN-hosted, per-TCG index cached in IndexedDB/Cache API (service worker) on web and bundled/cached on iOS — eliminating the `GET /cards/scan/artwork-fingerprints` dependency. **True server-free recognition.**
9. **Scale-out:** build MTG/YGO indexes with the same encoder; at ~100k cards, migrate brute-force → prebuilt HNSW binary (evaluate `usearch`; round-trip-test across WASM+Swift). Never build HNSW in the mobile browser.
10. **Only if** benchmarks prove the encoder (not crop quality) is the residual bottleneck: fine-tune a small encoder (MobileNetV3-L/EfficientNet-Lite0, sub-center ArcFace head dropped at inference) on catalog + mined real frames; re-export to ONNX+CoreML, rebuild the index (both sides must match), keep OCR as final arbiter.

---

## Risks & Open Questions

- **DINOv2's fine-grained advantage is benchmarked on landmarks, not TCG art on compressed handheld crops** — unproven transfer; benchmark on your own evolution-line pairs before committing.
- **No generic embedding (DINOv2 or CLIP) separates true twins / same-art reprints by vision alone** — the plan depends on the collector-number OCR stage working on real footer crops (net-new; ~40% of frames readable).
- **Zero labeled real photos today** — catalog-only + augmentation has an unproven sim-to-real gap. Mining real scan frames is a prerequisite for both benchmarking and any fine-tune.
- **CoreML conversion of DINOv2 may not fully map to the ANE** (silent CPU/FP16 fallback documented) — profile per-op before trusting on-device latency.
- **Preprocessing parity** between ONNX (web) and CoreML (iOS) must be byte-verified, or the shared index silently breaks.
- **Quantization recall figures are from text benchmarks** — measure on TCGer's hard pairs with float32 rescoring before shipping binary/int8.
- **In-browser ANN beyond ~50–100k is unproven on mobile Safari**; `usearch`'s single-shared-index-format across WASM+Swift is plausible but not guaranteed — round-trip-test before relying on it.
- **WebGPU is only default on iOS 26+**; older iPhones fall back to WASM (slower), and an embeddable widget hits COOP/COEP friction for WASM threads — a WASM single-thread fallback is mandatory.
- **`VNDetectDocumentSegmentationRequest`** returns a single document and is trained on paper — validate against glossy foils/full-art and the single-card UX.
- **Multi-TCG scale:** MTG full Scryfall is ~90–100k printings vs 1,639 hashes today, and zero YGO DB — building those indexes (and per-game OCR regexes/art regions) is substantial net-new data work.
- **Lock the on-device embedding dimension** (384 for DINOv2-small assumed here) before final index sizing — all storage math revalidates once the model is fixed.

---

## How This Review Was Produced

A multi-phase agent workflow (June 19–20, 2026): (1) verified the current code state across the browser,
iOS, embedding-service, and data-scale areas; (2) web-researched six option families — in-browser embedding
models, fine-tuned encoders, client-side vector search, OCR/collector-number, detection+crop quality, and
real-world client-side reference implementations; (3) adversarially fact-checked the riskiest quantitative
claims (model sizes, latencies, scaling limits, licenses); (4) synthesized this recommendation. The
MobileCLIP licensing blocker and the "embedding-alone can't split twins" conclusion came out of the
verification phase and materially shaped the ranking.
