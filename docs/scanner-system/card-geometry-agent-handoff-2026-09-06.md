# Card geometry — AI agent handoff, 2026-09-06

## Start here

This handoff covers the recent card-outline training, corpus/tooling repairs, benchmarks and failure analysis. It is current through **`b3134c60`** on branch **`claude/tcg-card-recognition-review-fkwkvl`**. It does not replace the [scanner architecture index](README.md) for the broader app, catalog and per-game recognition system.

**Current conclusion:** the experiments and diagnosis are complete, but the candidate models are not ready for promotion. A confirmed importer defect trained on slabs and card subregions as if they were whole cards. **That defect has been diagnosed and quantified, NOT repaired yet.** The next agent should repair that boundary and validate the corrected training material before preparing another frozen experiment. Do not restart the same old run, claim a new corpus exists, or ask the user to relabel hundreds of evaluation frames.

Read these next:

1. [Completed failure analysis and visual comparisons](benchmarks/2026-09-06-real-failure-audit/ANALYSIS.md).
2. [Completed YOLOX loss-repair experiment](benchmarks/2026-09-06-yolox-loss-repair/README.md).
3. [Original round-two corpus/configuration freeze](benchmarks/2026-09-05-round-two-freeze/README.md).
4. [Machine-readable handoff pins and all four candidates' metrics](card-geometry-agent-handoff-2026-09-06.json).

Older dated experiment notes deliberately preserve their original state. Statements such as “next stage,” “diagnostic-only,” and “training in progress” in those notes can be stale. In particular, the YOLOX validation-repair-v2 run subsequently completed, and the normalized loss subsequently received its own full repair experiment. Use the later immutable result receipts and this handoff for current status.

## What the user wants and the rules already agreed

The goal is trustworthy card outlines and crops across real handheld, binder, sleeve, perspective and multi-card scenes, with a fair, reproducible model comparison. The user wants the agent to perform the investigation and necessary work, not repeatedly ask for permission or delegate obvious model failures back to them.

The accepted execution order was **trainer repair and self-validation → incumbents on the v6-full successor → frozen corpus and training-minimums-v3 → candidate results**. That sequence was followed for round two. Later execution and loss repairs have distinct receipts and experiment lineage because they happened after earlier results were available. Preserve that distinction for the next repair.

Keep these requirements:

- Whole archives and their forks/re-exports stay in one split. Resolve each `sourceArchiveId` through a declared `sourceArchiveAliases` table, including self mappings; unmapped archives fail preflight. Source asset IDs are an independent leakage key.
- Check training against **every** pinned evaluation release for canonical archive, session, source asset, physical card and exact image SHA-256 overlap. Exact image hashes must also be disjoint across release splits. pHash is an additional audit, not a substitute.
- Real context margins come from `fairness.realContextMarginPolicy`, covered by the experiment hash. The existing round-two value is `ceil(0.15 * max(width, height))` on each side. Synthetic records retain their declared margins.
- Genuine unknown-corner **card** instances remain boxes with no corner supervision. YOLO keypoint visibility is zero. FastViT masks only the negative focal term over those boxes, preserving positive supervision. Aspect/residual-rejected card polygon fits get the same treatment. Drop the image if such a card instance has no usable box. The new category repair must not undo this behavior.
- Background provenance retains reviewer, source identity/session status and crop/file hashes; all v6-full and Dev Mode sessions remain excluded from training backgrounds and training images.
- Frozen evaluation releases are immutable. Alias migration successors preserve record/image bytes, splits and scene slices, and benchmark reports carry predecessor and successor hashes. A label correction is not an alias-only migration.
- Preserve historical reports. No threshold/model/data selection on held-out results without declaring a new follow-up experiment. No deployment or model export is implied by passing training or a benchmark.
- YOLO11n/s are **evaluation-only** candidates in the existing configs. Respect the declared license route before any distribution decision.

## What was done, what failed, and what fixed it

| Stage | Finding / attempted work | Outcome and evidence |
|---|---|---|
| Reference inventory | Audited unused archives, forks, source splits, trainers and backgrounds. Corrected an earlier mistaken interpretation of the canonical audit as a whole-archive split. | [Reference audit](reference-unused-materials-audit-2026-09-04.md). It describes existing archive record splits; do not reuse it as a computed assignment. |
| Release leakage repair | Existing archive key did not resolve fork IDs. Added alias resolution and unmapped-ID failure; fixtures place a fork across splits. | `4dbe6c51`; `corpus_release.py`, `preflight.py`, fixture releases. |
| Evaluation migration / cross-release gate | Required aliases broke old releases under current preflight. Published alias-compatible successors with `supersedes` and byte/split/slice preservation evidence; added training-vs-evaluation leakage gate. | `bb8f1684`; [migration evidence](benchmarks/2026-09-04-evaluation-v2/); `migrate_evaluation_release.py`. |
| Exact duplicate defense | Differently named/self-mapped archives could still contain identical image bytes. | `01e5d859`; image SHA-256 participates in within-release and cross-release disjointness. |
| FastViT initialization | Classification checkpoint keys did not match flattened feature-model keys; `strict=False` silently loaded none. | Strictly load 462 classification keys before retaining 444 feature keys; log keys, atomic epoch history, finite losses. [Trainer repair](benchmarks/2026-09-04-trainer-repair/README.md). |
| Real ingestion / unknown corners | Synthetic-only assumptions and dropped instances distorted supervision. | Declared real margin policy; preserve box-only and rejected-fit card instances; YOLO visibility-zero targets; FastViT negative-term ignore mask. See same trainer-repair evidence. |
| Initial YOLOX runtime | Validation/config/zero-visible-keypoint defects, dtype dependency, LR scaling and inherited resize behavior. | Guarded upstream patch, validation from epoch 1, AdamW LR `0.004 * batch / 256` (0.00025 at batch 16), no second autoscale, explicit BGR float loading, runtime fixture and train-split self-evaluation. |
| Incumbents | Re-evaluated seven exports after trainer repair, before round-two assembly. | [All seven completed](benchmarks/2026-09-04-incumbents-v6-successor/README.md). Archived `device` lacks output for 502 archive images; it is not fresh inference or the complete current binder pipeline. |
| Background shortage | All 100 old Dev Mode crops violated the exclusion rule. User requested external pictures. | [60 reviewed Poly Haven CC0 textures](benchmarks/2026-09-05-cc0-backgrounds/README.md), split by source family/similarity: 48 train / 12 validation. These are surfaces, not real hands/sleeves/binder photographs. |
| Round-two freeze | Mixed real archives with new synthetic scenes; performed exact leakage, provenance, ingestion and perceptual audit. | [Freeze](benchmarks/2026-09-05-round-two-freeze/README.md): 15,744 images; 19 preflight checks passed. Four candidates, 50 epochs, input 640, seed 20260905, one repeat, no runtime augmentation. |
| Bootstrap failure | Ultralytics dependency install upgraded NumPy to 2.4.6. | Original four jobs canceled before optimization. [Replacement bootstrap](benchmarks/2026-09-05-round-two-freeze/bootstrap-repair-v1/README.md) reinstalls/asserts NumPy 1.26.4 after dependencies; preserves fairness settings. |
| YOLOX epoch-2 CUDA failure | Pose keypoints were truncated before indexing with full-list NMS indices; parent YOLOX path could return >300 boxes. | [Validation repair v1](benchmarks/2026-09-05-round-two-freeze/yolox-validation-repair-v1/README.md): preserve index lists and parent box order, not index clamping. Saved epoch-2 model/EMA/optimizer/scheduler state retained. |
| First resume failure | Standalone `tools/test.py` failed with CocoMetric `KeyError: id` before optimization resumed. | [Repair v2](benchmarks/2026-09-05-round-two-freeze/yolox-validation-repair-v2/README.md): include sample `id` in inference metadata; fixture exercises actual subprocess; full checkpoint validation before epoch 3. Run eventually completed. |
| Completed original YOLOX still unusable | 50 epochs completed but shared decoder accepted no quads; third predicted corner lay near first, yielding invalid polygons. | [Corner-learning diagnostic](benchmarks/2026-09-06-yolox-corner-learning/README.md): source targets and actual loader/decoder coordinate round trips did not explain the collapsed corner. |
| Loss experiments | Original OKS objective saturated to exactly zero gradient for the distant corner. Tested original OKS vs normalized L1 on identical generated fixtures. | 80 steps restored gradient but did not yield quads; separately declared 800-step extension produced 3 accepted fixture quads with L1, zero with OKS. Final third-corner error: L1 0.34 px vs OKS 319.67 px. Fixture convergence, not generalization. |
| Full YOLOX loss repair | Fresh detector-base initialization, explicit normalized L1 weight 30, original OKS assigner; repaired PIL→MMDetection BGR adapter. | [Separate 50-epoch experiment](benchmarks/2026-09-06-yolox-loss-repair/README.md) completed AMP fixture, training, all-train self-eval, both benchmarks and recognition replay. |
| Raw-stage audit | Captured post-framework boxes, raw quads, shared-decoder decisions on 600 held-out baseline images and 88 fixed validation images. | Both diagnostic jobs completed; final predictions equal saved originals on **600/600** records for each model. No training in these jobs. |
| YOLO11s color probe | Existing numpy input is RGB where Ultralytics expects BGR. Validation-only corrected variant checked against PIL input. | PIL/BGR parity passed. Real-validation IoU .50/.75/.90 counts stayed **31/27/13**; not the main explanation. **Default YOLO11 adapter has not been changed yet.** |
| Human review interface | User offered to compare models in a familiar four-corner editor. Built side-by-side stages, crop previews, optional corner edits and durable review journal. | [Viewer instructions](benchmarks/2026-09-06-real-failure-audit/README.md). User then asked the agent to analyze instead. Do not ask them to redraw existing evaluation labels. |
| Completed automatic + visual analysis | Traced misses and canonical categories; inspected binder, duel, crops and real training examples. | `b3134c60`; [analysis](benchmarks/2026-09-06-real-failure-audit/ANALYSIS.md). **Category defect identified, not fixed.** |

## What we have been using

### Data and release identities

Local releases live under `.artifacts/card-geometry/releases/`. Dataset Hub repository: **`ahzs645/tcger-scanner-images`**.

| Role | Release | Immutable dataset revision | Corpus SHA-256 |
|---|---|---|---|
| Current historical training | `card-geometry-training-round-two-v1` | `cabee73ac46a5901cc3060cfd17b7c63408bf66a` | `286d1196e9f0c85a37779ec52c6e9ba2f1533224a62c066dc93269c26720dbc4` |
| Real evaluation | `real-geometry-evaluation-v6-full-aliases-v2` | `3e03b753158b602b9f4ec3bdace2de05a5b2e5f2` | `631cc7f9ac24b19d5e7587f5c5aefa401f911cfcf4ed52ab6858ea29d3740dd7` |
| Synthetic evaluation | `synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2` | Same evaluation revision | `fb3eca1aa55d99cbff03c1f0eb58600884be879af2d75b8b4becc3d94932ba05` |

Real predecessor hash: `7a75cc5ba2f0ac429136fa67f75b473e09c05f6edaee112bf0f5b1ba701a188a`. Synthetic predecessor hash: `bda45771be01d50bde130b6a68afe91ad509154df9aa26050f9cfdf30aad809a`.

Training-minimums-v3: `tools/card-geometry/policies/training-minimums-v3.json`, hash `679dd02c8e6280f2043978e007ea16d9608eba9a0c74ea2766477b885c4e56da`. Do not weaken this policy to get a successor through preflight; if changing it is necessary, declare a new version and explain why.

The release manifest is now `card-geometry-release-manifest.v2.schema.json`; experiment schema v2 also exists. Current frozen configs use `evaluations.frozenReal` and `evaluations.syntheticMultigame`. Historical output filenames such as `real-v3.benchmark.json` and `synthetic-duel-field.benchmark.json` are not the authoritative release names—read their pinned hashes. Do not rename historical experiment inputs in place.

Historical training composition: **5,744 real + 10,000 synthetic images**; 13,465 train + 2,279 validation images; 45,172 stored instance targets. That last count includes the newly discovered non-card targets, so do not present it as 45,172 valid whole cards. Synthetic assets: 3,400 split-separated faces, three train-only backs, 60 external textures. The recorded session exclusion inventory contains 43 Dev Mode/evaluation sessions.

External Poly Haven assets have no TCGer capture session: their `sourceSessionId` is explicitly null with an explanatory status, while provider/source-family identities remain recorded. Do not invent a session or relabel excluded Dev Mode crops as external backgrounds.

The pHash audit flagged 14 pairs, reviewed as distinct synthetic scenes (mostly shared low-frequency templates). It did not find real-evaluation pairs. That is documented residual template similarity, not proof of all possible near-duplicate absence.

### Models, runtimes and artifacts

Private model/artifact repository: **`ahzs645/tcger-universal-arcface`**. Never rely on mutable `main` when retrieving experiment evidence.

- Original round-two FastViT, YOLO11n and YOLO11s results are pinned at model revision **`36f35b46b81da49458276fbfb1a3ebaa19c935c8`**. Their exact experiment hashes/prefixes and metrics are copied into the companion handoff JSON. Local reports: `.artifacts/card-geometry/round-two-current-results/<candidate>/`.
- Repaired YOLOX full-run result revision: **`a6dc39fbf3c4dde47402a9b0ca28124330dd3507`**. Checkpoint SHA-256: **`8ee7d280b65e438742f4d7a2c3684c3f00701b0204361a16616b836fedf4f41c`**. New experiment hash: `08c4024752c8b71b213f87ef1daa3fb3200470d9e681f951b7022e73670963d2`; fairness hash `207664bfa5e9af2f6aea880e5795f182677d091eee683c59161dcfc42eeccdf0`. Read the [verified result receipt](benchmarks/2026-09-06-yolox-loss-repair/result-verification.json).
- Audited YOLO11s best checkpoint SHA-256: **`fee23a78a4a16b93fed51ff802dc620db4d88bcf55278f5db14f56f180f1b351`**. Full checkpoint/model-config Hub paths and revisions for both audited models are in `benchmarks/2026-09-06-real-failure-audit/audit-inputs.json` and the handoff JSON.
- MMYOLO revision: `8c4d9dc503dc8e327bec8147e8dc97124052f693`. YOLOX original detector base is SHA-256 `3a8dfbd76b4493580449925f6cd01d1ae3b2b7425c6d1ed168dbe5282920c9b3`. Reuse the pinned container and bootstrap commands from the actual experiment receipts; do not assemble an ad hoc upgraded OpenMMLab stack.
- Full candidate runs used one L4 each with bounded job timeouts. Full YOLOX repair used 50 epochs, batch 16, 640 input, seed 20260905, fresh optimizer and original detector-base initialization. It was **not** continued from the failed learned-corner checkpoint.
- Recognition is a separate stage using the pinned per-game ArcFace ONNX encoders, metadata and vectors at revision **`3e51bbba70c6fbc6d07bdc6d1f4ea4ac7a00f7cb`**. Exact hashes, game normalization and thresholds are in `evaluations.recognitionModels` in the repair config / handoff JSON. Do not assume locally found model files match without hashing them.
- Training/self-evaluation reproduces declared context margins and JPEG quality-95 materialization. Historical held-out geometry uses the original evaluation padding contract. Recognition uses a 720×1000 image-edge/bilinear/black-border crop without inset; replay tests 0° and 180° and selects the better encoder score.
- Frozen shared decoder: confidence .05, quad-area minimum .001, exterior margin .25, quad NMS IoU .5, aspect bands [.5, 3]. Raw framework settings differ by candidate. Native boxes in the audit are **after** framework score filtering/NMS, not all network proposals.

### Important jobs — completed unless explicitly marked failed

| Work | HF job ID |
|---|---|
| Round-two YOLO11n | `6a9c6665e686246ca69a4373` |
| Round-two YOLO11s | `6a9c6670e686246ca69a4377` |
| Round-two FastViT | `6a9c6687e686246ca69a437c` |
| Original YOLOX, failed after epoch 2 | `6a9c667be686246ca69a437a` |
| First YOLOX resume, failed metadata gate | `6a9c8770e686246ca69a45e5` |
| Successful original YOLOX resume to epoch 50 | `6a9c9300259f8e97255e4a0e` |
| Paired gradient probes, 80 / 800 steps | `6a9d257ae686246ca69a5254` / `6a9d26f6e686246ca69a527a` |
| Fresh full YOLOX loss repair | `6a9d91e8259f8e97255e75af` |
| YOLOX / YOLO11s raw-stage audit | `6a9dea44e686246ca69a6bfb` / `6a9dea4f259f8e97255e8917` |

Job URLs use `https://huggingface.co/jobs/ahzs645/<job-id>`. The two audit result revisions are `538ef66e60e2e773e1fa07553fef6b59f74e8cc7` (YOLOX) and `5e707d3125dd93a9cc340e52182ea4e8730dd10d` (YOLO11s). Their input publication is pinned at `626d5df0ccc7fa0e2553a3859863dfaf0e26825c` with tooling `c7df7f4a09ad52c89ea50ad87ddc22f01de2e99d`.

No further training was launched after the diagnosis. Verify live job status if continuing much later; receipts here describe completed scoped work, not every job in the account.

## Current results and their limits

| Candidate | Real recall .50 | Real recall .75 | Real extras / duplicates | Synthetic recall .50 |
|---|---:|---:|---:|---:|
| FastViT-T8 four-corner | 78.86% | 49.29% | 316 / 3 | 41.25% |
| YOLO11n pose | 91.00% | 70.86% | 403 / 5 | 82.94% |
| YOLO11s pose | 95.86% | 77.71% | 288 / 26 | 90.96% |
| YOLOX, fresh loss repair | 60.14% | 58.29% | 7 / 0 | 92.52% |

Real denominator: 600 images / 700 scorable cards. Synthetic: 1,000 images / 3,651 cards. Original unrepaired YOLOX had **zero accepted quads**; do not conflate it with the fresh loss-repair row. These are not fully symmetric experiments: the YOLOX repair was chosen and declared after original results exposed the loss failure.

The real total is dominated by 502 archive images / 561 cards. Binder has only 3 images / 27 cards; duel has 18 / 33. YOLOX binder: 0/27, with zero native boxes. YOLO11s binder: 27 loose matches but only 5 tight (.75) matches, plus 34 extras and 7 duplicates. This is why the viewer looked bad despite high headline recall.

The repaired YOLOX passed train-split self-evaluation on all 13,465 training images: 34,687 / 36,078 scorable targets matched at .50 (96.14%). This proves fit/execution, not generalization; its explicit gate only requires at least one matched target and is intentionally not a deployment threshold. Some targets are now known to be non-card regions.

Recognition denominator correction: of 57 replay frames, **11 have verified identities**, 42 have unknown identities and 4 only test specific forbidden accepts. On the 11 identified frames: YOLOX 2 correct / 9 abstain / 0 wrong; YOLO11s 4 correct / 6 abstain / 1 wrong. Do not call this “2 of 57 correct” or count 44 unknown outcomes as errors. A reasonable Tranquil Cove crop still receives a wrong-family outcome, so encoder/index/identity behavior needs separate checking; label-crop recognition replay has **not** been run.

## Confirmed new defect versus hypotheses

**Confirmed:** `build_real_smoke_release.add_canonical_archive` sends all `row.annotations` to `_mask_instance`, which emits `detectionClass: card`, `container: unknown`. The canonical builder and source config preserved category distinctions correctly; the geometry importer lost them.

Trace on the frozen training release:

- Train: 312 affected images; 749 non-card targets (235 slabs, 257 titles, 211 information regions, 46 collection regions); 226 of these received trusted corner targets.
- Validation: 235 affected images / inner-border targets; 199 received trusted corners. They constitute 199/393 (50.6%) of the real validation corner-supervised instances.
- Actual card-category training annotations: 6,281; known corners on 2,176 (34.6%). The old 537 “multi-card images” meant multiple annotations of any category. There are 261 training images with multiple **card-category annotations**, which still does not prove distinct physical-card counts.
- The canonical evaluation portion has 561 card-category annotations and no non-card categories. The defect therefore does not invalidate that portion of the evaluation truth by this mechanism.

**Supported but not causally apportioned:** the category defect plausibly causes extra/nested/partial-card detections; a real-scene supervision gap plausibly contributes to failure on sleeves/binders/perspective. A controlled repaired-data run is needed to measure their effects.

**Ruled out as the sole explanation:** shared decoder rejection cannot explain YOLOX binder misses because there are no input boxes. The color correction does not improve the fixed real-validation recalls. Loader coordinate/visibility checks and the pose decoder round trip passed in the loss diagnostic.

**Open label QA:** the steep Giratina frame ending `021546fdb85857d9` has a label crop extending outside capture and losing visible card content. Flag specific cases; do not silently revise frozen truth or demand wholesale relabeling. Unmatched outputs on partially labeled/box-only scenes are not necessarily invented physical cards.

## Concrete path forward

### 1. Repair categories before generating a new corpus

Work in `tools/card-geometry/build_real_smoke_release.py`, particularly `add_canonical_archive` / `_mask_instance`. Use `tools/card-segmentation-data/source-config.json` as the existing category contract. Whole-card geometry targets should come from canonical `card` annotations; auxiliary/context annotations should be accounted for explicitly, not quietly converted into cards. Decide and document handling of missing/unknown categories and records with no full-card target. Preserve genuine box-only cards and the missing-box whole-image exclusion rule.

Add fixtures containing one card plus slab/title/inner-border annotations. Assert only intended whole-card targets survive and that known/unknown corner supervision remains correct. Add an enforceable category/provenance consistency check to assembly/preflight so a manifest can no longer pass solely on hashes and counts while representing the wrong target semantics. The current category audit is read-only diagnostic tooling, not that preflight gate.

### 2. Recompute coverage and repair eligible real supervision

Recount actual cards, trusted corners and scene slices after filtering. Sample every canonical source and inspect nested labels, corner order and polygon-fit quality. Current real scene metadata says `single_card_archive` for everything and is not evidence that binder scenes are absent. Add reliable corner supervision on eligible real binder/sleeve/multi-card/perspective TRAIN sources. Never recruit the already labeled Dev Mode/evaluation images into training.

The [unused-reference audit](reference-unused-materials-audit-2026-09-04.md) lists additional YGO and MTG archives worth checking. Eligibility, alias mapping, provenance, licensing and leakage must be recomputed against the current releases; historical “unused” counts are not proof of present eligibility. The external textures alone do not solve this real-scene gap.

### 3. Separate adapter and recognition questions

Correct YOLO11 numpy color handling with a file/PIL/BGR parity test and an explicit evaluation version. Do not overwrite the original reports or reuse a frozen tooling hash. `rerun_geometry_evaluation.py` currently supports only YOLOX and assumes epoch 50; do not call it for YOLO11s without generalizing and validating it.

A small, predeclared replay using trusted label-derived crops and the pinned recognition encoders can isolate recognition from geometry. Check exact family/printing labels and corner QA before interpreting that replay. No full retraining is needed for this diagnostic.

### 4. Validate, freeze, then train

Run trainer/runtime fixtures including AMP, standalone validation, real margins, mixed box-only instances and finite losses. Recompute archive assignments, exact and perceptual leakage, background provenance, semantic counts and policy checks on the successor. Preserve current releases as historical inputs. Freeze the successor corpus, policy decision, fairness/configuration, initialization, seed, budget and evaluation pins **before** results.

Use train-split self-evaluation before held-out scoring. A stronger small train-fit diagnostic may be useful, but its settings/gate must be declared rather than selected after seeing benchmark results. Assess per-scene tight geometry, misses, extras and downstream recognition; do not declare a winner solely on IoU .50 recall. Export/device latency work follows a convincing quality result and the appropriate license route.

## How to resume locally

Working directory: `/Users/ahmadjalil/github/TCGer`. There are many unrelated, uncommitted app/backend/mobile edits in this shared checkout. Inspect status, preserve them, and stage only explicitly owned paths. In particular, `docs/scanner-system/README.md` already had unrelated edits during this handoff; it was not staged or overwritten.

Useful local locations:

- Reference root: `/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference`.
- Canonical corpus: `<Reference>/TCGer-Scanner-Datasets/derived/card-segmentation/canonical-v1/corpus.jsonl`.
- Verified audit images: `.artifacts/card-geometry/failure-audit-inputs/images/`.
- Full train self-evaluation download: `.artifacts/card-geometry/yolox-loss-repair-final/train-self-evaluation.json`.
- External textures: `.artifacts/card-geometry/compositor-assets/backgrounds-polyhaven-cc0-candidate-v1/`.
- Python: `.artifacts/card-geometry/trainer-validation-venv/bin/python`. Local environment includes CPU Torch, numpy, Pillow, matplotlib, cv2, ONNX Runtime and Hugging Face Hub. Full MMYOLO work used its pinned Linux job environment.

Reproduce the saved-output analysis without GPU work:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/summarize_geometry_failures.py --audit docs/scanner-system/benchmarks/2026-09-06-real-failure-audit
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/render_geometry_failure_panels.py --audit docs/scanner-system/benchmarks/2026-09-06-real-failure-audit --images .artifacts/card-geometry/failure-audit-inputs
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/audit_canonical_target_categories.py --help
```

For the category audit supply the canonical path above, `--release .artifacts/card-geometry/releases/card-geometry-training-round-two-v1`, and an output path. It verifies manifest-record hashes and expects the old importer's annotation ordering; it must not infer alignment for a successor that filters/reorders annotations. Download missing assets from the recorded immutable publication, then verify their hashes; local `.artifacts` directories are caches, not substitutes for receipts.

Tests appropriate to current analysis tooling:

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python -m unittest discover -s tools/card-geometry -p test_failure_analysis.py
.artifacts/card-geometry/trainer-validation-venv/bin/python -m unittest discover -s tools/card-geometry -p test_failure_review_server.py
node --test tools/card-geometry/corner-editor/geometry.test.cjs
```

For future importer changes, run `test_real_smoke_release.py`, relevant training-geometry/preflight/cross-release tests and actual runtime fixtures where affected. Use `uvx --from ruff==0.15.8 ruff check <changed-python-files>`. Latest analysis verification: 5 tests + Ruff passed. Interface verification: 5 Python + 7 corner-math tests and browser save/reload smoke check. The earlier 234-test full geometry pass belongs to the loss-repair integration; do not present it as a new full-suite run for later changes.

### Review interface, if useful

```sh
.artifacts/card-geometry/trainer-validation-venv/bin/python tools/card-geometry/failure_review_server.py
```

URL: <http://127.0.0.1:8767>. It was left running locally; restart only if needed. It contains 600 evaluation, 88 validation and 24 training-label examples. Original editor: `corner_editor_server.py` and `corner-editor/`; comparison viewer: `failure_review_server.py` and `failure-review/`.

Real user journal: `.artifacts/card-geometry/human-failure-review/reviews.jsonl`. Test-only journal: `ui-smoke-test.jsonl` in the same directory; **never count the smoke-test reviewer as human evidence**. Saves append revisions with reviewer, time and immutable hashes. Read the real journal before assuming whether the user has saved anything. The analysis itself wrote no human reviews and changed no labels. Known UX limitations: original labels are hidden until toggled; the correction editor is prominent even when no relabeling is needed. The user explicitly asked the agent to do the comparison instead.

### Remote operations

Read the available HF Jobs / hf-cli skills before remote work. Use the supported Hugging Face Jobs MCP for submissions; use Hub APIs/CLI for permitted inspection, downloads and artifact publication. Reuse exact published job commands and digest-guarded source patches rather than guessing dependencies. The connector-provided token was read-only in this session; an already saved local write-capable token was supplied as a job secret when publication was required. Never print tokens, commit them, include them in prose receipts or bypass access failures.

Important code map: `corpus_release.py` / `preflight.py` enforce release integrity; `plan_real_archive_release.py` plans archives; `combine_geometry_releases.py` combines data; `training_geometry.py` handles shared supervision; `train_{yolo_pose,yolox_pose,fastvit_four_corner}.py` are trainers; `yolox_validation_fix.py` and `yolox_corner_loss.py` hold the repairs; `run_card_geometry_hf_job.py` orchestrates gates/training; `evaluate_geometry_candidate.py`, `benchmark_geometry.py`, `reference_geometry.py` and `crop_parity.py` define inference/scoring/crops. The source canonicalizer is `tools/card-segmentation-data/build_standardized_corpus.py`.

## First action for the next agent

Read the category audit and importer, write a mixed-category regression fixture, and repair the import boundary. Keep the old corpus and benchmarks untouched. Recompute what the repair changes before planning a successor release. There is no outstanding reason to wait for the user to compare these same images.
