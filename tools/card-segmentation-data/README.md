# Canonical card-segmentation data

This directory turns heterogeneous, immutable Roboflow COCO archives into one
reproducible card-localization corpus. It is the connection between raw source
downloads and future detector/segmentation training or localizer benchmarks.

The compiler does **not** pretend every label is the same thing. It preserves
six canonical semantic roles:

| Category | Role | Default use |
|---|---|---|
| `card` | primary | card localization and segmentation |
| `inner_border` | auxiliary | rectification and border research |
| `title_region` | auxiliary | OCR-region research |
| `info_region` | auxiliary | MTG rules/footer-region research |
| `collection_region` | auxiliary | set/collector-region research |
| `slab` | context | slab-aware localization; never silently relabeled as a card |

`source-config.json` is the reviewed mapping contract. An annotated source
class that is not explicitly mapped makes the build fail. A `null` mapping is
an intentional exclusion, generally for unused synthetic parent categories.

## Geometry tiers

The unified corpus keeps two geometry tiers separate:

- `source-polygon` and `source-rle` are masks from an instance-segmentation
  source. Whole-card masks in these tiers are eligible for segmentation
  evaluation.
- `bbox-derived` is a rectangular mask synthesized from an object-detection
  box. It is useful for detector pretraining and coarse localization testing,
  but is excluded from the segmentation-quality denominator.

This prevents a loose rectangular box from being scored as if it were a traced
card outline.

## Deduplication and split safety

The default `representative` policy keeps one image from each Roboflow
augmentation family. Exact duplicate bytes are merged first, with source
polygon annotations preferred over box-derived annotations. Known forks can
share an `originNamespace`; their independently encoded images remain usable,
but are assigned to the same canonical split so they cannot leak between
training and evaluation.

The original Roboflow train/valid/test value is retained as provenance only.
Canonical splits are rebuilt deterministically from origin-family groups using
the configured seed.

## Archive-backed build

This produces `corpus.jsonl`, `report.json`, and canonical COCO JSON without
extracting another copy of the images:

```sh
REFERENCE_ROOT='/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference/TCGer-Scanner-Datasets'

python3 tools/card-segmentation-data/build_standardized_corpus.py \
  --raw-dir "$REFERENCE_ROOT/raw" \
  --archive-manifest "$REFERENCE_ROOT/manifest.json" \
  --out .artifacts/card-segmentation-data/canonical-v1
```

Archive-backed COCO uses `zip://ARCHIVE#MEMBER` image references. Use
`corpus.jsonl` for inventory, filtering, sampling, and reproducibility checks.

## Materialized training or evaluation build

When a trainer or evaluator needs ordinary image paths, add
`--materialize-images`. Images are content-addressed and verified while being
extracted:

```sh
python3 tools/card-segmentation-data/build_standardized_corpus.py \
  --raw-dir "$REFERENCE_ROOT/raw" \
  --archive-manifest "$REFERENCE_ROOT/manifest.json" \
  --out .artifacts/card-segmentation-data/canonical-v1-materialized \
  --materialize-images
```

The resulting layout is:

```text
canonical-v1-materialized/
  corpus.jsonl
  report.json
  coco/train.json
  coco/validation.json
  coco/test.json
  coco-card-detection/*
  coco-card-segmentation/*
  images/train/*
  images/validation/*
  images/test/*
```

Use `coco-card-segmentation/` for card-only segmentation training and testing;
it contains only canonical category ID `1` with source masks. Use
`coco-card-detection/` for broader detector pretraining; it also includes
`bbox-derived` geometry. `coco/` retains every primary, auxiliary, and context
category for explicit multi-task experiments.

## Localizer benchmark connection

A materialized split can be passed directly to the existing localizer bake-off:

```sh
python3 tools/camera-corpus/bench_localizers.py \
  --out .artifacts/card-segmentation-data/localizer-benchmark \
  --coco canonical-test=.artifacts/card-segmentation-data/canonical-v1-materialized/coco-card-segmentation/test.json:.artifacts/card-segmentation-data/canonical-v1-materialized/images/test \
  --vision-swift tools/camera-corpus/vision-quads.swift
```

This card-only export avoids accidentally scoring title, border, information,
or slab regions as full cards.

## Adding a future dataset

1. Preserve and checksum the raw archive.
2. Add it to the reference library inventory.
3. Add a source entry to `source-config.json` with its task, license, and an
   explicit mapping for every annotated source class.
4. Set `originNamespace` when it is a fork or re-export of a known source.
5. Run the unit tests and an archive-backed build.
6. Review `sourceAudit`, geometry counts, deduplication counts, and split counts
   in `report.json` before materializing or training.

Tests:

```sh
python3 -m unittest tools/card-segmentation-data/test_build_standardized_corpus.py
```
