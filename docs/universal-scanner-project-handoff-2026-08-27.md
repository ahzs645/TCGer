# Universal TCG scanner project handoff

> **Historical snapshot.** This handoff records the state before the isolated
> full Pokémon, Magic, and Yu-Gi-Oh jobs completed and before their web/iOS/
> Android R2 releases were published. Current architecture, releases,
> operations, decisions, and known issues—including Pokémon TCG Pocket
> contamination—are indexed in
> [docs/scanner-system/README.md](scanner-system/README.md).

**Date:** 2026-08-27
**Repository:** `ahzs645/TCGer`
**Pull request:** [TCGer PR #39](https://github.com/ahzs645/TCGer/pull/39)
**Hugging Face repository:** [ahzs645/tcger-universal-arcface](https://huggingface.co/ahzs645/tcger-universal-arcface)

## Executive summary

The target architecture is one shared whole-card detector and one game-neutral
ArcFace encoder with independent Pokemon, Magic: The Gathering, and Yu-Gi-Oh
search-index shards. Automatic mode searches compatible installed shards;
game-specific mode searches only the selected game.

The runtime architecture, catalog conversion, Hub preparation, trainer,
checkpointing, combined/per-game export, and a small GPU smoke test are done.
The Hub catalogs contain 147,642 model-ready reference rows.

There is no production universal checkpoint yet. The corrected paired
comparison against the shipped Pokemon ArcFace model is complete: production
ArcFace materially outperformed the quick universal Pokemon shard. The full
12-epoch training run has not been launched and is not approved.

A persistent Hugging Face CLI credential and Jobs secret now pass repository
read/write checks. The repeated five-minute device-authorization workaround is
retired; do not use more device-code bootstrap jobs.

## Goals

1. Detect and rectify a card without assuming its game.
2. Compute one normalized 384-dimensional embedding with a shared encoder.
3. Support Automatic and game-specific scanner modes.
4. Download and version each game index independently.
5. Add MTG and Yu-Gi-Oh without regressing Pokemon.
6. Identify card artwork visually, then use game-specific metadata/OCR to
   resolve exact printings.
7. Keep Drive as the canonical raw archive and Hugging Face as the versioned,
   model-ready distribution and training-artifact layer.

## Architecture

| Layer | Scope | Responsibility |
|---|---|---|
| Whole-card detector | Shared | Find and rectify cards in camera scenes |
| ArcFace encoder | Shared | Produce one normalized embedding |
| Automatic router | Shared | Select the likely game/index shard |
| Pokemon index | Game-specific | Search Pokemon references |
| MTG index | Game-specific | Search Scryfall printing/card-face references |
| Yu-Gi-Oh index | Game-specific | Search YGOPRODeck artwork/passcode references |
| OCR/verification | Game-specific | Resolve collector number, set, face, and set-code ties |

Roboflow datasets belong to detector training and real-camera evaluation. They
are too incomplete to be production recognition catalogs. Recognition uses
the authoritative Pokemon catalog, Scryfall, and YGOPRODeck mirrors.

## Data prepared

### Google Drive

A game-separated structure was created under
`TCGer-Scanner-Datasets/games`, with `raw`, `derived`, `catalog`, `replay`, and
`models` areas. Existing Pokemon paths were kept compatible with older tools.

Six Roboflow archives were downloaded and checksummed:

| Game | Archive size |
|---|---:|
| Pokemon | 349.3 MB |
| Magic: The Gathering | 295.4 MB |
| Yu-Gi-Oh | 109.3 MB |
| Total | approximately 754 MB |

The comprehensive Scryfall and YGOPRODeck source-image mirrors were located in
the UniFi backup. Those are the recognition references.

### Hugging Face

The private model repository contains normalized catalogs, source versions,
checksums, provenance, and a `ready-for-gpu` preflight record:

| Catalog | Rows |
|---|---:|
| Pokemon | 21,828 |
| MTG | 111,131 visible faces |
| Yu-Gi-Oh | 14,683 artwork identities |
| Universal | 147,642 |

The shipped Pokemon ONNX baseline was uploaded as:

`baselines/pokemon/card-embeddings-arcface-production-fp16.onnx`

## Software completed

Main contains the shared-encoder/game-shard runtime, universal metadata
converter, free catalog preflight, resumable Hub job, multi-game trainer,
combined/per-game export, and Scryfall 2026 compatibility.

The local-only recovery layer adds:

- `--pokemon-baseline-onnx` paired acceptance evaluation;
- identical augmented Pokemon pixels with each encoder's required preprocessing;
- a shared Pokemon-only gallery for both models;
- Recall@1, Recall@5, model delta, providers, and baseline SHA-256;
- support for the production ONNX's fixed batch size of one;
- a local/pinned `--trainer-script` override;
- automatic baseline download from the private model repository.

The relevant scripts are:

- `mobile-apps/ios/scripts/build_universal_trainer_metadata.py`
- `mobile-apps/ios/scripts/prepare_universal_arcface_hub.py`
- `mobile-apps/ios/scripts/run_universal_arcface_hf_job.py`
- `mobile-apps/ios/scripts/train_arcface_encoder.py`

## GPU smoke test

The initial L4 quick job completed successfully:

- **Job:** [`6a8f78a4984507d9db4e69da`](https://huggingface.co/jobs/ahzs645/6a8f78a4984507d9db4e69da)
- **Scope:** up to 2,000 identities per game
- **Epochs:** 3

| Slice | Recall@1 | Recall@5 |
|---|---:|---:|
| Combined | 89.58% | 92.54% |
| Pokemon | 92.57% | 96.45% |
| MTG | 77.23% | 81.30% |
| Yu-Gi-Oh | 98.97% | 99.90% |

This proves that mixed-game training and shard export work. It does not prove
production quality: it used a small sample, three epochs, synthetic/catalog
queries, and predates the corrected paired production-Pokemon comparison.

MTG is the weakest slice. Its larger visual variety, shared/repeated artwork,
multi-face cards, and printing-specific verification needs require focused
evaluation.

## Current Pokemon baseline

| Evidence | Result |
|---|---:|
| Historical catalog Recall@1 | 97.91% |
| Historical catalog Recall@5 | 99.31% |
| Current real iOS replay recovery | 46 / 76 |
| Current real iOS replay wrong accepts | 0 |
| ONNX SHA-256 | `a5d867cc0b2b16a91ee7f12106bb9b57a3ab8cd752352dbb87db53d177abd2b5` |

The historical metrics are context, not an acceptance gate, because their
queries differ from the universal quick run. The paired evaluator creates the
required apples-to-apples comparison.

## Corrected paired Pokemon A/B result

The corrected L4 evaluation reused the existing quick checkpoint and evaluated
1,983 Pokemon identities with three augmented queries per identity. Each model
received the same augmented RGB pixels through its own required preprocessing
contract.

- **Job:** [`6a8fb8dd984507d9db4e6fc7`](https://huggingface.co/jobs/ahzs645/6a8fb8dd984507d9db4e6fc7)
- **Git revision:** `16da75ec`
- **Pinned Hub revision:** `46e6e798cf287e54a6ae1251def090595dd54e4b`
- **Duration:** 334 seconds on one L4

| Model | Recall@1 | Recall@5 |
|---|---:|---:|
| Production Pokemon ArcFace | 99.58% | 100.00% |
| Quick universal Pokemon shard | 92.70% | 96.47% |
| Universal delta | -6.88 points | -3.53 points |

The quick universal checkpoint is not a production replacement for Pokemon.
This result does not justify the full training run by itself. Review whether to
improve the training recipe, preserve a dedicated Pokemon encoder, or add a
Pokemon-specific adapter/head before spending on full training.

## Failures and lessons

### Device authorization is the wrong pipeline primitive

The connected Jobs credential can submit compute but lacks repository-write
permission. A CPU bootstrap Job requested a five-minute browser authorization,
uploaded code, and attempted to launch an L4 child job with the temporary
token. Repeated expiry made the process brittle and user-dependent. Retire it.

The local CLI credential is now the persistent least-privilege path for Hub
writes and Jobs. CPU preflight Job
[`6a8fb5ed45686a1580c0c949`](https://huggingface.co/jobs/ahzs645/6a8fb5ed45686a1580c0c949)
successfully uploaded and read back a marker before GPU work resumed.

### The quick model is a plumbing test

Quick mode was valuable because it found integration errors cheaply. It must
not be shipped or treated as the full model.

### The production ONNX has fixed batch size one

The first paired A/B job
[`6a8f8fcf45686a1580c0c389`](https://huggingface.co/jobs/ahzs645/6a8f8fcf45686a1580c0c389)
failed when a batch of 256 was passed to a model expecting one sample:

`Got 256; Expected 1`

The recovered trainer detects that fixed dimension and evaluates the baseline
one sample at a time while keeping the universal model batched.

### The production ONNX owns its preprocessing contract

The first completed rerun incorrectly fed ImageNet-normalized tensors to the
production ONNX even though that normalization is already baked into the
model. Its near-zero score was invalid. Commit `16da75ec` reconstructs the
shared RGB `[0,1]` augmented pixels for the ONNX while retaining normalized
input for the universal PyTorch model. The corrected production result is
99.58% Recall@1, consistent with the baseline rather than the invalid run.

### Reproducibility is part of the model contract

Catalog fingerprints, pinned code, model hashes, compatibility metadata, and
per-epoch checkpoints are required. Never resume a checkpoint against silently
changed catalogs or load an index produced by another encoder.

### Recognition and printing resolution differ

Embeddings can identify artwork while leaving multiple possible printings.
MTG requires set/collector-number and card-face checks. Yu-Gi-Oh requires
printed set-code verification when artwork and passcode are shared.

### Catalog retrieval does not replace camera replay

Synthetic views measure representation quality. Real replay is required for
glare, blur, sleeves, perspective, partial crops, foil cards, and difficult
lighting. Poor localization can fail before recognition; detector work should
continue independently.

## Current status

| Area | Status |
|---|---|
| Drive game structure and Roboflow archives | Complete |
| Authoritative reference mirrors located | Complete |
| Hub catalogs and preflight | Complete |
| Automatic/game-specific runtime | Merged to main |
| Quick L4 smoke test | Complete |
| Production Pokemon baseline on Hub | Complete |
| Paired Pokemon evaluator | Fixed, reviewed, and pinned |
| Corrected paired GPU result | Complete; production wins |
| Full 147,642-row, 12-epoch model | Not started |
| Real-camera validation for all games | Not complete |
| Production packaging | Not complete |

## Sustainable next pipeline

### Phase 0: fix authentication once (complete)

1. Create a fine-grained token that can read/write the private model repository
   and submit/inspect Jobs.
2. Store it as a persistent Jobs secret or stable CLI credential. Never put it
   in Git, chat, scripts, or logs.
3. Run a CPU-only upload/readback test before allocating a GPU.

### Phase 1: preserve code (complete)

1. Apply the recovery patch to PR #39.
2. Review and push the paired-evaluation changes.
3. Upload the exact reviewed trainer/wrapper under an immutable Hub code path.
4. Record the Git revision, catalog fingerprint, dependencies, and baseline
   hash in the run manifest.

### Phase 2: finish the quick Pokemon A/B comparison (complete)

1. Resume the existing quick checkpoint.
2. Run both models on the same Pokemon gallery and augmented queries.
3. Persist `arcface-eval.json`, the model export, and all shards.
4. Use this first comparable result to set the production regression gate.

Do not invent a final threshold from historical, non-comparable metrics.

### Phase 3: decide whether full training is justified

Full mode uses 147,642 rows and 12 epochs. Prior scaling suggested roughly
18–24 hours on one L4. The live Jobs listing on 2026-08-27 showed US$0.80/hour,
or approximately US$14.40–19.20 at that duration; pricing can change. Confirm
live pricing and obtain explicit hardware/cost approval immediately before
submission.

The quick paired result currently argues against approving a full run solely
to replace the Pokemon model. Define a plausible training improvement or an
MTG/Yu-Gi-Oh-specific value case before requesting that approval.

Confirm per-epoch persistence and a successful resume test first, so an
interruption cannot lose more than one epoch.

### Phase 4: production evaluation

1. Repeat the paired Pokemon comparison using the full model.
2. Run both models against the immutable Pokemon replay set.
3. Preserve zero wrong accepts and measure recovery against 46/76.
4. Build separate MTG and Yu-Gi-Oh camera replay suites.
5. Measure routing errors separately from within-game recognition errors.
6. Calibrate rejection thresholds independently per game.
7. Add printing verification for MTG and Yu-Gi-Oh.

### Phase 5: package only after acceptance

Publish the universal encoder in checkpoint, ONNX, and Core ML forms, plus the
combined index and independent game shards. Include thresholds, compatibility
metadata, fingerprints, and evaluation reports.

If Pokemon regresses, keep the existing Pokemon encoder and use the universal
work for MTG/Yu-Gi-Oh, or add a small Pokemon adapter/head while retaining the
shard architecture.

## Resume checklist

- [x] Persistent Hub write/Jobs credential works without device authorization.
- [x] Recovery patch is reviewed, merged, and pushed to main.
- [x] Corrected trainer is pinned on the Hub.
- [x] CPU read/write preflight succeeds.
- [x] Quick paired Pokemon A/B run completes and persists metrics.
- [ ] User reviews metrics and approves hardware/cost.
- [ ] Full run completes with resumable checkpoints.
- [ ] All real-camera suites pass their acceptance gates.
- [ ] Universal and per-game assets are versioned for the apps.

## Bottom line

The project is not starting over. The architecture, runtime, catalogs,
training pipeline, smoke test, persistent authentication, and corrected paired
comparison exist. The quick universal model trails production Pokemon ArcFace,
so the next decision is how to improve or narrow the universal training goal.
Do not launch full training without a concrete rationale and explicit approval.
