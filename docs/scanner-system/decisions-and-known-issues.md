# Decisions, lessons, and known issues

## Decision record

### Use per-game encoders behind one runtime contract

The original goal was one game-neutral encoder with independent shards. The
quick mixed-game job proved the mechanics, but Pokémon regressed materially
against the shipped model and Magic was much weaker than the other games.

The production-facing full runs were therefore isolated by game. This keeps
classification heads, checkpoints, catalogs, thresholds, and release versions
independent while preserving one preprocessing/vector/client contract.

Automatic browser mode supports heterogeneous encoders by running each model
and merging calibrated results. A true shared encoder remains a future
optimization, not a prerequisite for supporting more games.

### Keep detection and recognition datasets separate

Roboflow scene archives are suitable for card detection, crop, and real-camera
evaluation. They are incomplete as identity catalogs. Recognition is built
from authoritative provider catalogs and artwork mirrors.

### Use authoritative provider semantics

- Pokémon: provider series/format plus stable catalog identity;
- Magic: Scryfall paper cards and visible faces;
- Yu-Gi-Oh: YGOPRODeck cards and artwork identities.

Provider set-release/version feeds schedule work, but normalized catalog diffs
decide what changed.

### Make reproducibility part of the model contract

Catalog fingerprint, image-library fingerprint/revision, code revision,
checkpoint hash, model input contract, index row order, thresholds, and
evaluation must travel together. Resume is rejected on mismatch.

### Persist checkpoints every epoch

Long GPU jobs must survive interruption without losing the entire run. Game-
scoped paths prevent accidental cross-game resume and overwrite.

### Retire five-minute device authorization

Temporary device-code bootstrap jobs repeatedly expired and required user
presence. Persistent least-privilege CLI/Jobs credentials now handle repository
writes and job submission. A CPU preflight verifies permission before paid
hardware.

### Treat model, index, metadata, and thresholds atomically

Similarity thresholds live on one model's score distribution. Swapping an
index without its encoder and operating point silently rejects correct matches
or accepts wrong ones. Mobile stages the full release; browser index artifacts
carry the model URL and thresholds.

### Keep client delivery content-addressed

Immutable objects are cached long-term. Mutable manifests are revalidated and
published last. Rollback changes a manifest reference instead of rewriting
bytes.

### Compress browser indexes in transit

Large index JSON is stored with gzip content encoding. Browsers decompress it
natively and cache the parsed result in IndexedDB. Integrity diagnostics still
describe the decoded JSON that is parsed.

### Keep training images private

Public R2 contains runtime and product data only. Catalog artwork libraries and
phone captures remain private, versioned, provenance-reviewed, and pinned for
training.

### Do not quantize FastViT encoder weights to dynamic int8

Earlier dynamic int8 conversion destroyed FastViT embedding fidelity. The
deployed encoder remains fp16/fp32. Packed reference vectors may be int8 because
their scale cancels in normalized cosine search; these are different
quantization problems.

### Keep exact printing verification separate from artwork recognition

Embeddings identify visual artwork. Magic still needs face, set, and collector
number verification; Yu-Gi-Oh needs printed set-code verification where
artwork/passcodes repeat. OCR cannot be assumed to behave identically across
games.

### Future games are data extensions until they require code

A future game can provide catalog data, declarative pack rules, and a model
conforming to the scanner contract. It must not provide arbitrary remote code.
New executable recognition or pack behavior requires a reviewed app update.

## Confirmed Pokémon TCG Pocket contamination

The full Pokémon trainer metadata contains 21,828 rows. Exactly 2,321 rows
(10.6331%) are Pokémon TCG Pocket digital-only cards, leaving 19,507 physical
rows.

| Pocket set | Rows |
|---|---:|
| A1 | 286 |
| A1a | 86 |
| A2 | 207 |
| A2a | 96 |
| A2b | 111 |
| A3 | 239 |
| A3a | 103 |
| A3b | 107 |
| A4 | 241 |
| A4a | 105 |
| B1 | 331 |
| B1a | 102 |
| B2 | 234 |
| P / P-A | 73 |

Every contaminated row uses a TCGdex `/tcgp/` image path. Examples include
`A1-001 Bulbasaur`, `A4-001 Oddish`, `B1-331 Flame Patch`, and
`P-A-001 Potion`.

Root cause: the Pokémon normalization path accepted every row with an image URL
and did not preserve or filter the provider's `tcgp` series marker. The output
has `format: null` on every Pokémon row. The general product catalog correctly
recognizes TCG Pocket and may retain it for digital collection features; the
physical scanner must not.

Evaluation is contaminated as well: deterministic seed 22 selected 263 Pocket
identities among 2,500 evaluation identities, creating 789 of 7,500 augmented
queries. The published 98.24% Recall@1 is therefore not a physical-only metric.

