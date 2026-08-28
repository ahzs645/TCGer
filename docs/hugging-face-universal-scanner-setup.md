# Hugging Face universal scanner setup

> **Historical workflow.** The mixed-game quick job described here completed,
> followed by isolated full Pokémon, Magic, and Yu-Gi-Oh jobs. Full jobs now
> require pinned catalog and durable image-library revisions unless explicitly
> reproducing a legacy run. Use
> [scanner-system/training-and-data-pipeline.md](scanner-system/training-and-data-pipeline.md)
> and [scanner-system/operations-runbook.md](scanner-system/operations-runbook.md)
> for the current process.

The Hugging Face workflow is split deliberately so account setup and GPU
billing cannot block or accidentally start training.

## What this trains

One game-neutral FastViT-T8 ArcFace encoder learns card appearance across
Pokemon, Magic: The Gathering, and Yu-Gi-Oh. The export contains both:

- a combined universal index for automatic/game-neutral scanning;
- independent `pokemon`, `magic`, and `yugioh` index shards for explicit game
  modes and smaller downloads.

The Roboflow scene datasets remain a separate whole-card detector track. They
are useful for localization, but they are not complete identity catalogs and
are not inputs to this ArcFace recognition job.

## Phase 1: free local preflight

This downloads only authoritative catalog metadata, converts it to trainer
rows, verifies every game, and records source checksums. It does not allocate a
GPU and does not require Hugging Face authentication.

```bash
uv run mobile-apps/ios/scripts/prepare_universal_arcface_hub.py --no-upload
```

Generated files land under `.artifacts/huggingface/` and are ignored by Git.
Successful preflight writes `catalogs/preflight.json` with
`status: ready-for-gpu` and exact per-game row counts.

## Phase 2: free private Hub setup

Authenticate without pasting a token into a terminal command or repository:

```bash
hf auth login
hf auth whoami
```

Then create/update the private model repository and upload the prepared
catalogs:

```bash
uv run mobile-apps/ios/scripts/prepare_universal_arcface_hub.py \
  --hub-repo ahzs645/tcger-universal-arcface
```

This phase is still CPU/local work. It verifies Hub write permission before
any paid hardware is requested. The intended repository layout is:

```text
catalogs/
  pokemon/CardsIndexMetadata.json
  magic/CardsIndexMetadata.json
  yugioh/CardsIndexMetadata.json
  CardsIndexMetadata-universal.json
  provenance.json
  preflight.json
training/
  quick/arcface-checkpoint.pt
  full/arcface-checkpoint.pt
exports/
  quick/
  full/
    CardEmbeddings-arcface.mlpackage.zip
    CardsIndexMetadata.json
    CardsIndexVectors-arcface.bin
    shards/{pokemon,magic,yugioh}/...
    arcface-eval.json
```

## Phase 3: GPU smoke test

Do not submit this phase until Hugging Face Jobs is enabled and a write token
is available. Before submission, choose the dataset scope, validation plan,
and hardware. Always run `quick` before `full`.

The job first reuses the prepared `catalogs/` files, downloads the card images
to ephemeral local storage, then persists its checkpoint after every epoch.
If interrupted, the next job resumes only when the catalog fingerprint
matches.

```bash
hf jobs uv run mobile-apps/ios/scripts/run_universal_arcface_hf_job.py \
  --flavor <chosen-hardware> \
  --timeout 6h \
  --secrets HF_TOKEN \
  -- \
  --hub-repo ahzs645/tcger-universal-arcface \
  --mode quick
```

The quick job caps each game at 2,000 identities and runs three epochs. It is a
pipeline and export check, not the production checkpoint.

## Phase 4: full GPU training

After the smoke test produces valid retrieval metrics, Core ML export, and all
three shards, submit the same script with `--mode full`. Full mode uses every
catalog row and twelve epochs by default.

The following checks are required before publishing the checkpoint to the app:

1. Per-game recall is reported separately as well as combined recall.
2. The universal and game-specific vector headers match their metadata counts.
3. Core ML produces a normalized 384-dimensional embedding.
4. Existing Pokemon replay tests do not regress.
5. MTG and Yu-Gi-Oh real-camera replay sets are evaluated separately from
   synthetic/catalog-view retrieval.

The Pokemon acceptance gate also runs the currently shipped production
ArcFace ONNX and the universal encoder over the exact same deterministic
augmented Pokemon queries. Both models search the same Pokemon-only gallery;
`arcface-eval.json` records their Recall@1/Recall@5 and the universal-minus-
production delta. The historical 97.9% Recall@1 remains useful context, but
is not used as a substitute for this paired comparison.