Required correction:

1. preserve provider series and normalize `format: pocket|tabletop`;
2. exclude series `tcgp` from physical training/index ingestion;
3. defensively reject `format: pocket` and `/tcgp/` paths;
4. add snapshot and generic invariant tests;
5. rebuild metadata and matching vector rows at 19,507 physical cards;
6. publish corrected browser, iOS, and Android releases;
7. retrain and reevaluate physical-only Pokémon because Pocket occupied 10.6%
   of training classes.

Items 1–4 are now implemented at catalog ingestion, image-library ingestion,
trainer loading, and all three platform publishers. A local rebuild reproduces
19,507 physical rows with zero Pocket entries. Items 5–7 require the corrected
model/index build and release promotion; the contaminated 98.24% result remains
historical only.

Do not filter by A/B/P set-code regex. Physical sets may use uppercase codes and
future codes can collide.

Mobile currently filters Pocket candidates at runtime. The browser currently
does not, so replacing the browser index is the urgent client mitigation.

## Other open risks

### Real-camera acceptance is incomplete

Catalog retrieval is strong but does not cover glare, sleeves, foil patterns,
bad crops, motion blur, partial cards, perspective, or lighting. Magic and
Yu-Gi-Oh need dedicated held-out phone suites. Pokémon needs a clean physical-
only model/index rerun and replay comparison.

### Cross-game automatic calibration is incomplete

Scores from separate encoders are not automatically comparable. Browser merges
calibrated candidates, but mobile downloaded models remain explicit-mode until
held-out cross-game evidence supports routing thresholds.

### Magic is the weakest synthetic slice

Magic full Recall@1 is 91.2%. Its scale, repeated/shared artwork, multiple
faces, and many printings make identity and exact-print resolution harder.
Investigate errors by visual identity, face, and printing rather than treating
all misses as one class.

### Web operating point remains provisional

The browser uses the iOS-derived ArcFace 0.60 strong-accept and 0.05 ambiguity
margin. Its crop, shortlist, OCR, track averaging, and WASM path differ, so it
needs its own evidence sweep and regression gate.

### First two-stage durable image release is being prepared

The MTG two-stage pipeline materializes, audits, and uploads the private image
release in a CPU Hugging Face Job, then submits the L4 child only after an
immutable image revision exists. Until that job completes and its report is
reviewed, the earlier mutable-source release remains the deployed baseline.

The image-library and trainer hardening are implemented and tested, but the
first complete private dataset sync/upload/pin has not occurred. The completed
full models used mutable upstream URLs and therefore predate the current
reproducibility standard.

### Catalog and scanner universes differ

This is legitimate but must be explicit. Product catalogs can include formats
and printings not eligible for a scanner. Scanner metadata must still resolve
to catalog identities, and every release should record the catalog revision it
expects.

### Download systems are fragmented

Catalog, sealed products, offline pack assets, browser scanner, iOS scanner,
and Android scanner have independent manifests and hard-coded game registries.
The game-package framework is designed but not yet implemented.

### App asset strategy documentation was stale

Earlier documents described mobile R2 scanner delivery as future work. It now
exists. Bundled Pokémon fallback assets still matter for first-run behavior and
rollback, but downloadable per-game scanner runtimes are live.

## Failed experiments and what they taught us

| Failure | Lesson |
|---|---|
| Temporary five-minute auth flow | Authentication is infrastructure, not an interactive step inside GPU work |
| Fixed batch-one ONNX evaluated with batch 256 | Inspect input shapes; batch baseline inference when supported, otherwise iterate |
| Double-applied ImageNet normalization | The deployed graph owns its input contract; compare identical RGB pixels through model-specific preprocessing |
| Quick mixed-game model treated as a candidate replacement | Quick mode proves plumbing, not production quality |
| Dynamic int8 FastViT | Measure embedding parity and self-retrieval; small files are worthless if geometry collapses |
| Mutable image downloads during long runs | Build, validate, upload, and pin a durable image library first |
| Missing images represented by empty/zero rows | Fail closed or explicitly quarantine and compact indices |
| URL/row-based sample identity | Use visual identity and content facts so reorder and URL tokens cannot corrupt splits/cache |

## Definition of production-ready for a new game

A new game is not “supported” merely because a model file exists. It needs:

- authoritative catalog and stable identity mapping;
- explicit physical/digital eligibility;
- audited image coverage and provenance;
- pinned training inputs and resumable checkpoint;
- synthetic and real-phone evaluation;
- calibrated rejection/ambiguity thresholds;
- exact-print verification strategy;
- platform export parity;
- content-addressed releases and atomic installers;
- catalog resolution for every returned candidate;
- update, rollback, and removal tests;
- game-package capability metadata.
